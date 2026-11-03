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
const migration0001 = readFileSync(
    join(__dirname, "../../../db/migrations/0001_sessions_turns.sql"),
    "utf8"
);
const migration0005 = readFileSync(
    join(__dirname, "../../../db/migrations/0005_asr_speaker.sql"),
    "utf8"
);
const migration0006 = readFileSync(
    join(__dirname, "../../../db/migrations/0006_asr_mode.sql"),
    "utf8"
);
const migration0007 = readFileSync(
    join(__dirname, "../../../db/migrations/0007_auth_tables.sql"),
    "utf8"
);
const migration0010 = readFileSync(
    join(__dirname, "../../../db/migrations/0010_sessions_user_id.sql"),
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
            speaker: "A",
        },
        {
            turn_id: "turn_2",
            startMs: 300,
            endMs: 1000,
            transcript: "dua puluh meter",
            final: true,
            speaker: "B",
        },
    ],
};

describe.skipIf(!TEST_DATABASE_URL)("postgres turns store", () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        await pool.query(migration0001);
        await pool.query(migration0005);
        await pool.query(migration0006);
        await pool.query(migration0007);
        await pool.query(migration0010);
        // The demo and CI both re-run the migration on a database that already
        // has the tables.
        await pool.query(migration0001);
        await pool.query(migration0005);
        await pool.query(migration0006);
        await pool.query(migration0007);
        await pool.query(migration0010);
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
            mode: "ENDPOINTING",
            userId: null,
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
                speaker: null,
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

    it("round-trips speaker labels and null speakers in DIARIZATION and ENDPOINTING turns", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const sessionWithMixedSpeakers: TranscriptionRecord = {
            sessionId: "sess-diarization-db",
            locale: "id",
            audioSha256: "abc123sha",
            audioBytes: 16000,
            metaSessionId: "meta_sess_diar",
            transcript: "halo mandor siap",
            audioDurationMs: 2000,
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 1000,
                    transcript: "halo mandor",
                    final: true,
                    speaker: "A",
                },
                {
                    turn_id: "turn_2",
                    startMs: 1000,
                    endMs: 2000,
                    transcript: "siap",
                    final: true,
                    speaker: null,
                },
            ],
        };

        await store.saveTranscription(sessionWithMixedSpeakers);
        const retrieved = await store.findSession("sess-diarization-db");
        expect(retrieved).not.toBeNull();
        expect(retrieved?.turns).toEqual(sessionWithMixedSpeakers.turns);
    });

    it("persists and reads back mode (ENDPOINTING and DIARIZATION)", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);

        await store.saveTranscription({
            ...record,
            sessionId: "sess-mode-diar",
            mode: "DIARIZATION",
        });
        const diar = await store.findSession("sess-mode-diar");
        expect(diar?.mode).toBe("DIARIZATION");

        await store.saveTranscription({
            ...record,
            sessionId: "sess-mode-endpoint",
            mode: "ENDPOINTING",
        });
        const endp = await store.findSession("sess-mode-endpoint");
        expect(endp?.mode).toBe("ENDPOINTING");

        await store.saveTranscription({
            ...record,
            sessionId: "sess-mode-default",
            mode: undefined,
        });
        const def = await store.findSession("sess-mode-default");
        expect(def?.mode).toBe("ENDPOINTING");
    });

    it("persists userId on saveTranscription and reads back from findSession", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const ownerId = "00000000-0000-0000-0000-000000000000";

        await store.saveTranscription({
            ...record,
            sessionId: "sess-owned-direct",
            userId: ownerId,
        });

        const owned = await store.findSession("sess-owned-direct");
        expect(owned?.userId).toBe(ownerId);
    });

    it("sets session owner via setSessionOwner when user_id is null", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const ownerId = "00000000-0000-0000-0000-000000000000";

        await store.saveTranscription({
            ...record,
            sessionId: "sess-ownerless",
        });

        const before = await store.findSession("sess-ownerless");
        expect(before?.userId).toBeNull();

        await store.setSessionOwner!("sess-ownerless", ownerId);

        const after = await store.findSession("sess-ownerless");
        expect(after?.userId).toBe(ownerId);
    });

    it("does not overwrite existing session owner when setSessionOwner is called again with another user", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const originalOwner = "00000000-0000-0000-0000-000000000000";

        // Insert a second user in auth_user to test foreign user id
        const foreignOwner = "00000000-0000-0000-0000-000000000002";
        await pool.query(
            "insert into auth_user (id, email, email_verified, name, role) values ($1, $2, true, 'User 2', 'user') on conflict (id) do nothing",
            [foreignOwner, "user2@suara-lapangan.local"]
        );

        await store.saveTranscription({
            ...record,
            sessionId: "sess-first-writer",
            userId: originalOwner,
        });

        await store.setSessionOwner!("sess-first-writer", foreignOwner);

        const check = await store.findSession("sess-first-writer");
        expect(check?.userId).toBe(originalOwner);
    });

    it("saveTranscription by a foreign user throws ownership error and keeps original audio", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const originalOwner = "00000000-0000-0000-0000-000000000000";
        const foreignOwner = "00000000-0000-0000-0000-000000000002";

        await store.saveTranscription({
            ...record,
            sessionId: "sess-resave-owner",
            userId: originalOwner,
        });

        await expect(
            store.saveTranscription({
                ...record,
                sessionId: "sess-resave-owner",
                audioSha256: "different-audio-sha",
                userId: foreignOwner,
            })
        ).rejects.toMatchObject({ name: "SessionOwnershipError" });

        const check = await store.findSession("sess-resave-owner");
        expect(check?.userId).toBe(originalOwner);
        expect(check?.audioSha256).toBe(record.audioSha256);
    });

    it("two simultaneous first uploads by the SAME user converge: exactly one claims, one is foreign", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const user = "00000000-0000-0000-0000-0000000000a1";
        await pool.query(
            "insert into auth_user (id, email, email_verified, name, role) values ($1, 'race-same@suara-lapangan.local', true, 'Race', 'user') on conflict (id) do nothing",
            [user]
        );
        const create = {
            locale: "id",
            audioSha256: "race-same-sha",
            audioBytes: 16000,
        } as const;

        const [a, b] = await Promise.all([
            store.claimSessionOwner!(
                "sess-claim-race-same",
                user,
                false,
                create
            ),
            store.claimSessionOwner!(
                "sess-claim-race-same",
                user,
                false,
                create
            ),
        ]);

        // The verdict keys on whether OUR insert landed, never on a re-read
        // of the owner: both callers own the row, but only one may proceed
        // to a paid transcription.
        expect([a, b].sort()).toEqual(["claimed", "foreign"]);
        const row = await store.findSession("sess-claim-race-same");
        expect(row?.userId).toBe(user);
    });

    it("a claimed placeholder never satisfies the cache: its audio hash is a sentinel, not the upload's", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const user = "00000000-0000-0000-0000-0000000000a1";
        const claim = await store.claimSessionOwner!(
            "sess-claim-sentinel",
            user,
            false,
            { locale: "id", audioSha256: "real-audio-sha", audioBytes: 16000 }
        );
        expect(claim).toBe("claimed");

        const row = await store.findSession("sess-claim-sentinel");
        // The winner must still transcribe: a placeholder whose stored hash
        // equalled the upload's would cache-hit on zero turns and return []
        // without ever calling Meta.
        expect(row?.audioSha256).not.toBe("real-audio-sha");
    });

    it("two simultaneous first uploads on an unseen session id converge: one claims, one is foreign", async () => {
        const store = createPostgresStore(TEST_DATABASE_URL!);
        const userA = "00000000-0000-0000-0000-0000000000a1";
        const userB = "00000000-0000-0000-0000-0000000000b2";
        for (const [id, email] of [
            [userA, "race-a@suara-lapangan.local"],
            [userB, "race-b@suara-lapangan.local"],
        ] as const) {
            await pool.query(
                "insert into auth_user (id, email, email_verified, name, role) values ($1, $2, true, 'Race', 'user') on conflict (id) do nothing",
                [id, email]
            );
        }
        const create = {
            locale: "id",
            audioSha256: "race-sha",
            audioBytes: 16000,
        } as const;

        const [a, b] = await Promise.all([
            store.claimSessionOwner!("sess-claim-race", userA, false, create),
            store.claimSessionOwner!("sess-claim-race", userB, false, create),
        ]);

        expect([a, b].sort()).toEqual(["claimed", "foreign"]);
        const row = await store.findSession("sess-claim-race");
        const winner = a === "claimed" ? userA : userB;
        expect(row?.userId).toBe(winner);
    });
});
