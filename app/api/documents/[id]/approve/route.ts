import { z } from "zod";
import { NextResponse } from "next/server";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import { getSession, canAccessDocument } from "@/lib/server/auth";
import {
    documentIdSchema,
    draftRevisionSchema,
    formatZodError,
} from "@/lib/server/validation/document";
import {
    getPostgresDocumentStore,
    contentHashOf,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { redactSecrets } from "@/lib/server/asr/log";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import { renderPdf, writeOfficialPdf } from "@/lib/server/pdf/storage";

import { verifiedOfficialPdf } from "@/lib/server/pdf/official";

type RouteContext = { params: Promise<{ id: string }> };

function responseDocument(stored: StoredDocument) {
    return {
        document: toResponseDocument({ ...stored.document, id: stored.id }),
        draft_revision: stored.draftRevision,
        status: stored.status,
        butuh_konfirmasi: stored.document.butuh_konfirmasi ?? [],
        field_changes: stored.fieldChanges ?? [],
        approved_at: stored.approvedAt?.toISOString() ?? null,
        approved_by: stored.approvedBy ?? null,
        version: stored.version,
        root_id: stored.rootId,
        parent_id: stored.parentId ?? null,
        superseded_by: stored.supersededBy ?? null,
        pdf_path: stored.pdfPath ?? null,
    };
}

async function handleApprove(
    request: Request,
    context?: RouteContext
): Promise<Response> {
    const parsedId = documentIdSchema.safeParse((await context?.params)?.id);
    if (!parsedId.success)
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedId.error),
            },
            { status: 400 }
        );
    const id = parsedId.data;
    const session = await getSession(request);
    if (!session)
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );

    let store;
    let existing;
    try {
        store = getPostgresDocumentStore();
        existing = await store.get(id);
    } catch (cause) {
        console.error(redactSecrets(`[approve] read failed: ${String(cause)}`));
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }
    if (!existing)
        return NextResponse.json(
            { error: "not_found", message: `Document '${id}' not found` },
            { status: 404 }
        );
    if (!canAccessDocument(session, existing.userId ?? null))
        return NextResponse.json(
            {
                error: "forbidden",
                message: "You do not have access to this document",
            },
            { status: 403 }
        );

    const revision = draftRevisionSchema
        .extend({ recover_pdf: z.boolean().optional() })
        .safeParse(await request.json().catch(() => null));
    const key = request.headers.get("Idempotency-Key");
    if (!revision.success || !key || !/^[\x21-\x7e]{1,128}$/.test(key)) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: "draft_revision and Idempotency-Key are required",
            },
            { status: 400 }
        );
    }
    let result;
    try {
        result = await store.approve(id, session.user.id, {
            revision: revision.data.draft_revision,
            key,
            recoverPdf: revision.data.recover_pdf,
            approvalYear: new Date().getUTCFullYear(),
        });
    } catch (cause) {
        console.error(redactSecrets(`[approve] error: ${String(cause)}`));
        return NextResponse.json(
            { error: "store_failure", message: "Failed to approve document" },
            { status: 500 }
        );
    }
    if (!result.ok) {
        const messages = {
            not_found: `Document '${id}' not found`,
            needs_confirmation:
                "Document requires confirmation and complete item prices before it can be approved",
            invalid_state: `Document '${id}' cannot be approved in status '${result.status}'`,
            stale_revision: "Draft changed since it was reviewed",
            idempotency_conflict:
                "Approval was already recorded for another request or revision",
            legacy_migration_required:
                "This legacy official PDF requires verified migration; retry cannot regenerate it",
        };
        return NextResponse.json(
            {
                error: result.reason,
                message: messages[result.reason],
                ...(result.draftRevision !== undefined
                    ? { draft_revision: result.draftRevision }
                    : {}),
            },
            { status: result.reason === "not_found" ? 404 : 409 }
        );
    }
    const approved = result.document;
    try {
        if (!approved.pdfPath) {
            if (!approved.approvalRequestKey)
                throw new Error(
                    "Legacy approved document requires verified snapshot migration"
                );
            const bytes = await renderPdf(
                renderQuotationHtml(approved.document)
            );
            const candidate = await writeOfficialPdf(bytes);
            approved.pdfPath = await store.publishPdfSnapshot(
                id,
                candidate,
                contentHashOf(approved.document)
            );
            if (!approved.pdfPath)
                throw new Error("Document no longer publishable");
        }
        const published = await store.get(id);
        if (!published || published.pdfPath !== approved.pdfPath)
            throw new Error("Official PDF publication mismatch");
        await verifiedOfficialPdf(published);
    } catch (cause) {
        console.error(
            redactSecrets(
                `[approve] PDF publication/verification failed for ${id}: ${String(cause)}`
            )
        );
        return NextResponse.json(
            {
                ...responseDocument(approved),
                error: "pdf_failed",
                message: approved.pdfPath
                    ? "Published PDF cannot be verified; restore its original verified bytes. It will not be regenerated."
                    : "Official PDF unavailable; retry with the same revision and key or explicitly recover the unpublished PDF",
            },
            { status: 500 }
        );
    }
    return NextResponse.json(responseDocument(approved));
}

export const POST = withRateLimitFlat(handleApprove, {
    route: "/api/documents/approve",
}) as (request: Request, context: RouteContext) => Promise<Response>;
