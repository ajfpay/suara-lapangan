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

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32)
    throw new Error("Set the isolated server's test signing secret");
parseAndValidateSandboxUrl(process.env.DATABASE_URL);
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
});
const user = randomUUID();
const session = "hurl-draft-" + randomUUID();
const documentId = randomUUID();
const baseUrl = "http://127.0.0.1:3010";
let directory;
let verified = false;
try {
    await verifySandboxIdentity(pool);
    verified = true;
    if (!(await fetch(baseUrl + "/api/health")).ok)
        throw new Error("Sandbox not running");
    const token = randomBytes(32).toString("hex");
    const cookie = encodeURIComponent(
        token +
            "." +
            createHmac("sha256", secret).update(token).digest("base64")
    );
    await pool.query(
        "insert into auth_user(id,email,name,role,email_verified) values($1,$2,'Draft fixture','user',true)",
        [user, user + "@example.test"]
    );
    await pool.query(
        "insert into auth_session(id,expires_at,token,user_id) values($1,now()+interval '10 minutes',$2,$3)",
        [randomUUID(), token, user]
    );
    await pool.query(
        "insert into sessions(id,locale,audio_sha256,audio_bytes,transcript) values($1,'id','fixture',1,'fixture')",
        [session]
    );
    const document = {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: null,
        tanggal: "2026-11-28",
        proyek: { nama: "Fixture", lokasi: "Fixture", klien: "Fixture" },
        pekerjaan: [
            {
                uraian: "Item",
                volume: 1,
                satuan: "unit",
                harga_satuan: 5,
                jumlah: 5,
                sumber_kutipan: "manual",
            },
        ],
        total_nominal: 5,
        terbilang: "lima rupiah",
        butuh_konfirmasi: [],
    };
    await pool.query(
        "insert into documents(id,session_id,locale,status,turns_hash,data_json,user_id) values($1,$2,'id','draf',$3,$4,$5)",
        [documentId, session, randomUUID(), JSON.stringify(document), user]
    );
    directory = await mkdtemp(join(tmpdir(), "slm-draft-hurl-"));
    const vars = join(directory, "vars");
    await writeFile(
        vars,
        Object.entries({
            base_url: baseUrl,
            cookie,
            document_id: documentId,
            key: randomUUID(),
        })
            .map(([k, v]) => k + "=" + v)
            .join("\n"),
        { mode: 0o600 }
    );
    const result = spawnSync(
        process.env.HURL_BIN || "hurl",
        [
            "--test",
            "--variables-file",
            vars,
            "tests/api/documents/draft-revision.hurl",
        ],
        { encoding: "utf8", timeout: 90000 }
    );
    if (result.status !== 0) {
        console.error(
            (result.stderr ?? "")
                .split("\n")
                .filter((line) =>
                    /draft-revision\.hurl:\d+|^Executed files:|^Succeeded files:|^Failed files:|^Errors:|^error:/.test(
                        line
                    )
                )
                .join("\n")
        );
        throw new Error("Draft HTTP checks failed");
    }
    console.log("Hurl draft revision: 8 HTTP requests passed");
} catch {
    console.error("Ticket 22 HTTP proof failed");
    process.exitCode = 1;
} finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    try {
        if (verified) {
            await pool.query("delete from sessions where id=$1", [session]);
            await pool.query("delete from auth_user where id=$1", [user]);
        }
    } finally {
        await pool.end();
    }
}
