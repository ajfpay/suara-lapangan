// Seeds a verified user + live session for the docker-pdf CI smoke test.
// Mirrors e2e/auth-setup.ts (same tables, same cookie scheme) without Playwright.
import crypto from "node:crypto";
import { Pool } from "pg";

const USER_ID = "00000000-0000-0000-0000-00000000d0c1";
const EMAIL = "docker-smoke@suara-lapangan.test";
const TOKEN = "docker-smoke-session-token";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is required");

const pool = new Pool({ connectionString });
try {
    await pool.query(
        `insert into auth_user (id, email, email_verified, name, role)
         values ($1, $2, true, 'Docker Smoke', 'user')
         on conflict (id) do update set email_verified = true`,
        [USER_ID, EMAIL]
    );
    await pool.query("delete from auth_session where user_id = $1", [USER_ID]);
    await pool.query(
        `insert into auth_session (id, expires_at, token, user_id)
         values ($1, now() + interval '30 days', $2, $3)`,
        [crypto.randomUUID(), TOKEN, USER_ID]
    );
    const signature = crypto
        .createHmac("sha256", secret)
        .update(TOKEN)
        .digest("base64");
    // Print the signed cookie value for the next step.
    process.stdout.write(`${TOKEN}.${signature}`);
} finally {
    await pool.end();
}
