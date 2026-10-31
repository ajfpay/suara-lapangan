import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { GET, resetPdfCacheForTesting, resetPdfDbPoolForTesting } from "./route";
import type { QuotationDocument } from "@/lib/server/guard/types";
import {
    resolvePdfStorageDir,
    relativePdfPathFor,
    pdfPathFor,
    writePdfAtomic,
    readPdf,
    writePdfHash,
    readPdfHash,
} from "@/lib/server/pdf/storage";

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

    it("relativePdfPathFor and pdfPathFor derive <year>/<nnnn>.pdf from SL/QTN/YYYY/NNNN", () => {
        expect(relativePdfPathFor("SL/QTN/2026/0001")).toBe(path.join("2026", "0001.pdf"));
        expect(pdfPathFor("SL/QTN/2026/0001", "/data/pdf")).toBe(
            path.join("/data/pdf", "2026", "0001.pdf")
        );

        // Fallback for non-conforming nomor sanitizes safely
        expect(relativePdfPathFor("LEGACY/123-abc")).toBe("LEGACY_123-abc.pdf");
        expect(pdfPathFor("LEGACY/123-abc", "/data/pdf")).toBe(
            path.join("/data/pdf", "LEGACY_123-abc.pdf")
        );
    });

    it("readPdf returns null for non-existent path", async () => {
        const tempDir = await makeTempDir();
        expect(await readPdf(path.join(tempDir, "missing.pdf"))).toBeNull();
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

describe.skipIf(!TEST_DATABASE_URL)("GET /api/pdf/[id]", () => {
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

        await pool.query("truncate documents, sessions cascade");
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '')"
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

    it("after 200 GET, file exists under PDF_STORAGE_DIR starting with %PDF and pdf_path is set in documents table", async () => {
        const id = await seed(doc());
        const res = await GET(new Request(`http://localhost/api/pdf/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(res.status).toBe(200);

        const expectedRelativePath = path.join("2026", "0001.pdf");
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

        const expectedRelativePath = path.join("2026", "0001.pdf");
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
});
