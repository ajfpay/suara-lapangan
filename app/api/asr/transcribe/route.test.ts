import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

/**
 * The route boundary, which is the contract ticket 02 uploads against and
 * ticket 05 quotes from: multipart in, `{sessionId, turns}` out, idempotent per
 * `sessionId` + audio, and Meta mocked at the network edge with the committed
 * K5 fixture. No key, no database and no network are needed to run this.
 */

const { storeStub } = vi.hoisted(() => ({
    storeStub: {
        findSession: vi.fn(),
        saveTranscription: vi.fn(),
    },
}));

vi.mock("@/lib/server/db/store", () => ({ getTurnsStore: () => storeStub }));

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
    },
    {
        turn_id: "turn_2",
        startMs: 300,
        endMs: 700,
        transcript: "I need ten meters of rebar for the second floor.",
        final: true,
    },
    {
        turn_id: "turn_3",
        startMs: 700,
        endMs: 1000,
        transcript: "And two bags of cement.",
        final: true,
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
}: {
    audioBytes?: Uint8Array;
    locale?: string | null;
    sessionId?: string | null;
} = {}) {
    const body = new FormData();
    body.set(
        "audio",
        new File([audioBytes], "recording.wav", { type: "audio/wav" })
    );
    if (locale !== null) body.set("locale", locale);
    if (sessionId !== null) body.set("sessionId", sessionId);

    return new Request("http://localhost/api/asr/transcribe", {
        method: "POST",
        body,
    });
}

beforeEach(() => {
    storeStub.findSession.mockReset().mockResolvedValue(null);
    storeStub.saveTranscription.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.MODEL_API_KEY = API_KEY;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MODEL_API_KEY;
});

type MalformedUpload = {
    audioBytes?: Uint8Array | null;
    locale?: string | null;
    sessionId?: string | null;
};

const MALFORMED_UPLOADS: Array<[string, MalformedUpload, number]> = [
    ["audio part missing", { audioBytes: null }, 400],
    ["locale missing", { locale: null }, 400],
    ["locale not shipped", { locale: "fr" }, 400],
    ["session id missing", { sessionId: null }, 400],
    ["session id with a path", { sessionId: "../../etc/passwd" }, 400],
];

describe("POST /api/asr/transcribe", () => {
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
            turns: TURNS,
        });
    });

    it("replays a re-upload of the same recording without asking Meta again", async () => {
        storeStub.findSession.mockResolvedValue({
            sessionId: "sess-route-1",
            locale: "id",
            audioSha256: createHash("sha256").update(audio).digest("hex"),
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
            if (overrides.audioBytes) {
                body.set(
                    "audio",
                    new File([audio], "recording.wav", { type: "audio/wav" })
                );
            }
            if (overrides.locale) body.set("locale", overrides.locale);
            if (overrides.sessionId) body.set("sessionId", overrides.sessionId);

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
});
