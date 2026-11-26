#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { betterAuth } from "better-auth";
import pg from "pg";
import {
    parseAndValidateSandboxUrl,
    verifySandboxIdentity,
} from "./dbGuard.mjs";
import { hasSecureSessionCookie, parseCurlResponse } from "./androidProof.mjs";

let origin, serial, pool;
const id = crypto.randomUUID();
const email = `sandbox-${id}@suara-lapangan.test`;
const password = crypto.randomBytes(32).toString("hex");
const jar = `/data/local/tmp/slm-${id}.cookies`;
let identityVerified = false;
let interrupted = false;
const interrupt = () => {
    interrupted = true;
    process.exitCode = 1;
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

function checkInterrupted() {
    if (interrupted) throw new Error("Android session proof interrupted");
}

function shell(command, input) {
    return execFileSync("adb", ["-s", serial, "shell", "-T", command], {
        encoding: "utf8",
        input,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
    });
}
function request(path, options = "", input) {
    checkInterrupted();
    const raw = shell(
        `umask 077; curl --max-time 20 -sS -w '\\n%{http_code}' ${options} '${origin.origin}${path}'`,
        input
    );
    return parseCurlResponse(raw);
}

try {
    parseAndValidateSandboxUrl(process.env.DATABASE_URL);
    origin = new URL(process.env.BETTER_AUTH_URL);
    assert.equal(origin.origin, "https://53a2d20f8168.tailadc164.ts.net:3443");
    serial = process.env.ANDROID_SERIAL || "LGMV300L3f605971";
    pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 10000,
        query_timeout: 10000,
    });
    await verifySandboxIdentity(pool);
    identityVerified = true;
    checkInterrupted();
    const auth = betterAuth({
        secret: crypto.randomBytes(32).toString("hex"),
        database: pool,
        emailAndPassword: { enabled: true },
    });
    const hash = await (await auth.$context).password.hash(password);
    checkInterrupted();
    await pool.query(
        "INSERT INTO auth_user (id,email,email_verified,name,role) VALUES ($1,$2,true,'Sandbox proof','user')",
        [id, email]
    );
    checkInterrupted();
    await pool.query(
        "INSERT INTO auth_account (id,account_id,provider_id,user_id,password) VALUES ($1,$2::uuid::text,'credential',$2::uuid,$3)",
        [crypto.randomUUID(), id, hash]
    );
    const login = request(
        "/api/auth/sign-in/email",
        `-c '${jar}' -H 'Origin: ${origin.origin}' -H 'Content-Type: application/json' --data-binary @-`,
        JSON.stringify({ email, password })
    );
    assert.equal(login.status, 200, "Android login HTTP status");
    console.log("Android sign-in: HTTP 200");
    assert.ok(
        hasSecureSessionCookie(shell(`cat '${jar}'`)),
        "session cookie must be Secure and HttpOnly"
    );
    console.log("Android cookie: Secure, HttpOnly");
    const session = request("/api/auth/get-session", `-b '${jar}'`);
    assert.equal(session.status, 200);
    assert.equal(JSON.parse(session.body).user.id, id);
    console.log("Android get-session: HTTP 200, correct synthetic user");
    const logout = request(
        "/api/auth/sign-out",
        `-b '${jar}' -H 'Origin: ${origin.origin}' -H 'Content-Type: application/json' --data-binary '{}'`
    );
    assert.equal(logout.status, 200);
    const after = request("/api/auth/get-session", `-b '${jar}'`);
    assert.equal(after.status, 200);
    assert.equal(JSON.parse(after.body), null);
    console.log("Android sign-out: HTTP 200, old session revoked");
} catch (error) {
    console.error(
        "Android session proof failed:",
        error instanceof assert.AssertionError
            ? "HTTP or session assertion failed"
            : (error.code ?? error.name)
    );
    process.exitCode = 1;
} finally {
    try {
        if (serial) shell(`rm -f '${jar}'`);
    } catch {
        process.exitCode = 1;
    }
    try {
        if (identityVerified)
            await pool.query("DELETE FROM auth_user WHERE id=$1 AND email=$2", [
                id,
                email,
            ]);
    } catch {
        console.error("Android proof account cleanup failed");
        process.exitCode = 1;
    } finally {
        if (pool) {
            try {
                await pool.end();
            } catch {
                console.error("Android proof database close failed");
                process.exitCode = 1;
            }
        }
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
    }
}
