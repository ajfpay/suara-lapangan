import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as dbStore from "@/lib/server/db/store";
import * as sparkModule from "@/lib/server/guard/spark";
import type { StoredSession, TurnsStore } from "@/lib/server/db/store";
import type { CandidateDocument } from "@/lib/server/guard/types";

/**
 * POST /api/documents against the test Postgres (`ASR_TEST_DATABASE_URL`),
 * which the route reads documents from through `DATABASE_URL`.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("POST /api/documents route handler", () => {
    const originalApiKey = process.env.MODEL_API_KEY;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    let pool: Pool;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DATABASE_URL;
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
        ]) {
            const sql = await import("node:fs/promises").then((fs) =>
                fs.readFile(`db/migrations/${file}`, "utf8")
            );
            await pool.query(sql);
        }
    });

    beforeEach(async () => {
        await pool.query("truncate documents, sessions cascade");
        process.env.DATABASE_URL = TEST_DATABASE_URL;
        vi.restoreAllMocks();
    });

    afterEach(async () => {
        if (originalApiKey !== undefined) {
            process.env.MODEL_API_KEY = originalApiKey;
        } else {
            delete process.env.MODEL_API_KEY;
        }
        if (originalDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = originalDatabaseUrl;
        }
    });

    afterAll(async () => {
        await pool.end();
    });

    function mockSession(sessionId: string, transcript: string): StoredSession {
        return {
            sessionId,
            locale: "id",
            audioSha256: "sha-test",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 5000,
                    transcript,
                    final: true,
                },
            ],
        };
    }


    async function seedSessionsIntoDb(sessions: { id: string; locale: string; turns: { startMs: number; endMs: number; transcript: string }[] }[]) {
        const { Pool } = await import("pg");
        const seedPool = new Pool({ connectionString: TEST_DATABASE_URL });
        try {
            for (const s of sessions) {
                await seedPool.query(
                    "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ($1, $2, 'sha', 1, 'seed') on conflict (id) do update set locale = excluded.locale",
                    [s.id, s.locale]
                );
                await seedPool.query("delete from turns where session_id = $1", [s.id]);
                for (const [i, t] of s.turns.entries()) {
                    await seedPool.query(
                        "insert into turns (session_id, turn_index, start_ms, end_ms, transcript) values ($1, $2, $3, $4, $5)",
                        [s.id, i + 1, t.startMs, t.endMs, t.transcript]
                    );
                }
            }
        } finally {
            await seedPool.end();
        }
    }

    function mockStore(session: StoredSession): TurnsStore {
        return {
            findSession: vi.fn().mockResolvedValue(session),
            saveTranscription: vi.fn(),
        };
    }

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

    it("returns 500 when the session database fails to look up a session", async () => {
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
        const mockStore: TurnsStore = {
            findSession: vi.fn().mockResolvedValue({
                sessionId: "empty-session",
                locale: "en",
                audioSha256: "dummy-sha",
                turns: [],
            }),
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

    it("creates and persists the document with a server-issued id and unchanged envelope", async () => {
        delete process.env.MODEL_API_KEY;
        const transcript =
            "Pengecatan kamar, seratus meter persegi, tiga puluh ribu per meter persegi.";
        const pool2 = await import("pg").then(({ Pool }) => new Pool({ connectionString: TEST_DATABASE_URL }));
        try {
            await pool2.query(
                "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('sess-persist-1', 'id', 'sha', 1, 'seed') on conflict (id) do nothing"
            );
            await pool2.query(
                "insert into turns (session_id, turn_index, start_ms, end_ms, transcript) values ('sess-persist-1', 1, 0, 5000, $1)",
                [transcript]
            );
        } finally {
            await pool2.end();
        }
        const session = mockSession("sess-persist-1", transcript);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-persist-1",
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

        expect(data.document.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
        expect(data.status).toBe("siap");
        expect(data.butuh_konfirmasi).toEqual([]);
        expect(data.document.pekerjaan).toHaveLength(1);
        expect(data.document.pekerjaan[0].volume).toBe(100);
        expect(data.document.pekerjaan[0].harga_satuan).toBe(30000);
        expect(data.document.proyek.nama).toBe("Proyek Sleman");

        // The row is in Postgres with the same id and payload.
        const row = await pool.query(
            "select id, session_id, status, data_json from documents where id = $1::uuid",
            [data.document.id]
        );
        expect(row.rowCount).toBe(1);
        expect(row.rows[0].session_id).toBe("sess-persist-1");
        expect(row.rows[0].status).toBe("siap");
        expect(row.rows[0].data_json.total_nominal).toBe(
            data.document.total_nominal
        );
    });

    it("returns the existing document for an identical create on the same day", async () => {
        delete process.env.MODEL_API_KEY;
        const transcript =
            "Pengecatan kamar, seratus meter persegi, tiga puluh ribu per meter persegi.";
        const session = mockSession("sess-idem-1", transcript);
        await seedSessionsIntoDb([{ id: "sess-idem-1", locale: "id", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

        const body = JSON.stringify({
            sessionId: "sess-idem-1",
            project: {
                nama: "Proyek Sleman",
                lokasi: "Sleman",
                klien: "Pak Andi",
            },
        });
        const res1 = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            })
        );
        expect(res1.status).toBe(200);
        const first = await res1.json();

        const res2 = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            })
        );
        expect(res2.status).toBe(200);
        const second = await res2.json();

        expect(second.document.id).toBe(first.document.id);
        expect(second.document.nomor).toBe(first.document.nomor);

        // Only one row exists.
        const rows = await pool.query(
            "select count(*)::int as n from documents where session_id = 'sess-idem-1'"
        );
        expect(rows.rows[0].n).toBe(1);
    });

    it("creates a distinct document when the turns change for the same session", async () => {
        delete process.env.MODEL_API_KEY;
        const turnsStore: TurnsStore = {
            findSession: vi
                .fn()
                .mockResolvedValueOnce(
                    mockSession("sess-new-1", "pagar dua puluh meter")
                )
                .mockResolvedValueOnce(
                    mockSession("sess-new-1", "pagar tiga puluh meter")
                ),
            saveTranscription: vi.fn(),
        };
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(turnsStore);
        await seedSessionsIntoDb([
            { id: "sess-new-1", locale: "id", turns: [{ startMs: 0, endMs: 5000, transcript: "pagar dua puluh meter" }] },
            { id: "sess-new-1b", locale: "id", turns: [{ startMs: 0, endMs: 5000, transcript: "pagar tiga puluh meter" }] },
        ]);

        const body = JSON.stringify({ sessionId: "sess-new-1" });
        const res1 = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            })
        );
        const res2 = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            })
        );
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
        const first = await res1.json();
        const second = await res2.json();

        expect(second.document.id).not.toBe(first.document.id);
        expect(second.document.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
    });

    it("falls back to rule generation when the model rejects the schema, without persisting", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const session = mockSession(
            "sess-schema-rejected",
            "Pengecatan kamar, seratus meter persegi, tiga puluh ribu per meter persegi."
        );
        await seedSessionsIntoDb([{ id: "sess-schema-rejected", locale: "id", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));
        vi.spyOn(sparkModule, "callMuseSpark").mockRejectedValue(
            new sparkModule.SparkError("schema_rejected", 422, "bad candidate"),
        );

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "sess-schema-rejected" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan.length).toBeGreaterThan(0);

        // Transient fallback answers are not persisted: the next create can retry.
        const rows = await pool.query(
            "select count(*)::int as n from documents where session_id = 'sess-schema-rejected'"
        );
        expect(rows.rows[0].n).toBe(0);
    });

    it("calls Muse Spark 1.3, runs guard, persists, and returns 200 with result when key is set", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const session = mockSession(
            "sess-happy-1",
            "Twenty-four square feet of drywall at twenty-five dollars a square foot."
        );
        await seedSessionsIntoDb([{ id: "sess-happy-1", locale: "en", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

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

        const row = await pool.query(
            "select status from documents where id = $1::uuid",
            [data.document.id]
        );
        expect(row.rows[0].status).toBe("siap");
    });

    it("carries _spark_path on the model path outside production", async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        (process.env as Record<string, string | undefined>).NODE_ENV = "test";
        process.env.MODEL_API_KEY = "test-key";
        const session = mockSession(
            "sess-spark-dev",
            "Twenty-four square feet of drywall at twenty-five dollars a square foot."
        );
        await seedSessionsIntoDb([{ id: "sess-spark-dev", locale: "en", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

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
        const session = mockSession(
            "sess-spark-prod",
            "Twenty-four square feet of drywall at twenty-five dollars a square foot."
        );
        await seedSessionsIntoDb([{ id: "sess-spark-prod", locale: "en", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

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
            expect("_spark_path" in data.document).toBe(false);
            expect(JSON.stringify(data)).not.toContain("_spark_path");
        } finally {
            if (originalNodeEnv === undefined) { delete (process.env as Record<string, string | undefined>).NODE_ENV; } else { (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv; }
        }
    });
});
