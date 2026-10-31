import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import type { QuotationDocument } from "@/lib/server/guard/types";

/**
 * The PDF route reads its document from the Postgres document store
 * (`DATABASE_URL`). Point `ASR_TEST_DATABASE_URL` at a throwaway database to
 * run it; it truncates the tables it owns.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

function doc(overrides?: Partial<QuotationDocument>): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: "SL/QTN/2026/0001",
        tanggal: "2026-10-30",
        proyek: { nama: "Villa", lokasi: "Ubud", klien: "Pak Made" },
        pekerjaan: [
            {
                uraian: "Hebel",
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
        ...overrides,
    };
}

describe.skipIf(!TEST_DATABASE_URL)("GET /api/pdf/[id]", () => {
    let pool: Pool;
    let seededId = "";

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
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '')"
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seed(document: QuotationDocument): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json)
             values ('seed-session', $1, $2, $3, $4, $5) returning id`,
            [
                document.locale,
                document.nomor,
                document.butuh_konfirmasi.length > 0 ? "perlu_konfirmasi" : "siap",
                "pdf-hash-" + Math.random(),
                JSON.stringify(document),
            ]
        );
        seededId = result.rows[0].id;
        return seededId;
    }

    it("404 for unknown id", async () => {
        const res = await GET(new Request("http://localhost/api/pdf/nope"), {
            params: Promise.resolve({ id: "nope" }),
        });
        expect(res.status).toBe(404);
    });

    it("409 when butuh_konfirmasi non-empty", async () => {
        const id = await seed(
            doc({ butuh_konfirmasi: [{ field: "x", alasan: "y", sumber_kutipan: null }] })
        );
        const res = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe("needs_confirmation");
    });

    it("returns application/pdf with %PDF header, second call served from cache", async () => {
        const id = await seed(doc());
        const ctx = { params: Promise.resolve({ id }) };
        const r1 = await GET(new Request(`http://localhost/api/pdf/${id}`), ctx);
        expect(r1.status).toBe(200);
        expect(r1.headers.get("content-type")).toBe("application/pdf");
        expect(r1.headers.get("x-pdf-cache")).toBe("MISS");
        const buf = Buffer.from(await r1.arrayBuffer());
        expect(buf.subarray(0, 4).toString()).toBe("%PDF");
        const r2 = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(r2.headers.get("x-pdf-cache")).toBe("HIT");
    }, 60000);
});
