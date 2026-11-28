import { Pool } from "pg";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import path from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { migrateLegacyPdf } from "@/scripts/migrate-legacy-pdf.mjs";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const { mockGetSession, mockIsAdmin } = vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsAdmin: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: mockIsAdmin,
    canAccessDocument: (
        session: { user: { id: string; role?: string } },
        ownerUserId: string | null
    ) => {
        if (ownerUserId === null) return mockIsAdmin(session);
        return session.user.id === ownerUserId || mockIsAdmin(session);
    },
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
import { PATCH } from "../route";
import { GET as downloadPdf } from "@/app/api/pdf/[id]/route";
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

describe
    .skipIf(!TEST_DATABASE_URL)
    .sequential("POST /api/documents/[id]/approve route handler", () => {
        let pool: Pool;
        let seededIds: string[] = [];

        beforeAll(async () => {
            pool = new Pool({ connectionString: TEST_DATABASE_URL });
            for (const file of (
                await import("node:fs/promises").then((fs) =>
                    fs.readdir("db/migrations")
                )
            )
                .filter((name) => name.endsWith(".sql"))
                .sort()) {
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
            await pool.query(
                "truncate documents, sessions, document_sequences cascade"
            );
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
                createdAt?: string;
            }
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

        it("migrates only independently verified legacy bytes and preserves the original", async () => {
            const id = await seedDocument(
                createTestDocument({ nomor: "LEGACY-23" }),
                { status: "disetujui", userId: ownerId }
            );
            const root = await fs.mkdtemp(path.join(tmpdir(), "legacy-pdf-"));
            try {
                const legacy_path = `${id}.pdf`;
                const bytes = Buffer.from("%PDF-1.4\nlegacy fixture\n%%EOF\n");
                await fs.writeFile(path.join(root, legacy_path), bytes);
                await pool.query(
                    "update documents set pdf_path=$2 where id=$1",
                    [id, legacy_path]
                );
                const {
                    rows: [row],
                } = await pool.query(
                    "select data_json from documents where id=$1",
                    [id]
                );
                const digest = (value: string | Buffer) =>
                    createHash("sha256").update(value).digest("hex");
                const manifest = {
                    id,
                    legacy_path,
                    sha256: digest(bytes),
                    document_sha256: digest(JSON.stringify(row.data_json)),
                };
                await expect(
                    migrateLegacyPdf(
                        pool,
                        root,
                        { ...manifest, sha256: "0".repeat(64) },
                        true
                    )
                ).rejects.toThrow("digest mismatch");
                expect(await migrateLegacyPdf(pool, root, manifest)).toBe(
                    "verified"
                );
                expect(
                    (
                        await pool.query(
                            "select pdf_path from documents where id=$1",
                            [id]
                        )
                    ).rows[0].pdf_path
                ).toBe(legacy_path);
                expect(await migrateLegacyPdf(pool, root, manifest, true)).toBe(
                    "migrated"
                );
                expect(await migrateLegacyPdf(pool, root, manifest, true)).toBe(
                    "already_migrated"
                );
                expect(
                    (
                        await pool.query(
                            "select pdf_path from documents where id=$1",
                            [id]
                        )
                    ).rows[0].pdf_path
                ).toBe(`snapshots/${manifest.sha256}.pdf`);
                expect(await fs.readFile(path.join(root, legacy_path))).toEqual(
                    bytes
                );
            } finally {
                await fs.rm(root, { recursive: true, force: true });
            }
        });

        it("requires the exact reviewed revision and idempotency key before approval", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });
            const ctx = { params: Promise.resolve({ id }) };
            const url = `http://localhost/api/documents/${id}/approve`;
            const missing = await POST(
                new Request(url, { method: "POST" }),
                ctx
            );
            expect(missing.status).toBe(400);
            const stale = await POST(
                new Request(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "stale",
                    },
                    body: JSON.stringify({ draft_revision: 2 }),
                }),
                ctx
            );
            expect(stale.status).toBe(409);
            expect(await stale.json()).toMatchObject({
                error: "stale_revision",
                draft_revision: 1,
            });
        });

        it("rejects empty items and missing prices even without confirmation flags", async () => {
            withUser("user", ownerId);
            const empty = await seedDocument(
                createTestDocument({ pekerjaan: [] }),
                { userId: ownerId }
            );
            const missingPrice = createTestDocument();
            missingPrice.pekerjaan[0].harga_satuan_minor = null;
            const missing = await seedDocument(missingPrice, {
                userId: ownerId,
            });
            for (const id of [empty, missing]) {
                const res = await POST(
                    new Request(
                        `http://localhost/api/documents/${id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Idempotency-Key": "reject-incomplete",
                            },
                            body: JSON.stringify({ draft_revision: 1 }),
                        }
                    ),
                    { params: Promise.resolve({ id }) }
                );
                expect(res.status).toBe(409);
                expect(await res.json()).toMatchObject({
                    error: "needs_confirmation",
                });
            }
        });

        it("rejects unauthenticated caller with 401", async () => {
            mockGetSession.mockResolvedValue(null);
            mockIsAdmin.mockReturnValue(false);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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
                    {
                        field: "pekerjaan[0].volume",
                        alasan: "unclear",
                        sumber_kutipan: null,
                    },
                ],
            });
            const id = await seedDocument(docWithConfirmation, {
                userId: ownerId,
            });

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(res.status).toBe(409);
            expect(await res.json()).toMatchObject({
                error: "needs_confirmation",
            });
        });

        it("returns 409 needs_confirmation for legacy perlu_konfirmasi status with empty array", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
                status: "perlu_konfirmasi",
            });

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(res.status).toBe(409);
            expect(await res.json()).toMatchObject({
                error: "needs_confirmation",
            });
        });

        it("after patching the citation, approve returns 200 (no more 409 needs_confirmation when the only pending item was the citation)", async () => {
            withUser("user", ownerId);
            const docWithCitation = createTestDocument({
                butuh_konfirmasi: [
                    {
                        field: "pekerjaan[0].sumber_kutipan",
                        alasan: "sumber_kutipan 'turn_99' bukan giliran dari sesi ini",
                        sumber_kutipan: "turn_99",
                    },
                ],
            });
            const id = await seedDocument(docWithCitation, {
                userId: ownerId,
            });

            // Pre-condition: approve returns 409 needs_confirmation
            const preApprove = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(preApprove.status).toBe(409);
            expect(await preApprove.json()).toMatchObject({
                error: "needs_confirmation",
            });

            // Patch citation to "manual"
            const patchRes = await PATCH(
                new Request(`http://localhost/api/documents/${id}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "ticket22-regression",
                    },
                    body: JSON.stringify({
                        draft_revision: 1,
                        field: "pekerjaan[0].sumber_kutipan",
                        nilai: "manual",
                    }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(patchRes.status).toBe(200);
            const patchData = await patchRes.json();
            expect(patchData.status).toBe("draf");
            expect(patchData.butuh_konfirmasi).toEqual([]);

            // Post-condition: approve succeeds with 200
            const approveRes = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 2 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(approveRes.status).toBe(200);
            const approveData = await approveRes.json();
            expect(approveData.status).toBe("disetujui");
            expect(approveData.document.nomor).toMatch(
                /^SL\/QTN\/\d{4}\/\d{4}$/
            );
        }, 30000);

        it("returns 409 invalid_state when document status is not draf (e.g. terkirim)", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
                status: "terkirim",
            });

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(res.status).toBe(409);
            expect(await res.json()).toMatchObject({ error: "invalid_state" });
        });

        it("successfully approves draft, assigns sequence number for approval year, commits, generates PDF and updates documents.pdf_path", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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
            const storageDir =
                process.env.PDF_STORAGE_DIR ??
                path.resolve(process.cwd(), "./data/pdf");
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
                    new Request(
                        `http://localhost/api/documents/${id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Idempotency-Key": "approval-test",
                            },
                            body: JSON.stringify({ draft_revision: 1 }),
                        }
                    ),
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
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            const res1 = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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

        it("PDF failure is recoverable: 500 with approved doc, re-approve regenerates PDF with no new sequence", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            // Simulate PDF failure via monkey-patched renderQuotationHtml throwing.
            const pdfMod = await import("@/lib/server/pdf/renderQuotation");
            const renderSpy = vi
                .spyOn(pdfMod, "renderQuotationHtml")
                .mockImplementationOnce(() => {
                    throw new Error("pdf render boom");
                });
            const res1 = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            renderSpy.mockRestore();
            expect(res1.status).toBe(500);
            const data1 = await res1.json();
            expect(data1.status).toBe("disetujui");
            expect(data1.document.nomor).toBeTruthy();
            const nomor = data1.document.nomor as string;
            expect(data1.pdf_path).toBeNull();
            const unreadable = await downloadPdf(
                new Request(`http://localhost/api/pdf/${id}`),
                { params: Promise.resolve({ id }) }
            );
            expect(unreadable.status).toBe(500);
            expect(unreadable.headers.get("cache-control")).toBe(
                "private, no-store"
            );

            const res2 = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
                }),
                { params: Promise.resolve({ id }) }
            );
            expect(res2.status).toBe(200);
            const data2 = await res2.json();
            expect(data2.document.nomor).toBe(nomor);
            expect(data2.pdf_path).toBeTruthy();

            const year = new Date().getUTCFullYear();
            const seqRow = await pool.query<{ last_number: number }>(
                "select last_number from document_sequences where year = $1",
                [year]
            );
            expect(seqRow.rows[0].last_number).toBe(1);
        });

        it("concurrent approvals on the same draft serialize and allocate exactly one sequence number", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            const [r1, r2, r3] = await Promise.all([
                POST(
                    new Request(
                        `http://localhost/api/documents/${id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Idempotency-Key": "approval-test",
                            },
                            body: JSON.stringify({ draft_revision: 1 }),
                        }
                    ),
                    {
                        params: Promise.resolve({ id }),
                    }
                ),
                POST(
                    new Request(
                        `http://localhost/api/documents/${id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Idempotency-Key": "approval-test",
                            },
                            body: JSON.stringify({ draft_revision: 1 }),
                        }
                    ),
                    {
                        params: Promise.resolve({ id }),
                    }
                ),
                POST(
                    new Request(
                        `http://localhost/api/documents/${id}/approve`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Idempotency-Key": "approval-test",
                            },
                            body: JSON.stringify({ draft_revision: 1 }),
                        }
                    ),
                    {
                        params: Promise.resolve({ id }),
                    }
                ),
            ]);

            expect(r1.status).toBe(200);
            expect(r2.status).toBe(200);
            expect(r3.status).toBe(200);

            const d1 = await r1.json();
            const d2 = await r2.json();
            const d3 = await r3.json();

            expect(d1.document.nomor).toBe(d2.document.nomor);
            expect(d2.document.nomor).toBe(d3.document.nomor);
            expect(d1.pdf_path).toBe(d2.pdf_path);
            expect(d2.pdf_path).toBe(d3.pdf_path);

            const year = new Date().getUTCFullYear();
            const seqRow = await pool.query<{ last_number: number }>(
                "select last_number from document_sequences where year = $1",
                [year]
            );
            expect(seqRow.rows[0].last_number).toBe(1);
        });

        it("if approval transaction fails, no corrupted or partially updated document row is committed", async () => {
            withUser("user", ownerId);
            const id = await seedDocument(createTestDocument(), {
                userId: ownerId,
            });

            // Seed sequence at 9999 so allocateDocumentNumber throws exhausted error
            const year = new Date().getUTCFullYear();
            await pool.query(
                "insert into document_sequences (year, last_number) values ($1, 9999) on conflict (year) do update set last_number = 9999",
                [year]
            );

            const res = await POST(
                new Request(`http://localhost/api/documents/${id}/approve`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": "approval-test",
                    },
                    body: JSON.stringify({ draft_revision: 1 }),
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
            }>(
                "select status, nomor, approved_at, approved_by from documents where id = $1::uuid",
                [id]
            );
            expect(row.rows[0].status).toBe("draf");
            expect(row.rows[0].nomor).toBeNull();
            expect(row.rows[0].approved_at).toBeNull();
            expect(row.rows[0].approved_by).toBeNull();
        });
    });
