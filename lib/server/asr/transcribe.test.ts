import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredSession, TranscriptionRecord, TurnsStore } from "@/lib/server/db/store";
import {
    getUsageStore,
    PostgresUsageStore,
    resetMemoryUsageStore,
    setUsageStore,
} from "@/lib/server/quota/usage-meter";

import { SessionOwnershipError, transcribeSession } from "./transcribe";

const FIXTURE_DIR = join(__dirname, "__fixtures__");
const audio = new Uint8Array(readFileSync(join(FIXTURE_DIR, "sample-16k.wav")));
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

const sessionStore = new Map<string, StoredSession>();

const storeStub: TurnsStore = {
    async findSession(sessionId: string) {
        return sessionStore.get(sessionId) ?? null;
    },
    async saveTranscription(record: TranscriptionRecord) {
        sessionStore.set(record.sessionId, {
            sessionId: record.sessionId,
            locale: record.locale,
            audioSha256: record.audioSha256,
            mode: record.mode,
            turns: record.turns,
        });
    },
};

vi.mock("@/lib/server/db/store", () => ({
    getTurnsStore: () => storeStub,
}));

describe("transcribeSession mode-aware cache", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    const origDatabaseUrl = process.env.DATABASE_URL;

    afterAll(() => {
        if (origDatabaseUrl !== undefined) {
            process.env.DATABASE_URL = origDatabaseUrl;
        } else {
            delete process.env.DATABASE_URL;
        }
        setUsageStore(null);
    });

    beforeEach(async () => {
        sessionStore.clear();
        const dbUrl =
            process.env.ASR_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!dbUrl) {
            throw new Error(
                "Database-backed suite cannot reach Postgres: ASR_TEST_DATABASE_URL or DATABASE_URL must be set"
            );
        }
        process.env.DATABASE_URL = dbUrl;
        const pool = new Pool({ connectionString: dbUrl });
        try {
            await pool.query("truncate usage_meter");
            await pool.query(
                `insert into auth_user (id, email, email_verified, name, role)
                 values ($1, 'transcribe-test@suara-lapangan.local', true, 'Test User', 'admin')
                 on conflict (id) do nothing`,
                [TEST_USER_ID]
            );
        } finally {
            await pool.end();
        }
        setUsageStore(null);
        resetMemoryUsageStore();
        expect(getUsageStore()).toBeInstanceOf(PostgresUsageStore);
        process.env.MODEL_API_KEY = "test-meta-key";

        fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const formData = await new Request("http://meta.test", {
                method: "POST",
                body: init.body,
            }).formData();
            const requestJson = JSON.parse(
                await (formData.get("request") as File).text()
            );

            if (requestJson.mode === "DIARIZATION") {
                return new Response(
                    JSON.stringify({
                        sessionId: "meta-sess-diar",
                        transcript: "Halo mandor. Siap laksanakan.",
                        audioDurationMs: 1000,
                        turns: [
                            {
                                startMs: 0,
                                endMs: 500,
                                transcript: "Halo mandor.",
                                speaker: "A",
                            },
                            {
                                startMs: 500,
                                endMs: 1000,
                                transcript: "Siap laksanakan.",
                                speaker: "B",
                            },
                        ],
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    }
                );
            }

            return new Response(
                JSON.stringify({
                    sessionId: "meta-sess-endpoint",
                    transcript: "Halo mandor. Siap laksanakan.",
                    audioDurationMs: 1000,
                    turns: [
                        {
                            startMs: 0,
                            endMs: 500,
                            transcript: "Halo mandor.",
                        },
                        {
                            startMs: 500,
                            endMs: 1000,
                            transcript: "Siap laksanakan.",
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }
            );
        });

        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        delete process.env.MODEL_API_KEY;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("same sessionId and same audio, first ENDPOINTING then DIARIZATION, calls Meta twice and carries speaker labels on the second result, while same-mode retry replays from store", async () => {
        const sessionId = "sess-mode-cache-1";

        // 1. Initial transcription in ENDPOINTING mode
        const endpTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "ENDPOINTING",
            userId: TEST_USER_ID,
            isAdmin: true,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(endpTurns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 500,
                transcript: "Halo mandor.",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_2",
                startMs: 500,
                endMs: 1000,
                transcript: "Siap laksanakan.",
                final: true,
                speaker: null,
            },
        ]);

        // 2. Same-mode retry must replay from store without calling Meta a second time
        const endpRetryTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "ENDPOINTING",
            userId: TEST_USER_ID,
            isAdmin: true,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(endpRetryTurns).toEqual(endpTurns);

        // 3. Re-upload same audio with DIARIZATION mode must call Meta twice and carry speaker labels
        const diarTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "DIARIZATION",
            userId: TEST_USER_ID,
            isAdmin: true,
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(diarTurns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 500,
                transcript: "Halo mandor.",
                final: true,
                speaker: "A",
            },
            {
                turn_id: "turn_2",
                startMs: 500,
                endMs: 1000,
                transcript: "Siap laksanakan.",
                final: true,
                speaker: "B",
            },
        ]);

        // 4. Same-mode retry in DIARIZATION must replay from store without a third Meta call
        const diarRetryTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "DIARIZATION",
            userId: TEST_USER_ID,
            isAdmin: true,
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(diarRetryTurns).toEqual(diarTurns);
    });

    it("treats a store that reports no mode as ENDPOINTING", async () => {
        const sessionId = "sess-legacy-row";
        const { createHash } = await import("node:crypto");
        const audioSha256 = createHash("sha256").update(audio).digest("hex");

        sessionStore.set(sessionId, {
            sessionId,
            locale: "id",
            audioSha256,
            mode: undefined,
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 500,
                    transcript: "Teks lama",
                    final: true,
                    speaker: null,
                },
            ],
        });

        // Replaying in ENDPOINTING treats missing mode as ENDPOINTING -> cache hit
        const cachedTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "ENDPOINTING",
            userId: TEST_USER_ID,
            isAdmin: true,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(cachedTurns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 500,
                transcript: "Teks lama",
                final: true,
                speaker: null,
            },
        ]);

        // Switching to DIARIZATION sees storedMode (ENDPOINTING) !== mode (DIARIZATION) -> calls Meta
        const diarTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "DIARIZATION",
            userId: TEST_USER_ID,
            isAdmin: true,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(diarTurns[0].speaker).toBe("A");
    });

    it("cache hit denies foreign owner with 404 and spends no quota", async () => {
        const { createHash } = await import("node:crypto");
        const audioSha256 = createHash("sha256").update(audio).digest("hex");
        sessionStore.set("sess-owned-cache", {
            sessionId: "sess-owned-cache",
            locale: "id",
            audioSha256,
            mode: "ENDPOINTING",
            userId: "owner-A",
            turns: [
                { turn_id: "turn_1", startMs: 0, endMs: 500, transcript: "Teks lama", final: true, speaker: null },
            ],
        });

        await expect(
            transcribeSession({ sessionId: "sess-owned-cache", locale: "id", audio, mode: "ENDPOINTING", userId: "owner-B", isAdmin: false })
        ).rejects.toMatchObject({ name: "SessionOwnershipError", status: 404 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cache hit denies legacy null-owner to non-admin with 403, allows admin", async () => {
        const { createHash } = await import("node:crypto");
        const audioSha256 = createHash("sha256").update(audio).digest("hex");
        sessionStore.set("sess-legacy-cache", {
            sessionId: "sess-legacy-cache",
            locale: "id",
            audioSha256,
            mode: "ENDPOINTING",
            userId: null,
            turns: [
                { turn_id: "turn_1", startMs: 0, endMs: 500, transcript: "Teks lama", final: true, speaker: null },
            ],
        });

        await expect(
            transcribeSession({ sessionId: "sess-legacy-cache", locale: "id", audio, mode: "ENDPOINTING", userId: "someone", isAdmin: false })
        ).rejects.toMatchObject({ status: 403 });
        const adminTurns = await transcribeSession({ sessionId: "sess-legacy-cache", locale: "id", audio, mode: "ENDPOINTING", userId: "admin", isAdmin: true });
        expect(adminTurns).toHaveLength(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("overwrite of existing session by foreign caller is denied", async () => {
        const { createHash } = await import("node:crypto");
        const otherAudio = new Uint8Array(audio);
        otherAudio[44] ^= 0xff;
        const audioSha256 = createHash("sha256").update(audio).digest("hex");
        sessionStore.set("sess-owned-overwrite", {
            sessionId: "sess-owned-overwrite",
            locale: "id",
            audioSha256,
            mode: "ENDPOINTING",
            userId: "owner-A",
            turns: [
                { turn_id: "turn_1", startMs: 0, endMs: 500, transcript: "Teks lama", final: true, speaker: null },
            ],
        });

        await expect(
            transcribeSession({ sessionId: "sess-owned-overwrite", locale: "id", audio: otherAudio, mode: "ENDPOINTING", userId: "owner-B", isAdmin: false })
        ).rejects.toBeInstanceOf(SessionOwnershipError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends the session's vocabulary as Meta keywords on a fresh transcription", async () => {
        const sessionId = "sess-vocabulary-bias";
        sessionStore.set(sessionId, {
            sessionId,
            locale: "id",
            // Different hash: this is a new recording, so Meta is called.
            audioSha256: "stale-hash",
            mode: "ENDPOINTING",
            userId: null,
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 500,
                    transcript: "Proyek Kemang milik Pak Budi.",
                    final: true,
                    speaker: null,
                },
            ],
        });

        await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "ENDPOINTING",
            isAdmin: true,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const formData = await new Request("http://meta.test", {
            method: "POST",
            body: init.body,
        }).formData();
        const requestJson = JSON.parse(
            await (formData.get("request") as File).text()
        );

        // Session terms, schema-derived units and seed materials all leave
        // the process in the `request` part the Meta API documents.
        expect(requestJson.keywords).toContain("Kemang");
        expect(requestJson.keywords).toContain("Budi");
        expect(requestJson.keywords).toContain("meter persegi");
        expect(requestJson.keywords).toContain("semen");
        expect(requestJson.languageBias).toContain("Indonesian");
    });
});
