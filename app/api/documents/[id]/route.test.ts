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
import type { CandidateDocument, QuotationDocument } from "@/lib/server/guard/types";
import { applyGuard } from "@/lib/server/guard/rules";

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
            "0009_review_before_pdf.sql",
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
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seedDocument(
        document: QuotationDocument,
        options?: { userId?: string | null; status?: string }
    ): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id)
             values ('seed-session', $1, $2, $3, $4, $5, $6) returning id`,
            [
                document.locale,
                document.nomor ? document.nomor + "#" + seededIds.length : null,
                options?.status ?? "draf",
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
        expect(data.status).toBe("draf");

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
        expect(data.status).toBe("draf");
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

    it("removes matching entry from butuh_konfirmasi while status remains draf until approval", async () => {
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
        // pekerjaan[0].volume removed, but pekerjaan[0].harga_satuan remains -> status remains "draf"
        expect(data1.status).toBe("draf");
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
        // Both defects cleared -> status remains "draf" until approval
        expect(data2.status).toBe("draf");
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

    it("rejects non-owner for non-existent document on PATCH with 404 (consistent with approve)", async () => {
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
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found", message: `Document '${missingId}' not found` });
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

    it("patches proyek.nama, proyek.lokasi, and proyek.klien without modifying line items or recalculating totals", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(
            createTestDocument({
                total_nominal: 700000,
                terbilang: "Tujuh ratus ribu rupiah",
            }),
            { userId: ownerId }
        );

        const res1 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "proyek.nama", nilai: "Renovasi Gudang Modern" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        expect(data1.document.proyek.nama).toBe("Renovasi Gudang Modern");
        expect(data1.document.total_nominal).toBe(700000);
        expect(data1.document.terbilang).toBe("Tujuh ratus ribu rupiah");

        const res2 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "proyek.lokasi", nilai: "Jl. Kaliurang km 10" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.document.proyek.lokasi).toBe("Jl. Kaliurang km 10");

        const res3 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "proyek.klien", nilai: "Ibu Hartono" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res3.status).toBe(200);
        const data3 = await res3.json();
        expect(data3.document.proyek.klien).toBe("Ibu Hartono");
    });

    it("patches tanggal with valid ISO YYYY-MM-DD date and rejects invalid dates", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "tanggal", nilai: "2026-11-20" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.tanggal).toBe("2026-11-20");

        // Invalid date string
        const badRes1 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "tanggal", nilai: "not-a-date" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(badRes1.status).toBe(400);

        // Invalid calendar date
        const badRes2 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "tanggal", nilai: "2026-02-31" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(badRes2.status).toBe(400);
    });

    it("rejects PATCH on mata_uang with 400 invalid_request (derived from locale)", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "mata_uang", nilai: "USD" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("supports structural op add_line with sumber_kutipan: 'manual' and recomputes totals and terbilang", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(
            createTestDocument({
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
            }),
            { userId: ownerId }
        );

        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    op: "add_line",
                    item: {
                        uraian: "Transportasi material",
                        volume: 1,
                        satuan: "unit",
                        harga_satuan: 150000,
                    },
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan).toHaveLength(2);
        expect(data.document.pekerjaan[1]).toEqual({
            uraian: "Transportasi material",
            volume: 1,
            satuan: "unit",
            harga_satuan: 150000,
            jumlah: 150000,
            sumber_kutipan: "manual",
        });
        expect(data.document.total_nominal).toBe(650000);
        expect(data.document.terbilang).toBe("Enam ratus lima puluh ribu rupiah");
    });

    it("supports structural op remove_line and recomputes totals", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    op: "remove_line",
                    index: 1,
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan).toHaveLength(1);
        expect(data.document.pekerjaan[0].uraian).toBe("Pemasangan hebel");
        expect(data.document.total_nominal).toBe(500000);
        expect(data.document.terbilang).toBe("Lima ratus ribu rupiah");

        // Out of bounds index
        const oobRes = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    op: "remove_line",
                    index: 99,
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(oobRes.status).toBe(400);
    });

    it("supports structural op move_line to reorder lines", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    op: "move_line",
                    fromIndex: 0,
                    toIndex: 1,
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan[0].uraian).toBe("Plester aci");
        expect(data.document.pekerjaan[1].uraian).toBe("Pemasangan hebel");

        // Out of bounds
        const oobRes = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    op: "move_line",
                    fromIndex: 0,
                    toIndex: 10,
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(oobRes.status).toBe(400);
    });

    it("remove_line shifts indices for butuh_konfirmasi and field_changes", async () => {
        withUser("user", ownerId);
        // 3 items (indices 0, 1, 2)
        const id = await seedDocument(
            createTestDocument({
                pekerjaan: [
                    { uraian: "Item 0", volume: 1, satuan: "unit", harga_satuan: 100, jumlah: 100, sumber_kutipan: "turn_1" },
                    { uraian: "Item 1", volume: 2, satuan: "unit", harga_satuan: 200, jumlah: 400, sumber_kutipan: "turn_2" },
                    { uraian: "Item 2", volume: 3, satuan: "unit", harga_satuan: 300, jumlah: 900, sumber_kutipan: "turn_3" },
                ],
                butuh_konfirmasi: [
                    { field: "pekerjaan[1].volume", alasan: "Check item 1", sumber_kutipan: "turn_2" },
                    { field: "pekerjaan[2].harga_satuan", alasan: "Check item 2", sumber_kutipan: "turn_3" },
                ],
            }),
            { userId: ownerId }
        );

        // Edit item 2 first to create a field_change
        await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[2].volume", nilai: 5 }),
            }),
            { params: Promise.resolve({ id }) }
        );

        // Remove item 0
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ op: "remove_line", index: 0 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan).toHaveLength(2);
        // What was item 1 is now item 0
        expect(data.document.pekerjaan[0].uraian).toBe("Item 1");
        expect(data.document.pekerjaan[1].uraian).toBe("Item 2");
        // butuh_konfirmasi fields shifted from [1]->[0] and [2]->[1]
        expect(data.butuh_konfirmasi).toHaveLength(2);
        expect(data.butuh_konfirmasi[0].field).toBe("pekerjaan[0].volume");
        expect(data.butuh_konfirmasi[1].field).toBe("pekerjaan[1].harga_satuan");
        // field_changes shifted from [2]->[1]
        expect(data.field_changes).toHaveLength(1);
        expect(data.field_changes[0].field).toBe("pekerjaan[1].volume");
    });

    it("move_line remaps indices for butuh_konfirmasi and field_changes", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(
            createTestDocument({
                pekerjaan: [
                    { uraian: "Item 0", volume: 1, satuan: "unit", harga_satuan: 100, jumlah: 100, sumber_kutipan: "turn_1" },
                    { uraian: "Item 1", volume: 2, satuan: "unit", harga_satuan: 200, jumlah: 400, sumber_kutipan: "turn_2" },
                ],
                butuh_konfirmasi: [
                    { field: "pekerjaan[0].uraian", alasan: "Check item 0", sumber_kutipan: "turn_1" },
                ],
            }),
            { userId: ownerId }
        );

        // Edit item 0 to record field_change
        await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 10 }),
            }),
            { params: Promise.resolve({ id }) }
        );

        // Move item 0 to position 1
        const res = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ op: "move_line", fromIndex: 0, toIndex: 1 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.document.pekerjaan[1].uraian).toBe("Item 0");
        // butuh_konfirmasi remapped to pekerjaan[1].volume
        expect(data.butuh_konfirmasi[0].field).toBe("pekerjaan[1].uraian");
        // field_changes remapped to pekerjaan[1].volume
        expect(data.field_changes[0].field).toBe("pekerjaan[1].volume");
    });

    it("tracks provenance in field_changes when modifying transcript-derived fields and preserves original on re-edit", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        // Edit volume of line 0 (sumber_kutipan: "turn_1") from 10 to 15
        const res1 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 15 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        expect(data1.field_changes).toHaveLength(1);
        expect(data1.field_changes[0]).toEqual({
            field: "pekerjaan[0].volume",
            original: 10,
            current: 15,
            changed_by: ownerId,
            changed_at: expect.any(String),
        });

        // Re-edit volume of line 0 from 15 to 20: original remains 10!
        const res2 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 20 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.field_changes).toHaveLength(1);
        expect(data2.field_changes[0]).toEqual({
            field: "pekerjaan[0].volume",
            original: 10,
            current: 20,
            changed_by: ownerId,
            changed_at: expect.any(String),
        });

        // Add a manual line, then edit it: manual lines are not tracked in field_changes
        await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    op: "add_line",
                    item: { uraian: "Cat", volume: 2, satuan: "sak", harga_satuan: 10000 },
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        const res3 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[2].volume", nilai: 4 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res3.status).toBe(200);
        const data3 = await res3.json();
        // field_changes still has only 1 entry (line 0)
        expect(data3.field_changes).toHaveLength(1);
        expect(data3.field_changes[0].field).toBe("pekerjaan[0].volume");
    });

    it("clears butuh_konfirmasi when editing any matching field (header or line item)", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(
            createTestDocument({
                butuh_konfirmasi: [
                    {
                        field: "proyek.lokasi",
                        alasan: "Lokasi tidak disebutkan",
                        sumber_kutipan: null,
                    },
                    {
                        field: "pekerjaan[0].volume",
                        alasan: "Volume tidak yakin",
                        sumber_kutipan: "turn_1",
                    },
                ],
            }),
            { userId: ownerId }
        );

        // Edit proyek.lokasi -> clears proyek.lokasi from butuh_konfirmasi
        const res1 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "proyek.lokasi", nilai: "Bantul" }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        expect(data1.butuh_konfirmasi).toHaveLength(1);
        expect(data1.butuh_konfirmasi[0].field).toBe("pekerjaan[0].volume");

        // Edit pekerjaan[0].volume -> clears remaining item
        const res2 = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 10 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.butuh_konfirmasi).toHaveLength(0);
    });

    it("rejects PATCH on locked documents (status disetujui or terkirim) with 409 locked", async () => {
        withUser("user", ownerId);
        const idApproved = await seedDocument(createTestDocument(), {
            userId: ownerId,
            status: "disetujui",
        });

        const resApproved = await PATCH(
            new Request(`http://localhost/api/documents/${idApproved}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 99 }),
            }),
            { params: Promise.resolve({ id: idApproved }) }
        );
        expect(resApproved.status).toBe(409);
        const dataApproved = await resApproved.json();
        expect(dataApproved.error).toBe("locked");

        const idSent = await seedDocument(createTestDocument(), {
            userId: ownerId,
            status: "terkirim",
        });

        const resSent = await PATCH(
            new Request(`http://localhost/api/documents/${idSent}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 99 }),
            }),
            { params: Promise.resolve({ id: idSent }) }
        );
        expect(resSent.status).toBe(409);
        const dataSent = await resSent.json();
        expect(dataSent.error).toBe("locked");
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
            "0009_review_before_pdf.sql",
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

    it("rejects non-owner for non-existent document on GET with 404 (consistent with approve)", async () => {
        withUser("user", otherUserId);
        const missingId = "00000000-0000-0000-0000-000000000099";
        const res = await GET(new Request(`http://localhost/api/documents/${missingId}`), {
            params: Promise.resolve({ id: missingId }),
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found", message: `Document '${missingId}' not found` });
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

    it("returns field_changes in response envelope alongside document, butuh_konfirmasi, and status", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("document");
        expect(data).toHaveProperty("butuh_konfirmasi");
        expect(data).toHaveProperty("status");
        expect(data).toHaveProperty("field_changes");
        expect(Array.isArray(data.field_changes)).toBe(true);
    });
});

describe("Guard rules manual lines", () => {
    it("evaluates turn transcript only for ^turn_ citations; manual lines pass without error", () => {
        const candidate: CandidateDocument = {
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            tanggal: "2026-11-02",
            proyek: {
                nama: "Proyek Test",
                lokasi: "Sleman",
                klien: "Pak Budi",
            },
            pekerjaan: [
                {
                    uraian: "Pemasangan paving manual",
                    volume: 50,
                    satuan: "m2",
                    harga_satuan: 80000,
                    jumlah: 4000000,
                    sumber_kutipan: "manual",
                },
            ],
            total_nominal: 4000000,
            terbilang: "Empat juta rupiah",
            butuh_konfirmasi: [],
        };
        // turns list is empty - if manual line checked turns, it would fail
        const result = applyGuard(candidate, []);
        expect(result.document.pekerjaan[0].sumber_kutipan).toBe("manual");
        expect(result.document.pekerjaan[0].jumlah).toBe(4000000);
        expect(result.butuh_konfirmasi).toHaveLength(0);
    });
});
