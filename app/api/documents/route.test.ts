import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as authModule from "@/lib/server/auth";
import * as dbStore from "@/lib/server/db/store";
import * as sparkModule from "@/lib/server/guard/spark";
import type { StoredSession, TurnsStore } from "@/lib/server/db/store";
import type { CandidateDocument } from "@/lib/server/guard/types";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import { recordUsage } from "@/lib/server/quota/usage-meter";

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
        const fs = await import("node:fs/promises");
        const migrationFiles = (await fs.readdir("db/migrations"))
            .filter((f) => f.endsWith(".sql"))
            .sort();
        for (const file of migrationFiles) {
            await pool.query(await fs.readFile(`db/migrations/${file}`, "utf8"));
        }
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values
               ('00000000-0000-0000-0000-000000000001','test1@suara-lapangan.local',true,'Test User 1','user'),
               ('00000000-0000-0000-0000-000000000002','test2@suara-lapangan.local',true,'Test User 2','user')
             on conflict (id) do nothing`
        );
    });

    beforeEach(async () => {
        resetRateLimits();
        await pool.query(
            "truncate documents, sessions, usage_meter, document_sequences cascade"
        );
        process.env.DATABASE_URL = TEST_DATABASE_URL;
        vi.restoreAllMocks();
        vi.spyOn(authModule, "getSession").mockResolvedValue({
            user: { id: "00000000-0000-0000-0000-000000000001", email: "test1@suara-lapangan.local", name: "Test User 1", role: "user" },
        } as Awaited<ReturnType<typeof authModule.getSession>>);
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
        expect(data.status).toBe("draf");
        expect(data.document.nomor).toBeNull();
        expect(data.butuh_konfirmasi).toEqual([]);
        expect(data.document.pekerjaan).toHaveLength(1);
        expect(data.document.pekerjaan[0].volume).toBe(100);
        expect(data.document.pekerjaan[0].harga_satuan).toBe(30000);
        expect(data.document.proyek.nama).toBe("Proyek Sleman");

        // The row is in Postgres with the same id and payload.
        const row = await pool.query(
            "select id, session_id, status, nomor, data_json from documents where id = $1::uuid",
            [data.document.id]
        );
        expect(row.rowCount).toBe(1);
        expect(row.rows[0].session_id).toBe("sess-persist-1");
        expect(row.rows[0].status).toBe("draf");
        expect(row.rows[0].nomor).toBeNull();
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

        expect(first.status).toBe("draf");
        expect(first.document.nomor).toBeNull();
        expect(second.status).toBe("draf");
        expect(second.document.id).toBe(first.document.id);
        expect(second.document.nomor).toBeNull();

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
        expect(first.document.nomor).toBeNull();
        expect(second.document.nomor).toBeNull();
    });

    it("creates draft without number, never lets model nomor through, and leaves document_sequences empty", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const session = mockSession(
            "sess-nomor-owner",
            "Twenty-four square feet of drywall at twenty-five dollars a square foot."
        );
        await seedSessionsIntoDb([{ id: "sess-nomor-owner", locale: "en", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

        const modelNomor = "SL/QTN/1999/0001";
        const mockCandidate: CandidateDocument = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: modelNomor,
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
        };
        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue(mockCandidate);

        const res = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: "sess-nomor-owner", locale: "en" }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.status).toBe("draf");
        expect(data.document.nomor).toBeNull();
        const row = await pool.query(
            "select nomor, status from documents where id = $1::uuid",
            [data.document.id]
        );
        expect(row.rows[0].nomor).toBeNull();
        expect(row.rows[0].status).toBe("draf");

        const seqRows = await pool.query("select * from document_sequences");
        expect(seqRows.rowCount).toBe(0);
    });

    it("duplicate create returns 200 with draf status and leaves document_sequences empty", async () => {
        delete process.env.MODEL_API_KEY;
        const transcript =
            "Pemasangan keramik, sepuluh meter persegi, lima puluh ribu per meter persegi.";
        const session = mockSession("sess-dup-draf", transcript);
        await seedSessionsIntoDb([{ id: "sess-dup-draf", locale: "id", turns: session.turns }]);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue(mockStore(session));

        const body = JSON.stringify({
            sessionId: "sess-dup-draf",
            project: { nama: "Proyek Duplikat", lokasi: "Sleman", klien: "Pak Budi" },
        });

        const res1 = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            })
        );
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        expect(data1.status).toBe("draf");
        expect(data1.document.nomor).toBeNull();

        const res2 = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            })
        );
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.status).toBe("draf");
        expect(data2.document.nomor).toBeNull();
        expect(data2.document.id).toBe(data1.document.id);

        const seqRows = await pool.query("select * from document_sequences");
        expect(seqRows.rowCount).toBe(0);
    });

    it("an inline-turns POST against a stored session builds from the stored turns, never clobbering them", async () => {
        delete process.env.MODEL_API_KEY;
        const storedTranscript =
            "Pengecatan kamar, seratus meter persegi, tiga puluh ribu per meter persegi.";
        await seedSessionsIntoDb([
            {
                id: "sess-inline-guard",
                locale: "id",
                turns: [
                    { startMs: 0, endMs: 5000, transcript: storedTranscript },
                ],
            },
        ]);
        const storedSession = mockSession("sess-inline-guard", storedTranscript);
        const save = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(dbStore, "getTurnsStore").mockReturnValue({
            findSession: vi.fn().mockResolvedValue(storedSession),
            saveTranscription: save,
        });

        const res = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: "sess-inline-guard",
                    turns: [
                        {
                            turn_id: "turn_1",
                            startMs: 0,
                            endMs: 5000,
                            transcript: "CLOBBERED",
                            final: true,
                        },
                    ],
                }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();

        // The document content comes from the stored turns, not the inline copy.
        expect(data.document.pekerjaan[0].uraian).toBe("Pengecatan kamar");
        expect(data.document.pekerjaan[0].volume).toBe(100);
        // The stored session was never rewritten.
        expect(save).not.toHaveBeenCalled();
        const row = await pool.query(
            "select transcript from turns where session_id = 'sess-inline-guard'"
        );
        expect(row.rows[0].transcript).toBe(storedTranscript);
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
            nomor: "SL/QTN/2026/0001",
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

        expect(data.status).toBe("draf");
        expect(data.document.nomor).toBeNull();
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
        expect(row.rows[0].status).toBe("draf");
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
            nomor: "SL/QTN/2026/0001",
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
            nomor: "SL/QTN/2026/0001",
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
    it("rejects malformed sessionId with 400 without calling model", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const spy = vi.spyOn(sparkModule, "callMuseSpark");
        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "../etc/passwd" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("invalid_request");
        expect(body.message).toContain("sessionId");
        expect(spy).not.toHaveBeenCalled();
    });

    it("enforces rate limit: 31 sequential POSTs in the same minute; #31 is 429", async () => {
        let lastRes: Response | null = null;
        for (let i = 0; i < 31; i++) {
            const req = new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: "invalid-rate-limit!!!" }),
            });
            lastRes = await POST(req);
        }
        expect(lastRes).not.toBeNull();
        expect(lastRes!.status).toBe(429);
        const retryAfter = Number(lastRes!.headers.get("Retry-After"));
        expect(retryAfter).toBeGreaterThan(0);
        const body = await lastRes!.json();
        expect(body.error).toBe("rate_limited");
    });

    it("returns 401 and writes no row without a session", async () => {
        vi.mocked(authModule.getSession).mockResolvedValue(null);
        const res = await POST(
            new Request("http://localhost/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: "sess-anon-1",
                    turns: [{ turn_id: "turn_1", startMs: 0, endMs: 1000, transcript: "anon attempt" }],
                }),
            })
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ error: "unauthorized" });
        const rows = await pool.query("select id from documents where session_id = $1", ["sess-anon-1"]);
        expect(rows.rowCount).toBe(0);
    });

    it("enforces quota hard-stop: 429 with X-Quota-Hard-Stop, model not called", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const spy = vi.spyOn(sparkModule, "callMuseSpark");
        await recordUsage({ userId: "00000000-0000-0000-0000-000000000001", estCost: 6.0 });

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-quota",
                turns: [
                    {
                        turn_id: "turn_1",
                        startMs: 0,
                        endMs: 1000,
                        transcript: "testing quota",
                    },
                ],
            }),
        });
        const res = await POST(req);
        expect(res.status).toBe(429);
        expect(res.headers.get("X-Quota-Hard-Stop")).toBe("true");
        const body = await res.json();
        expect(body.error).toBe("quota_exceeded");
        expect(spy).not.toHaveBeenCalled();
    });

    it("honours the per-user cost limit: 429 for the user over their own cap, 200 for another user", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const overCap = "00000000-0000-0000-0000-000000000001";
        const underCap = "00000000-0000-0000-0000-000000000002";

        // The cap is read from `user_cost_limits` for the session user.
        await pool.query(
            `insert into user_cost_limits (user_id, daily_cost_limit) values ($1, 1.0) on conflict (user_id) do update set daily_cost_limit = excluded.daily_cost_limit`,
            [overCap]
        );
        // The user's usage reaches the cap.
        await recordUsage({ userId: overCap, estCost: 6.0 });

        const turns = [
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 1000,
                transcript: "testing quota",
            },
        ];

        async function withSession(userId: string | null): Promise<Response> {
            const session = userId
                ? { user: { id: userId, email: "a@example.com", name: "A", role: "user" } }
                : null;
            const spy = vi.spyOn(authModule, "getSession");
            spy.mockResolvedValue(session);
            try {
                return await POST(
                    new Request("http://localhost/api/documents", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            sessionId: `sess-${userId}`,
                            turns,
                        }),
                    })
                );
            } finally {
                spy.mockRestore();
            }
        }

        const overRes = await withSession(overCap);
        expect(overRes.status).toBe(429);
        expect(overRes.headers.get("X-Quota-Hard-Stop")).toBe("true");
        expect(await overRes.json()).toMatchObject({ error: "quota_exceeded" });

        // Restore the seeded cap so later tests for the same user start clean.
        await pool.query(
            "delete from user_cost_limits where user_id = $1",
            [overCap]
        );

        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue({
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor: "SL/QTN/2099/0001",
            tanggal: "2026-10-31",
            proyek: {
                nama: "Renovasi Rumah",
                lokasi: "Jl. Kaliurang km 5",
                klien: "Pak Bambang",
            },
            pekerjaan: [
                {
                    uraian: "Pemasangan hebel",
                    volume: 10,
                    satuan: "m2",
                    harga_satuan: 50000,
                    jumlah: 500000,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 500000,
            terbilang: "Lima ratus ribu rupiah",
            butuh_konfirmasi: [],
            _spark_path: true,
            _usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        });
        const underRes = await withSession(underCap);
        expect(underRes.status).toBe(200);
    });

    it("trips the daily cap with Spark-only token spend", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const candidate: CandidateDocument & {
            _usage?: sparkModule.SparkUsage;
        } = {
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor: "SL/QTN/2026/0001",
            tanggal: "2026-10-31",
            proyek: {
                nama: "Renovasi Rumah",
                lokasi: "Jl. Kaliurang km 5",
                klien: "Pak Bambang",
            },
            pekerjaan: [
                {
                    uraian: "Pemasangan hebel",
                    volume: 10,
                    satuan: "m2",
                    harga_satuan: 50000,
                    jumlah: 500000,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 500000,
            terbilang: "Lima ratus ribu rupiah",
            butuh_konfirmasi: [],
            _spark_path: true,
            _usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        };
        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue(candidate);

        await recordUsage({ userId: "00000000-0000-0000-0000-000000000001", estCost: 6.0 });

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-metering-spark",
                turns: [
                    {
                        turn_id: "turn_1",
                        startMs: 0,
                        endMs: 5000,
                        transcript:
                            "Pemasangan hebel sepuluh meter persegi lima puluh ribu per meter.",
                    },
                ],
            }),
        });
        const res = await POST(req);
        expect(res.status).toBe(429);
        expect(res.headers.get("X-Quota-Hard-Stop")).toBe("true");
        expect(await res.json()).toMatchObject({ error: "quota_exceeded" });
    });

    it("records Spark token usage when model returns usage", async () => {
        process.env.MODEL_API_KEY = "test-key";
        const candidate: CandidateDocument & {
            _usage?: sparkModule.SparkUsage;
        } = {
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor: "SL/QTN/2026/0001",
            tanggal: "2026-10-31",
            proyek: {
                nama: "Renovasi Rumah",
                lokasi: "Jl. Kaliurang km 5",
                klien: "Pak Bambang",
            },
            pekerjaan: [
                {
                    uraian: "Pemasangan hebel",
                    volume: 10,
                    satuan: "m2",
                    harga_satuan: 50000,
                    jumlah: 500000,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 500000,
            terbilang: "Lima ratus ribu rupiah",
            butuh_konfirmasi: [],
            _spark_path: true,
            _usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        };
        vi.spyOn(sparkModule, "callMuseSpark").mockResolvedValue(candidate);

        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-metering-spark",
                turns: [
                    {
                        turn_id: "turn_1",
                        startMs: 0,
                        endMs: 5000,
                        transcript:
                            "Pemasangan hebel sepuluh meter persegi lima puluh ribu per meter.",
                    },
                ],
            }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);

        const queryRes = await pool.query<{
            tokens: number;
            est_cost: number;
        }>(
            "select coalesce(sum(tokens),0)::int as tokens, coalesce(sum(est_cost),0)::float8 as est_cost from usage_meter"
        );
        expect(queryRes.rows[0].tokens).toBe(150);
        expect(queryRes.rows[0].est_cost).toBeCloseTo(0.005, 4);
    });

    it("does not record tokens on fallback path when MODEL_API_KEY is missing", async () => {
        delete process.env.MODEL_API_KEY;
        const req = new Request("http://localhost/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-metering-fallback",
                turns: [
                    {
                        turn_id: "turn_1",
                        startMs: 0,
                        endMs: 5000,
                        transcript:
                            "Pengecatan kamar seratus meter persegi tiga puluh ribu per meter persegi.",
                    },
                ],
            }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);

        const queryRes = await pool.query<{ tokens: number }>(
            "select coalesce(sum(tokens),0)::int as tokens from usage_meter"
        );
        expect(queryRes.rows[0].tokens).toBe(0);
    });
});

/**
 * Pure request-validation tests: no Postgres, run everywhere. The
 * Postgres-backed suite below carries the rest.
 */
describe("POST /api/documents request validation", () => {
    beforeEach(() => {
        resetRateLimits();
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
        expect(data.message).toContain("locale");
    });
});
