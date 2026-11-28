import { NextResponse } from "next/server";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import {
    getPostgresDocumentStore,
    contentHashOf,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { readOfficialPdf } from "@/lib/server/pdf/storage";
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
    const session = await getSession(_request);
    if (!session) {
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
    }
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
    let stored: StoredDocument | null;
    try {
        stored = await getPostgresDocumentStore().get(id);
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
    if (!stored) {
        return NextResponse.json(
            { error: "not_found", message: `Document '${id}' not found` },
            { status: 404 }
        );
    }

    if (!canAccessDocument(session, stored.userId ?? null)) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `Document '${id}' not found`,
            },
            { status: 404 }
        );
    }

    if (stored.status !== "draf") {
        try {
            if (
                !stored.pdfPath ||
                stored.pdfDocumentHash !== contentHashOf(stored.document)
            )
                throw new Error("Official PDF unavailable");
            const pdf = await readOfficialPdf(stored.pdfPath);
            return new Response(new Uint8Array(pdf), {
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": "inline",
                },
            });
        } catch (cause) {
            console.error(
                redactSecrets(
                    `[pdf-preview] snapshot verification failed: ${String(cause)}`
                )
            );
            return NextResponse.json(
                {
                    error: "pdf_failure",
                    message: "Official PDF is unavailable",
                },
                { status: 500 }
            );
        }
    }
    const html = renderQuotationHtml({ ...stored.document, nomor: null });
    return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

export async function GET(
    request: Request,
    context: RouteContext
): Promise<Response> {
    let response: Response;
    try {
        response = await handleGet(request, context);
    } catch (cause) {
        console.error(
            redactSecrets(`[pdf-preview] request failed: ${String(cause)}`)
        );
        response = NextResponse.json(
            { error: "pdf_failure", message: "PDF preview is unavailable" },
            { status: 500 }
        );
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
}
