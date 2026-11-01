#!/usr/bin/env node
/**
 * Seeds or promotes a user to role 'admin' with email_verified: true.
 *
 * Usage:
 *   npm run db:seed-admin -- --email=admin@example.com --name="Admin User" [--password=SecretPassword123!]
 */
import pg from "pg";
import { betterAuth } from "better-auth";
import crypto from "node:crypto";

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (const arg of args) {
        if (arg.startsWith("--email=")) {
            parsed.email = arg.slice("--email=".length).trim();
        } else if (arg.startsWith("--name=")) {
            parsed.name = arg.slice("--name=".length).trim();
        } else if (arg.startsWith("--password=")) {
            parsed.password = arg.slice("--password=".length);
        }
    }
    return parsed;
}

const { email, name = "Admin", password = "AdminPassword123!" } = parseArgs();

if (!email) {
    console.error("Error: --email=... is required.");
    console.error("Usage: npm run db:seed-admin -- --email=admin@example.com [--name=Admin] [--password=...]");
    process.exit(1);
}

const connectionString =
    process.env.DATABASE_URL ||
    process.env.ASR_TEST_DATABASE_URL ||
    "postgres://suara:suara@localhost:5432/suara_test";

const pool = new pg.Pool({ connectionString });

try {
    const auth = betterAuth({
        database: pool,
        emailAndPassword: { enabled: true },
    });
    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash(password);

    // 1. Upsert auth_user
    const existing = await pool.query(
        "select id from auth_user where lower(email) = lower($1)",
        [email]
    );

    let userId;
    if (existing.rowCount > 0) {
        userId = existing.rows[0].id;
        await pool.query(
            `update auth_user
             set role = 'admin',
                 email_verified = true,
                 password_hash = $2,
                 name = coalesce(nullif($3, ''), name),
                 updated_at = now()
             where id = $1`,
            [userId, passwordHash, name]
        );
        console.log(`Updated existing user ${email} to admin (id: ${userId})`);
    } else {
        userId = crypto.randomUUID();
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role, password_hash)
             values ($1, lower($2), true, $3, 'admin', $4)`,
            [userId, email, name, passwordHash]
        );
        console.log(`Created new admin user ${email} (id: ${userId})`);
    }

    // 2. Upsert auth_account for credential login
    const existingAccount = await pool.query(
        "select id from auth_account where user_id = $1 and provider_id = 'credential'",
        [userId]
    );

    if (existingAccount.rowCount > 0) {
        await pool.query(
            `update auth_account
             set password = $1,
                 updated_at = now()
             where id = $2`,
            [passwordHash, existingAccount.rows[0].id]
        );
        console.log(`Updated credential password for admin ${email}`);
    } else {
        const accountId = crypto.randomUUID();
        await pool.query(
            `insert into auth_account (id, account_id, provider_id, user_id, password)
             values ($1, $2, 'credential', $3, $4)`,
            [accountId, accountId, userId, passwordHash]
        );
        console.log(`Created credential account for admin ${email}`);
    }
} finally {
    await pool.end();
}
