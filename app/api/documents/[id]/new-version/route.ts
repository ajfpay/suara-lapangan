import { NextResponse } from "next/server";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import { getSession, isAdmin, type AuthSession } from "@/lib/server/auth";
import { documentIdSchema, formatZodError } from "@/lib/server/validation/document";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { redactSecrets } from "@/lib/server/asr/log";

type RouteContext = {
    params: Promise<{ id: string }>;
};

function canAccessDocument(
    session: AuthSession,
    ownerUserId: string | null
): boolean {
    if (ownerUserId === null) return isAdmin(session);
    return session.user.id === ownerUserId || isAdmin(session);
}

async function handleNewVersion(
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
            { error: "store_failure", message: "Failed to access document database" },
            { status: 500 }
        );
    }

    let existing;
    try {
        existing = await docStore.get(id);
    } catch {
        return NextResponse.json(
            { error: "store_failure", message: "Failed to access document database" },
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
            { error: "forbidden", message: "You do not have access to this document" },
            { status: 403 }
        );
    }

    if (existing.status === "draf") {
        return NextResponse.json(
            {
                error: "invalid_state",
                message: "Cannot create a new version of an unapproved draft",
            },
            { status: 409 }
        );
    }

    let result;
    try {
        result = await docStore.createVersion(id, { userId: session.user.id });
    } catch (cause) {
        console.error(redactSecrets(`[new-version] error: ${String(cause)}`));
        return NextResponse.json(
            { error: "store_failure", message: "Failed to create new version" },
            { status: 500 }
        );
    }

    if (!result.ok) {
        if (result.reason === "not_found") {
            return NextResponse.json(
                { error: "not_found", message: `Document '${id}' not found` },
                { status: 404 }
            );
        }
        return NextResponse.json(
            {
                error: "invalid_state",
                message: `Cannot create a new version in status '${result.status}'`,
            },
            { status: 409 }
        );
    }

    const newDoc = result.document;
    return NextResponse.json(
        {
            document: toResponseDocument({
                ...newDoc.document,
                id: newDoc.id,
            }),
            status: newDoc.status,
            butuh_konfirmasi: newDoc.document.butuh_konfirmasi ?? [],
            field_changes: newDoc.fieldChanges ?? [],
            version: newDoc.version,
            root_id: newDoc.rootId,
            parent_id: newDoc.parentId,
            superseded_by: newDoc.supersededBy,
            approved_at: null,
            approved_by: null,
        },
        { status: 201 }
    );
}

export const POST = withRateLimitFlat(handleNewVersion, {
    route: "/api/documents/new-version",
}) as (request: Request, context: RouteContext) => Promise<Response>;
