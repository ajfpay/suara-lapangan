import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import * as auth from "@/lib/server/auth";
import { GET } from "@/app/api/documents/route";
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
            await pool.query("delete from documents where id=$1", [revision]);
        }
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
