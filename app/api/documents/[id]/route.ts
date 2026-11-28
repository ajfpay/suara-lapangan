import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
    getPostgresDocumentStore,
    DocumentLockedError,
    DraftMutationConflict,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { redactSecrets } from "@/lib/server/asr/log";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { DraftInputError, lineMoney, recalculateDraft } from "@/lib/server/guard/draftMoney";
import {
    documentIdSchema,
    patchDocumentBodySchema,
    formatZodError,
    draftRevisionSchema,
} from "@/lib/server/validation/document";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import {
    getSession,
    canAccessDocument,
} from "@/lib/server/auth";
import type { Turn } from "@/lib/server/asr/turns";
import { getTurnsStore } from "@/lib/server/db/store";
import type {
    CanonicalUnit,
    PekerjaanItem,
    Proyek,
} from "@/lib/server/guard/types";

class PatchIndexError extends Error {
    readonly index: number;
    constructor(index: number) {
        super(`Pekerjaan at index ${index} not found in document`);
        this.index = index;
    }
}

function remapIndex(i: number, fromIndex: number, toIndex: number): number {
    if (i === fromIndex) return toIndex;
    if (fromIndex < toIndex) {
        if (i > fromIndex && i <= toIndex) return i - 1;
    } else {
        if (i >= toIndex && i < fromIndex) return i + 1;
    }
    return i;
}

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

    const parsedBody = patchDocumentBodySchema.safeParse(body);
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
        return NextResponse.json({ error: "invalid_request", message: "draft_revision and Idempotency-Key are required" }, { status: 400 });
    }
    const mutationOptions = {
        revision: revision.data.draft_revision,
        actorId: session.user.id,
        key,
        fingerprint: createHash("sha256").update(JSON.stringify({ revision: revision.data.draft_revision, patch: patchBody })).digest("hex"),
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

    // A turn citation must resolve to a final turn of the document's own
    // session, mirroring the authoritative check in lib/server/guard/rules.ts;
    // the schema only regex-checks the shape. Without this, resolving a
    // confirmation strips the butuh_konfirmasi entry even when the cited
    // turn belongs to another session or does not exist.
    const citation = "op" in patchBody
        ? patchBody.op === "update_line" ? patchBody.changes.sumber_kutipan : undefined
        : patchBody.field.endsWith(".sumber_kutipan") ? String(patchBody.nilai) : undefined;
    if (citation && /^turn_[1-9][0-9]*$/.test(citation)) {
        let citedTurn: Turn | undefined;
        try {
            const storedSession = await getTurnsStore().findSession(
                existing.sessionId
            );
            const turnById = new Map<string, Turn>();
            for (const turn of storedSession?.turns ?? []) {
                turnById.set(turn.turn_id, turn);
            }
            citedTurn = turnById.get(citation);
        } catch {
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to access session database",
                },
                { status: 500 }
            );
        }
        if (!citedTurn || citedTurn.final !== true) {
            return NextResponse.json(
                {
                    error: "invalid_request",
                    message: `sumber_kutipan '${citation}' bukan giliran final dari sesi ini`,
                },
                { status: 400 }
            );
        }
    }

    const recomputeTotals = recalculateDraft;

    let result: StoredDocument | null = null;
    let indexError: PatchIndexError | undefined;
    let lockedError: DocumentLockedError | undefined;

    try {
        result = await docStore.update(id, (document, ctx) => {
            if ("op" in patchBody) {
                if (patchBody.op === "add_line") {
                    const newLine: PekerjaanItem = {
                        id: randomUUID(),
                        uraian: patchBody.item.uraian,
                        satuan: patchBody.item.satuan,
                        ...lineMoney(patchBody.item.volume, patchBody.item.harga_satuan, document.mata_uang),
                        sumber_kutipan: "manual",
                    };
                    document.pekerjaan = [
                        ...(document.pekerjaan || []),
                        newLine,
                    ];
                    recomputeTotals(document);
                    return { document, status: "draf" };
                }

                if (patchBody.op === "remove_line") {
                    const idx = patchBody.item_id ? document.pekerjaan.findIndex(item => item.id === patchBody.item_id) : patchBody.index!;
                    if (
                        !Array.isArray(document.pekerjaan) ||
                        idx < 0 ||
                        idx >= document.pekerjaan.length
                    ) {
                        throw new PatchIndexError(idx);
                    }
                    document.pekerjaan.splice(idx, 1);

                    // Drop butuh_konfirmasi for removed line and shift indices > idx down by 1
                    document.butuh_konfirmasi = (
                        document.butuh_konfirmasi || []
                    )
                        .filter(
                            (b) => !b.field.startsWith(`pekerjaan[${idx}].`)
                        )
                        .map((b) => {
                            const match = b.field.match(
                                /^pekerjaan\[(\d+)\]\.(.*)$/
                            );
                            if (match) {
                                const i = parseInt(match[1], 10);
                                if (i > idx) {
                                    return {
                                        ...b,
                                        field: `pekerjaan[${i - 1}].${match[2]}`,
                                    };
                                }
                            }
                            return b;
                        });

                    // Drop field_changes for removed line and shift indices > idx down by 1
                    const updatedFieldChanges = (ctx?.fieldChanges || [])
                        .filter(
                            (c) => !c.field.startsWith(`pekerjaan[${idx}].`)
                        )
                        .map((c) => {
                            const match = c.field.match(
                                /^pekerjaan\[(\d+)\]\.(.*)$/
                            );
                            if (match) {
                                const i = parseInt(match[1], 10);
                                if (i > idx) {
                                    return {
                                        ...c,
                                        field: `pekerjaan[${i - 1}].${match[2]}`,
                                    };
                                }
                            }
                            return c;
                        });

                    recomputeTotals(document);
                    return {
                        document,
                        fieldChanges: updatedFieldChanges,
                        status: "draf",
                    };
                }

                if (patchBody.op === "move_line") {
                    const { toIndex } = patchBody;
                    const fromIndex = patchBody.item_id ? document.pekerjaan.findIndex(item => item.id === patchBody.item_id) : patchBody.fromIndex!;
                    if (
                        !Array.isArray(document.pekerjaan) ||
                        fromIndex < 0 ||
                        fromIndex >= document.pekerjaan.length
                    ) {
                        throw new PatchIndexError(fromIndex);
                    }
                    if (toIndex < 0 || toIndex >= document.pekerjaan.length) {
                        throw new PatchIndexError(toIndex);
                    }
                    const [moved] = document.pekerjaan.splice(fromIndex, 1);
                    document.pekerjaan.splice(toIndex, 0, moved);

                    // Remap butuh_konfirmasi indices
                    document.butuh_konfirmasi = (
                        document.butuh_konfirmasi || []
                    ).map((b) => {
                        const match = b.field.match(
                            /^pekerjaan\[(\d+)\]\.(.*)$/
                        );
                        if (match) {
                            const i = parseInt(match[1], 10);
                            const nextI = remapIndex(i, fromIndex, toIndex);
                            return {
                                ...b,
                                field: `pekerjaan[${nextI}].${match[2]}`,
                            };
                        }
                        return b;
                    });

                    // Remap field_changes indices
                    const updatedFieldChanges = (ctx?.fieldChanges || []).map(
                        (c) => {
                            const match = c.field.match(
                                /^pekerjaan\[(\d+)\]\.(.*)$/
                            );
                            if (match) {
                                const i = parseInt(match[1], 10);
                                const nextI = remapIndex(i, fromIndex, toIndex);
                                return {
                                    ...c,
                                    field: `pekerjaan[${nextI}].${match[2]}`,
                                };
                            }
                            return c;
                        }
                    );

                    recomputeTotals(document);
                    return {
                        document,
                        fieldChanges: updatedFieldChanges,
                        status: "draf",
                    };
                }
                if (patchBody.op === "update_line") {
                    const idx = document.pekerjaan.findIndex(item => item.id === patchBody.item_id);
                    if (idx < 0) throw new PatchIndexError(idx);
                    const line = document.pekerjaan[idx];
                    const nextChanges = [...(ctx?.fieldChanges ?? [])];
                    for (const [field, value] of Object.entries(patchBody.changes)) {
                        const path = `pekerjaan[${idx}].${field}`;
                        const original = line[field as keyof PekerjaanItem];
                        if (original !== value && (line.sumber_kutipan.startsWith("turn_") || field === "sumber_kutipan")) {
                            nextChanges.push({ field: path, original, current: value, changed_by: session.user.id, changed_at: new Date().toISOString() });
                        }
                        document.butuh_konfirmasi = document.butuh_konfirmasi.filter(item => item.field !== path);
                    }
                    const { harga_satuan, ...other } = patchBody.changes;
                    Object.assign(line, other);
                    if (harga_satuan !== undefined) Object.assign(line, lineMoney(line.volume, harga_satuan, document.mata_uang));
                    recomputeTotals(document);
                    return { document, fieldChanges: nextChanges, status: "draf" };
                }
            }

            // Scalar edit
            const { field, nilai } = patchBody;
            if (
                field === "proyek.nama" ||
                field === "proyek.lokasi" ||
                field === "proyek.klien"
            ) {
                const subfield = field.slice("proyek.".length) as keyof Proyek;
                document.proyek[subfield] = String(nilai).trim();
                document.butuh_konfirmasi = (
                    document.butuh_konfirmasi || []
                ).filter((item) => item.field !== field);
                // AC 4: update project name only, no total recalc
                return { document, status: "draf" };
            }

            if (field === "tanggal") {
                document.tanggal = String(nilai).trim();
                document.butuh_konfirmasi = (
                    document.butuh_konfirmasi || []
                ).filter((item) => item.field !== field);
                return { document, status: "draf" };
            }

            const match = field.match(
                /^pekerjaan\[(\d+)\]\.(volume|harga_satuan|satuan|uraian|sumber_kutipan)$/
            )!;
            const idx = parseInt(match[1], 10);
            const subfield = match[2];

            if (
                !Array.isArray(document.pekerjaan) ||
                idx < 0 ||
                idx >= document.pekerjaan.length
            ) {
                throw new PatchIndexError(idx);
            }

            const lineItem = document.pekerjaan[idx];

            if (subfield === "sumber_kutipan") {
                lineItem.sumber_kutipan = String(nilai).trim();
                document.butuh_konfirmasi = (
                    document.butuh_konfirmasi || []
                ).filter((item) => item.field !== field);
                return { document, status: "draf" };
            }

            const oldValue = lineItem[subfield as keyof PekerjaanItem];
            let newValue: string | number;

            if (subfield === "volume" || subfield === "harga_satuan") {
                newValue =
                    typeof nilai === "number"
                        ? nilai
                        : Number(String(nilai).trim());
                if (subfield === "volume") lineItem.volume = newValue;
                else Object.assign(lineItem, lineMoney(lineItem.volume, nilai, document.mata_uang));
            } else if (subfield === "satuan") {
                newValue = String(nilai).trim() as CanonicalUnit;
                lineItem.satuan = newValue as CanonicalUnit;
            } else {
                newValue = String(nilai).trim();
                lineItem.uraian = newValue;
            }

            const nextChanges = [...(ctx?.fieldChanges || [])];
            if (
                typeof lineItem.sumber_kutipan === "string" &&
                lineItem.sumber_kutipan.startsWith("turn_")
            ) {
                const existingIdx = nextChanges.findIndex(
                    (c) => c.field === field
                );
                const nowIso = new Date().toISOString();
                if (existingIdx >= 0) {
                    nextChanges[existingIdx] = {
                        ...nextChanges[existingIdx],
                        current: newValue,
                        changed_by: session.user.id,
                        changed_at: nowIso,
                    };
                } else {
                    nextChanges.push({
                        field,
                        original: oldValue,
                        current: newValue,
                        changed_by: session.user.id,
                        changed_at: nowIso,
                    });
                }
            }

            document.butuh_konfirmasi = (
                document.butuh_konfirmasi || []
            ).filter((item) => item.field !== field);

            recomputeTotals(document);

            return {
                document,
                fieldChanges: nextChanges,
                status: "draf",
            };
        }, mutationOptions);
    } catch (cause) {
        if (cause instanceof DraftInputError) {
            return NextResponse.json({ error: "invalid_request", message: cause.message }, { status: 400 });
        }
        if (cause instanceof DraftMutationConflict) {
            return NextResponse.json({ error: cause.code, message: cause.code, draft_revision: cause.revision }, { status: 409 });
        }
        if (cause instanceof PatchIndexError) {
            indexError = cause;
        } else if (cause instanceof DocumentLockedError) {
            lockedError = cause;
        } else {
            console.error(
                redactSecrets(`[documents] patch failed: ${String(cause)}`)
            );
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to persist document",
                },
                { status: 500 }
            );
        }
    }
    if (lockedError) {
        return NextResponse.json(
            {
                error: "locked",
                message: lockedError.message,
            },
            { status: 409 }
        );
    }
    if (indexError) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: indexError.message,
            },
            { status: 400 }
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
        lineage = (await getPostgresDocumentStore().listByRootId(stored.rootId)).filter(
            (sibling) => canAccessDocument(session, sibling.userId ?? null)
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
