import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

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

const ownerId = "00000000-0000-0000-0000-000000000001";
const otherUserId = "00000000-0000-0000-0000-000000000002";

function withUser(role: "user" | "admin", userId: string): void {
    mockGetSession.mockResolvedValue({
        user: { id: userId, email: `${role}@example.com`, name: role, role },
    });
    mockIsAdmin.mockReturnValue(role === "admin");
}

import { POST } from "./route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import type { QuotationDocument } from "@/lib/server/guard/types";

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

if (TEST_DATABASE_URL !== undefined) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
}

function createTestDocument(
    overrides?: Partial<QuotationDocument>
): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: null,
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
        ],
        total_nominal: 500000,
        terbilang: "Lima ratus ribu rupiah",
        butuh_konfirmasi: [],
        ...overrides,
    };
}

describe.skipIf(!TEST_DATABASE_URL).sequential("POST /api/documents/[id]/approve route handler", () => {
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
            const sql = await fs.readFile(`db/migrations/${file}`, "utf8");
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
        await pool.query("truncate documents, sessions, document_sequences cascade");
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
        options?: { userId?: string | null; status?: string; createdAt?: string }
    ): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id, created_at)
             values ('seed-session', $1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now())) returning id`,
            [
                document.locale,
                document.nomor,
                options?.status ?? "draf",
                "hash-" + seededIds.length,
                JSON.stringify(document),
                options?.userId ?? null,
                options?.createdAt ?? null,
            ]
        );
        const id = result.rows[0].id;
        seededIds.push(id);
        return id;
    }

    it("rejects unauthenticated caller with 401", async () => {
        mockGetSession.mockResolvedValue(null);
        mockIsAdmin.mockReturnValue(false);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
            error: "unauthorized",
            message: "Authentication required",
        });
    });

    it("rejects non-owner non-admin caller with 403", async () => {
        withUser("user", otherUserId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
            error: "forbidden",
            message: "You do not have access to this document",
        });
    });

    it("returns 404 for non-existent document", async () => {
        withUser("user", ownerId);
        const id = "00000000-0000-0000-0000-000000000099";
        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: "not_found" });
    });

    it("returns 409 needs_confirmation when butuh_konfirmasi is not empty", async () => {
        withUser("user", ownerId);
        const docWithConfirmation = createTestDocument({
            butuh_konfirmasi: [
                { field: "pekerjaan[0].volume", alasan: "unclear", sumber_kutipan: null },
            ],
        });
        const id = await seedDocument(docWithConfirmation, { userId: ownerId });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: "needs_confirmation" });
    });

    it("returns 409 invalid_state when document status is not draf (e.g. terkirim)", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), {
            userId: ownerId,
            status: "terkirim",
        });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: "invalid_state" });
    });

    it("successfully approves draft, assigns sequence number for approval year, commits, generates PDF and updates documents.pdf_path", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        const currentYear = new Date().getUTCFullYear();
        const expectedNomor = `SL/QTN/${currentYear}/0001`;

        expect(data.status).toBe("disetujui");
        expect(data.document.nomor).toBe(expectedNomor);

        // Check DB row
        const row = await pool.query<{
            status: string;
            nomor: string;
            approved_by: string;
            approved_at: Date;
            pdf_path: string | null;
            data_json: QuotationDocument;
        }>(
            "select status, nomor, approved_by, approved_at, pdf_path, data_json from documents where id = $1::uuid",
            [id]
        );
        expect(row.rows[0].status).toBe("disetujui");
        expect(row.rows[0].nomor).toBe(expectedNomor);
        expect(row.rows[0].data_json.nomor).toBe(expectedNomor);
        expect(row.rows[0].approved_by).toBe(ownerId);
        expect(row.rows[0].approved_at).not.toBeNull();

        // Check PDF file on disk
        expect(row.rows[0].pdf_path).toBeTruthy();
        const storageDir = process.env.PDF_STORAGE_DIR ?? path.resolve(process.cwd(), "./data/pdf");
        const fullPdfPath = path.join(storageDir, row.rows[0].pdf_path!);
        expect(existsSync(fullPdfPath)).toBe(true);
        const fileBytes = await fs.readFile(fullPdfPath);
        expect(fileBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    });

    it("approval year rollover: draft created in Dec 2026 and approved in Jan 2027 receives sequence number for 2027", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), {
            userId: ownerId,
            createdAt: "2026-12-25T10:00:00Z",
        });

        // Advance system time to 2027
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2027-01-10T14:00:00Z"));
        try {
            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.document.nomor).toBe("SL/QTN/2027/0001");
        } finally {
            vi.useRealTimers();
        }
    });

    it("approving an already approved document is idempotent: returns 200 without incrementing sequence", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const res1 = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        const allocatedNomor = data1.document.nomor;

        // Second approve call
        const res2 = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.document.nomor).toBe(allocatedNomor);

        // Sequence counter must still be 1
        const year = new Date().getUTCFullYear();
        const seqRow = await pool.query<{ last_number: number }>(
            "select last_number from document_sequences where year = $1",
            [year]
        );
        expect(seqRow.rows[0].last_number).toBe(1);
    });

    it("concurrent approvals on the same draft serialize and allocate exactly one sequence number", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        const [r1, r2, r3] = await Promise.all([
            POST(new Request(`http://localhost/api/documents/${id}/approve`, { method: "POST" }), {
                params: Promise.resolve({ id }),
            }),
            POST(new Request(`http://localhost/api/documents/${id}/approve`, { method: "POST" }), {
                params: Promise.resolve({ id }),
            }),
            POST(new Request(`http://localhost/api/documents/${id}/approve`, { method: "POST" }), {
                params: Promise.resolve({ id }),
            }),
        ]);

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(200);

        const d1 = await r1.json();
        const d2 = await r2.json();
        const d3 = await r3.json();

        expect(d1.document.nomor).toBe(d2.document.nomor);
        expect(d2.document.nomor).toBe(d3.document.nomor);

        const year = new Date().getUTCFullYear();
        const seqRow = await pool.query<{ last_number: number }>(
            "select last_number from document_sequences where year = $1",
            [year]
        );
        expect(seqRow.rows[0].last_number).toBe(1);
    });

    it("if approval transaction fails, no corrupted or partially updated document row is committed", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument(), { userId: ownerId });

        // Seed sequence at 9999 so allocateDocumentNumber throws exhausted error
        const year = new Date().getUTCFullYear();
        await pool.query(
            "insert into document_sequences (year, last_number) values ($1, 9999) on conflict (year) do update set last_number = 9999",
            [year]
        );

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/approve`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(500);

        // Verify document row in DB is completely uncorrupted (remains draf, nomor=null, approved_at=null)
        const row = await pool.query<{
            status: string;
            nomor: string | null;
            approved_at: Date | null;
            approved_by: string | null;
        }>("select status, nomor, approved_at, approved_by from documents where id = $1::uuid", [id]);
        expect(row.rows[0].status).toBe("draf");
        expect(row.rows[0].nomor).toBeNull();
        expect(row.rows[0].approved_at).toBeNull();
        expect(row.rows[0].approved_by).toBeNull();
    });
});
