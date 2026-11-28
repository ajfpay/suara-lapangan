import { randomInt, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import {
    parseAndValidateSandboxUrl,
    verifySandboxIdentity,
} from "../../../scripts/sandbox/dbGuard.mjs";

const baseUrl = new URL(
    process.env.AUTH_HURL_BASE_URL ?? "http://localhost:3010"
);
if (
    baseUrl.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(baseUrl.hostname) ||
    !baseUrl.port ||
    baseUrl.pathname !== "/" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
) {
    throw new Error(
        "AUTH_HURL_BASE_URL must be a loopback HTTP origin with an explicit port"
    );
}
parseAndValidateSandboxUrl(process.env.DATABASE_URL);
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
});
const ip = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
const key = `${ip}|/sign-in/email`;
let verified = false;
try {
    await verifySandboxIdentity(pool);
    verified = true;
    const health = await fetch(new URL("/api/health", baseUrl), {
        signal: AbortSignal.timeout(10000),
    });
    if (!health.ok) throw new Error("Sandbox server is not ready");
    const result = spawnSync(
        process.env.HURL_BIN || "hurl",
        [
            "--test",
            "--variable",
            `base_url=${baseUrl.origin}`,
            "--variable",
            `client_ip=${ip}`,
            "--variable",
            `unknown_email=ticket21-http-${randomUUID()}@example.test`,
            "tests/api/auth/rate-limit.hurl",
        ],
        { stdio: "inherit", timeout: 180000 }
    );
    if (result.error || result.status !== 0) process.exitCode = 1;
} catch {
    console.error(
        "Rate-limit HTTP proof failed; verify the sandbox and Hurl configuration."
    );
    process.exitCode = 1;
} finally {
    try {
        if (verified)
            await pool.query("delete from auth_rate_limit where key=$1", [key]);
    } finally {
        await pool.end();
    }
}
