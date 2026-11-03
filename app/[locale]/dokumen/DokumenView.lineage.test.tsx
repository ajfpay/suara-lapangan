// @vitest-environment jsdom
/**
 * Permanent regression test for ticket 05's version-selector UI against the
 * real API envelope (ticket 10). Proves the UI contract against the GET
 * /api/documents/[id] envelope, not props injection.
 *
 * Seeds a two-version lineage in the test database, calls the real GET
 * handler, captures its JSON envelope, then renders DokumenView with
 * global.fetch stubbed to return exactly that envelope.
 */
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
    default: ({
        href,
        children,
        ...rest
    }: {
        href?: string;
        children?: React.ReactNode;
        [key: string]: unknown;
    }) => (
        <a href={typeof href === "string" ? href : "#"} {...rest}>
            {children}
        </a>
    ),
}));

const { mockGetSession, mockIsAdmin } = vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsAdmin: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: mockIsAdmin,
}));

import { GET } from "@/app/api/documents/[id]/route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import { DokumenView } from "./DokumenView";

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL !== undefined) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const ownerId = "00000000-0000-0000-0000-000000000001";

type Sibling = {
    id: string;
    version: number;
    nomor: string | null;
    status: string;
    superseded_by: string | null;
};
type Envelope = {
    version: number;
    root_id: string;
    superseded_by: string | null;
    versions: Sibling[];
};

const MIGRATIONS = [
    "0001_sessions_turns.sql",
    "0002_usage_meter.sql",
    "0003_documents.sql",
    "0004_email_sends.sql",
    "0007_auth_tables.sql",
    "0008_documents_user_id.sql",
    "0009_review_before_pdf.sql",
];

describe
    .skipIf(!TEST_DATABASE_URL)
    .sequential("DokumenView renders lineage UI from real GET envelope", () => {
        let pool: Pool;

        beforeAll(async () => {
            pool = new Pool({ connectionString: TEST_DATABASE_URL });
            for (const file of MIGRATIONS) {
                const sql = await readFile(`db/migrations/${file}`, "utf8");
                await pool.query(sql);
            }
            await pool.query(
                `insert into auth_user (id, email, email_verified, name, role)
                 values
                   ('00000000-0000-0000-0000-000000000000', 'admin@suara-lapangan.local', true, 'Admin', 'admin'),
                   ('00000000-0000-0000-0000-000000000001', 'owner@suara-lapangan.local', true, 'Owner', 'user')
                 on conflict (id) do nothing`
            );
        });

        beforeEach(async () => {
            cleanup();
            resetRateLimits();
            // document_sequences is truncated too: this suite seeds fixed
            // numbers without touching the allocator, so leaving a stale
            // sequence behind would desync it from these rows.
            await pool.query(
                "truncate documents, sessions, document_sequences cascade"
            );
            await pool.query(
                "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
            );
            mockGetSession.mockResolvedValue({
                user: {
                    id: ownerId,
                    email: "owner@suara-lapangan.local",
                    name: "Owner",
                    role: "user",
                },
            });
            mockIsAdmin.mockReturnValue(false);
        });

        afterAll(async () => {
            // The last test's rows would otherwise survive into the next suite
            // and into the e2e run, where the allocator would hand out a
            // number one of them already holds (documents_nomor_uidx).
            await pool.query(
                "truncate documents, sessions, document_sequences cascade"
            );
            await pool.end();
        });

        let seq = 0;
        async function seedDoc(options?: {
            status?: string;
            version?: number;
            rootId?: string;
            parentId?: string | null;
            supersededBy?: string | null;
        }): Promise<string> {
            seq += 1;
            const result = await pool.query<{ id: string }>(
                `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id, version, root_id, parent_id, superseded_by)
                 values ('seed-session', 'id', $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
                [
                    `SL/QTN/2026/000${seq}`,
                    options?.status ?? "siap",
                    `hash-${seq}`,
                    JSON.stringify({
                        jenis: "surat_penawaran",
                        locale: "id",
                        mata_uang: "IDR",
                        nomor: `SL/QTN/2026/000${seq}`,
                        tanggal: "2026-11-02",
                        proyek: {
                            nama: "Proyek Proof",
                            lokasi: "Sleman",
                            klien: "Pak Budi",
                        },
                        pekerjaan: [
                            {
                                uraian: "Pemasangan paving",
                                volume: 50,
                                satuan: "m2",
                                harga_satuan: 80000,
                                jumlah: 4000000,
                                sumber_kutipan: "turn_1",
                            },
                        ],
                        total_nominal: 4000000,
                        terbilang: "Empat juta rupiah",
                        butuh_konfirmasi: [],
                    }),
                    ownerId,
                    options?.version ?? 1,
                    options?.rootId ?? null,
                    options?.parentId ?? null,
                    options?.supersededBy ?? null,
                ]
            );
            return result.rows[0].id;
        }

        async function realGetEnvelope(id: string): Promise<unknown> {
            const res = await GET(
                new Request(`http://localhost/api/documents/${id}`),
                { params: Promise.resolve({ id }) }
            );
            expect(res.status).toBe(200);
            return res.json();
        }

        function stubFetchWith(envelope: unknown, pdfBlob?: Blob) {
            const fetchMock = vi.fn((input: RequestInfo | URL) => {
                const url = String(input);
                if (url.includes("/pdf")) {
                    return Promise.resolve(
                        new Response(
                            pdfBlob ??
                                new Blob(["%PDF-1.4"], {
                                    type: "application/pdf",
                                }),
                            {
                                status: 200,
                                headers: {
                                    "content-disposition":
                                        'attachment; filename="doc.pdf"',
                                },
                            }
                        )
                    );
                }
                if (url.includes("/api/documents/")) {
                    return Promise.resolve(
                        new Response(JSON.stringify(envelope), {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        })
                    );
                }
                return Promise.resolve(
                    new Response(JSON.stringify({ error: "not_found" }), {
                        status: 404,
                    })
                );
            });
            vi.stubGlobal("fetch", fetchMock);
            return fetchMock;
        }

        function renderDokumenView(docId: string) {
            return render(
                <DokumenView
                    locale="id"
                    docId={docId}
                    copy={{
                        viewerTitle: "Dokumen",
                        loading: "Memuat…",
                        emptyTitle: "Kosong",
                        emptyBody: "Tidak ada dokumen.",
                        notFoundBody: "Tidak ditemukan.",
                        emptyCta: "Buat dokumen",
                        errorTitle: "Gagal",
                        errorBody: "Terjadi kesalahan.",
                        retry: "Coba lagi",
                        statusLabel: "Status",
                        nomorLabel: "Nomor",
                        draftNomor: "Belum ditetapkan",
                    }}
                />
            );
        }

        it("renders version selector both options + superseded badge/banner for a superseded v1 against the real GET envelope", async () => {
            const v1 = await seedDoc({ status: "disetujui" });
            const v2 = await seedDoc({
                status: "draf",
                version: 2,
                rootId: v1,
                parentId: v1,
            });
            await pool.query(
                "update documents set superseded_by = $2::uuid where id = $1::uuid",
                [v1, v2]
            );

            const envelope = await realGetEnvelope(v1);
            // sanity: the real envelope carries the lineage fields
            expect(envelope).toMatchObject({
                version: 1,
                root_id: v1,
                superseded_by: v2,
            });
            expect(
                (envelope as Envelope).versions.map((v) => v.version)
            ).toEqual([2, 1]);

            stubFetchWith(envelope);
            try {
                renderDokumenView(v1);

                await waitFor(
                    () =>
                        expect(
                            screen.queryByTestId("version-selector")
                        ).not.toBeNull(),
                    { timeout: 5000 }
                );

                const selector = screen.getByTestId("version-selector");
                expect(selector.querySelectorAll("option")).toHaveLength(2);
                expect(screen.getByTestId("version-option-1")).not.toBeNull();
                expect(screen.getByTestId("version-option-2")).not.toBeNull();
                expect(screen.getByTestId("superseded-badge")).not.toBeNull();
                expect(screen.getByTestId("superseded-banner")).not.toBeNull();
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it("renders no version selector for a lone root (versions length 1) against the real GET envelope", async () => {
            const v1 = await seedDoc({ status: "siap" });
            const envelope = await realGetEnvelope(v1);
            expect((envelope as Envelope).versions).toHaveLength(1);

            stubFetchWith(envelope);
            try {
                renderDokumenView(v1);

                await waitFor(
                    () =>
                        expect(
                            screen.queryByTestId("document-nomor")
                        ).not.toBeNull(),
                    { timeout: 5000 }
                );
                expect(screen.queryByTestId("version-selector")).toBeNull();
                expect(screen.queryByTestId("superseded-badge")).toBeNull();
            } finally {
                vi.unstubAllGlobals();
            }
        });
    });
