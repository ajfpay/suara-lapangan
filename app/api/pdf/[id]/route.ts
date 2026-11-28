import { NextResponse } from "next/server";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import { verifiedOfficialPdf } from "@/lib/server/pdf/official";
import {
    documentIdSchema,
    formatZodError,
} from "@/lib/server/validation/document";
import { redactSecrets } from "@/lib/server/asr/log";
import { getSession, canAccessDocument } from "@/lib/server/auth";

type RouteContext = { params: Promise<{ id: string }> };

async function handleGet(
    request: Request,
    context?: RouteContext
): Promise<Response> {
    const session = await getSession(request);
    if (!session)
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
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
    let stored;
    try {
        stored = await getPostgresDocumentStore().get(id);
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
    if (!stored || !canAccessDocument(session, stored.userId ?? null))
        return NextResponse.json(
            { error: "not_found", message: `Document '${id}' not found` },
            { status: 404 }
        );
    if (stored.status === "draf")
        return NextResponse.json(
            {
                error: "draft_not_approved",
                message: "Document must be approved before downloading the PDF",
            },
            { status: 409 }
        );
    if (
        !Array.isArray(stored.document.butuh_konfirmasi) ||
        stored.document.butuh_konfirmasi.length > 0
    )
        return NextResponse.json(
            {
                error: "needs_confirmation",
                message:
                    "Document requires confirmation. Resolve butuh_konfirmasi via PATCH /api/documents/{id} first.",
            },
            { status: 409 }
        );
    try {
        const bytes = await verifiedOfficialPdf(stored);
        const filename = (stored.document.nomor ?? id).replace(
            /[^a-zA-Z0-9._-]/g,
            "-"
        );
        return new Response(new Uint8Array(bytes), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${filename}.pdf"`,
            },
        });
    } catch (cause) {
        console.error(
            redactSecrets(
                `[pdf] snapshot verification failed for ${id}: ${String(cause)}`
            )
        );
        return NextResponse.json(
            { error: "pdf_failure", message: "Official PDF is unavailable" },
            { status: 500 }
        );
    }
}
const limitedGet = withRateLimitFlat(handleGet, { route: "/api/pdf" });
export async function GET(
    request: Request,
    context: RouteContext
): Promise<Response> {
    let response: Response;
    try {
        response = await limitedGet(request, context);
    } catch (cause) {
        console.error(redactSecrets(`[pdf] request failed: ${String(cause)}`));
        response = NextResponse.json(
            { error: "pdf_failure", message: "Official PDF is unavailable" },
            { status: 500 }
        );
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
}
