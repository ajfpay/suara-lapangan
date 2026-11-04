import { NextResponse } from "next/server";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import { createHash } from "node:crypto";
import path from "node:path";
import type { QuotationDocument } from "@/lib/server/guard/types";
import {
    renderPdf,
    resolvePdfStorageDir,
    relativePdfPathFor,
    writePdfAtomic,
    readPdfSnapshot,
    isSafeStoredPdfPath,
} from "@/lib/server/pdf/storage";
import {
    documentIdSchema,
    formatZodError,
} from "@/lib/server/validation/document";
import { getPdfDbPool, pdfCache } from "@/lib/server/pdf/storage";
import { redactSecrets } from "@/lib/server/asr/log";
import {
    getSession,
    canAccessDocument,
} from "@/lib/server/auth";

type RouteContext = {
    params: Promise<{ id: string }>;
};

async function getDocumentPdfPath(id: string): Promise<string | null> {
    const pool = getPdfDbPool();
    const result = await pool.query<{ pdf_path: string | null }>(
        "SELECT pdf_path FROM documents WHERE id = $1",
        [id]
    );
    return result.rows[0]?.pdf_path ?? null;
}

// Stored pdf_path is relative to PDF_STORAGE_DIR (e.g. '2026/0001.pdf') for portability.
async function setDocumentPdfPath(
    id: string,
    relativePath: string
): Promise<void> {
    const pool = getPdfDbPool();
    await pool.query(
        "UPDATE documents SET pdf_path = $2, updated_at = now() WHERE id = $1",
        [id, relativePath]
    );
}

function hashDoc(doc: unknown): string {
    return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

async function handleGet(
    _request: Request,
    context?: RouteContext
): Promise<Response> {
    const parsedId = documentIdSchema.safeParse((await context?.params)?.id);
    if (!parsedId.success) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedId.error),
            },
            { status: 400 }
        );
    }
    const id = parsedId.data;
    let doc: QuotationDocument | undefined;
    let storedPdfPath: string | null = null;
    let ownerUserId: string | null = null;
    let docStatus: string | null = null;
    let docVersion = 1;
    try {
        const stored = await getPostgresDocumentStore().get(id);
        doc = stored?.document;
        ownerUserId = stored?.userId ?? null;
        docStatus = stored?.status ?? null;
        docVersion = stored?.version ?? 1;
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

    // Document access control. A document with no owner is legacy data and
    // visible to admins only; an owned document is visible to its owner or
    // an admin. Unauthenticated requests are rejected before the disk read.
    const session = await getSession(_request);
    if (!session) {
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
    }
    if (!canAccessDocument(session, ownerUserId)) {
        return NextResponse.json(
            {
                error: "forbidden",
                message: "You do not have access to this document",
            },
            { status: 403 }
        );
    }
    if (docStatus === "draf") {
        return NextResponse.json(
            {
                error: "draft_not_approved",
                message:
                    "Document is still a draft. Approve it via POST /api/documents/{id}/approve before downloading the PDF.",
            },
            { status: 409 }
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
    const cacheKey = `${id}:${docVersion}:${hash}`;
    const docNomor = doc.nomor ?? "";
    const cached = pdfCache.get(cacheKey);
    if (cached && cached.hash === hash) {
        return new Response(new Uint8Array(cached.pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${docNomor.replaceAll("/", "-")}.pdf"`,
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
        pdfCache.set(cacheKey, {
            hash,
            pdf: snapshot.pdf,
        });
        return new Response(new Uint8Array(snapshot.pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${docNomor.replaceAll(
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
    pdfCache.set(cacheKey, { hash, pdf });
    return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${docNomor.replaceAll("/", "-")}.pdf"`,
            "X-PDF-Cache": "MISS",
        },
    });
}

export const GET = withRateLimitFlat(handleGet, { route: "/api/pdf" }) as (
    request: Request,
    context: RouteContext
) => Promise<Response>;
