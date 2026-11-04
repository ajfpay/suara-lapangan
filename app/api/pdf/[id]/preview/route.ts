import { NextResponse } from "next/server";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";
import {
    documentIdSchema,
    formatZodError,
} from "@/lib/server/validation/document";
import { redactSecrets } from "@/lib/server/asr/log";
import { getSession, canAccessDocument } from "@/lib/server/auth";

type RouteContext = {
    params: Promise<{ id: string }>;
};

async function handleGet(
    _request: Request,
    context: RouteContext
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
    let ownerUserId: string | null = null;
    try {
        const stored = await getPostgresDocumentStore().get(id);
        doc = stored?.document;
        ownerUserId = stored?.userId ?? null;
    } catch (cause) {
        console.error(
            redactSecrets(
                `[pdf-preview] document read failed: ${String(cause)}`
            )
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

    // No status gate: drafts and approved documents both get a preview.
    // The shared builder renders the draft marker for unnumbered documents.
    const html = renderQuotationHtml(doc);
    return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

export const GET = handleGet;
