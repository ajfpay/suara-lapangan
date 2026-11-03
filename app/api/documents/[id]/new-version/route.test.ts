import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";

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
import { GET as getDocument, PATCH as patchDocument } from "@/app/api/documents/[id]/route";
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
        ],
        total_nominal: 500000,
        terbilang: "Lima ratus ribu rupiah",
        butuh_konfirmasi: [],
        ...overrides,
    };
}

describe.skipIf(!TEST_DATABASE_URL).sequential("POST /api/documents/[id]/new-version route handler", () => {
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
        options?: {
            userId?: string | null;
            status?: string;
            nomor?: string | null;
            fieldChanges?: unknown;
        }
    ): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id, field_changes)
             values ('seed-session', $1, $2, $3, $4, $5, $6, $7) returning id`,
            [
                document.locale,
                options?.nomor !== undefined ? options.nomor : document.nomor,
                options?.status ?? "disetujui",
                "hash-" + seededIds.length,
                JSON.stringify(document),
                options?.userId ?? null,
                JSON.stringify(options?.fieldChanges ?? []),
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
            new Request(`http://localhost/api/documents/${id}/new-version`, {
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
            new Request(`http://localhost/api/documents/${id}/new-version`, {
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
            new Request(`http://localhost/api/documents/${id}/new-version`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: "not_found" });
    });

    it("rejects unapproved drafts (status: 'draf') with HTTP 409 invalid_state", async () => {
        withUser("user", ownerId);
        const id = await seedDocument(createTestDocument({ nomor: null }), {
            userId: ownerId,
            status: "draf",
            nomor: null,
        });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/new-version`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: "invalid_state" });
    });

    it("creates a new draft version (HTTP 201) and sets superseded_by on parent", async () => {
        withUser("user", ownerId);
        const fieldChanges = [
            {
                field: "pekerjaan[0].volume",
                original: 10,
                current: 15,
                changed_by: ownerId,
                changed_at: "2026-11-01T00:00:00Z",
            },
        ];
        const id = await seedDocument(createTestDocument(), {
            userId: ownerId,
            status: "disetujui",
            nomor: "SL/QTN/2026/0001",
            fieldChanges,
        });

        const res = await POST(
            new Request(`http://localhost/api/documents/${id}/new-version`, {
                method: "POST",
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(201);
        const data = await res.json();

        expect(data.document.id).not.toBe(id);
        expect(data.status).toBe("draf");
        expect(data.document.nomor).toBeNull();
        expect(data.version).toBe(2);
        expect(data.root_id).toBe(id);
        expect(data.parent_id).toBe(id);
        expect(data.superseded_by).toBeNull();
        expect(data.approved_at).toBeNull();
        expect(data.approved_by).toBeNull();
        expect(data.field_changes).toEqual(fieldChanges);

        // Verify parent in DB
        const parentRow = await pool.query<{
            status: string;
            nomor: string;
            superseded_by: string;
            version: number;
        }>(
            "select status, nomor, superseded_by, version from documents where id = $1::uuid",
            [id]
        );
        expect(parentRow.rows[0].status).toBe("disetujui");
        expect(parentRow.rows[0].nomor).toBe("SL/QTN/2026/0001");
        expect(parentRow.rows[0].version).toBe(1);
        expect(parentRow.rows[0].superseded_by).toBe(data.document.id);

        // Verify child in DB
        const childRow = await pool.query<{
            status: string;
            nomor: string | null;
            version: number;
            root_id: string;
            parent_id: string;
            approved_at: Date | null;
            approved_by: string | null;
            data_json: QuotationDocument;
        }>(
            "select status, nomor, version, root_id, parent_id, approved_at, approved_by, data_json from documents where id = $1::uuid",
            [data.document.id]
        );
        expect(childRow.rows[0].status).toBe("draf");
        expect(childRow.rows[0].nomor).toBeNull();
        expect(childRow.rows[0].version).toBe(2);
        expect(childRow.rows[0].root_id).toBe(id);
        expect(childRow.rows[0].parent_id).toBe(id);
        expect(childRow.rows[0].approved_at).toBeNull();
        expect(childRow.rows[0].approved_by).toBeNull();
        expect(childRow.rows[0].data_json.nomor).toBeNull();

        // Parent remains readable via GET /api/documents/{id}
        const getRes = await getDocument(
            new Request(`http://localhost/api/documents/${id}`),
            { params: Promise.resolve({ id }) }
        );
        expect(getRes.status).toBe(200);
        const getBody = await getRes.json();
        expect(getBody.document.nomor).toBe("SL/QTN/2026/0001");
        expect(getBody.status).toBe("disetujui");

        // Parent remains immutable via PATCH /api/documents/{id} (returns 409 locked)
        const patchRes = await patchDocument(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field: "pekerjaan[0].volume", nilai: 99 }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(patchRes.status).toBe(409);
        expect(await patchRes.json()).toMatchObject({ error: "locked" });
    });
});
