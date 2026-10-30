import { describe, expect, it, vi, beforeEach } from "vitest";

import { AsrError } from "@/lib/server/asr/errors";
import { GET } from "./route";

const { storeStub } = vi.hoisted(() => ({
    storeStub: {
        findSession: vi.fn(),
        saveTranscription: vi.fn(),
    },
}));

vi.mock("@/lib/server/db/store", () => ({ getTurnsStore: () => storeStub }));

describe("GET /api/sessions/[sessionId]/turns", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects invalid session ids with 400", async () => {
        const invalidIds = ["", "bad/id", "bad?id", "../secret", "a".repeat(65)];

        for (const badId of invalidIds) {
            const req = new Request(`http://localhost/api/sessions/${badId}/turns`);
            const res = await GET(req, {
                params: Promise.resolve({ sessionId: badId }),
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("invalid_request");
        }
    });

    it("returns 404 when session is not found", async () => {
        storeStub.findSession.mockResolvedValueOnce(null);

        const req = new Request("http://localhost/api/sessions/sess_not_found/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_not_found" }),
        });

        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error.code).toBe("not_found");
    });

    it("returns 200 with turns sorted ascending by startMs", async () => {
        const unsortedTurns = [
            {
                turn_id: "turn_2",
                startMs: 2000,
                endMs: 3500,
                transcript: "dua sak semen",
                final: true as const,
            },
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 1800,
                transcript: "halo mandor",
                final: true as const,
            },
            {
                turn_id: "turn_3",
                startMs: 4000,
                endMs: 6000,
                transcript: "sepuluh meter besi",
                final: true as const,
            },
        ];

        storeStub.findSession.mockResolvedValueOnce({
            sessionId: "sess_123",
            locale: "id",
            audioSha256: "abc",
            turns: unsortedTurns,
        });

        const req = new Request("http://localhost/api/sessions/sess_123/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_123" }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sessionId).toBe("sess_123");
        expect(json.locale).toBe("id");
        expect(json.turns).toHaveLength(3);
        expect(json.turns[0].turn_id).toBe("turn_1");
        expect(json.turns[0].startMs).toBe(0);
        expect(json.turns[1].turn_id).toBe("turn_2");
        expect(json.turns[1].startMs).toBe(2000);
        expect(json.turns[2].turn_id).toBe("turn_3");
        expect(json.turns[2].startMs).toBe(4000);
    });

    it("maps store configuration errors to 500", async () => {
        storeStub.findSession.mockRejectedValueOnce(
            new AsrError("not_configured", { detail: "DATABASE_URL is not set" })
        );

        const req = new Request("http://localhost/api/sessions/sess_db_err/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_db_err" }),
        });

        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.error.code).toBe("not_configured");
    });
});
