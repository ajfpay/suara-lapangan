import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import {
    getUsage,
    recordUsage,
    resetMemoryUsageStore,
    setUsageStore,
} from "@/lib/server/quota/usage-meter";

import { POST } from "./route";

/**
 * The route boundary, which is the contract ticket 02 uploads against and
 * ticket 05 quotes from: multipart in, `{sessionId, turns}` out, idempotent per
 * `sessionId` + audio, and Meta mocked at the network edge with the committed
 * K5 fixture. No key, no database and no network are needed to run this.
 */

const { storeStub, mockGetSession } = vi.hoisted(() => ({
    storeStub: {
        findSession: vi.fn(),
        saveTranscription: vi.fn(),
        setSessionOwner: vi.fn(),
        claimSessionOwner: vi.fn(),
    },
    mockGetSession: vi.fn(),
}));

vi.mock("@/lib/server/db/store", () => ({ getTurnsStore: () => storeStub }));
vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: (session: { user?: { role?: string } } | null) =>
        session?.user?.role === "admin",
}));

const FIXTURE_DIR = join(__dirname, "../../../../lib/server/asr/__fixtures__");
const audio = new Uint8Array(readFileSync(join(FIXTURE_DIR, "sample-16k.wav")));
const metaResponse = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "meta-transcribe.json"), "utf8")
);
const API_KEY = "sk-test-key-value";
const TURNS = [
    {
        turn_id: "turn_1",
        startMs: 0,
        endMs: 300,
        transcript: "Good morning.",
        final: true,
        speaker: null,
    },
    {
        turn_id: "turn_2",
        startMs: 300,
        endMs: 700,
        transcript: "I need ten meters of rebar for the second floor.",
        final: true,
        speaker: null,
    },
    {
        turn_id: "turn_3",
        startMs: 700,
        endMs: 1000,
        transcript: "And two bags of cement.",
        final: true,
        speaker: null,
    },
];

let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function metaAnswers(body: unknown, status = 200) {
    fetchMock.mockImplementation(async () =>
        status === 200
            ? new Response(JSON.stringify(body), {
                  status,
                  headers: { "content-type": "application/json" },
              })
            : new Response(JSON.stringify(body), { status })
    );
}

function upload({
    audioBytes = audio,
    locale = "id",
    sessionId = "sess-route-1",
    mode = null,
}: {
    audioBytes?: Uint8Array;
    locale?: string | null;
    sessionId?: string | null;
    mode?: string | null;
} = {}) {
    const body = new FormData();
    body.set(
        "audio",
        new File([audioBytes], "recording.wav", { type: "audio/wav" })
    );
    if (locale !== null) body.set("locale", locale);
    if (sessionId !== null) body.set("sessionId", sessionId);
    if (mode !== null) body.set("mode", mode);

    return new Request("http://localhost/api/asr/transcribe", {
        method: "POST",
        body,
    });
}
beforeEach(async () => {
    resetRateLimits();
    setUsageStore(null);
    resetMemoryUsageStore();
    // The route resolves the real Postgres usage store via DATABASE_URL; a
    // hard-stopped row left by another suite would 429 every test here.
    const dbUrl =
        process.env.ASR_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (dbUrl) {
        const pool = new Pool({ connectionString: dbUrl });
        try {
            await pool.query("truncate usage_meter");
        } catch {
            // usage_meter may not exist in suites that never ran migrations.
        } finally {
            await pool.end();
        }
    }
    mockGetSession.mockReset().mockResolvedValue({
        user: {
            id: "00000000-0000-0000-0000-000000000001",
            email: "user@suara.local",
            name: "User",
            role: "user",
        },
    });
    storeStub.findSession.mockReset().mockResolvedValue(null);
    storeStub.saveTranscription.mockReset().mockResolvedValue(undefined);
    storeStub.setSessionOwner.mockReset().mockResolvedValue(undefined);
    storeStub.claimSessionOwner.mockReset().mockResolvedValue("missing");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.MODEL_API_KEY = API_KEY;
});

afterEach(() => {
    resetRateLimits();
    setUsageStore(null);
    resetMemoryUsageStore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MODEL_API_KEY;
});

type MalformedUpload = {
    audioBytes?: Uint8Array | null;
    locale?: string | null;
    sessionId?: string | null;
    mode?: string | null;
};

const MALFORMED_UPLOADS: Array<[string, MalformedUpload, number]> = [
    ["audio part missing", { audioBytes: null }, 400],
    ["locale missing", { locale: null }, 400],
    ["locale not shipped", { locale: "fr" }, 400],
    ["session id missing", { sessionId: null }, 400],
    ["session id with a path", { sessionId: "../../etc/passwd" }, 400],
    ["invalid mode", { mode: "INVALID_MODE" }, 400],
];

describe("POST /api/asr/transcribe", () => {
    it("returns HTTP 401 unauthenticated when request carries no valid session, and performs no transcription work", async () => {
        mockGetSession.mockResolvedValueOnce(null);

        const response = await POST(upload());

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error.code).toBe("unauthenticated");
        expect(storeStub.findSession).not.toHaveBeenCalled();
        expect(storeStub.saveTranscription).not.toHaveBeenCalled();
        expect(storeStub.setSessionOwner).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("maps auth resolution failure to 500 internal_error and performs no transcription work", async () => {
        mockGetSession.mockRejectedValueOnce(new Error("auth db down"));

        const response = await POST(upload());

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error.code).toBe("internal_error");
        expect(storeStub.findSession).not.toHaveBeenCalled();
        expect(storeStub.saveTranscription).not.toHaveBeenCalled();
        expect(storeStub.setSessionOwner).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });


    it("persists authenticated caller's user id as session owner via setSessionOwner", async () => {
        metaAnswers(metaResponse);
        const callerUserId = "00000000-0000-0000-0000-000000000001";
        mockGetSession.mockResolvedValueOnce({
            user: {
                id: callerUserId,
                email: "user@suara.local",
                name: "User",
                role: "user",
            },
        });

        const response = await POST(upload({ sessionId: "sess-owned-1" }));

        expect(response.status).toBe(200);
        expect(storeStub.setSessionOwner).toHaveBeenCalledWith(
            "sess-owned-1",
            callerUserId
        );
    });

    it("maps setSessionOwner failure to 500 internal_error without leaking store text", async () => {
        metaAnswers(metaResponse);
        storeStub.setSessionOwner.mockRejectedValueOnce(new Error("postgres connection refused"));

        const response = await POST(upload());

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error.code).toBe("internal_error");
        expect(JSON.stringify(body)).not.toContain("postgres connection refused");
    });

    it("answers with the numbered turns Meta found", async () => {
        metaAnswers(metaResponse);

        const response = await POST(upload());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            sessionId: "sess-route-1",
            turns: TURNS,
        });
        expect(response.headers.get("content-type")).toContain(
            "application/json"
        );
    });

    it("stores the session and its turns bound to the session id", async () => {
        metaAnswers(metaResponse);

        await POST(upload());

        expect(storeStub.saveTranscription).toHaveBeenCalledTimes(1);
        expect(storeStub.saveTranscription).toHaveBeenCalledWith({
            sessionId: "sess-route-1",
            locale: "id",
            audioSha256: createHash("sha256").update(audio).digest("hex"),
            audioBytes: audio.byteLength,
            metaSessionId: metaResponse.sessionId,
            transcript: metaResponse.transcript,
            audioDurationMs: 1000,
            mode: "ENDPOINTING",
            turns: TURNS,
            userId: "00000000-0000-0000-0000-000000000001",
        });
    });

    it("replays a re-upload of the same recording without asking Meta again", async () => {
        storeStub.findSession.mockResolvedValue({
            sessionId: "sess-route-1",
            locale: "id",
            audioSha256: createHash("sha256").update(audio).digest("hex"),
            userId: "00000000-0000-0000-0000-000000000001",
            turns: TURNS,
        });
        metaAnswers(metaResponse);

        const response = await POST(upload());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            sessionId: "sess-route-1",
            turns: TURNS,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(storeStub.saveTranscription).not.toHaveBeenCalled();
    });

    it("re-transcribes when the same session id carries different audio", async () => {
        const otherAudio = new Uint8Array(audio);
        otherAudio[44] ^= 0xff;
        storeStub.findSession.mockResolvedValue({
            sessionId: "sess-route-1",
            locale: "id",
            audioSha256: createHash("sha256").update(audio).digest("hex"),
            userId: "00000000-0000-0000-0000-000000000001",
            turns: TURNS,
        });
        metaAnswers({
            transcript: "sepuluh meter pagar",
            audioDurationMs: 1000,
            turns: [
                { startMs: 0, endMs: 1000, transcript: "sepuluh meter pagar" },
            ],
        });

        const response = await POST(upload({ audioBytes: otherAudio }));

        expect(await response.json()).toEqual({
            sessionId: "sess-route-1",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 1000,
                    transcript: "sepuluh meter pagar",
                    final: true,
                    speaker: null,
                },
            ],
        });
        expect(storeStub.saveTranscription).toHaveBeenCalledWith(
            expect.objectContaining({
                turns: [
                    expect.objectContaining({
                        transcript: "sepuluh meter pagar",
                    }),
                ],
            })
        );
    });

    it("answers a refused credential as a server fault, in the session's language", async () => {
        metaAnswers({ error: "invalid api key" }, 401);

        const response = await POST(upload({ locale: "id" }));

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
            error: {
                code: "upstream_auth",
                message:
                    "Transkripsi sedang tidak tersedia. Rekaman tetap tersimpan di perangkat ini.",
            },
        });
    });

    it("never lets the credential reach the client or the log", async () => {
        metaAnswers({ error: `credential ${API_KEY} is invalid` }, 401);

        const response = await POST(upload());
        const body = await response.text();

        expect(body).not.toContain(API_KEY);
        expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(API_KEY);
        expect(errorSpy.mock.calls.flat().join(" ")).toContain("[redacted]");
    });

    it.each([
        [400, 400, "upstream_rejected"],
        [413, 413, "too_large"],
        [429, 429, "rate_limited"],
        [500, 502, "upstream_failure"],
    ])("maps a Meta %i to %i (%s)", async (metaStatus, status, code) => {
        metaAnswers({ error: "no" }, metaStatus);

        const response = await POST(upload());

        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ error: { code } });
    });

    it("answers an unreachable Meta with a retryable timeout", async () => {
        fetchMock.mockRejectedValue(new TypeError("fetch failed"));

        const response = await POST(upload());

        expect(response.status).toBe(504);
        expect(await response.json()).toMatchObject({
            error: { code: "upstream_unreachable" },
        });
    });

    it.each(MALFORMED_UPLOADS)(
        "rejects a malformed upload (%s) with %i",
        async (_label, overrides, status) => {
            metaAnswers(metaResponse);

            const body = new FormData();
            if (overrides.audioBytes !== null) {
                body.set(
                    "audio",
                    new File([audio], "recording.wav", { type: "audio/wav" })
                );
            }
            if (overrides.locale !== null) {
                body.set("locale", overrides.locale ?? "id");
            }
            if (overrides.sessionId !== null) {
                body.set("sessionId", overrides.sessionId ?? "sess-route-1");
            }
            if (overrides.mode !== undefined && overrides.mode !== null) {
                body.set("mode", overrides.mode);
            }
            const response = await POST(
                new Request("http://localhost/api/asr/transcribe", {
                    method: "POST",
                    body,
                })
            );

            expect(response.status).toBe(status);
            expect(await response.json()).toMatchObject({
                error: { code: "invalid_request" },
            });
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );

    it("refuses audio past Meta's 32 MB cap without uploading it", async () => {
        const oversized = new Uint8Array(32 * 1024 * 1024 + 1);

        const response = await POST(upload({ audioBytes: oversized }));

        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
            error: { code: "too_large" },
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers 500 when the server has no Meta credential", async () => {
        delete process.env.MODEL_API_KEY;
        metaAnswers(metaResponse);

        const response = await POST(upload());

        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
            error: { code: "not_configured" },
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(errorSpy.mock.calls.flat().join(" ")).toContain("MODEL_API_KEY");
    });

    it("answers 500 without leaking the store's own failure text", async () => {
        const { AsrError } = await import("@/lib/server/asr/errors");
        storeStub.findSession.mockRejectedValue(
            new AsrError("not_configured", {
                detail: "DATABASE_URL is not set",
            })
        );

        const response = await POST(upload());
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toMatchObject({
            error: { code: "not_configured" },
        });
        expect(body).not.toContain("DATABASE_URL");
    });

    it("answers 500 for an unexpected failure without leaking its text", async () => {
        storeStub.findSession.mockRejectedValue(
            new Error("connection terminated unexpectedly")
        );

        const response = await POST(upload());
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(body)).toMatchObject({
            error: { code: "internal_error" },
        });
        expect(body).not.toContain("connection terminated");
        expect(errorSpy.mock.calls.flat().join(" ")).toContain(
            "internal_error"
        );
    });

    it("returns 429 with X-Quota-Hard-Stop header when daily cap is reached", async () => {
        await recordUsage({
            userId: "00000000-0000-0000-0000-000000000001",
            estCost: 6.0,
        });

        const response = await POST(
            upload({ sessionId: "sess-quota-hard-stop" })
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("X-Quota-Hard-Stop")).toBe("true");
        const body = await response.json();
        expect(body).toMatchObject({
            error: {
                code: "quota_exceeded",
            },
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("passes mode DIARIZATION to Meta when requested", async () => {
        metaAnswers(metaResponse);

        const response = await POST(
            upload({ sessionId: "sess-diarization-test", mode: "DIARIZATION" })
        );
        expect(response.status).toBe(200);

        const [, init] = fetchMock.mock.calls[0];
        const sent = await new Request("http://meta.test", {
            method: "POST",
            body: init.body,
        }).formData();
        const requestJson = JSON.parse(
            await (sent.get("request") as File).text()
        );
        expect(requestJson.mode).toBe("DIARIZATION");
    });

    it("defaults to mode ENDPOINTING when mode is absent", async () => {
        metaAnswers(metaResponse);

        const response = await POST(
            upload({ sessionId: "sess-endpointing-default" })
        );
        expect(response.status).toBe(200);

        const [, init] = fetchMock.mock.calls[0];
        const sent = await new Request("http://meta.test", {
            method: "POST",
            body: init.body,
        }).formData();
        const requestJson = JSON.parse(
            await (sent.get("request") as File).text()
        );
        expect(requestJson.mode).toBe("ENDPOINTING");
    });

    it("returns speaker labels when Meta returns them in DIARIZATION mode", async () => {
        metaAnswers({
            ...metaResponse,
            turns: [
                {
                    startMs: 0,
                    endMs: 300,
                    transcript: "Good morning.",
                    speaker: "A",
                },
                {
                    startMs: 300,
                    endMs: 700,
                    transcript: "I need ten meters of rebar for the second floor.",
                    speaker: "B",
                },
            ],
        });

        const response = await POST(
            upload({ sessionId: "sess-diarization-inline", mode: "DIARIZATION" })
        );
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 300,
                transcript: "Good morning.",
                final: true,
                speaker: "A",
            },
            {
                turn_id: "turn_2",
                startMs: 300,
                endMs: 700,
                transcript: "I need ten meters of rebar for the second floor.",
                final: true,
                speaker: "B",
            },
        ]);
    });

    it("claims ownership before transcription: foreign-owned session gets 404 without Meta call", async () => {
        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("foreign");
        metaAnswers(metaResponse);

        const response = await POST(upload({ sessionId: "sess-foreign" }));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: { code: "not_found", message: "Session not found" },
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(storeStub.saveTranscription).not.toHaveBeenCalled();
    });

    it("claim-race loser is denied even when claim reports claimed but row belongs to another user", async () => {
        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("claimed");
        storeStub.findSession.mockResolvedValue({
            sessionId: "sess-race",
            locale: "id",
            audioSha256: "x",
            userId: "other-user",
            turns: [],
        });
        metaAnswers(metaResponse);

        const response = await POST(upload({ sessionId: "sess-race" }));

        expect(response.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("denied callers leave the meter unchanged: every claim denial releases the reservation", async () => {
        metaAnswers(metaResponse);

        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("foreign");
        expect(
            (await POST(upload({ sessionId: "sess-quota-foreign" }))).status
        ).toBe(404);

        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("orphan");
        expect(
            (await POST(upload({ sessionId: "sess-quota-orphan" }))).status
        ).toBe(403);

        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("claimed");
        storeStub.findSession.mockResolvedValue({
            sessionId: "sess-quota-race",
            locale: "id",
            audioSha256: "x",
            userId: "other-user",
            turns: [],
        });
        expect(
            (await POST(upload({ sessionId: "sess-quota-race" }))).status
        ).toBe(404);

        const usage = await getUsage(
            undefined,
            "00000000-0000-0000-0000-000000000001"
        );
        expect(usage.estCost).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("checks quota before claiming: exhausted quota answers 429 without adopting the session", async () => {
        await recordUsage({
            userId: "00000000-0000-0000-0000-000000000001",
            estCost: 6.0,
        });

        const response = await POST(
            upload({ sessionId: "sess-quota-before-claim" })
        );

        expect(response.status).toBe(429);
        expect(storeStub.claimSessionOwner).not.toHaveBeenCalled();
        expect(storeStub.setSessionOwner).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("legacy null-owner session is denied to non-admin with 403 before transcription", async () => {
        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("claimed");
        storeStub.findSession.mockResolvedValue({
            sessionId: "sess-legacy",
            locale: "id",
            audioSha256: "x",
            userId: null,
            turns: [],
        });
        metaAnswers(metaResponse);

        const response = await POST(upload({ sessionId: "sess-legacy" }));

        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("quota is per-user: another user's exhausted bucket does not block this caller", async () => {
        await recordUsage({
            userId: "00000000-0000-0000-0000-000000000002",
            estCost: 6.0,
        });
        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("missing");
        metaAnswers(metaResponse);

        const response = await POST(upload({ sessionId: "sess-other-bucket" }));

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalled();
    });

    it("a failed transcription releases the route-level reservation: no phantom charge remains", async () => {
        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("missing");
        metaAnswers(metaResponse);
        // transcribeSession's own reservation succeeds but its Meta call
        // fails: both reservations (route-level and inner) must be released.
        fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));

        const response = await POST(upload({ sessionId: "sess-quota-release" }));

        expect(response.status).toBe(502);
        const usage = await getUsage(
            new Date().toISOString().slice(0, 10),
            "00000000-0000-0000-0000-000000000001"
        );
        expect(usage.estCost).toBeCloseTo(0, 4);
    });

    it("quota is per-user: this caller's exhausted bucket blocks even when the shared bucket is empty", async () => {
        await recordUsage({
            userId: "00000000-0000-0000-0000-000000000001",
            estCost: 6.0,
        });
        storeStub.claimSessionOwner = vi.fn().mockResolvedValue("missing");

        const response = await POST(
            upload({ sessionId: "sess-own-bucket" })
        );

        expect(response.status).toBe(429);
        expect(storeStub.claimSessionOwner).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
