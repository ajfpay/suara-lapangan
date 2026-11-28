import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
    getPostgresDocumentStore,
    DocumentLockedError,
    DraftMutationConflict,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { redactSecrets } from "@/lib/server/asr/log";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { DraftInputError } from "@/lib/server/guard/draftMoney";
import { applyDraftMutation } from "@/lib/server/guard/draftMutation";
import {
    documentIdSchema,
    patchDocumentBodySchema,
    formatZodError,
    draftRevisionSchema,
} from "@/lib/server/validation/document";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import { getSession, canAccessDocument } from "@/lib/server/auth";
import type { Turn } from "@/lib/server/asr/turns";
import { getTurnsStore } from "@/lib/server/db/store";
type RouteContext = {
    params: Promise<{ id: string }>;
};

async function handlePatch(
    request: Request,
    context?: RouteContext
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "invalid_request", message: "Request body must be JSON" },
            { status: 400 }
        );
    }

    const operation =
        body && typeof body === "object" && !Array.isArray(body)
            ? Object.fromEntries(
                  Object.entries(body).filter(
                      ([key]) => key !== "draft_revision"
                  )
              )
            : body;
    const parsedBody = patchDocumentBodySchema.safeParse(operation);
    if (!parsedBody.success) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedBody.error),
            },
            { status: 400 }
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
    const session = await getSession(request);
    if (!session) {
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
    }

    const id = parsedId.data;
    const patchBody = parsedBody.data;
    const revision = draftRevisionSchema.safeParse(body);
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
    const mutationOptions = {
        revision: revision.data.draft_revision,
        actorId: session.user.id,
        key,
        fingerprint: createHash("sha256")
            .update(
                JSON.stringify({
                    revision: revision.data.draft_revision,
                    patch: patchBody,
                })
            )
            .digest("hex"),
    };

    let docStore: ReturnType<typeof getPostgresDocumentStore>;
    try {
        docStore = getPostgresDocumentStore();
    } catch {
        return NextResponse.json(
            {
                error: "not_configured",
                message: "DATABASE_URL is not set",
            },
            { status: 503 }
        );
    }
    let existing: StoredDocument | null;
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

    const ownerUserId = existing?.userId ?? null;
    if (!existing) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `Document '${id}' not found`,
            },
            { status: 404 }
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

    const citation =
        "op" in patchBody
            ? patchBody.op === "update_line"
                ? patchBody.changes.sumber_kutipan
                : undefined
            : patchBody.field.endsWith(".sumber_kutipan")
              ? String(patchBody.nilai)
              : undefined;
    let citedTurn: Turn | undefined;
    if (citation && citation !== "manual") {
        try {
            citedTurn = (
                await getTurnsStore().findSession(existing.sessionId)
            )?.turns.find((turn) => turn.turn_id === citation);
        } catch {
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to access session database",
                },
                { status: 500 }
            );
        }
    }
    let result: StoredDocument | null = null;
    try {
        result = await docStore.update(
            id,
            (document, ctx) =>
                applyDraftMutation(
                    document,
                    ctx?.fieldChanges ?? [],
                    patchBody,
                    session.user.id,
                    (source) =>
                        citedTurn?.turn_id === source &&
                        citedTurn.final === true
                ),
            mutationOptions
        );
    } catch (cause) {
        if (cause instanceof DraftInputError) {
            return NextResponse.json(
                { error: "invalid_request", message: cause.message },
                { status: 400 }
            );
        }
        if (cause instanceof DraftMutationConflict) {
            return NextResponse.json(
                {
                    error: cause.code,
                    message:
                        cause.code === "stale_revision"
                            ? "Draft revision changed. Reload and review the latest draft."
                            : "Idempotency-Key was already used for a different request.",
                    draft_revision: cause.revision,
                },
                { status: 409 }
            );
        }
        if (cause instanceof DocumentLockedError) {
            return NextResponse.json(
                { error: "locked", message: cause.message },
                { status: 409 }
            );
        }
        console.error(
            redactSecrets(`[documents] patch failed: ${String(cause)}`)
        );
        return NextResponse.json(
            { error: "store_failure", message: "Failed to persist document" },
            { status: 500 }
        );
    }
    if (!result) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `Document '${id}' not found`,
            },
            { status: 404 }
        );
    }

    return NextResponse.json(
        {
            document: toResponseDocument({
                ...result.document,
                id: result.id,
            }),
            butuh_konfirmasi: result.document.butuh_konfirmasi,
            status: result.status,
            draft_revision: result.draftRevision,
            field_changes: result.fieldChanges ?? [],
        },
        { status: 200 }
    );
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
    const session = await getSession(_request);
    if (!session) {
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
    }

    const id = parsedId.data;
    let stored: StoredDocument | null;
    try {
        stored = await getPostgresDocumentStore().get(id);
    } catch {
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }
    const ownerUserId = stored?.userId ?? null;
    if (!stored) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `Document '${id}' not found`,
            },
            { status: 404 }
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

    let lineage: StoredDocument[];
    try {
        lineage = (
            await getPostgresDocumentStore().listByRootId(stored.rootId)
        ).filter((sibling) =>
            canAccessDocument(session, sibling.userId ?? null)
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

    const visibleIds = new Set(lineage.map((sibling) => sibling.id));
    const visibleSuccessor = (id: string | null | undefined) =>
        id && visibleIds.has(id) ? id : null;
    return NextResponse.json(
        {
            document: toResponseDocument({
                ...stored.document,
                id: stored.id,
            }),
            butuh_konfirmasi: stored.document.butuh_konfirmasi,
            status: stored.status,
            draft_revision: stored.draftRevision,
            pdf_recovery_available:
                stored.status === "disetujui" &&
                Boolean(stored.approvalRequestKey) &&
                !stored.pdfPath,
            field_changes: stored.fieldChanges ?? [],
            sent_to: stored.sentTo ?? null,
            sent_at: stored.sentAt ? stored.sentAt.toISOString() : null,
            version: stored.version,
            root_id: stored.rootId,
            superseded_by: visibleSuccessor(stored.supersededBy),
            versions: lineage.map((sibling) => ({
                id: sibling.id,
                version: sibling.version,
                nomor: sibling.nomor,
                status: sibling.status,
                superseded_by: visibleSuccessor(sibling.supersededBy),
            })),
        },
        { status: 200 }
    );
}

export const PATCH = withRateLimitFlat(handlePatch, {
    route: "/api/documents",
}) as (request: Request, context: RouteContext) => Promise<Response>;
export const GET = withRateLimitFlat(handleGet, {
    route: "/api/documents",
}) as (request: Request, context: RouteContext) => Promise<Response>;
