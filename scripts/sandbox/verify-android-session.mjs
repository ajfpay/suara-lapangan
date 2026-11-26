#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { betterAuth } from "better-auth";
import pg from "pg";
import {
    parseAndValidateSandboxUrl,
    validateDbIdentityResult,
} from "./dbGuard.mjs";

const target = parseAndValidateSandboxUrl(process.env.DATABASE_URL);
assert.equal(
    target.database,
    "suara_lapangan_test",
    "Android proof requires the disposable test database"
);
const origin = new URL(process.env.BETTER_AUTH_URL);
assert.equal(origin.origin, "https://53a2d20f8168.tailadc164.ts.net:3443");
const serial = "LGMV300L3f605971";
const id = crypto.randomUUID();
const email = `sandbox-${id}@suara-lapangan.test`;
const password = crypto.randomBytes(32).toString("hex");
const jar = `/data/local/tmp/slm-${id}.cookies`;
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
});
let seeded = false;

function shell(command, input) {
    return execFileSync("adb", ["-s", serial, "shell", "-T", command], {
        encoding: "utf8",
        input,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
    });
}
function request(path, options = "", input) {
    const raw = shell(
        `umask 077; curl --max-time 20 -sS -w '\\n%{http_code}' ${options} '${origin.origin}${path}'`,
        input
    );
    const split = raw.lastIndexOf("\n");
    return { status: Number(raw.slice(split + 1)), body: raw.slice(0, split) };
}

try {
    const {
        rows: [identity],
    } = await pool.query(
        "SELECT current_database() AS db, current_user AS usr, rolsuper FROM pg_roles WHERE rolname=current_user"
    );
    validateDbIdentityResult({
        currentDatabase: identity.db,
        currentUser: identity.usr,
        rolsuper: identity.rolsuper,
        expectedDatabase: target.database,
        expectedUser: target.user,
    });
    const auth = betterAuth({
        secret: crypto.randomBytes(32).toString("hex"),
        database: pool,
        emailAndPassword: { enabled: true },
    });
    const hash = await (await auth.$context).password.hash(password);
    await pool.query(
        "INSERT INTO auth_user (id,email,email_verified,name,role) VALUES ($1,$2,true,'Sandbox proof','user')",
        [id, email]
    );
    seeded = true;
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
    const cookie = shell(`cat '${jar}'`)
        .split("\n")
        .map((line) => line.split("\t"))
        .find((parts) => parts[5]?.endsWith("session_token"));
    assert.ok(
        cookie && cookie[0].startsWith("#HttpOnly_") && cookie[3] === "TRUE",
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
            ? error.message.split("\n")[0]
            : (error.code ?? error.name)
    );
    process.exitCode = 1;
} finally {
    try {
        shell(`rm -f '${jar}'`);
    } catch {
        process.exitCode = 1;
    }
    try {
        if (seeded)
            await pool.query("DELETE FROM auth_user WHERE id=$1 AND email=$2", [
                id,
                email,
            ]);
    } finally {
        await pool.end();
    }
}
