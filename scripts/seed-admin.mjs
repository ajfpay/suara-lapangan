#!/usr/bin/env node
import crypto from "node:crypto";
import pg from "pg";
import { hashPassword, verifyPassword } from "better-auth/crypto";

function configuration() {
    const args = {};
    for (const argument of process.argv.slice(2)) {
        const match = /^--(email|name)=(.+)$/.exec(argument);
        if (!match || Object.hasOwn(args, match[1])) {
            throw new Error("Only --email and --name options are accepted.");
        }
        args[match[1]] = match[2].trim();
    }
    const email = args.email?.toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("A valid --email is required.");
    }
    const allowlist = (process.env.ADMIN_SEED_EMAIL_ALLOWLIST ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    if (!allowlist.includes(email)) {
        throw new Error("Email is not in the explicit admin seed allowlist.");
    }
    const password = process.env.ADMIN_SEED_PASSWORD;
    if (!password || password.length < 8 || password.length > 128) {
        throw new Error("ADMIN_SEED_PASSWORD must contain 8–128 characters.");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("An explicit DATABASE_URL is required.");
    }
    return { email, name: args.name || "Admin", password, connectionString };
}

async function seed({ email, name, password, connectionString }) {
    const pool = new pg.Pool({ connectionString });
    let client;
    try {
        client = await pool.connect();
        await client.query("begin");
        await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            ["seed-admin:" + email]
        );
        const { rows: users } = await client.query(
            "select id, role, email_verified from auth_user where lower(email)=$1 for update",
            [email]
        );
        if (users.length > 1) throw new Error("Ambiguous account");
        const existing = users[0];
        const userId = existing?.id ?? crypto.randomUUID();
        const { rows: credentials } = existing
            ? await client.query(
                  "select id, password from auth_account where user_id=$1 and provider_id='credential' for update",
                  [userId]
              )
            : { rows: [] };
        if (credentials.length > 1) throw new Error("Ambiguous credentials");
        const credential = credentials[0];
        if (
            credential &&
            (!credential.password ||
                !(await verifyPassword({
                    hash: credential.password,
                    password,
                })))
        ) {
            throw new Error("Existing credential cannot be verified");
        }
        if (!existing) {
            await client.query(
                "insert into auth_user(id,email,email_verified,name,role) values($1,$2,true,$3,'admin')",
                [userId, email, name]
            );
        } else if (existing.role !== "admin" || !existing.email_verified) {
            await client.query(
                "update auth_user set role='admin', email_verified=true, updated_at=now() where id=$1",
                [userId]
            );
        }
        if (!credential) {
            const hash = await hashPassword(password);
            await client.query(
                "insert into auth_account(id,account_id,provider_id,user_id,password) values($1,$2,'credential',$3,$4)",
                [crypto.randomUUID(), userId, userId, hash]
            );
        }
        await client.query("commit");
        console.log("Admin seed complete.");
    } catch {
        if (client) await client.query("rollback").catch(() => {});
        console.error(
            "Admin seed failed; no account details or credentials are logged."
        );
        process.exitCode = 1;
    } finally {
        client?.release();
        await pool.end();
    }
}

let config;
try {
    config = configuration();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
if (config) await seed(config);
