import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

/**
 * Seeds a verified user and a live session, then writes the signed session
 * cookie as Playwright's storage state.
 *
 * The protected routes and the document API validate the session for real, so
 * the suite needs a session that resolves — a placeholder cookie passes the
 * middleware's presence check and then fails the API's lookup.
 */

const SESSION_COOKIE = "better-auth.session_token";
export const E2E_USER_ID = "00000000-0000-0000-0000-0000000000e2";
const E2E_USER_EMAIL = "e2e@suara-lapangan.test";
const E2E_SESSION_TOKEN = "e2e-session-token";
const STATE_PATH = "e2e/.auth/state.json";

export default async function globalSetup(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error(
            "DATABASE_URL is required for the e2e auth session"
        );
    }
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
        throw new Error(
            "BETTER_AUTH_SECRET is required for the e2e session: the server " +
                "signs sessions with it, and production never falls back to a " +
                "known constant. playwright.config.ts sets it for both sides."
        );
    }

    const pool = new Pool({ connectionString });
    try {
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values ($1, $2, true, 'E2E User', 'user')
             on conflict (id) do update set email_verified = true`,
            [E2E_USER_ID, E2E_USER_EMAIL]
        );
        await pool.query("delete from auth_session where user_id = $1", [
            E2E_USER_ID,
        ]);
        await pool.query(
            `insert into auth_session (id, expires_at, token, user_id)
             values ($1, now() + interval '30 days', $2, $3)`,
            [crypto.randomUUID(), E2E_SESSION_TOKEN, E2E_USER_ID]
        );
    } finally {
        await pool.end();
    }

    const signature = crypto
        .createHmac("sha256", secret)
        .update(E2E_SESSION_TOKEN)
        .digest("base64");

    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    await fs.writeFile(
        STATE_PATH,
        JSON.stringify(
            {
                cookies: [
                    {
                        name: SESSION_COOKIE,
                        value: `${E2E_SESSION_TOKEN}.${signature}`,
                        domain: "127.0.0.1",
                        path: "/",
                        expires: Math.floor(Date.now() / 1000) + 30 * 86400,
                        httpOnly: false,
                        secure: false,
                        sameSite: "Lax",
                    },
                ],
                origins: [],
            },
            null,
            2
        )
    );
}
