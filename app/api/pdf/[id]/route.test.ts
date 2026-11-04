import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { GET } from "./route";
import {
    resolveChromiumPath,
    resetPdfCacheForTesting,
    resetPdfDbPoolForTesting,
} from "@/lib/server/pdf/storage";
import { PATCH } from "@/app/api/documents/[id]/route";
import type { QuotationDocument } from "@/lib/server/guard/types";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import {
    formatDay,
    getDailyCostCap,
    recordUsage,
} from "@/lib/server/quota/usage-meter";
import {
    resolvePdfStorageDir,
    relativePdfPathFor,
    pdfPathFor,
    writePdfAtomic,
    readPdf,
    readPdfSnapshot,
    writePdfHash,
    readPdfHash,
    isSafeStoredPdfPath,
} from "@/lib/server/pdf/storage";

/**
 * The PDF route resolves the session through `getSession` from `@/lib/server/auth`.
 * Unit tests here control it directly instead of going through a real session.
 * The default is an admin, because the existing suites seed legacy documents
 * without a `user_id` and the route allows admins to read them.
 */
const { mockGetSession, mockIsAdmin } = vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsAdmin: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: mockIsAdmin,
    canAccessDocument: (session: { user: { id: string; role?: string } }, ownerUserId: string | null) => {
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

/**
 * Storage helpers unit tests (no database required; runs in all environments).
 */
describe("pdf storage", () => {
    const tempDirs: string[] = [];
    const origEnv = process.env.PDF_STORAGE_DIR;

    afterAll(async () => {
        if (origEnv !== undefined) {
            process.env.PDF_STORAGE_DIR = origEnv;
        } else {
            delete process.env.PDF_STORAGE_DIR;
        }
        for (const dir of tempDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    });

    async function makeTempDir(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "suara-pdf-unit-"));
        tempDirs.push(dir);
        return dir;
    }

    it("resolvePdfStorageDir defaults to ./data/pdf under cwd or uses PDF_STORAGE_DIR", () => {
        delete process.env.PDF_STORAGE_DIR;
        expect(resolvePdfStorageDir()).toBe(path.resolve(process.cwd(), "./data/pdf"));

        process.env.PDF_STORAGE_DIR = "/custom/pdf/dir";
        expect(resolvePdfStorageDir()).toBe("/custom/pdf/dir");

        process.env.PDF_STORAGE_DIR = "relative/pdf";
        expect(resolvePdfStorageDir()).toBe(path.resolve(process.cwd(), "relative/pdf"));
    });

    it("relativePdfPathFor derives <id>.pdf from the document id", () => {
        expect(relativePdfPathFor("550e8400-e29b-41d4-a716-446655440000")).toBe(
            "550e8400-e29b-41d4-a716-446655440000.pdf"
        );
        expect(pdfPathFor("550e8400-e29b-41d4-a716-446655440000", "/data/pdf")).toBe(
            path.join("/data/pdf", "550e8400-e29b-41d4-a716-446655440000.pdf")
        );
    });

    it("isSafeStoredPdfPath rejects absolute paths, dot-dot segments, and escapes", () => {
        expect(isSafeStoredPdfPath("550e8400.pdf")).toBe(true);
        expect(isSafeStoredPdfPath("2026/0001.pdf")).toBe(true);
        expect(isSafeStoredPdfPath("/etc/passwd")).toBe(false);
        expect(isSafeStoredPdfPath("../../etc/passwd")).toBe(false);
        expect(isSafeStoredPdfPath("foo/../bar.pdf")).toBe(false);
        expect(isSafeStoredPdfPath("")).toBe(false);
    });

    it("readPdf returns null for non-existent path", async () => {
        const tempDir = await makeTempDir();
        expect(await readPdf(path.join(tempDir, "missing.pdf"))).toBeNull();
    });

    it("resolveChromiumPath throws a clear error when no Chromium exists", () => {
        const origChromePath = process.env.CHROME_PATH;
        delete process.env.CHROME_PATH;
        try {
            expect(() => resolveChromiumPath(() => false)).toThrow(/no Chromium found.*CHROME_PATH/);
        } finally {
            if (origChromePath !== undefined) process.env.CHROME_PATH = origChromePath;
        }
    });

    it("writePdfHash and readPdfHash round-trip hash values", async () => {
        const tempDir = await makeTempDir();
        const pdfFile = path.join(tempDir, "doc.pdf");
        expect(await readPdfHash(pdfFile)).toBeNull();

        await writePdfHash(pdfFile, "sha256-abc-123");
        expect(await readPdfHash(pdfFile)).toBe("sha256-abc-123");
    });

    it("atomic write: replaces destination completely, removes temp files, survives concurrent reads", async () => {
        const tempDir = await makeTempDir();
        const targetPath = path.join(tempDir, "2026", "0001.pdf");

        // 1. Rename replaces an existing destination completely (old bytes gone)
        const oldContent = Buffer.from("%PDF-1.4 OLD_CONTENT_HERE_WITH_PADDING_AAAA");
        const newContent = Buffer.from("%PDF-1.4 NEW_CONTENT_REPLACING_COMPLETELY_BBBB");
        await writePdfAtomic(targetPath, oldContent);
        expect(await readPdf(targetPath)).toEqual(oldContent);

        await writePdfAtomic(targetPath, newContent);
        const replaced = await readPdf(targetPath);
        expect(replaced).toEqual(newContent);
        expect(replaced?.includes(Buffer.from("OLD_CONTENT"))).toBe(false);

        // Verify no temp file left behind
        const dirFiles = await fs.readdir(path.dirname(targetPath));
        expect(dirFiles.some((f) => f.includes(".tmp-"))).toBe(false);

        // 2. Concurrent reads during write: reads observe either null or a complete valid document
        const largePdf = Buffer.concat([
            Buffer.from("%PDF-1.4\n"),
            Buffer.alloc(128 * 1024, "X"),
            Buffer.from("\n%%EOF"),
        ]);
        const testPath = path.join(tempDir, "2026", "0002.pdf");

        let stop = false;
        const observedErrors: string[] = [];
        let readCount = 0;

        const reader = (async () => {
            while (!stop) {
                const read = await readPdf(testPath);
                readCount++;
                if (read !== null) {
                    if (read.subarray(0, 4).toString() !== "%PDF") {
                        observedErrors.push(
                            "Corrupt header: " + read.subarray(0, 4).toString()
                        );
                    }
                    if (read.length !== largePdf.length) {
                        observedErrors.push(
                            `Partial length: expected ${largePdf.length}, got ${read.length}`
                        );
                    }
                }
            }
        })();

        for (let i = 0; i < 5; i++) {
            await writePdfAtomic(testPath, largePdf);
        }
        stop = true;
        await reader;

        expect(observedErrors).toEqual([]);
        expect(readCount).toBeGreaterThan(0);
        const finalRead = await readPdf(testPath);
        expect(finalRead?.subarray(0, 4).toString()).toBe("%PDF");
        expect(finalRead?.length).toBe(largePdf.length);

        const testDirFiles = await fs.readdir(path.dirname(testPath));
        expect(testDirFiles.some((f) => f.includes(".tmp-"))).toBe(false);
    });
});

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

describe.skipIf(!TEST_DATABASE_URL).sequential("GET /api/pdf/[id]", () => {
    let pool: Pool;
    let seededId = "";
    const tempStorageDirs: string[] = [];
    const origPdfStorageDir = process.env.PDF_STORAGE_DIR;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DATABASE_URL;
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
               ('00000000-0000-0000-0000-000000000001','test1@suara-lapangan.local',true,'Test User 1','user'),
               ('00000000-0000-0000-0000-000000000002','test2@suara-lapangan.local',true,'Test User 2','user')
             on conflict (id) do nothing`
        );
    });

    beforeEach(async () => {
        const freshDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "suara-pdf-storage-")
        );
        tempStorageDirs.push(freshDir);
        process.env.PDF_STORAGE_DIR = freshDir;
        resetPdfCacheForTesting();
        resetRateLimits();

        await pool.query(
            "truncate documents, sessions, usage_meter cascade"
        );
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
        );
    });

    afterAll(async () => {
        await resetPdfDbPoolForTesting();
        await pool.end();
        if (origPdfStorageDir !== undefined) {
            process.env.PDF_STORAGE_DIR = origPdfStorageDir;
        } else {
            delete process.env.PDF_STORAGE_DIR;
        }
        for (const dir of tempStorageDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    });

    async function seed(
        document: QuotationDocument,
        status = "disetujui"
    ): Promise<string> {
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json)
             values ('seed-session', $1, $2, $3, $4, $5) returning id`,
            [
                document.locale,
                document.nomor,
                status,
                "pdf-hash-" + Math.random(),
                JSON.stringify(document),
            ]
        );
        seededId = result.rows[0].id;
        return seededId;
    }

    it("404 for unknown id", async () => {
        const res = await GET(
            new Request(
                "http://localhost/api/pdf/00000000-0000-0000-0000-000000000000"
            ),
            {
                params: Promise.resolve({
                    id: "00000000-0000-0000-0000-000000000000",
                }),
            }
        );
        expect(res.status).toBe(404);
    });

    it("enforces rate limit: 31 GETs for an unknown id returns 429 with Retry-After", async () => {
        let lastRes: Response | null = null;
        for (let i = 0; i < 31; i++) {
            lastRes = await GET(
                new Request(
                    "http://localhost/api/pdf/00000000-0000-0000-0000-000000000000"
                ),
                {
                    params: Promise.resolve({
                        id: "00000000-0000-0000-0000-000000000000",
                    }),
                }
            );
        }
        expect(lastRes).not.toBeNull();
        expect(lastRes!.status).toBe(429);
        const retryAfter = Number(lastRes!.headers.get("Retry-After"));
        expect(retryAfter).toBeGreaterThan(0);
        const body = await lastRes!.json();
        expect(body.error).toBe("rate_limited");
    });

    it("answers 400 for a non-UUID id", async () => {
        const res = await GET(
            new Request("http://localhost/api/pdf/not-a-uuid"),
            {
                params: Promise.resolve({
                    id: "not-a-uuid",
                }),
            }
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("invalid_request");
    });

    it("does not gate quota on PDF GET: reaches handler and returns 404 without X-Quota-Hard-Stop", async () => {
        await recordUsage({
            date: formatDay(),
            estCost: getDailyCostCap() + 1.0,
        });
        const res = await GET(
            new Request(
                "http://localhost/api/pdf/00000000-0000-0000-0000-000000000000"
            ),
            {
                params: Promise.resolve({
                    id: "00000000-0000-0000-0000-000000000000",
                }),
            }
        );
        expect(res.status).toBe(404);
        expect(res.headers.get("X-Quota-Hard-Stop")).toBeNull();
    });

    it("409 draft_not_approved for a draft document", async () => {
        const id = await seed(doc({ nomor: null }), "draf");
        const res = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe("draft_not_approved");
    });

    it("409 when butuh_konfirmasi non-empty", async () => {
        const id = await seed(
            doc({ butuh_konfirmasi: [{ field: "x", alasan: "y", sumber_kutipan: null }] }),
            "disetujui"
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

    it("after 200 GET, file exists under PDF_STORAGE_DIR starting with %PDF and pdf_path is set in documents table", async () => {
        const id = await seed(doc());
        const res = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);

        const expectedRelativePath = `${id}.pdf`;
        const expectedDiskPath = path.join(
            process.env.PDF_STORAGE_DIR!,
            expectedRelativePath
        );

        const fileExists = await fs
            .stat(expectedDiskPath)
            .then(() => true)
            .catch(() => false);
        expect(fileExists).toBe(true);

        const diskBytes = await fs.readFile(expectedDiskPath);
        expect(diskBytes.subarray(0, 4).toString()).toBe("%PDF");

        const dbRes = await pool.query<{ pdf_path: string | null }>(
            "select pdf_path from documents where id = $1",
            [id]
        );
        expect(dbRes.rows[0].pdf_path).toBe(expectedRelativePath);
    }, 60000);

    it("cache key includes version and content hash: data change re-renders with MISS and different bytes", async () => {
        const id = await seed(doc());
        const ctx = { params: Promise.resolve({ id }) };
        const r1 = await GET(new Request(`http://localhost/api/pdf/${id}`), ctx);
        expect(r1.status).toBe(200);
        expect(r1.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes1 = Buffer.from(await r1.arrayBuffer());

        const updated = doc({ pekerjaan: [
            {
                uraian: "Hebel plus bata",
                volume: 20,
                satuan: "m2",
                harga_satuan: 60000,
                jumlah: 1200000,
                sumber_kutipan: "turn_2",
            },
        ], total_nominal: 1200000, terbilang: "Satu juta dua ratus ribu rupiah" });
        await pool.query(
            "update documents set data_json = $1::jsonb, version = version + 1 where id = $2",
            [JSON.stringify(updated), id]
        );
        resetPdfCacheForTesting();

        const r2 = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(r2.status).toBe(200);
        expect(r2.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes2 = Buffer.from(await r2.arrayBuffer());
        expect(bytes2.equals(bytes1)).toBe(false);
    }, 60000);

    it("generated PDF text contains total, terbilang, project metadata, and line items", async () => {
        const id = await seed(doc());
        const res = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
        const buf = Buffer.from(await res.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false });
        const pdfDoc = await loadingTask.promise;
        let text = "";
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const content = await page.getTextContent();
            text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
        }
        await (pdfDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
        expect(text).toContain("500");
        expect(text).toContain("Lima ratus ribu rupiah");
        expect(text).toContain("Villa");
        expect(text).toContain("Ubud");
        expect(text).toContain("Pak Made");
        expect(text).toContain("Hebel");
    }, 60000);

    it("second GET with memory cache cleared returns 200 with %PDF header and IDENTICAL bytes from disk", async () => {
        const id = await seed(doc());
        const ctx = { params: Promise.resolve({ id }) };
        const r1 = await GET(new Request(`http://localhost/api/pdf/${id}`), ctx);
        expect(r1.status).toBe(200);
        expect(r1.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes1 = Buffer.from(await r1.arrayBuffer());
        expect(bytes1.subarray(0, 4).toString()).toBe("%PDF");

        resetPdfCacheForTesting();

        const r2 = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(r2.status).toBe(200);
        expect(r2.headers.get("x-pdf-cache")).toBe("HIT");
        const bytes2 = Buffer.from(await r2.arrayBuffer());
        expect(bytes2.subarray(0, 4).toString()).toBe("%PDF");
        expect(bytes2.equals(bytes1)).toBe(true);
    }, 60000);

    it("PATCH-equivalent: direct data_json update + cleared memory cache re-renders and overwrites same path on disk with DIFFERENT bytes", async () => {
        const id = await seed(doc());
        const ctx = { params: Promise.resolve({ id }) };
        const r1 = await GET(new Request(`http://localhost/api/pdf/${id}`), ctx);
        expect(r1.status).toBe(200);
        const bytes1 = Buffer.from(await r1.arrayBuffer());

        const expectedRelativePath = `${id}.pdf`;
        const expectedDiskPath = path.join(
            process.env.PDF_STORAGE_DIR!,
            expectedRelativePath
        );
        const diskBytes1 = await fs.readFile(expectedDiskPath);
        expect(diskBytes1.equals(bytes1)).toBe(true);

        // Update data_json in the test DB directly (as PATCH does)
        const updated = doc({
            proyek: { nama: "Villa Sunset", lokasi: "Canggu", klien: "Ibu Ketut" },
            pekerjaan: [
                {
                    uraian: "Pemasangan Keramik",
                    volume: 50,
                    satuan: "m2",
                    harga_satuan: 120000,
                    jumlah: 6000000,
                    sumber_kutipan: "turn_2",
                },
            ],
            total_nominal: 6000000,
            terbilang: "Enam juta rupiah",
        });
        await pool.query(
            "update documents set data_json = $1 where id = $2",
            [JSON.stringify(updated), id]
        );

        resetPdfCacheForTesting();

        const r2 = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(r2.status).toBe(200);
        expect(r2.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes2 = Buffer.from(await r2.arrayBuffer());
        expect(bytes2.subarray(0, 4).toString()).toBe("%PDF");
        expect(bytes2.equals(bytes1)).toBe(false);

        // Overwrites the same file path on disk
        const diskBytes2 = await fs.readFile(expectedDiskPath);
        expect(diskBytes2.equals(bytes2)).toBe(true);
        expect(diskBytes2.equals(diskBytes1)).toBe(false);
    }, 60000);

    it("unwritable-directory case: 500 pdf_failure, does not leak path in body, logs error", async () => {
        const id = await seed(doc());
        // Use a regular file as an ancestor of PDF_STORAGE_DIR to force a write failure
        // regardless of process privileges (e.g., running as root).
        const blockingFile = await fs.mkdtemp(
            path.join(os.tmpdir(), "suara-pdf-block-")
        );
        tempStorageDirs.push(blockingFile);
        const blockerPath = path.join(blockingFile, "blocker");
        await fs.writeFile(blockerPath, "block");
        const unwritableDir = path.join(blockerPath, "data", "pdf");
        process.env.PDF_STORAGE_DIR = unwritableDir;

        const errorLogs: string[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => {
            errorLogs.push(args.map(String).join(" "));
        };

        try {
            const res = await GET(
                new Request(`http://localhost/api/pdf/${id}`),
                { params: Promise.resolve({ id }) }
            );
            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body.error).toBe("pdf_failure");
            expect(body.message).toBe("Failed to render PDF");
            expect(JSON.stringify(body)).not.toContain(unwritableDir);
            expect(JSON.stringify(body)).not.toContain(blockingFile);
            expect(errorLogs.length).toBeGreaterThan(0);
            expect(
                errorLogs.some((l) => l.includes("[pdf] render or write failed"))
            ).toBe(true);
        } finally {
            console.error = originalError;
        }
    }, 60000);

    it("old-style pdf_path resolves to a missing file and gets re-rendered", async () => {
        const id = await seed(doc());
        // Simulate a dev row written under the old nomor-based scheme.
        await pool.query(
            "update documents set pdf_path = $1 where id = $2",
            ["2026/0001.pdf", id]
        );
        resetPdfCacheForTesting();

        const res = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes = Buffer.from(await res.arrayBuffer());
        expect(bytes.subarray(0, 4).toString()).toBe("%PDF");

        // Re-render landed at the id-keyed path, not the old one.
        const newDiskPath = path.join(process.env.PDF_STORAGE_DIR!, `${id}.pdf`);
        const newFile = await fs.stat(newDiskPath).then(() => true).catch(() => false);
        expect(newFile).toBe(true);
        const newBytes = await fs.readFile(newDiskPath);
        expect(newBytes.equals(bytes)).toBe(true);

        // The database now records the id-keyed path.
        const dbRes = await pool.query<{ pdf_path: string | null }>(
            "select pdf_path from documents where id = $1",
            [id]
        );
        expect(dbRes.rows[0].pdf_path).toBe(`${id}.pdf`);
    }, 60000);

    it("PATCH then GET re-renders and overwrites the same id-keyed path", async () => {
        const id = await seed(doc(), "draf");
        const ctx = { params: Promise.resolve({ id }) };

        // PATCH through the real endpoint changes data_json.
        const patchRes = await PATCH(
            new Request(`http://localhost/api/documents/${id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    field: "pekerjaan[0].volume",
                    nilai: 20,
                }),
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(patchRes.status).toBe(200);

        // Simulate approval so the PDF gate passes.
        await pool.query("update documents set status = 'disetujui' where id = $1", [id]);

        const r1 = await GET(new Request(`http://localhost/api/pdf/${id}`), ctx);
        expect(r1.status).toBe(200);
        expect(r1.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes1 = Buffer.from(await r1.arrayBuffer());

        const expectedDiskPath = path.join(
            process.env.PDF_STORAGE_DIR!,
            `${id}.pdf`
        );
        const diskBytes1 = await fs.readFile(expectedDiskPath);
        expect(diskBytes1.equals(bytes1)).toBe(true);

        // A data change bumps the version, so the next GET re-renders.
        await pool.query(
            "update documents set data_json = jsonb_set(data_json, '{pekerjaan,0,volume}', '25'), version = version + 1 where id = $1",
            [id]
        );

        resetPdfCacheForTesting();

        const r2 = await GET(new Request(`http://localhost/api/pdf/${id}`), ctx);
        expect(r2.status).toBe(200);
        expect(r2.headers.get("x-pdf-cache")).toBe("MISS");
        const bytes2 = Buffer.from(await r2.arrayBuffer());
        expect(bytes2.subarray(0, 4).toString()).toBe("%PDF");
        expect(bytes2.equals(bytes1)).toBe(false);

        // Same id-keyed path overwritten with new content.
        const diskBytes2 = await fs.readFile(expectedDiskPath);
        expect(diskBytes2.equals(bytes2)).toBe(true);
        expect(diskBytes2.equals(diskBytes1)).toBe(false);
    }, 60000);

    it("concurrent writers with different hashes never serve a mixed pair", async () => {
        // Directly exercise writePdfAtomic + readPdfSnapshot under concurrency,
        // simulating the race finding 2 described: two writers carrying different
        // hashes land on the same path. The reader must observe either writer's
        // complete pair, never new bytes with a stale hash.
        const storageDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "suara-pdf-race-")
        );
        tempStorageDirs.push(storageDir);
        const filePath = path.join(storageDir, "shared.pdf");
        const hashA = "hash-a";
        const hashB = "hash-b";
        const pdfA = Buffer.from("%PDF-1.4 A CONTENT");
        const pdfB = Buffer.from("%PDF-1.4 B CONTENT");

        await Promise.all([
            writePdfAtomic(filePath, pdfA, hashA),
            writePdfAtomic(filePath, pdfB, hashB),
        ]);

        const snapshot = await readPdfSnapshot(filePath);
        expect(snapshot).not.toBeNull();
        if (snapshot) {
            // Either writer's complete pair is valid; a mixed pair is not.
            const isA =
                snapshot.hash === hashA && snapshot.pdf.equals(pdfA);
            const isB =
                snapshot.hash === hashB && snapshot.pdf.equals(pdfB);
            expect(isA || isB).toBe(true);
        }
    }, 60000);
    describe("access control", () => {
    let pool: Pool;
    const tempStorageDirs: string[] = [];
    const origPdfStorageDir = process.env.PDF_STORAGE_DIR;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DATABASE_URL;
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
            "0004_email_sends.sql",
            "0007_auth_tables.sql",
            "0008_documents_user_id.sql",
        ]) {
            const sql = await fs.readFile(`db/migrations/${file}`, "utf8");
            await pool.query(sql);
        }
    });

    beforeEach(async () => {
        const freshDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "suara-pdf-storage-")
        );
        tempStorageDirs.push(freshDir);
        process.env.PDF_STORAGE_DIR = freshDir;
        resetPdfCacheForTesting();
        resetRateLimits();

        await pool.query(
            "truncate documents, sessions, usage_meter cascade"
        );
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
        );
    });

    afterAll(async () => {
        await resetPdfDbPoolForTesting();
        await pool.end();
        if (origPdfStorageDir !== undefined) {
            process.env.PDF_STORAGE_DIR = origPdfStorageDir;
        } else {
            delete process.env.PDF_STORAGE_DIR;
        }
        for (const dir of tempStorageDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    });

    let accessControlDocCount = 0;
    async function seedDocument(userId: string | null): Promise<string> {
        accessControlDocCount++;
        const nomor = `SL/QTN/2099/${String(accessControlDocCount).padStart(4, "0")}`;
        const turnsHash = `hash-ac-${accessControlDocCount}`;
        const document = JSON.stringify({
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor,
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
        });
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, user_id)
             values ('seed-session', 'id', $1, 'siap', $2, $3::jsonb, $4) returning id`,
            [nomor, turnsHash, document, userId]
        );
        return result.rows[0].id;
    }

    async function renderPdf(id: string): Promise<Response> {
        const idDiskPath = path.join(
            process.env.PDF_STORAGE_DIR!,
            `${id}.pdf`
        );
        await fs.writeFile(idDiskPath, Buffer.from("%PDF-1.4 test"));
        return GET(
            new Request(`http://localhost/api/pdf/${id}`),
            { params: Promise.resolve({ id }) }
        );
    }

    function withSession(userRole: "user" | "admin", userId: string): void {
        mockGetSession.mockResolvedValue({
            user: { id: userId, email: "test@example.com", name: "Test User", role: userRole },
        });
        mockIsAdmin.mockReturnValue(userRole === "admin");
    }

    it("rejects an unauthenticated request with 401", async () => {
        mockGetSession.mockResolvedValue(null);
        mockIsAdmin.mockReturnValue(false);
        const id = await seedDocument(null);
        const res = await GET(
            new Request(`http://localhost/api/pdf/${id}`),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe("unauthorized");
    });

    it("rejects a non-owner with 403", async () => {
        withSession("user", "00000000-0000-0000-0000-000000000001");
        const id = await seedDocument("00000000-0000-0000-0000-000000000002");
        const res = await GET(
            new Request(`http://localhost/api/pdf/${id}`),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("forbidden");
    });

    it("serves the owner with 200", async () => {
        withSession("user", "00000000-0000-0000-0000-000000000001");
        const id = await seedDocument("00000000-0000-0000-0000-000000000001");
        const res = await renderPdf(id);
        expect(res.status).toBe(200);
    });

    it("serves an admin for a legacy ownerless document with 200", async () => {
        withSession("admin", "00000000-0000-0000-0000-000000000000");
        const id = await seedDocument(null);
        const res = await renderPdf(id);
        expect(res.status).toBe(200);
    });

    it("rejects a non-admin for a legacy ownerless document with 403", async () => {
        withSession("user", "00000000-0000-0000-0000-000000000001");
        const id = await seedDocument(null);
        const res = await renderPdf(id);
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("forbidden");
    });

    it("serves an admin for an owned document with 200", async () => {
        withSession("admin", "00000000-0000-0000-0000-000000000000");
        const id = await seedDocument("00000000-0000-0000-0000-000000000001");
        const res = await renderPdf(id);
        expect(res.status).toBe(200);
    });
});
    });
