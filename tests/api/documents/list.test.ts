import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { Pool } from "pg";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import * as auth from "@/lib/server/auth";
import { GET } from "@/app/api/documents/route";
import { GET as detail } from "@/app/api/documents/[id]/route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import { GET as versions } from "@/app/api/documents/[id]/versions/route";
import { resetDocumentStoreForTesting } from "@/lib/server/db/documentStore";

const url = process.env.ASR_TEST_DATABASE_URL;
describe.skipIf(!url)("private document list", () => {
    const owner = randomUUID(),
        other = randomUUID();
    const sessionId = "list-" + randomUUID();
    const ids = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
    ];
    let pool: Pool;
    beforeEach(() => resetRateLimits());
    const call = (query = "") =>
        GET(new Request("http://localhost/api/documents" + query));
    function login(id: string, role = "user") {
        vi.spyOn(auth, "getSession").mockResolvedValue({
            user: { id, role, email: "fixture@example.test", name: "Fixture" },
        });
    }
    beforeAll(async () => {
        vi.stubEnv("DATABASE_URL", url);
        resetDocumentStoreForTesting();
        pool = new Pool({ connectionString: url });
        await pool.query(
            "insert into auth_user(id,email,name,role,email_verified) values ($1,$2,'A','user',true),($3,$4,'B','admin',true)",
            [owner, owner + "@example.test", other, other + "@example.test"]
        );
        await pool.query(
            "insert into sessions(id,locale,audio_sha256,audio_bytes,transcript) values ($1,'id','test',1,'private')",
            [sessionId]
        );
        for (let i = 0; i < ids.length; i++) {
            const root = i === 1 ? ids[0] : ids[i];
            const payload = {
                locale: "id",
                mata_uang: "IDR",
                proyek: {
                    nama: i === 2 ? "Literal % project" : "Other",
                    klien: "Client",
                    lokasi: "private",
                },
                total_nominal: 123,
                pekerjaan: [],
                internal: "secret",
            };
            await pool.query(
                `insert into documents(id,session_id,locale,nomor,status,turns_hash,data_json,user_id,root_id,version,created_at) values($1,$2,'id',null,'draf',$3,$4,$5,$6,$7,'2026-01-01T00:00:00.123456Z')`,
                [
                    ids[i],
                    sessionId,
                    "hash-" + i,
                    JSON.stringify(payload),
                    i === 3 ? other : i === 4 ? null : owner,
                    root,
                    i === 1 ? 2 : 1,
                ]
            );
        }
    });
    afterAll(async () => {
        vi.restoreAllMocks();
        if (pool) {
            await pool.query("delete from sessions where id=$1", [sessionId]);
            await pool.query("delete from auth_user where id=any($1::uuid[])", [
                [owner, other],
            ]);
            await pool.end();
        }
        vi.unstubAllEnvs();
        resetDocumentStoreForTesting();
    });
    it("rejects anonymous and invalid limits", async () => {
        vi.spyOn(auth, "getSession").mockResolvedValue(null);
        expect((await call()).status).toBe(401);
        login(owner);
        expect((await call("?limit=0")).status).toBe(400);
        expect((await call("?cursor=garbage")).status).toBe(400);
        for (const query of [
            "?limit=101",
            "?limit=007",
            "?limit=bad",
            "?search=" + "a".repeat(201),
            "?cursor=" +
                Buffer.from(
                    JSON.stringify({
                        createdAt: "2026-02-30T00:00:00.000000Z",
                        id: ids[0],
                    })
                ).toString("base64url"),
        ]) {
            expect((await call(query)).status).toBe(400);
        }
    });
    it("returns only latest owned rows with stable timestamp ties and minimal DTO", async () => {
        login(owner);
        const response = await call("?limit=1");
        expect(response.status).toBe(200);
        const first = await response.json();
        expect(first.items).toHaveLength(1);
        expect(first.nextCursor).toBeTruthy();
        const second = await (
            await call(
                "?limit=1&cursor=" + encodeURIComponent(first.nextCursor)
            )
        ).json();
        expect([first.items[0].id, second.items[0].id].sort()).toEqual(
            [ids[1], ids[2]].sort()
        );
        expect(second.nextCursor).toBeNull();
        expect(JSON.stringify(first)).not.toContain("secret");
        expect(Object.keys(first.items[0]).sort()).toEqual(
            [
                "id",
                "rootId",
                "nomor",
                "status",
                "proyek",
                "klien",
                "locale",
                "mata_uang",
                "total",
                "createdAt",
                "version",
            ].sort()
        );
        expect(first.items[0].createdAt).toBe("2026-01-01T00:00:00.123456Z");
        const contract = JSON.parse(
            await import("node:fs/promises").then((fs) =>
                fs.readFile("contracts/openapi/openapi.json", "utf8")
            )
        );
        expect(Object.keys(first.items[0]).sort()).toEqual(
            [...contract.components.schemas.DocumentListItem.required].sort()
        );
    });
    it("searches literal wildcards and does not grant admins cross-account list access", async () => {
        login(owner);
        const result = await (await call("?search=%25&status=draf")).json();
        expect(result.items.map((x: { id: string }) => x.id)).toEqual([ids[2]]);
        login(other, "admin");
        const admin = await (await call()).json();
        expect(admin.items.map((x: { id: string }) => x.id)).toEqual([ids[3]]);
    });
    it("filters after selecting the latest version and preserves legacy status normalization", async () => {
        await pool.query("update documents set status='siap' where id=$1", [
            ids[0],
        ]);
        login(owner);
        const approved = await (await call("?status=disetujui")).json();
        expect(approved.items).toEqual([]);
        await pool.query(
            "update documents set status='perlu_konfirmasi' where id=$1",
            [ids[2]]
        );
        const draft = await (await call("?search=%25&status=draf")).json();
        expect(draft.items[0].status).toBe("draf");
        expect((await call("?status=unknown")).status).toBe(400);
        expect((await call("?limit=1&limit=2")).status).toBe(400);
        expect((await call("?search=%00")).status).toBe(400);
    });
    it("returns only the authenticated owner's version history even for admins", async () => {
        const history = (id: string) =>
            versions(
                new Request(
                    "http://localhost/api/documents/" + id + "/versions"
                ),
                { params: Promise.resolve({ id }) }
            );
        login(owner);
        const response = await history(ids[0]);
        expect(response.status).toBe(200);
        expect(
            (await response.json()).items.map((x: { id: string }) => x.id)
        ).toEqual([ids[1], ids[0]]);
        login(other, "admin");
        expect((await history(ids[0])).status).toBe(404);
        expect((await history(ids[4])).status).toBe(404);
        vi.spyOn(auth, "getSession").mockResolvedValue(null);
        expect((await history(ids[0])).status).toBe(401);
    });
    it("keeps another owner's revision out of private history and list", async () => {
        const revision = randomUUID();
        await pool.query(
            "insert into documents(id,session_id,locale,nomor,status,turns_hash,data_json,user_id,root_id,version,created_at) select $1,session_id,locale,null,'draf',$2,data_json,$3,root_id,3,created_at from documents where id=$4",
            [revision, randomUUID(), other, ids[1]]
        );
        try {
            await pool.query(
                "update documents set superseded_by=$1 where id=$2",
                [revision, ids[1]]
            );
            login(owner);
            const oldDetail = await detail(
                new Request("http://localhost/api/documents/" + ids[1]),
                { params: Promise.resolve({ id: ids[1] }) }
            );
            expect(oldDetail.status).toBe(200);
            const oldBody = await oldDetail.json();
            expect(oldBody.versions.map((x: { id: string }) => x.id)).toEqual([
                ids[1],
                ids[0],
            ]);
            expect(oldBody.superseded_by).toBeNull();
            expect(JSON.stringify(oldBody)).not.toContain(revision);
            login(other, "admin");
            const adminDetail = await detail(
                new Request("http://localhost/api/documents/" + ids[1]),
                { params: Promise.resolve({ id: ids[1] }) }
            );
            expect(
                (await adminDetail.json()).versions.map(
                    (x: { id: string }) => x.id
                )
            ).toEqual([revision, ids[1], ids[0]]);
            login(owner);
            const list = await (await call()).json();
            expect(list.items.map((x: { id: string }) => x.id).sort()).toEqual(
                [ids[1], ids[2]].sort()
            );
            const response = await versions(
                new Request(
                    "http://localhost/api/documents/" + ids[0] + "/versions"
                ),
                { params: Promise.resolve({ id: ids[0] }) }
            );
            expect(
                (await response.json()).items.map((x: { id: string }) => x.id)
            ).toEqual([ids[1], ids[0]]);
            expect(
                (
                    await versions(
                        new Request(
                            "http://localhost/api/documents/" +
                                revision +
                                "/versions"
                        ),
                        { params: Promise.resolve({ id: revision }) }
                    )
                ).status
            ).toBe(404);
        } finally {
            await pool.query(
                "update documents set superseded_by=null where id=$1",
                [ids[1]]
            );
            await pool.query("delete from documents where id=$1", [revision]);
        }
    });
    it("returns a usable page even if an owned legacy row has malformed summary data", async () => {
        const { rows } = await pool.query(
            "select data_json from documents where id=$1",
            [ids[2]]
        );
        await pool.query("update documents set data_json=$2 where id=$1", [
            ids[2],
            JSON.stringify({
                total_nominal: "invalid",
                proyek: { nama: 42 },
                mata_uang: "bad",
            }),
        ]);
        try {
            login(owner);
            const res = await call();
            expect(res.status).toBe(200);
            const item = (await res.json()).items.find(
                (x: { id: string }) => x.id === ids[2]
            );
            expect(item).toMatchObject({
                total: null,
                proyek: null,
                klien: null,
                mata_uang: null,
            });
        } finally {
            await pool.query("update documents set data_json=$2 where id=$1", [
                ids[2],
                JSON.stringify(rows[0].data_json),
            ]);
        }
    });
    it("returns 503 if the document store is not configured", async () => {
        login(owner);
        resetDocumentStoreForTesting();
        vi.stubEnv("DATABASE_URL", undefined);
        try {
            expect((await call()).status).toBe(503);
            expect(
                (
                    await versions(
                        new Request(
                            "http://localhost/api/documents/" +
                                ids[0] +
                                "/versions"
                        ),
                        { params: Promise.resolve({ id: ids[0] }) }
                    )
                ).status
            ).toBe(503);
        } finally {
            vi.stubEnv("DATABASE_URL", url);
            resetDocumentStoreForTesting();
        }
    });
    it("rate limits the list and history separately from writes", async () => {
        login(owner);
        for (let i = 0; i < 30; i++)
            expect((await call("?limit=0")).status).toBe(400);
        const denied = await call("?limit=0");
        expect(denied.status).toBe(429);
        expect(denied.headers.get("Retry-After")).toBeTruthy();
        const history = () =>
            versions(
                new Request("http://localhost/api/documents/invalid/versions"),
                { params: Promise.resolve({ id: "invalid" }) }
            );
        for (let i = 0; i < 30; i++) expect((await history()).status).toBe(400);
        expect((await history()).status).toBe(429);
    });
    it("checks real signed cookies and account isolation without mocking auth", async () => {
        vi.restoreAllMocks();
        const cookies: string[] = [];
        const cookieName = (await auth.auth.$context).authCookies.sessionToken
            .name;
        for (const id of [owner, other]) {
            const token = randomBytes(32).toString("hex");
            await pool.query(
                "insert into auth_session(id,expires_at,token,user_id) values($1,now()+interval '10 minutes',$2,$3)",
                [randomUUID(), token, id]
            );
            const signature = createHmac("sha256", auth.AUTH_SECRET)
                .update(token)
                .digest("base64");
            cookies.push(
                cookieName + "=" + encodeURIComponent(token + "." + signature)
            );
        }
        const req = (path: string, cookie: string) =>
            new Request("http://localhost" + path, { headers: { cookie } });
        for (const [index, expected] of [
            [0, [ids[1], ids[2]]],
            [1, [ids[3]]],
        ] as const) {
            const res = await GET(req("/api/documents", cookies[index]));
            expect(res.status).toBe(200);
            expect(
                (await res.json()).items.map((x: { id: string }) => x.id).sort()
            ).toEqual([...expected].sort());
        }
        const path = "/api/documents/" + ids[0] + "/versions";
        expect(
            (
                await versions(req(path, cookies[0]), {
                    params: Promise.resolve({ id: ids[0] }),
                })
            ).status
        ).toBe(200);
        expect(
            (
                await versions(req(path, cookies[1]), {
                    params: Promise.resolve({ id: ids[0] }),
                })
            ).status
        ).toBe(404);
        expect(
            (await GET(req("/api/documents", cookieName + "=invalid"))).status
        ).toBe(401);
    });
    it("defaults to 20 items and continues through the remaining roots", async () => {
        await pool.query(
            "insert into documents(session_id,locale,nomor,status,turns_hash,data_json,user_id,version,created_at) select session_id,locale,null,'draf',$2 || n::text,data_json,user_id,1,created_at from documents cross join generate_series(1,21) n where id=$1",
            [ids[2], randomUUID()]
        );
        login(owner);
        const page = await (await call()).json();
        expect(page.items).toHaveLength(20);
        expect(page.nextCursor).toBeTruthy();
        const remaining = await (
            await call("?cursor=" + encodeURIComponent(page.nextCursor))
        ).json();
        expect(remaining.items).toHaveLength(3);
        expect(remaining.nextCursor).toBeNull();
        expect(
            new Set(
                [...page.items, ...remaining.items].map(
                    (x: { id: string }) => x.id
                )
            ).size
        ).toBe(23);
    });
});
