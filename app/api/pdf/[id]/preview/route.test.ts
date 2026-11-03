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
import fs from "node:fs/promises";
import { GET } from "./route";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import type { QuotationDocument } from "@/lib/server/guard/types";
import idMessages from "@/i18n/locales/id.json";
import enMessages from "@/i18n/locales/en.json";

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

describe("renderQuotationHtml unit (no DB)", () => {
    it("returns a complete HTML document with A4 print rules and embedded fonts", () => {
        const html = renderQuotationHtml(doc());
        expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
        expect(html).toContain("@page{size:A4;margin:12mm}");
        expect(html).toContain("-webkit-print-color-adjust:exact");
        expect(html).toContain("table{page-break-inside:auto}");
        expect(html).toContain("tr{page-break-inside:avoid}");
        expect(html).toContain("@font-face");
        expect(html).toContain("IBM Plex Sans");
        expect(html).toContain("data:font/woff2;base64,");
    });

    it("renders the locale draft marker for drafts, never a hardcoded literal", () => {
        const idMarker = (idMessages as { dokumen: { draftMarker: string } })
            .dokumen.draftMarker;
        expect(idMarker).toBe("DRAF — nomor belum ditetapkan");
        expect(
            renderQuotationHtml(doc({ nomor: null, locale: "id" }))
        ).toContain(idMarker);

        const enMarker = (enMessages as { dokumen: { draftMarker: string } })
            .dokumen.draftMarker;
        const enHtml = renderQuotationHtml(doc({ nomor: null, locale: "en" }));
        expect(enHtml).toContain(enMarker);
        expect(enHtml).not.toContain(idMarker);
    });
});

describe
    .skipIf(!TEST_DATABASE_URL)
    .sequential("GET /api/pdf/[id]/preview", () => {
        let pool: Pool;

        beforeAll(async () => {
            process.env.DATABASE_URL = TEST_DATABASE_URL;
            pool = new Pool({ connectionString: TEST_DATABASE_URL });
            for (const file of [
                "0001_sessions_turns.sql",
                "0002_usage_meter.sql",
                "0003_documents.sql",
                "0004_email_sends.sql",
                "0007_auth_tables.sql",
                "0009_review_before_pdf.sql",
                "0008_documents_user_id.sql",
            ]) {
                const sql = await fs.readFile(`db/migrations/${file}`, "utf8");
                await pool.query(sql);
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
            await pool.query(
                "truncate documents, sessions, usage_meter cascade"
            );
            await pool.query(
                "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
            );
        });

        afterAll(async () => {
            await pool.end();
        });

        async function seed(
            document: QuotationDocument,
            status = "draf"
        ): Promise<string> {
            const result = await pool.query<{ id: string }>(
                `insert into documents (session_id, locale, nomor, status, turns_hash, data_json)
             values ('seed-session', $1, $2, $3, $4, $5) returning id`,
                [
                    document.locale,
                    document.nomor,
                    status,
                    "preview-hash-" + Math.random(),
                    JSON.stringify(document),
                ]
            );
            return result.rows[0].id;
        }

        it("200 text/html for a draft, with the locale draft marker", async () => {
            const id = await seed(doc({ nomor: null }), "draf");
            const res = await GET(
                new Request(`http://localhost/api/pdf/${id}/preview`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            expect(res.status).toBe(200);
            expect(res.headers.get("content-type")).toBe(
                "text/html; charset=utf-8"
            );
            const body = await res.text();
            expect(body).toContain(
                (idMessages as { dokumen: { draftMarker: string } }).dokumen
                    .draftMarker
            );
            expect(body).toBe(renderQuotationHtml(doc({ nomor: null })));
        });

        it("200 text/html for an approved document with its sequence number", async () => {
            const id = await seed(
                doc({ nomor: "SL/QTN/2026/0042" }),
                "disetujui"
            );
            const res = await GET(
                new Request(`http://localhost/api/pdf/${id}/preview`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            expect(res.status).toBe(200);
            expect(res.headers.get("content-type")).toBe(
                "text/html; charset=utf-8"
            );
            expect(await res.text()).toContain("SL/QTN/2026/0042");
        });

        it("401 for unauthenticated callers", async () => {
            mockGetSession.mockResolvedValueOnce(null);
            const id = await seed(doc({ nomor: null }), "draf");
            const res = await GET(
                new Request(`http://localhost/api/pdf/${id}/preview`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            expect(res.status).toBe(401);
        });

        it("403 for a non-owner non-admin", async () => {
            mockGetSession.mockResolvedValueOnce({
                user: {
                    id: "00000000-0000-0000-0000-000000000002",
                    email: "test2@suara-lapangan.local",
                    name: "Test User 2",
                    role: "user",
                },
            });
            mockIsAdmin.mockReturnValueOnce(false);
            const id = await seed(doc({ nomor: null }), "draf");
            const res = await GET(
                new Request(`http://localhost/api/pdf/${id}/preview`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            expect(res.status).toBe(403);
        });

        it("404 for unknown id", async () => {
            const res = await GET(
                new Request(
                    "http://localhost/api/pdf/00000000-0000-0000-0000-000000000000/preview"
                ),
                {
                    params: Promise.resolve({
                        id: "00000000-0000-0000-0000-000000000000",
                    }),
                }
            );
            expect(res.status).toBe(404);
        });
    });
