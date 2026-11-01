import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { Pool } from "pg";
import { getPostgresDocumentStore, resetDocumentStoreForTesting } from "@/lib/server/db/documentStore";
import { PostgresUsageStore } from "@/lib/server/quota/usage-meter";
import type { Auth } from "@/lib/server/auth";

const TEST_DATABASE_URL =
    process.env.ASR_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgres://suara:suara@localhost:5432/suara_test";

describe("Better Auth & Admin Dashboard core contracts", () => {
    let pool: Pool;
    const origDbUrl = process.env.DATABASE_URL;
    let auth: Auth;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DATABASE_URL;
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        // `auth` builds its pool from DATABASE_URL at module scope, so it must
        // be imported after the test URL is set — otherwise auth requests and
        // the verification updates would target different databases.
        auth = (await import("@/lib/server/auth")).auth;
    });

    afterAll(async () => {
        resetDocumentStoreForTesting();
        if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
        else delete process.env.DATABASE_URL;
        await pool.end();
    });

    it("registers user with email_verified: false and requires verification", async () => {
        const testEmail = `test-user-${Date.now()}@example.com`;
        const testPassword = "Password123!";

        const signUpRes = await auth.api.signUpEmail({
            body: {
                name: "Test Field User",
                email: testEmail,
                password: testPassword,
            },
        });

        expect(signUpRes.user.email).toBe(testEmail);
        expect(signUpRes.user.emailVerified).toBe(false);
        expect(signUpRes.token).toBeNull(); // No session token until verified

        // Attempting to sign in before verification fails
        await expect(
            auth.api.signInEmail({
                body: {
                    email: testEmail,
                    password: testPassword,
                },
            })
        ).rejects.toThrow();

        // Mark email verified
        await pool.query(
            "update auth_user set email_verified = true where id = $1",
            [signUpRes.user.id]
        );

        // Sign in succeeds after verification
        const signInRes = await auth.api.signInEmail({
            body: {
                email: testEmail,
                password: testPassword,
            },
        });

        expect(signInRes.user.email).toBe(testEmail);
        expect(signInRes.token).toBeTruthy();

        // Cleanup
        await pool.query("delete from auth_user where id = $1", [signUpRes.user.id]);
    });
    it("persists document with user_id and filters by user correctly", async () => {
        const testUserId = "00000000-0000-0000-0000-000000000001";
        const docStore = getPostgresDocumentStore();
        const testDocId = crypto.randomUUID();
        const testSessionId = `test-auth-admin-${Date.now()}`;

        await pool.query(
            `insert into sessions (id, locale, audio_sha256, audio_bytes, transcript)
             values ($1, 'id', 'fake-sha', 1000, 'test transcript')
             on conflict (id) do nothing`,
            [testSessionId]
        );

        await pool.query(
            `insert into documents (id, session_id, locale, nomor, status, turns_hash, data_json, user_id)
             values ($1::uuid, $2, 'id', 'SL/QTN/2099/0001', 'siap', 'hash-test', '{}'::jsonb, $3)`,
            [testDocId, testSessionId, testUserId]
        );

        // List by user returns the document
        const userDocs = await docStore.listByUser(testUserId);
        expect(userDocs.some((d) => d.id === testDocId)).toBe(true);

        // List all includes the document with user info
        const allDocs = await docStore.listAll();
        const found = allDocs.find((d) => d.id === testDocId);
        expect(found).toBeDefined();
        expect(found?.userEmail).toBeDefined();

        // Cleanup
        await pool.query("delete from documents where id = $1::uuid", [testDocId]);
        await pool.query("delete from sessions where id = $1", [testSessionId]);
    });

    it("stores and retrieves per-user cost limits", async () => {
        const usageStore = new PostgresUsageStore(pool);
        const testUserId = "00000000-0000-0000-0000-000000000001";

        await usageStore.setUserLimit(testUserId, 15.5);
        const limit = await usageStore.getCapForUser(testUserId);
        expect(limit).toBe(15.5);

        const allLimits = await usageStore.getAllLimits();
        expect(allLimits.get(testUserId)).toBe(15.5);

        // Reset to default
        await pool.query("delete from user_cost_limits where user_id = $1", [testUserId]);
    });
});
