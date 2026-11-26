import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { documentIdSchema } from "@/lib/server/validation/document";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
): Promise<Response> {
    const session = await getSession(request);
    if (!session)
        return NextResponse.json(
            { error: "unauthorized", message: "Login required" },
            { status: 401 }
        );
    const id = documentIdSchema.safeParse((await context.params).id);
    if (!id.success)
        return NextResponse.json(
            { error: "invalid_request", message: "Invalid document ID" },
            { status: 400 }
        );
    try {
        const items = await getPostgresDocumentStore().listOwnedVersions(
            session.user.id,
            id.data
        );
        if (!items.length)
            return NextResponse.json(
                { error: "not_found", message: "Document not found" },
                { status: 404 }
            );
        return NextResponse.json(
            { items },
            { headers: { "Cache-Control": "private, no-store" } }
        );
    } catch {
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }
}
