import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import {
    parseAndValidateSandboxUrl,
    verifySandboxIdentity,
} from "../../../scripts/sandbox/dbGuard.mjs";

const url = new URL(process.env.AUTH_HURL_BASE_URL ?? "http://localhost:3010");
if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
) {
    throw new Error(
        "AUTH_HURL_BASE_URL must be a loopback HTTP origin with an explicit port"
    );
}
const baseUrl = url.origin;
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32)
    throw new Error("Use the sandbox signing configuration");
parseAndValidateSandboxUrl(process.env.DATABASE_URL);
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
});
const fixtures = [
    { id: randomUUID(), name: "password", providers: ["google", "credential"] },
    { id: randomUUID(), name: "social", providers: ["google"] },
    { id: randomUUID(), name: "unknown", providers: [] },
];
let verified = false;
let directory;
try {
    await verifySandboxIdentity(pool);
    verified = true;
    const health = await fetch(baseUrl + "/api/health", {
        signal: AbortSignal.timeout(10000),
    });
    if (!health.ok) throw new Error("Sandbox server is not ready");
    const vars = { base_url: baseUrl, other_user_id: fixtures[1].id };
    const hash = await hashPassword(randomBytes(24).toString("hex"));
    for (const fixture of fixtures) {
        await pool.query(
            "insert into auth_user(id,email,name,email_verified) values($1,$2,'Capability HTTP fixture',true)",
            [fixture.id, fixture.id + "@example.test"]
        );
        for (const provider of fixture.providers) {
            await pool.query(
                "insert into auth_account(id,account_id,provider_id,user_id,password) values($1,$2,$3,$4,$5)",
                [
                    randomUUID(),
                    randomUUID(),
                    provider,
                    fixture.id,
                    provider === "credential" ? hash : null,
                ]
            );
        }
        const token = randomBytes(32).toString("hex");
        await pool.query(
            "insert into auth_session(id,expires_at,token,user_id) values($1,now()+interval '10 minutes',$2,$3)",
            [randomUUID(), token, fixture.id]
        );
        const signature = createHmac("sha256", secret)
            .update(token)
            .digest("base64");
        vars[fixture.name + "_cookie"] = encodeURIComponent(
            token + "." + signature
        );
    }
    directory = await mkdtemp(join(tmpdir(), "slm-capability-http-"));
    const file = join(directory, "vars");
    await writeFile(
        file,
        Object.entries(vars)
            .map(([key, value]) => key + "=" + value)
            .join("\n"),
        { mode: 0o600 }
    );
    const result = spawnSync(
        process.env.HURL_BIN || "hurl",
        [
            "--test",
            "--variables-file",
            file,
            "tests/api/auth/credential-capability.hurl",
        ],
        { encoding: "utf8", timeout: 90000 }
    );
    if (result.status !== 0) {
        // Only print assertion location and HTTP status, never signed cookies or body data.
        for (const line of (result.stderr ?? "").split("\n")) {
            if (
                /^error: Assert status code$|^\s*--> tests\/api\/auth\/credential-capability\.hurl:\d+:\d+$|^\s*\|\s*\^+ actual value is <\d{3}>$/.test(
                    line
                )
            )
                console.error(line.trim());
        }
        console.error(
            "Credential capability HTTP checks failed; request headers and cookies are not logged."
        );
        process.exitCode = 1;
    } else {
        console.log("Credential capability HTTP: four requests passed");
    }
} catch {
    console.error(
        "Ticket 21 HTTP proof failed; check the sandbox and Hurl configuration."
    );
    process.exitCode = 1;
} finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    try {
        if (verified)
            await pool.query("delete from auth_user where id=any($1::uuid[])", [
                fixtures.map((fixture) => fixture.id),
            ]);
    } finally {
        await pool.end();
    }
}
