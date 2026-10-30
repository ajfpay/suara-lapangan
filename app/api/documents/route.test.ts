import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as dbStore from "@/lib/server/db/store";
import * as sparkModule from "@/lib/server/guard/spark";
import type { StoredSession, TurnsStore } from "@/lib/server/db/store";
import type { CandidateDocument } from "@/lib/server/guard/types";
import { resetDocumentStoreForTesting } from "@/lib/server/guard/documentStore";

describe("POST /api/documents route handler", () => {
    const originalApiKey = process.env.MODEL_API_KEY;

    beforeEach(() => {
        resetDocumentStoreForTesting();
        delete process.env.MODEL_API_KEY;
        vi.restoreAllMocks();
    });

    afterEach(() => {
        if (originalApiKey !== undefined) {
            process.env.MODEL_API_KEY = originalApiKey;
        } else {
            delete process.env.MODEL_API_KEY;
        }
    });

    it("rejects non-JSON bodies with 400", async () => {
        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            body: "not json",
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects missing or empty sessionId with 400", async () => {
        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects invalid sessionId format with 400", async () => {
        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "bad id with spaces!!!" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects invalid locale with 400", async () => {
        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "sess-valid-1", locale: "fr" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("returns 500 when database fails to look up session", async () => {
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue({
            findSession: vi.fn().mockRejectedValue(new Error("DB error")),
        } as unknown as TurnsStore);

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "sess-valid-1" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toBe("store_failure");
    });

    it("returns 404 when session is not found in store", async () => {
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(null),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "non-existent-session" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe("session_not_found");
    });

    it("returns 400 when session has no turns", async () => {
        const mockSession: StoredSession = {
            sessionId: "empty-session",
            locale: "en",
            audioSha256: "dummy-sha",
            turns: [],
        };
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(mockSession),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "empty-session" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("empty_turns");
    });

    it("falls back to documentFromTurns when MODEL_API_KEY is not configured", async () => {
        delete process.env.MODEL_API_KEY;
        const mockSession: StoredSession = {
            sessionId: "sess-fallback-1",
            locale: "id",
            audioSha256: "sha-fb",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 5000,
                    transcript: "Pengecatan kamar, seratus meter persegi, tiga puluh ribu per meter persegi.",
                    final: true,
                },
            ],
        };
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(mockSession),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-fallback-1",
                project: {
                    nama: "Proyek Sleman",
                    lokasi: "Sleman",
                    klien: "Pak Andi",
                },
            }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("siap");
        expect(data.document.pekerjaan.length).toBe(1);
        expect(data.document.pekerjaan[0].volume).toBe(100);
        expect(data.document.pekerjaan[0].harga_satuan).toBe(30000);
        expect(data.document.proyek.nama).toBe("Proyek Sleman");

        // Idempotent reuse: second call for same session returns cached document
        const reqReplay = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "sess-fallback-1" }),
        });
        const resReplay = await POST(reqReplay);
        expect(resReplay.status).toBe(200);
        const dataReplay = await resReplay.json();
        expect(dataReplay.document).toEqual(data.document);
    });

    it("calls Muse Spark 1.3, runs guard, and returns 200 with result when key is set", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const mockSession: StoredSession = {
            sessionId: "sess-happy-1",
            locale: "en",
            audioSha256: "sha-1",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 5000,
                    transcript: "Twenty-four square feet of drywall at twenty-five dollars a square foot.",
                    final: true,
                },
            ],
        };
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(mockSession),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);

        const mockCandidate: CandidateDocument = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: "SL/QTN/2026-10-29/001",
            tanggal: "2026-10-29",
            proyek: {
                nama: "Living Room Remodel",
                lokasi: "Austin, TX",
                klien: "Mr. Carter",
            },
            pekerjaan: [
                {
                    uraian: "Drywall installation",
                    volume: 24,
                    satuan: "sq_ft",
                    harga_satuan: 25,
                    jumlah: 600,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 600,
            terbilang: "Six hundred US dollars",
            butuh_konfirmasi: [],
        };

        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue(mockCandidate);

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "sess-happy-1", locale: "en" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.status).toBe("siap");
        expect(data.butuh_konfirmasi).toEqual([]);
        expect(data.document.pekerjaan).toHaveLength(1);
        expect(data.document.pekerjaan[0].volume).toBe(24);
        expect(data.document.pekerjaan[0].jumlah).toBe(600);
        expect(data.document.total_nominal).toBe(600);
        expect(data.document.terbilang).toBe("Six hundred US dollars");
    });

    it("falls back to rule generation when the model rejects the schema", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const mockSession: StoredSession = {
            sessionId: "sess-schema-rejected",
            locale: "id",
            audioSha256: "sha-schema",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 5000,
                    transcript: "Pengecatan kamar, seratus meter persegi, tiga puluh ribu per meter persegi.",
                    final: true,
                },
            ],
        };
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(mockSession),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);
        vi.spyOn(sparkModule, "callMuseSpark").mockRejectedValue(
            new sparkModule.SparkError(
                "schema_rejected",
                400,
                "Model API rejected the request schema (HTTP 400)"
            )
        );

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-schema-rejected",
                locale: "id",
            }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("siap");
        expect(data.document.pekerjaan.length).toBe(1);
        expect(data.document.pekerjaan[0].volume).toBe(100);
        expect(data.document.pekerjaan[0].harga_satuan).toBe(30000);
    });

    it("carries _spark_path on the model path outside production", async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        (process.env as Record<string, string | undefined>).NODE_ENV = "test";
        process.env.MODEL_API_KEY = "test-key";
        const mockSession: StoredSession = {
            sessionId: "sess-spark-dev",
            locale: "en",
            audioSha256: "sha-dev",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 5000,
                    transcript: "Twenty-four square feet of drywall at twenty-five dollars a square foot.",
                    final: true,
                },
            ],
        };
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(mockSession),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);

        const mockCandidate: CandidateDocument = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: "SL/QTN/2026-10-29/001",
            tanggal: "2026-10-29",
            proyek: { nama: "Living Room Remodel", lokasi: "Austin, TX", klien: "Mr. Carter" },
            pekerjaan: [
                {
                    uraian: "Drywall installation",
                    volume: 24,
                    satuan: "sq_ft",
                    harga_satuan: 25,
                    jumlah: 600,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 600,
            terbilang: "Six hundred US dollars",
            butuh_konfirmasi: [],
            _spark_path: true,
        };
        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue(mockCandidate);

        try {
            const req = new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: "sess-spark-dev", locale: "en" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data._spark_path).toBe(true);
            expect(data.document._spark_path).toBe(true);
        } finally {
            if (originalNodeEnv === undefined) { delete (process.env as Record<string, string | undefined>).NODE_ENV; } else { (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv; }
        }
    });

    it("omits _spark_path entirely in production", async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        (process.env as Record<string, string | undefined>).NODE_ENV = "production";
        process.env.MODEL_API_KEY = "test-key";
        const mockSession: StoredSession = {
            sessionId: "sess-spark-prod",
            locale: "en",
            audioSha256: "sha-prod",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 5000,
                    transcript: "Twenty-four square feet of drywall at twenty-five dollars a square foot.",
                    final: true,
                },
            ],
        };
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue(mockSession),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore);

        const mockCandidate: CandidateDocument = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: "SL/QTN/2026-10-29/001",
            tanggal: "2026-10-29",
            proyek: { nama: "Living Room Remodel", lokasi: "Austin, TX", klien: "Mr. Carter" },
            pekerjaan: [
                {
                    uraian: "Drywall installation",
                    volume: 24,
                    satuan: "sq_ft",
                    harga_satuan: 25,
                    jumlah: 600,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 600,
            terbilang: "Six hundred US dollars",
            butuh_konfirmasi: [],
            _spark_path: true,
        };
        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue(mockCandidate);

        try {
            const req = new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: "sess-spark-prod", locale: "en" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect("_spark_path" in data).toBe(false);
            expect("_spark_path" in data.document).toBe(false);
        } finally {
            if (originalNodeEnv === undefined) { delete (process.env as Record<string, string | undefined>).NODE_ENV; } else { (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv; }
        }
    });
});
