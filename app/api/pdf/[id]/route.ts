import { NextResponse } from "next/server";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import { redactSecrets } from "@/lib/server/asr/log";
import { createHash } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import type { QuotationDocument } from "@/lib/server/guard/types";
import {
    resolvePdfStorageDir,
    relativePdfPathFor,
    writePdfAtomic,
    readPdfSnapshot,
    isSafeStoredPdfPath,
} from "@/lib/server/pdf/storage";
import { documentIdSchema, formatZodError } from "@/lib/server/validation/document";

type RouteContext = {
    params: Promise<{ id: string }>;
};

// Identical-content cache: key = document nomor + content hash.
const pdfCache = new Map<string, { hash: string; pdf: Buffer }>();

export function resetPdfCacheForTesting(): void {
    pdfCache.clear();
}

let dbPool: Pool | null = null;
let dbPoolUrl: string | null = null;

function getPdfDbPool(): Pool {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }
    if (!dbPool || dbPoolUrl !== connectionString) {
        if (dbPool) {
            dbPool.end().catch(() => {});
        }
        dbPoolUrl = connectionString;
        dbPool = new Pool({ connectionString });
        dbPool.on("error", (err) => {
            console.error(redactSecrets(`[pdf] db pool error: ${String(err)}`));
        });
    }
    return dbPool;
}

export async function resetPdfDbPoolForTesting(): Promise<void> {
    if (dbPool) {
        const p = dbPool;
        dbPool = null;
        dbPoolUrl = null;
        await p.end().catch(() => {});
    }
}

async function getDocumentPdfPath(id: string): Promise<string | null> {
    const pool = getPdfDbPool();
    const result = await pool.query<{ pdf_path: string | null }>(
        "SELECT pdf_path FROM documents WHERE id = $1",
        [id]
    );
    return result.rows[0]?.pdf_path ?? null;
}

// Stored pdf_path is relative to PDF_STORAGE_DIR (e.g. '2026/0001.pdf') for portability.
async function setDocumentPdfPath(id: string, relativePath: string): Promise<void> {
    const pool = getPdfDbPool();
    await pool.query(
        "UPDATE documents SET pdf_path = $2, updated_at = now() WHERE id = $1",
        [id, relativePath]
    );
}

function hashDoc(doc: unknown): string {
    return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

function shell(html: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}body{margin:0}table{page-break-inside:auto}tr{page-break-inside:avoid}</style></head><body>${html}</body></html>`;
}

async function renderPdf(html: string): Promise<Buffer> {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
        executablePath:
            process.env.CHROME_PATH ??
            "/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(shell(html), { waitUntil: "load" });
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

async function handleGet(
    _request: Request,
    context?: RouteContext
): Promise<Response> {
    const parsedId = documentIdSchema.safeParse(
        (await context?.params)?.id
    );
    if (!parsedId.success) {
        return NextResponse.json(
            { error: "invalid_request", message: formatZodError(parsedId.error) },
            { status: 400 }
        );
    }
    const id = parsedId.data;
    let doc: QuotationDocument | undefined;
    let storedPdfPath: string | null = null;
    try {
        doc = (await getPostgresDocumentStore().get(id))?.document;
        if (doc) {
            storedPdfPath = await getDocumentPdfPath(id);
        }
    } catch (cause) {
        console.error(
            redactSecrets(`[pdf] document read failed: ${String(cause)}`)
        );
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }
    if (!doc) {
        return NextResponse.json(
            { error: "not_found", message: `Document '${id}' not found` },
            { status: 404 }
        );
    }
    if (doc.butuh_konfirmasi.length > 0) {
        return NextResponse.json(
            {
                error: "needs_confirmation",
                message:
                    "Document requires confirmation before PDF can be generated. Resolve butuh_konfirmasi via PATCH /api/documents/{id} first.",
            },
            { status: 409 }
        );
    }
    const hash = hashDoc(doc);
    const cached = pdfCache.get(doc.nomor);
    if (cached && cached.hash === hash) {
        return new Response(new Uint8Array(cached.pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${doc.nomor.replaceAll("/", "-")}.pdf"`,
                "X-PDF-Cache": "HIT",
            },
        });
    }

    const storageDir = resolvePdfStorageDir();
    const idPath = relativePdfPathFor(id);
    const idDiskPath = path.resolve(storageDir, idPath);

    // A stored pdf_path is used only for reading; writes always go to the
    // id-keyed path so an old or missing stored path can never shadow a
    // different document's file.
    let storedDiskPath: string | null = null;
    if (storedPdfPath && isSafeStoredPdfPath(storedPdfPath)) {
        storedDiskPath = path.resolve(storageDir, storedPdfPath);
    }

    let snapshot: { pdf: Buffer; hash: string } | null = null;
    if (storedDiskPath) {
        try {
            snapshot = await readPdfSnapshot(storedDiskPath);
        } catch (cause) {
            console.error(
                redactSecrets(`[pdf] disk read failed: ${String(cause)}`)
            );
            return NextResponse.json(
                { error: "pdf_failure", message: "Failed to render PDF" },
                { status: 500 }
            );
        }
    }
    if (!snapshot) {
        try {
            snapshot = await readPdfSnapshot(idDiskPath);
        } catch (cause) {
            console.error(
                redactSecrets(`[pdf] disk read failed: ${String(cause)}`)
            );
            return NextResponse.json(
                { error: "pdf_failure", message: "Failed to render PDF" },
                { status: 500 }
            );
        }
    }
    if (snapshot && snapshot.hash === hash) {
        if (!storedPdfPath || storedPdfPath !== idPath) {
            try {
                await setDocumentPdfPath(id, idPath);
            } catch (cause) {
                console.error(
                    redactSecrets(`[pdf] path update failed: ${String(cause)}`)
                );
            }
        }
        pdfCache.set(doc.nomor, {
            hash,
            pdf: snapshot.pdf,
        });
        return new Response(new Uint8Array(snapshot.pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${doc.nomor.replaceAll(
                    "/",
                    "-"
                )}.pdf"`,
                "X-PDF-Cache": "HIT",
            },
        });
    }

    const html = renderQuotationHtml(doc);
    let pdf: Buffer;
    try {
        pdf = await renderPdf(html);
        await writePdfAtomic(idDiskPath, pdf, hash);
        await setDocumentPdfPath(id, idPath);
    } catch (cause) {
        console.error(
            redactSecrets(`[pdf] render or write failed: ${String(cause)}`)
        );
        return NextResponse.json(
            { error: "pdf_failure", message: "Failed to render PDF" },
            { status: 500 }
        );
    }
    pdfCache.set(doc.nomor, { hash, pdf });
    return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${doc.nomor.replaceAll("/", "-")}.pdf"`,
            "X-PDF-Cache": "MISS",
        },
    });
}

export const GET = withRateLimitFlat(handleGet, { route: "/api/pdf" }) as (
    request: Request,
    context: RouteContext
) => Promise<Response>;
