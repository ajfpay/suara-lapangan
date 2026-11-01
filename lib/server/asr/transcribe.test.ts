import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredSession, TranscriptionRecord, TurnsStore } from "@/lib/server/db/store";
import { resetMemoryUsageStore, setUsageStore } from "@/lib/server/quota/usage-meter";

import { transcribeSession } from "./transcribe";

const FIXTURE_DIR = join(__dirname, "__fixtures__");
const audio = new Uint8Array(readFileSync(join(FIXTURE_DIR, "sample-16k.wav")));

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

    beforeEach(() => {
        sessionStore.clear();
        setUsageStore(null);
        resetMemoryUsageStore();
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
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(endpRetryTurns).toEqual(endpTurns);

        // 3. Re-upload same audio with DIARIZATION mode must call Meta twice and carry speaker labels
        const diarTurns = await transcribeSession({
            sessionId,
            locale: "id",
            audio,
            mode: "DIARIZATION",
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
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(diarTurns[0].speaker).toBe("A");
    });
});
