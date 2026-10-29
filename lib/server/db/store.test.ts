import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresStore, type TranscriptionRecord } from "./store";

/**
 * The migration and the queries it backs, against a real Postgres.
 *
 * This is the one place where the SQL is exercised rather than described: a
 * column rename or a dropped constraint passes every mocked test and fails the
 * demo. Point `ASR_TEST_DATABASE_URL` at a throwaway database to run it; it
 * truncates the tables it owns.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;
const migration = readFileSync(
    join(__dirname, "../../../db/migrations/0001_sessions_turns.sql"),
    "utf8"
);

const record: TranscriptionRecord = {
    sessionId: "sess-round-trip",
    locale: "id",
    audioSha256: "9f2c1a",
    audioBytes: 32044,
    metaSessionId: "sess_meta_1",
    transcript: "pagar dua puluh meter",
    audioDurationMs: 1000,
    turns: [
        {
            turn_id: "turn_1",
            startMs: 0,
            endMs: 300,
            transcript: "pagar",
            final: true,
        },
        {
            turn_id: "turn_2",
            startMs: 300,
            endMs: 1000,
            transcript: "dua puluh meter",
            final: true,
        },
    ],
};

describe.skipIf(!TEST_DATABASE_URL)("postgres turns store", () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        await pool.query(migration);
        // The demo and CI both re-run the migration on a database that already
        // has the tables.
        await pool.query(migration);
    });

    beforeEach(async () => {
        await pool.query("truncate sessions cascade");
    });

    afterAll(async () => {
        await pool.end();
    });

    it("round-trips a session's turns in the K3 shape and in order", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);

        await store.saveTranscription(record);

        expect(await store.findSession(record.sessionId)).toEqual({
            sessionId: "sess-round-trip",
            locale: "id",
            audioSha256: "9f2c1a",
            turns: record.turns,
        });
    });

    it("replaces the turns of a session that is uploaded again", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        await store.saveTranscription(record);

        await store.saveTranscription({
            ...record,
            audioSha256: "0000beef",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 500,
                    transcript: "ulang",
                    final: true,
                },
            ],
        });

        const found = await store.findSession(record.sessionId);
        expect(found?.turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 500,
                transcript: "ulang",
                final: true,
            },
        ]);
        expect(found?.audioSha256).toBe("0000beef");

        const { rows } = await pool.query(
            "select count(*)::int as sessions from sessions"
        );
        expect(rows[0].sessions).toBe(1);
    });

    it("returns null for a session it has never seen", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);

        expect(await store.findSession("sess-unknown")).toBeNull();
    });

    it("keeps a session that Meta heard nothing in, with no turns", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);

        await store.saveTranscription({
            ...record,
            sessionId: "sess-silent",
            turns: [],
        });

        expect(await store.findSession("sess-silent")).toMatchObject({
            sessionId: "sess-silent",
            turns: [],
        });
    });
});
