import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
    parseAndValidateSandboxUrl,
    verifySandboxIdentity,
} from "../../../scripts/sandbox/dbGuard.mjs";

const baseUrl = "http://127.0.0.1:3010";
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32)
    throw new Error("Set the isolated server's test signing secret");
parseAndValidateSandboxUrl(process.env.DATABASE_URL);
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
});
const owners = [randomUUID(), randomUUID()];
const sessionId = "hurl-" + randomUUID();
const root = randomUUID();
const latest = randomUUID();
const search = randomUUID();
const other = randomUUID();
const legacy = randomUUID();
let fixtureId;
let verified = false;
try {
    await verifySandboxIdentity(pool);
    verified = true;
    const health = await fetch(baseUrl + "/api/health");
    if (!health.ok) throw new Error("Start the isolated sandbox first");
    const cookies = [];
    for (const [i, id] of owners.entries()) {
        const token = randomBytes(32).toString("hex");
        const sig = createHmac("sha256", secret).update(token).digest("base64");
        cookies.push(encodeURIComponent(token + "." + sig));
        await pool.query(
            "insert into auth_user(id,email,name,role,email_verified) values($1,$2,'Hurl fixture',$3,true)",
            [id, id + "@example.test", i === 0 ? "user" : "admin"]
        );
        await pool.query(
            "insert into auth_session(id,expires_at,token,user_id) values($1,now()+interval '10 minutes',$2,$3)",
            [randomUUID(), token, id]
        );
    }
    await pool.query(
        "insert into sessions(id,locale,audio_sha256,audio_bytes,transcript) values($1,'id','test',1,'private')",
        [sessionId]
    );
    // UUID ordering is deterministic for the two rows with the same timestamp.
    const pair = [latest, search].sort();
    const latestId = pair[1],
        searchId = pair[0];
    const docs = [
        [root, root, 1, owners[0], "disetujui", "Old"],
        [latestId, root, 2, owners[0], "draf", "New"],
        [searchId, searchId, 1, owners[0], "draf", "Literal % project"],
        [other, other, 1, owners[1], "draf", "Other account"],
        [legacy, legacy, 1, null, "draf", "Legacy unowned"],
    ];
    for (const [id, rootId, version, owner, status, project] of docs) {
        const payload = {
            locale: "id",
            mata_uang: "IDR",
            proyek: { nama: project, klien: "Fixture", lokasi: "private" },
            total_nominal: 123,
            pekerjaan: [],
        };
        await pool.query(
            "insert into documents(id,session_id,locale,nomor,status,turns_hash,data_json,user_id,root_id,version,created_at) values($1,$2,'id',null,$3,$4,$5,$6,$7,$8,'2026-01-01T00:00:00.123456Z')",
            [
                id,
                sessionId,
                status,
                randomUUID(),
                JSON.stringify(payload),
                owner,
                rootId,
                version,
            ]
        );
    }
    fixtureId = await mkdtemp(join(tmpdir(), "slm-hurl-"));
    const vars = join(fixtureId, "vars");
    await writeFile(
        vars,
        Object.entries({
            base_url: baseUrl,
            cookie_a: cookies[0],
            cookie_b: cookies[1],
            root_id: root,
            latest_id: latestId,
            search_id: searchId,
            other_id: other,
        })
            .map(([k, v]) => k + "=" + v)
            .join("\n"),
        { mode: 0o600 }
    );
    const result = spawnSync(
        process.env.HURL_BIN || "hurl",
        ["--test", "--variables-file", vars, "tests/api/documents/list.hurl"],
        { encoding: "utf8", timeout: 90000 }
    );
    if (result.status !== 0) {
        // Report only line numbers and test summary, never request headers or cookies.
        const lines = (result.stderr ?? "")
            .split("\n")
            .filter((line) =>
                /list\.hurl:\d+|^Executed files:|^Succeeded files:|^Failed files:|^Errors:|^error:/.test(
                    line
                )
            );
        console.error(lines.join("\n"));
        throw new Error("Hurl document checks failed");
    }
    console.log("Hurl private list and history: 11 HTTP requests passed");
} catch {
    console.error("Ticket 03 HTTP proof failed");
    process.exitCode = 1;
} finally {
    if (fixtureId) await rm(fixtureId, { recursive: true, force: true });
    try {
        if (verified) {
            await pool.query("delete from sessions where id=$1", [sessionId]);
            await pool.query("delete from auth_user where id=any($1::uuid[])", [
                owners,
            ]);
        }
    } finally {
        await pool.end();
    }
}
