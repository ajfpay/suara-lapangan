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
const ci =
    process.env.SLM_HURL_CI === "1" && process.env.GITHUB_ACTIONS === "true";
if (process.env.SLM_HURL_CI === "1" && !ci)
    throw new Error("CI mode is restricted to GitHub Actions");
if (ci) {
    if (
        process.env.DATABASE_URL !==
        "postgres://suara:suara@localhost:5432/suara_test"
    )
        throw new Error("Expected the CI-only disposable service database");
} else {
    parseAndValidateSandboxUrl(process.env.DATABASE_URL);
}
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
});
const user = randomUUID();
const otherUser = randomUUID();
const session = "hurl-draft-" + randomUUID();
const documentId = randomUUID();
const baseUrl = "http://127.0.0.1:3010";
let directory;
let verified = false;
let stage = "database identity";
try {
    if (ci) {
        const {
            rows: [identity],
        } = await pool.query(
            "select current_database() as db, current_user as usr, inet_server_port() as port"
        );
        if (
            identity?.db !== "suara_test" ||
            identity.usr !== "suara" ||
            identity.port !== 5432
        )
            throw new Error("CI test database identity mismatch");
    } else {
        await verifySandboxIdentity(pool);
    }
    verified = true;
    stage = "server health";
    if (!(await fetch(baseUrl + "/api/health")).ok)
        throw new Error("Sandbox not running");
    stage = "synthetic fixtures";
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
    const otherToken = randomBytes(32).toString("hex");
    const otherCookie = encodeURIComponent(
        otherToken +
            "." +
            createHmac("sha256", secret).update(otherToken).digest("base64")
    );
    await pool.query(
        "insert into auth_user(id,email,name,role,email_verified) values($1,$2,'Other fixture','user',true)",
        [otherUser, otherUser + "@example.test"]
    );
    await pool.query(
        "insert into auth_session(id,expires_at,token,user_id) values($1,now()+interval '10 minutes',$2,$3)",
        [randomUUID(), otherToken, otherUser]
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
            other_cookie: otherCookie,
            document_id: documentId,
            key: randomUUID(),
        })
            .map(([k, v]) => k + "=" + v)
            .join("\n"),
        { mode: 0o600 }
    );
    stage = "HTTP assertions";
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
    console.log("Hurl draft and approval integrity: 17 HTTP requests passed");
} catch {
    console.error(`Draft and approval HTTP proof failed during ${stage}`);
    process.exitCode = 1;
} finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    try {
        if (verified) {
            await pool.query("delete from sessions where id=$1", [session]);
            await pool.query("delete from auth_user where id=$1 or id=$2", [
                user,
                otherUser,
            ]);
            if (
                (
                    await pool.query("select 1 from documents where id=$1", [
                        documentId,
                    ])
                ).rowCount !== 0
            )
                throw new Error("Synthetic document cleanup failed");
        }
    } finally {
        await pool.end();
    }
}
