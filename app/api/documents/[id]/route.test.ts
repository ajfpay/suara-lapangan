import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockIsAdmin } = vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsAdmin: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: mockIsAdmin,
}));

beforeEach(() => {
    mockGetSession.mockResolvedValue({
        user: {
            id: "00000000-0000-0000-0000-000000000000",
            email: "system@suara-lapangan.local",
            name: "System",
            role: "admin",
        },
    });
    mockIsAdmin.mockReturnValue(true);
});
const adminId = "00000000-0000-0000-0000-000000000000";
const ownerId = "00000000-0000-0000-0000-000000000001";
const otherUserId = "00000000-0000-0000-0000-000000000002";

function withUser(role: "user" | "admin", userId: string): void {
    mockGetSession.mockResolvedValue({
        user: { id: userId, email: `${role}@example.com`, name: role, role },
    });
    mockIsAdmin.mockReturnValue(role === "admin");
}
import { GET, PATCH } from "./route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import type { QuotationDocument } from "@/lib/server/guard/types";

/**
 * PATCH /api/documents/[id] against the test Postgres (`ASR_TEST_DATABASE_URL`).
 * The route's field whitelist and server-side recompute are pure logic checked
 * through the HTTP shapes; the store itself is exercised end to end.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

if (TEST_DATABASE_URL !== undefined) {
    // The route builds its store from DATABASE_URL; point it at the same test
    // database the assertions read through their own pool.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
}

function createTestDocument(
    overrides?: Partial<QuotationDocument>
): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: "SL/QTN/2026/0001",
        tanggal: "2026-10-29",
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
            {
                uraian: "Plester aci",
                volume: 5,
                satuan: "m2",
                harga_satuan: 40000,
                jumlah: 200000,
                sumber_kutipan: "turn_2",
            },
        ],
        total_nominal: 700000,
        terbilang: "Tujuh ratus ribu rupiah",
        butuh_konfirmasi: [],
        ...overrides,
    };
}

describe.skipIf(!TEST_DATABASE_URL).sequential("PATCH /api/documents/[id] route handler", () => {
    let pool: Pool;
    let seededIds: string[] = [];

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
            "0004_email_sends.sql",
            "0007_auth_tables.sql",
            "0008_documents_user_id.sql",
        ]) {
            const sql = await import("node:fs/promises").then((fs) =>
                fs.readFile(`db/migrations/${file}`, "utf8")
            );
            await pool.query(sql);
        }
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values
               ('00000000-0000-0000-0000-000000000000', 'admin@suara-lapangan.local', true, 'Admin', 'admin'),
               ('00000000-0000-0000-0000-000000000001', 'owner@suara-lapangan.local', true, 'Owner', 'user'),
               ('00000000-0000-0000-0000-000000000002', 'other@suara-lapangan.local', true, 'Other', 'user')
             on conflict (id) do nothing`
        );
    });

    beforeEach(async () => {
        await pool.query("truncate documents, sessions cascade");
        seededIds = [];
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seedDocument(
        document: QuotationDocument,
        options?: { userId?: string | null }
    ): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id)
             values ('seed-session', $1, $2, $3, $4, $5, $6) returning id`,
            [
                document.locale,
                document.nomor + "#" + seededIds.length,
                document.butuh_konfirmasi.length > 0
                    ? "perlu_konfirmasi"
                    : "siap",
                "hash-" + seededIds.length,
                JSON.stringify(document),
                options?.userId ?? null,
            ]
        );
        const id = result.rows[0].id;
        seededIds.push(id);
        return id;
    }

    async function readDocument(id: string): Promise<QuotationDocument | null> {
        const result = await pool.query<{ data_json: QuotationDocument }>(
            "select data_json from documents where id = $1::uuid",
            [id]
        );
        return result.rows[0]?.data_json ?? null;
    }

    it("rejects non-JSON body with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            body: "invalid-json-content",
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects non-object JSON body with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify("plain string not object"),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects missing field with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nilai: 10 }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects empty or whitespace-only field with 400", async () => {
        const emptyReq = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "", nilai: 10 }),
        });
        const emptyRes = await PATCH(emptyReq, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(emptyRes.status).toBe(400);
        const emptyData = await emptyRes.json();
        expect(emptyData.error).toBe("invalid_request");

        const wsReq = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "   ", nilai: 10 }),
        });
        const wsRes = await PATCH(wsReq, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(wsRes.status).toBe(400);
        const wsData = await wsRes.json();
        expect(wsData.error).toBe("invalid_request");
    });

    it("rejects non-string field with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: 12345, nilai: 10 }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects unsupported field format with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "proyek.nama", nilai: "Baru" }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("returns 404 for an unknown id", async () => {
        const req = new Request(
            "http://localhost/api/documents/00000000-0000-0000-0000-000000000000",
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    field: "pekerjaan[0].volume",
                    nilai: 15,
                }),
            }
        );

        const res = await PATCH(req, {
            params: Promise.resolve({
                id: "00000000-0000-0000-0000-000000000000",
            }),
        });
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe("not_found");
    });

    it("rejects pekerjaan index out of bounds with 400", async () => {
        const id = await seedDocument(createTestDocument());

        const req = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[99].volume",
                nilai: 15,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects invalid numeric values with 400", async () => {
        const id = await seedDocument(createTestDocument());

        const nonNumReq = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: "bukan_angka",
            }),
        });
        const nonNumRes = await PATCH(nonNumReq, {
            params: Promise.resolve({ id }),
        });
        expect(nonNumRes.status).toBe(400);
        const nonNumData = await nonNumRes.json();
        expect(nonNumData.error).toBe("invalid_request");
        expect(nonNumData.message).toContain("nilai");

        const negReq = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: -10,
            }),
        });
        const negRes = await PATCH(negReq, {
            params: Promise.resolve({ id }),
        });
        expect(negRes.status).toBe(400);
        const negData = await negRes.json();
        expect(negData.error).toBe("invalid_request");
    });

    it("correcting pekerjaan[i].volume recomputes jumlah, total_nominal, and terbilang on the server", async () => {
        const id = await seedDocument(createTestDocument());

        // Patch volume of item 0 to 20
        const req = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 20,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);

        const data = await res.json();
        // Item 0 jumlah: 20 * 50000 = 1,000,000
        // Item 1 jumlah: 5 * 40000 = 200,000
        // total_nominal: 1,200,000
        expect(data.document.id).toBe(id);
        expect(data.document.pekerjaan[0].volume).toBe(20);
        expect(data.document.pekerjaan[0].jumlah).toBe(1000000);
        expect(data.document.pekerjaan[1].jumlah).toBe(200000);
        expect(data.document.total_nominal).toBe(1200000);
        expect(data.document.terbilang).toBe("Satu juta dua ratus ribu rupiah");
        expect(data.status).toBe("siap");

        // The patch reached Postgres, not just the response.
        const stored = await readDocument(id);
        expect(stored?.pekerjaan[0].volume).toBe(20);
        expect(stored?.total_nominal).toBe(1200000);
    });

    it("correcting pekerjaan[i].harga_satuan with string coercion in English locale document", async () => {
        const id = await seedDocument(
            createTestDocument({
                locale: "en",
                mata_uang: "USD",
                nomor: "SL/QTN/2026/0002",
                proyek: {
                    nama: "Drywall project",
                    lokasi: "Seattle, WA",
                    klien: "John Doe",
                },
                pekerjaan: [
                    {
                        uraian: "Install drywall",
                        volume: 4,
                        satuan: "sheet",
                        harga_satuan: 25,
                        jumlah: 100,
                        sumber_kutipan: "turn_1",
                    },
                ],
                total_nominal: 100,
                terbilang: "One hundred US dollars",
            })
        );

        // Patch harga_satuan as string "30.5"
        const req = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].harga_satuan",
                nilai: "30.5",
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);

        const data = await res.json();
        // 4 * 30.5 = 122
        expect(data.document.pekerjaan[0].harga_satuan).toBe(30.5);
        expect(data.document.pekerjaan[0].jumlah).toBe(122);
        expect(data.document.total_nominal).toBe(122);
        expect(data.document.terbilang).toBe("One hundred twenty-two US dollars");
        expect(data.status).toBe("siap");
    });

    it("patches string fields (satuan and uraian)", async () => {
        const id = await seedDocument(createTestDocument());

        const req1 = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].satuan",
                nilai: "sak",
            }),
        });
        const res1 = await PATCH(req1, {
            params: Promise.resolve({ id }),
        });
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        expect(data1.document.pekerjaan[0].satuan).toBe("sak");

        const req2 = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].uraian",
                nilai: "Pemasangan hebel tebal 10cm",
            }),
        });
        const res2 = await PATCH(req2, {
            params: Promise.resolve({ id }),
        });
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.document.pekerjaan[0].uraian).toBe(
            "Pemasangan hebel tebal 10cm"
        );
    });

    it("removes matching entry from butuh_konfirmasi and status flips from perlu_konfirmasi to siap only when empty", async () => {
        const id = await seedDocument(
            createTestDocument({
                butuh_konfirmasi: [
                    {
                        field: "pekerjaan[0].volume",
                        alasan: "Volume tidak cocok dengan transkrip",
                        sumber_kutipan: "turn_1",
                    },
                    {
                        field: "pekerjaan[0].harga_satuan",
                        alasan: "Harga satuan tidak cocok dengan transkrip",
                        sumber_kutipan: "turn_1",
                    },
                ],
            })
        );

        // First patch: fix pekerjaan[0].volume
        const req1 = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 15,
            }),
        });

        const res1 = await PATCH(req1, {
            params: Promise.resolve({ id }),
        });
        expect(res1.status).toBe(200);
        const data1 = await res1.json();

        // pekerjaan[0].volume removed, but pekerjaan[0].harga_satuan remains -> status still "perlu_konfirmasi"
        expect(data1.status).toBe("perlu_konfirmasi");
        expect(data1.butuh_konfirmasi).toHaveLength(1);
        expect(data1.butuh_konfirmasi[0].field).toBe("pekerjaan[0].harga_satuan");
        expect(data1.document.butuh_konfirmasi).toHaveLength(1);

        // Second patch: fix pekerjaan[0].harga_satuan
        const req2 = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].harga_satuan",
                nilai: 60000,
            }),
        });

        const res2 = await PATCH(req2, {
            params: Promise.resolve({ id }),
        });
        expect(res2.status).toBe(200);
        const data2 = await res2.json();

        // Both defects cleared -> status flips to "siap"
        expect(data2.status).toBe("siap");
        expect(data2.butuh_konfirmasi).toHaveLength(0);
        expect(data2.document.butuh_konfirmasi).toHaveLength(0);
    });

    it("persists document so a second read reflects the patch", async () => {
        const id = await seedDocument(createTestDocument());

        const req = new Request(`http://localhost/api/documents/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 25,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);

        const stored = await readDocument(id);
        expect(stored?.pekerjaan[0].volume).toBe(25);
        expect(stored?.pekerjaan[0].jumlah).toBe(1250000);
        expect(stored?.total_nominal).toBe(1450000);
        expect(stored?.terbilang).toBe(
            "Satu juta empat ratus lima puluh ribu rupiah"
        );
    });

    it("reports _spark_path outside production and omits it in production", async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        try {
            (process.env as Record<string, string | undefined>).NODE_ENV =
                "test";
            const idDev = await seedDocument(
                createTestDocument({ _spark_path: true })
            );
            const res = await PATCH(
                new Request(`http://localhost/api/documents/${idDev}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        field: "pekerjaan[0].volume",
                        nilai: 30,
                    }),
                }),
                { params: Promise.resolve({ id: idDev }) }
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.document._spark_path).toBe(true);

            (process.env as Record<string, string | undefined>).NODE_ENV =
                "production";
            const idProd = await seedDocument(
                createTestDocument({ _spark_path: true })
            );
            const resProd = await PATCH(
                new Request(`http://localhost/api/documents/${idProd}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        field: "pekerjaan[0].volume",
                        nilai: 30,
                    }),
                }),
                { params: Promise.resolve({ id: idProd }) }
            );
            const dataProd = await resProd.json();
            expect("_spark_path" in dataProd.document).toBe(false);
            expect(JSON.stringify(dataProd)).not.toContain("_spark_path");
        } finally {
            if (originalNodeEnv === undefined) {
                delete (process.env as Record<string, string | undefined>)
                    .NODE_ENV;
            } else {
                (process.env as Record<string, string | undefined>).NODE_ENV =
                    originalNodeEnv;
            }
        }
    });
    it("rejects unauthenticated PATCH with 401 and does not mutate DB", async () => {
        mockGetSession.mockResolvedValue(null);
        mockIsAdmin.mockReturnValue(false);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 99 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized", message: "Authentication required" });

        const row = await pool.query<{ data_json: QuotationDocument }>("select data_json from documents where id = $1", [id]);
        expect(row.rows[0].data_json.pekerjaan[0].volume).toBe(10);
    });

    it("rejects non-owner PATCH with 403 and does not mutate DB", async () => {
        withUser("user", otherUserId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 99 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden", message: "You do not have access to this document" });

        const row = await pool.query<{ data_json: QuotationDocument }>("select data_json from documents where id = $1", [id]);
        expect(row.rows[0].data_json.pekerjaan[0].volume).toBe(10);
    });

    it("rejects non-owner for non-existent document on PATCH with 403 (no existence leak)", async () => {
        withUser("user", otherUserId);
        const missingId = "00000000-0000-0000-0000-000000000099";
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${missingId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 10 }),
            }),
            { params: Promise.resolve({ id: missingId }) }
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden", message: "You do not have access to this document" });
    });

    it("allows owner to PATCH with 200 and mutates DB", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 50 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan[0].volume).toBe(50);

        const row = await pool.query<{ data_json: QuotationDocument }>("select data_json from documents where id = $1", [id]);
        expect(row.rows[0].data_json.pekerjaan[0].volume).toBe(50);
    });

    it("allows admin to PATCH owned document with 200 and mutates DB", async () => {
        withUser("admin", adminId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 77 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const row = await pool.query<{ data_json: QuotationDocument }>("select data_json from documents where id = $1", [id]);
        expect(row.rows[0].data_json.pekerjaan[0].volume).toBe(77);
    });

    it("allows admin to PATCH legacy ownerless document with 200", async () => {
        withUser("admin", adminId);
        const id = await seedDocument(createTestDocument(), { userId: null });
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 88 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
    });

    it("rejects non-admin for legacy ownerless document on PATCH with 403", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: null });
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 88 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden", message: "You do not have access to this document" });
    });
});

describe.skipIf(!TEST_DATABASE_URL).sequential("GET /api/documents/[id] route handler", () => {
    let pool: Pool;
    let seededIds: string[] = [];

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
            "0004_email_sends.sql",
            "0007_auth_tables.sql",
            "0008_documents_user_id.sql",
        ]) {
            const sql = await import("node:fs/promises").then((fs) =>
                fs.readFile(`db/migrations/${file}`, "utf8")
            );
            await pool.query(sql);
        }
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values
               ('00000000-0000-0000-0000-000000000000', 'admin@suara-lapangan.local', true, 'Admin', 'admin'),
               ('00000000-0000-0000-0000-000000000001', 'owner@suara-lapangan.local', true, 'Owner', 'user'),
               ('00000000-0000-0000-0000-000000000002', 'other@suara-lapangan.local', true, 'Other', 'user')
             on conflict (id) do nothing`
        );
    });
    beforeEach(async () => {
        resetRateLimits();
        await pool.query("truncate documents, sessions cascade");
        seededIds = [];
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
        );
        await seedDocument(createTestDocument());
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seedDocument(
        document: QuotationDocument,
        options?: { userId?: string | null }
    ): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id)
             values ('seed-session', $1, $2, $3, $4, $5, $6) returning id`,
            [
                document.locale,
                document.nomor + "#" + seededIds.length,
                document.butuh_konfirmasi.length > 0
                    ? "perlu_konfirmasi"
                    : "siap",
                "hash-" + seededIds.length,
                JSON.stringify(document),
                options?.userId ?? null,
            ]
        );
        const id = result.rows[0].id;
        seededIds.push(id);
        return id;
    }

    it("answers the same envelope as PATCH's 200", async () => {
        const doc = createTestDocument({
            butuh_konfirmasi: [
                {
                    field: "pekerjaan[0].volume",
                    alasan: "a",
                    sumber_kutipan: "turn_1",
                },
            ],
        });
        const id = await seedDocument(doc);

        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.id).toBe(id);
        expect(data.document.nomor).toBe(doc.nomor);
        expect(data.document.total_nominal).toBe(700000);
        expect(data.butuh_konfirmasi).toHaveLength(1);
        expect(data.status).toBe("draf");
    });

    it("returns 404 for an unknown id", async () => {
        const res = await GET(
            new Request(
                "http://localhost/api/documents/00000000-0000-0000-0000-000000000000"
            ),
            {
                params: Promise.resolve({
                    id: "00000000-0000-0000-0000-000000000000",
                }),
            }
        );
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe("not_found");
    });

    it("returns 400 for a malformed id", async () => {
        const res = await GET(
            new Request("http://localhost/api/documents/../etc/passwd"),
            {
                params: Promise.resolve({
                    id: "../etc/passwd",
                }),
            }
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("returns 400 for a non-UUID id", async () => {
        const res = await GET(
            new Request("http://localhost/api/documents/not-a-uuid"),
            {
                params: Promise.resolve({
                    id: "not-a-uuid",
                }),
            }
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rate limits PATCH to 30 per minute; the 31st is 429", async () => {
        const id = seededIds[0];
        let lastRes: Response | null = null;
        for (let i = 0; i < 31; i++) {
            lastRes = await PATCH(
                new Request(`http://localhost/api/documents/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        field: "pekerjaan[0].volume",
                        nilai: 1,
                    }),
                }),
                { params: Promise.resolve({ id }) }
            );
        }
        expect(lastRes).not.toBeNull();
        expect(lastRes!.status).toBe(429);
        const body = await lastRes!.json();
        expect(body.error).toBe("rate_limited");
        expect(lastRes!.headers.get("Retry-After")).toBeTruthy();
    });

    it("rate limits GET to 30 per minute; the 31st is 429", async () => {
        const id = seededIds[0];
        let lastRes: Response | null = null;
        for (let i = 0; i < 31; i++) {
            lastRes = await GET(
                new Request(`http://localhost/api/documents/${id}`),
                { params: Promise.resolve({ id }) }
            );
        }
        expect(lastRes).not.toBeNull();
        expect(lastRes!.status).toBe(429);
        const body = await lastRes!.json();
        expect(body.error).toBe("rate_limited");
        expect(lastRes!.headers.get("Retry-After")).toBeTruthy();
    });

    it("rejects unauthenticated GET with 401", async () => {
        mockGetSession.mockResolvedValue(null);
        mockIsAdmin.mockReturnValue(false);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized", message: "Authentication required" });
    });

    it("rejects non-owner GET with 403", async () => {
        withUser("user", otherUserId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden", message: "You do not have access to this document" });
    });

    it("rejects non-owner for non-existent document on GET with 403 (no existence leak)", async () => {
        withUser("user", otherUserId);
        const missingId = "00000000-0000-0000-0000-000000000099";
        const res = await GET(new Request(`http://localhost/api/documents/${missingId}`), {
            params: Promise.resolve({ id: missingId }),
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden", message: "You do not have access to this document" });
    });

    it("serves owner with 200 on GET", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.id).toBe(id);
    });

    it("serves admin for owned document on GET with 200", async () => {
        withUser("admin", adminId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });
        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
    });

    it("serves admin for legacy ownerless document on GET with 200", async () => {
        withUser("admin", adminId);
        const id = await seedDocument(createTestDocument(), { userId: null });
        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
    });

    it("rejects non-admin for legacy ownerless document on GET with 403", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: null });
        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden", message: "You do not have access to this document" });
    });
});
