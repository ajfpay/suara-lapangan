import { NextResponse } from "next/server";
import path from "node:path";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import {
    getSession,
    canAccessDocument,
    type AuthSession,
} from "@/lib/server/auth";
import {
    documentIdSchema,
    formatZodError,
} from "@/lib/server/validation/document";
import {
    getPostgresDocumentStore,
    contentHashOf,
} from "@/lib/server/db/documentStore";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { redactSecrets } from "@/lib/server/asr/log";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import {
    renderPdf,
    resolvePdfStorageDir,
    relativePdfPathFor,
    writePdfAtomic,
} from "@/lib/server/pdf/storage";

type RouteContext = {
    params: Promise<{ id: string }>;
};

async function handleApprove(
    request: Request,
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

    const session = await getSession(request);
    if (!session) {
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
    }

    let docStore;
    try {
        docStore = getPostgresDocumentStore();
    } catch {
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }

    let existing;
    try {
        existing = await docStore.get(id);
    } catch {
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }

    if (!existing) {
        return NextResponse.json(
            { error: "not_found", message: `Document '${id}' not found` },
            { status: 404 }
        );
    }

    if (!canAccessDocument(session, existing.userId ?? null)) {
        return NextResponse.json(
            {
                error: "forbidden",
                message: "You do not have access to this document",
            },
            { status: 403 }
        );
    }

    if (existing.status === "disetujui") {
        if (existing.pdfPath) {
            return NextResponse.json(
                {
                    document: toResponseDocument({
                        ...existing.document,
                        id: existing.id,
                    }),
                    status: existing.status,
                    butuh_konfirmasi: existing.document.butuh_konfirmasi ?? [],
                    field_changes: existing.fieldChanges ?? [],
                    approved_at: existing.approvedAt?.toISOString() ?? null,
                    approved_by: existing.approvedBy ?? null,
                    version: existing.version,
                    root_id: existing.rootId,
                    parent_id: existing.parentId ?? null,
                    superseded_by: existing.supersededBy ?? null,
                    pdf_path: existing.pdfPath ?? null,
                },
                { status: 200 }
            );
        }
        // Approved but the PDF never landed (render or write failed on the
        // first attempt): fall through and regenerate it below instead of
        // returning the already-approved early return with pdf_path null.
    }

    if (
        existing.status !== "draf" &&
        !(existing.status === "disetujui" && !existing.pdfPath)
    ) {
        return NextResponse.json(
            {
                error: "invalid_state",
                message: `Document '${id}' cannot be approved in status '${existing.status}'`,
            },
            { status: 409 }
        );
    }

    if (
        existing.rawStatus === "perlu_konfirmasi" ||
        (existing.document.butuh_konfirmasi &&
            existing.document.butuh_konfirmasi.length > 0)
    ) {
        return NextResponse.json(
            {
                error: "needs_confirmation",
                message:
                    "Document requires confirmation before it can be approved",
            },
            { status: 409 }
        );
    }

    const approvalYear = new Date().getUTCFullYear();
    let approvalResult;
    let approvedDoc;
    let pdfFailed = false;
    if (existing.status === "disetujui" && !existing.pdfPath) {
        // Retry path: the document is already approved (nomor allocated on
        // the first attempt) but the PDF never landed. Reuse the approved
        // row so no new sequence number is consumed.
        approvedDoc = existing;
    } else {
        try {
            approvalResult = await docStore.approve(id, session.user.id, {
                approvalYear,
            });
        } catch (cause) {
            console.error(redactSecrets(`[approve] error: ${String(cause)}`));
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to approve document",
                },
                { status: 500 }
            );
        }

        if (!approvalResult.ok) {
            if (approvalResult.reason === "not_found") {
                return NextResponse.json(
                    {
                        error: "not_found",
                        message: `Document '${id}' not found`,
                    },
                    { status: 404 }
                );
            }
            if (approvalResult.reason === "needs_confirmation") {
                return NextResponse.json(
                    {
                        error: "needs_confirmation",
                        message:
                            "Document requires confirmation before it can be approved",
                    },
                    { status: 409 }
                );
            }
            return NextResponse.json(
                {
                    error: "invalid_state",
                    message: `Document '${id}' cannot be approved in status '${approvalResult.status}'`,
                },
                { status: 409 }
            );
        }

        approvedDoc = approvalResult.document;
    }

    // Following transaction commit, generate PDF and store in PDF_STORAGE_DIR
    try {
        const html = renderQuotationHtml(approvedDoc.document);
        const pdf = await renderPdf(html);
        const storageDir = resolvePdfStorageDir();
        const relPath = relativePdfPathFor(id);
        const diskPath = path.join(storageDir, relPath);
        const hash = contentHashOf(approvedDoc.document);
        await writePdfAtomic(diskPath, pdf, hash);
        await docStore.setPdfPath(id, relPath);
        approvedDoc.pdfPath = relPath;
    } catch (cause) {
        console.error(
            redactSecrets(`[approve] PDF generation failed: ${String(cause)}`)
        );
        pdfFailed = true;
    }

    if (pdfFailed) {
        return NextResponse.json(
            {
                document: toResponseDocument({
                    ...approvedDoc.document,
                    id: approvedDoc.id,
                }),
                status: approvedDoc.status,
                butuh_konfirmasi: approvedDoc.document.butuh_konfirmasi ?? [],
                field_changes: approvedDoc.fieldChanges ?? [],
                approved_at: approvedDoc.approvedAt?.toISOString() ?? null,
                approved_by: approvedDoc.approvedBy ?? null,
                version: approvedDoc.version,
                root_id: approvedDoc.rootId,
                parent_id: approvedDoc.parentId ?? null,
                superseded_by: approvedDoc.supersededBy ?? null,
                pdf_path: approvedDoc.pdfPath ?? null,
                error: "pdf_failed",
                message:
                    "Document approved but PDF generation failed; re-POST to regenerate",
            },
            { status: 500 }
        );
    }

    return NextResponse.json(
        {
            document: toResponseDocument({
                ...approvedDoc.document,
                id: approvedDoc.id,
            }),
            status: approvedDoc.status,
            butuh_konfirmasi: approvedDoc.document.butuh_konfirmasi ?? [],
            field_changes: approvedDoc.fieldChanges ?? [],
            approved_at: approvedDoc.approvedAt?.toISOString() ?? null,
            approved_by: approvedDoc.approvedBy ?? null,
            version: approvedDoc.version,
            root_id: approvedDoc.rootId,
            parent_id: approvedDoc.parentId ?? null,
            superseded_by: approvedDoc.supersededBy ?? null,
            pdf_path: approvedDoc.pdfPath ?? null,
        },
        { status: 200 }
    );
}

export const POST = withRateLimitFlat(handleApprove, {
    route: "/api/documents/approve",
}) as (request: Request, context: RouteContext) => Promise<Response>;
