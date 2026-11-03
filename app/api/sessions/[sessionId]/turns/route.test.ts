import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AsrError } from "@/lib/server/asr/errors";
import { createPostgresStore } from "@/lib/server/db/store";
import { GET } from "./route";
const { storeStub, mockGetSession, mockIsAdmin } = vi.hoisted(() => ({
    storeStub: {
        findSession: vi.fn(),
        saveTranscription: vi.fn(),
        setSessionOwner: vi.fn(),
    },
    mockGetSession: vi.fn(),
    mockIsAdmin: vi.fn(),
}));

vi.mock("@/lib/server/db/store", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/db/store")>();
    return {
        ...actual,
        getTurnsStore: () => storeStub,
    };
});
vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: mockIsAdmin,
}));

describe("GET /api/sessions/[sessionId]/turns", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({
            user: {
                id: "user-owner-1",
                email: "owner@suara.local",
                name: "Owner",
                role: "user",
            },
        });
        mockIsAdmin.mockReset().mockReturnValue(false);
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
            userId: "user-owner-1",
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

    it("returns HTTP 401 unauthenticated when request carries no valid session, and no turn data", async () => {
        mockGetSession.mockResolvedValueOnce(null);

        const req = new Request("http://localhost/api/sessions/sess_123/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_123" }),
        });

        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.error.code).toBe("unauthenticated");
        expect(json.turns).toBeUndefined();
    });

    it("returns HTTP 404 when authenticated caller is not session owner, and no turn data", async () => {
        storeStub.findSession.mockResolvedValueOnce({
            sessionId: "sess_foreign",
            locale: "id",
            audioSha256: "sha_foreign",
            userId: "user-different-owner",
            turns: [],
        });

        const req = new Request("http://localhost/api/sessions/sess_foreign/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_foreign" }),
        });

        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error.code).toBe("not_found");
        expect(json.turns).toBeUndefined();
    });

    it("returns HTTP 200 with turns for authenticated owner", async () => {
        storeStub.findSession.mockResolvedValueOnce({
            sessionId: "sess_owner",
            locale: "id",
            audioSha256: "sha_owner",
            userId: "user-owner-1",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 100,
                    transcript: "halo",
                    final: true,
                    speaker: null,
                },
            ],
        });

        const req = new Request("http://localhost/api/sessions/sess_owner/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_owner" }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sessionId).toBe("sess_owner");
        expect(json.turns).toHaveLength(1);
    });

    it("returns HTTP 403 for legacy row with user_id null for non-admin caller", async () => {
        mockIsAdmin.mockReturnValueOnce(false);
        storeStub.findSession.mockResolvedValueOnce({
            sessionId: "sess_legacy",
            locale: "id",
            audioSha256: "sha_legacy",
            userId: null,
            turns: [],
        });

        const req = new Request("http://localhost/api/sessions/sess_legacy/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_legacy" }),
        });

        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error.code).toBe("forbidden");
        expect(json.turns).toBeUndefined();
    });

    it("returns HTTP 200 for legacy row with user_id null for admin caller", async () => {
        mockIsAdmin.mockReturnValue(true);
        storeStub.findSession.mockResolvedValueOnce({
            sessionId: "sess_legacy_admin",
            locale: "id",
            audioSha256: "sha_legacy",
            userId: null,
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 100,
                    transcript: "halo admin",
                    final: true,
                    speaker: null,
                },
            ],
        });

        const req = new Request("http://localhost/api/sessions/sess_legacy_admin/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_legacy_admin" }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sessionId).toBe("sess_legacy_admin");
        expect(json.turns).toHaveLength(1);
    });

    it("returns HTTP 404 when authenticated caller is admin on a foreign session, and no turn data", async () => {
        mockIsAdmin.mockReturnValue(true);
        storeStub.findSession.mockResolvedValueOnce({
            sessionId: "sess_foreign",
            locale: "id",
            audioSha256: "sha_foreign",
            userId: "user-different-owner",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 100,
                    transcript: "secret",
                    final: true,
                    speaker: null,
                },
            ],
        });

        const req = new Request("http://localhost/api/sessions/sess_foreign/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_foreign" }),
        });

        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error.code).toBe("not_found");
        expect(json.turns).toBeUndefined();
    });

    it("maps auth resolution failure to 500", async () => {
        mockGetSession.mockRejectedValueOnce(new Error("auth db down"));

        const req = new Request("http://localhost/api/sessions/sess_123/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess_123" }),
        });

        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.error.code).toBe("internal_error");
    });
});

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("GET /api/sessions/[sessionId]/turns against real store", () => {
    let pool: Pool;
    let realStore: ReturnType<typeof createPostgresStore>;
    const ownerId = "00000000-0000-0000-0000-000000000001";
    const foreignId = "00000000-0000-0000-0000-000000000002";

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0005_asr_speaker.sql",
            "0006_asr_mode.sql",
            "0007_auth_tables.sql",
            "0010_sessions_user_id.sql",
        ]) {
            const sql = readFileSync(
                join(__dirname, "../../../../../db/migrations", file),
                "utf8"
            );
            await pool.query(sql);
        }
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values ($1, 'owner@suara.local', true, 'Owner', 'user'),
                    ($2, 'foreign@suara.local', true, 'Foreign', 'user')
             on conflict (id) do nothing`,
            [ownerId, foreignId]
        );
        realStore = createPostgresStore(TEST_DATABASE_URL!);
    });

    beforeEach(async () => {
        mockIsAdmin.mockReset().mockReturnValue(false);
        storeStub.findSession.mockImplementation((id: string) => realStore.findSession(id));
        storeStub.saveTranscription.mockImplementation((rec) => realStore.saveTranscription(rec));
        storeStub.setSessionOwner.mockImplementation((id: string, uid: string) =>
            realStore.setSessionOwner!(id, uid)
        );
        await pool.query("truncate sessions cascade");

        // Seed an owned session with turns
        await realStore.saveTranscription({
            sessionId: "sess-real-owned",
            locale: "id",
            audioSha256: "sha_owned",
            audioBytes: 1000,
            metaSessionId: null,
            transcript: "halo pemilik",
            audioDurationMs: 100,
            userId: ownerId,
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 100,
                    transcript: "halo pemilik",
                    final: true,
                    speaker: null,
                },
            ],
        });

        // Seed a legacy session with user_id NULL
        await realStore.saveTranscription({
            sessionId: "sess-real-legacy",
            locale: "id",
            audioSha256: "sha_legacy",
            audioBytes: 1000,
            metaSessionId: null,
            transcript: "halo lama",
            audioDurationMs: 100,
            userId: null,
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 100,
                    transcript: "halo lama",
                    final: true,
                    speaker: null,
                },
            ],
        });
    });

    afterAll(async () => {
        await pool.end();
    });

    it("covers 401 unauthenticated against real store", async () => {
        mockGetSession.mockResolvedValueOnce(null);
        const req = new Request("http://localhost/api/sessions/sess-real-owned/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess-real-owned" }),
        });
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.error.code).toBe("unauthenticated");
        expect(json.turns).toBeUndefined();
    });

    it("covers 404 for foreign owner against real store", async () => {
        mockGetSession.mockResolvedValueOnce({
            user: {
                id: foreignId,
                email: "foreign@suara.local",
                name: "Foreign",
                role: "user",
            },
        });
        const req = new Request("http://localhost/api/sessions/sess-real-owned/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess-real-owned" }),
        });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error.code).toBe("not_found");
        expect(json.turns).toBeUndefined();
    });

    it("covers 403 for legacy row with null owner for non-admin caller against real store", async () => {
        mockGetSession.mockResolvedValueOnce({
            user: {
                id: ownerId,
                email: "owner@suara.local",
                name: "Owner",
                role: "user",
            },
        });
        mockIsAdmin.mockReturnValue(false);
        const req = new Request("http://localhost/api/sessions/sess-real-legacy/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess-real-legacy" }),
        });
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error.code).toBe("forbidden");
        expect(json.turns).toBeUndefined();
    });

    it("covers 200 for legacy row with null owner for admin caller against real store", async () => {
        mockGetSession.mockResolvedValueOnce({
            user: {
                id: ownerId,
                email: "admin@suara.local",
                name: "Admin",
                role: "admin",
            },
        });
        mockIsAdmin.mockReturnValue(true);
        const req = new Request("http://localhost/api/sessions/sess-real-legacy/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess-real-legacy" }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sessionId).toBe("sess-real-legacy");
        expect(json.turns).toHaveLength(1);
    });

    it("covers 200 for authenticated owner against real store", async () => {
        mockGetSession.mockResolvedValueOnce({
            user: {
                id: ownerId,
                email: "owner@suara.local",
                name: "Owner",
                role: "user",
            },
        });
        const req = new Request("http://localhost/api/sessions/sess-real-owned/turns");
        const res = await GET(req, {
            params: Promise.resolve({ sessionId: "sess-real-owned" }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.sessionId).toBe("sess-real-owned");
        expect(json.turns).toHaveLength(1);
        expect(json.turns[0].transcript).toBe("halo pemilik");
    });
});
