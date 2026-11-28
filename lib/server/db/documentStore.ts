import { createHash, randomUUID } from "node:crypto";
import {
    newDraftItemIds,
    withDraftItemIds,
} from "@/lib/server/guard/draftIdentity";
import { allocateDocumentNumber } from "./documentNumber";

import { Pool } from "pg";

import { redactSecrets } from "@/lib/server/asr/log";
import type {
    DocumentStatus,
    QuotationDocument,
} from "@/lib/server/guard/types";

export type FieldChange = {
    field: string;
    original: unknown;
    current: unknown;
    changed_by: string;
    changed_at: string;
    item_id?: string;
    source_before?: string | null;
    source_after?: string | null;
    original_source?: string | null;
    kind?:
        | "edit"
        | "source"
        | "remove"
        | "move"
        | "derived_confirmation"
        | "confirmation";
};

export class DocumentLockedError extends Error {
    readonly status: DocumentStatus;
    constructor(status: DocumentStatus) {
        super(`Document is locked with status '${status}'`);
        this.name = "DocumentLockedError";
        this.status = status;
    }
}

export type DraftMutationOptions = {
    revision: number;
    actorId: string;
    key: string;
    fingerprint: string;
};

export class DraftMutationConflict extends Error {
    constructor(
        readonly code: "stale_revision" | "idempotency_conflict",
        readonly revision: number
    ) {
        super(code);
        this.name = "DraftMutationConflict";
    }
}

export type StoredDocument = {
    draftRevision: number;
    id: string;
    sessionId: string;
    nomor: string | null; // null while the draft has not been approved (ticket 01)
    status: DocumentStatus;
    rawStatus?: string;
    createdAt: Date;
    document: QuotationDocument;
    pdfPath?: string | null;
    pdfDocumentHash?: string | null;
    sentTo?: string | null;
    sentAt?: Date | null;
    userId?: string | null;
    fieldChanges: FieldChange[];
    approvedAt?: Date | null;
    approvedBy?: string | null;
    approvalRequestKey?: string | null;
    version: number;
    rootId: string;
    parentId?: string | null;
    supersededBy?: string | null;
    turnsHash?: string;
};

export type ApproveResult =
    | { ok: true; document: StoredDocument }
    | {
          ok: false;
          reason:
              | "not_found"
              | "needs_confirmation"
              | "invalid_state"
              | "stale_revision"
              | "idempotency_conflict";
          draftRevision?: number;
          status?: DocumentStatus;
      };

export type CreateVersionResult =
    | { ok: true; document: StoredDocument }
    | {
          ok: false;
          reason: "not_found" | "invalid_state";
          status?: DocumentStatus;
      };

export type AdminDocument = StoredDocument & {
    userEmail?: string | null;
    userName?: string | null;
};

export type MarkSentResult =
    | { ok: true; document: StoredDocument }
    | { ok: false; reason: "not_found" | "changed" };

/**
 * Fingerprints the stored document payload. PDF publication stores it with the
 * byte-addressed path; markSent binds delivery to the same document content.
 */
export function contentHashOf(document: QuotationDocument): string {
    return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

export type CreateDocumentInput = {
    sessionId: string;
    locale: QuotationDocument["locale"];
    // No nomor: ticket 01 always creates drafts with nomor = NULL; the number
    // is allocated at approval (ticket 03).
    turnsHash: string;
    document: QuotationDocument;
    userId?: string | null;
    fieldChanges?: FieldChange[];
};

export type DocumentListItem = {
    id: string;
    rootId: string;
    nomor: string | null;
    status: "draf" | "disetujui" | "terkirim";
    proyek: string | null;
    klien: string | null;
    locale: "id" | "en";
    mata_uang: "IDR" | "USD" | null;
    total: number | null;
    createdAt: string;
    version: number;
};

export type DocumentListQuery = {
    limit: number;
    search?: string;
    status?: DocumentListItem["status"];
    cursor?: { createdAt: string; id: string };
};

const LIST_COLUMNS = `id, coalesce(root_id,id) AS "rootId", nomor,
    case status when 'perlu_konfirmasi' then 'draf' when 'siap' then 'disetujui' else status end AS status,
    case when jsonb_typeof(data_json->'proyek'->'nama') = 'string' then data_json->'proyek'->>'nama' end AS proyek,
    case when jsonb_typeof(data_json->'proyek'->'klien') = 'string' then data_json->'proyek'->>'klien' end AS klien,
    locale, case when data_json->>'mata_uang' in ('IDR','USD') then data_json->>'mata_uang' end AS mata_uang,
    case when jsonb_typeof(data_json->'total_nominal') = 'number' then data_json->'total_nominal' end AS total,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
    version`;

export interface DocumentStore {
    /** The document an identical create (same session, same turns, same calendar day) reuses. */
    findByIdempotencyKey(
        sessionId: string,
        turnsHash: string
    ): Promise<StoredDocument | null>;
    create(input: CreateDocumentInput): Promise<StoredDocument>;
    get(id: string): Promise<StoredDocument | null>;
    /**
     * Applies transform to the stored payload inside a row lock (SELECT … FOR
     * UPDATE), so overlapping PATCHes serialize on the row instead of racing a
     * read-modify-write. Null when the id is unknown or malformed.
     */
    update(
        id: string,
        transform: (
            document: QuotationDocument,
            context?: { fieldChanges: FieldChange[] }
        ) =>
            | QuotationDocument
            | {
                  document: QuotationDocument;
                  fieldChanges?: FieldChange[];
                  status?: DocumentStatus;
              },
        options?: DraftMutationOptions
    ): Promise<StoredDocument | null>;
    /**
     * Records a successful email send: sets status `terkirim` and persists
     * `sent_to` / `sent_at` inside the same row lock as update(). The send is
     * bound to the content hash of the document that was emailed; if the
     * payload changed concurrently (PATCH) the document is NOT marked sent and
     * `{ok: false, reason: "changed"}` is returned so the caller can retry
     * with a fresh PDF.
     */
    markSent(
        id: string,
        sentTo: string,
        contentHash: string
    ): Promise<MarkSentResult>;
    approve(
        id: string,
        userId: string,
        options: { approvalYear?: number; revision: number; key: string }
    ): Promise<ApproveResult>;
    publishPdfSnapshot(
        id: string,
        pdfPath: string,
        documentHash: string
    ): Promise<string | null>;
    createVersion(
        id: string,
        options?: { userId?: string }
    ): Promise<CreateVersionResult>;
    listOwnedLatest(
        userId: string,
        query: DocumentListQuery
    ): Promise<DocumentListItem[]>;
    listOwnedVersions(userId: string, id: string): Promise<DocumentListItem[]>;
    listByUser(userId: string): Promise<StoredDocument[]>;
    listByRootId(rootId: string): Promise<StoredDocument[]>;
    listAll(): Promise<AdminDocument[]>;
}

export function turnsHashOf(
    turns: { startMs: number; endMs: number; transcript: string }[],
    context?: {
        locale?: string;
        project?: { nama: string; lokasi: string; klien: string };
    }
): string {
    // Length-prefixed parts, so a transcript containing a separator character
    // cannot alias a different turn sequence.
    const parts = turns.map(
        (turn) =>
            `${turn.startMs}:${turn.endMs}:${turn.transcript.length}:${turn.transcript}`
    );
    if (context) {
        parts.push(`locale:${context.locale ?? ""}`);
        if (context.project)
            parts.push(`project:${JSON.stringify(context.project)}`);
    }
    return createHash("sha256").update(parts.join("\n")).digest("hex");
}

const DOCUMENT_COLUMNS =
    "id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at, user_id, field_changes, approved_at, approved_by, version, root_id, parent_id, superseded_by, turns_hash, draft_revision, approval_request_key, pdf_document_hash";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresDocumentStore(
    connectionString: string
): DocumentStore {
    const pool = new Pool({ connectionString });
    // Without a listener, pg emits 'error' on the pool for a background idle
    // client failure (Postgres restart, dropped connection) and Node crashes
    // the process; log it through redactSecrets and let the pool reconnect.
    pool.on("error", (err) => {
        console.error(redactSecrets(`[documents] pool error: ${String(err)}`));
    });
    function toStored(row: {
        id: string;
        session_id: string;
        nomor: string | null;
        status: DocumentStatus;
        data_json: QuotationDocument;
        pdf_path?: string | null;
        sent_to?: string | null;
        sent_at?: Date | null;
        created_at: Date | string;
        draft_revision?: number;
        approval_request_key?: string | null;
        pdf_document_hash?: string | null;
        user_id?: string | null;
        field_changes?: unknown;
        approved_at?: Date | string | null;
        approved_by?: string | null;
        version?: number | null;
        root_id?: string | null;
        parent_id?: string | null;
        superseded_by?: string | null;
        turns_hash?: string | null;
    }): StoredDocument {
        // Read normalization (ticket 01): legacy vocabulary is mapped to the
        // review-before-pdf vocabulary on every read.
        const status: DocumentStatus =
            row.status === "perlu_konfirmasi"
                ? "draf"
                : row.status === "siap"
                  ? "disetujui"
                  : row.status;
        return {
            id: row.id,
            sessionId: row.session_id,
            nomor: row.nomor,
            status,
            rawStatus: row.status,
            createdAt: new Date(row.created_at),
            draftRevision: row.draft_revision ?? 1,
            document:
                status === "draf"
                    ? withDraftItemIds(row.data_json, row.id)
                    : row.data_json,
            pdfPath: row.pdf_path ?? null,
            pdfDocumentHash: row.pdf_document_hash ?? null,
            sentTo: row.sent_to ?? null,
            sentAt: row.sent_at
                ? row.sent_at instanceof Date
                    ? row.sent_at
                    : new Date(row.sent_at)
                : null,
            userId: row.user_id ?? null,
            fieldChanges: Array.isArray(row.field_changes)
                ? (row.field_changes as FieldChange[])
                : [],
            approvedAt: row.approved_at
                ? row.approved_at instanceof Date
                    ? row.approved_at
                    : new Date(row.approved_at)
                : null,
            approvedBy: row.approved_by ?? null,
            approvalRequestKey: row.approval_request_key ?? null,
            version: row.version ?? 1,
            rootId: row.root_id ?? row.id,
            parentId: row.parent_id ?? null,
            supersededBy: row.superseded_by ?? null,
            turnsHash: row.turns_hash ?? undefined,
        };
    }

    return {
        async findByIdempotencyKey(sessionId, turnsHash) {
            const result = await pool.query(
                `select ${DOCUMENT_COLUMNS}
                 from documents
                 where session_id = $1
                   and turns_hash = $2
                   and version = 1
                   and (created_at at time zone 'UTC')::date
                       = (now() at time zone 'UTC')::date
                 order by created_at asc
                 limit 1`,
                [sessionId, turnsHash]
            );
            if (result.rowCount === 0) return null;
            return toStored(result.rows[0]);
        },

        async create(input) {
            // Serializes concurrent creates for one session. Inside the lock the
            // insert is re-checked against the unique (session, hash, day) index:
            // the loser of a race re-reads and returns the winner's document, so
            // two identical concurrent creates converge on one row instead of a
            // unique-violation 500.
            const client = await pool.connect();
            let clientReleased = false;
            try {
                await client.query("begin");
                await client.query(
                    "select pg_advisory_xact_lock(hashtext($1))",
                    [input.sessionId]
                );
                const existing = await client.query(
                    `select ${DOCUMENT_COLUMNS}
                     from documents
                     where session_id = $1
                       and turns_hash = $2
                       and version = 1
                       and (created_at at time zone 'UTC')::date
                           = (now() at time zone 'UTC')::date
                     order by created_at asc
                     limit 1`,
                    [input.sessionId, input.turnsHash]
                );
                if ((existing.rowCount ?? 0) > 0) {
                    await client.query("commit");
                    return toStored(existing.rows[0]);
                }
                const draft = newDraftItemIds(input.document);
                const fieldChanges = (input.fieldChanges ?? []).map(
                    (change) => {
                        const match = /^pekerjaan\[(\d+)\]/.exec(change.field);
                        return match
                            ? {
                                  ...change,
                                  item_id:
                                      draft.pekerjaan[Number(match[1])]?.id,
                              }
                            : change;
                    }
                );
                const result = await client.query(
                    `insert into documents (session_id, locale, status, turns_hash, data_json, user_id, field_changes)
                     values ($1, $2, 'draf', $3, $4, $5, $6)
                     returning ${DOCUMENT_COLUMNS}`,
                    [
                        input.sessionId,
                        input.locale,
                        input.turnsHash,
                        JSON.stringify(draft),
                        input.userId ?? null,
                        JSON.stringify(fieldChanges),
                    ]
                );
                await client.query("commit");
                return toStored(result.rows[0]);
            } catch (cause) {
                // A failed rollback must not replace the original cause. But a
                // rollback that fails leaves the client in an unknown state, so
                // it is destroyed instead of released back to the pool: a later
                // borrower could inherit an aborted transaction or its locks.
                await client.query("rollback").catch(() => {
                    client.release(cause instanceof Error ? cause : undefined);
                    clientReleased = true;
                });
                throw cause;
            } finally {
                if (!clientReleased) client.release();
            }
        },

        async get(id) {
            if (!UUID_RE.test(id)) return null;
            const result = await pool.query(
                `select ${DOCUMENT_COLUMNS}
                 from documents where id = $1::uuid`,
                [id]
            );
            if (result.rowCount === 0) return null;
            return toStored(result.rows[0]);
        },

        async update(id, transform, options) {
            if (!UUID_RE.test(id)) return null;
            const client = await pool.connect();
            let clientReleased = false;
            try {
                // Purge expired receipts across documents in a short, separate transaction.
                // SKIP LOCKED avoids waiting on another mutation's receipt.
                if (options)
                    await client.query(`delete from document_patch_receipts
                    where (document_id, actor_id, request_key) in (
                        select document_id, actor_id, request_key from document_patch_receipts
                        where expires_at <= now() order by expires_at limit 1000 for update skip locked
                    )`);
                await client.query("begin");
                // Serializes overlapping PATCHes on this document: the second
                // one reads the first one's committed payload, so its recomputed
                // totals build on the corrected numbers instead of overwriting.
                const locked = await client.query(
                    `select ${DOCUMENT_COLUMNS}
                     from documents where id = $1::uuid for update`,
                    [id]
                );
                if (locked.rowCount === 0) {
                    await client.query("rollback");
                    return null;
                }
                const stored = toStored(locked.rows[0]);
                if (options) {
                    await client.query(
                        "delete from document_patch_receipts where document_id=$1 and expires_at <= now()",
                        [id]
                    );
                    const receipt = await client.query(
                        "select fingerprint, result from document_patch_receipts where document_id=$1 and actor_id=$2 and request_key=$3 and expires_at > now()",
                        [id, options.actorId, options.key]
                    );
                    if (receipt.rows[0]) {
                        if (
                            receipt.rows[0].fingerprint !== options.fingerprint
                        ) {
                            throw new DraftMutationConflict(
                                "idempotency_conflict",
                                stored.draftRevision
                            );
                        }
                        await client.query("commit");
                        return toStored(receipt.rows[0].result);
                    }
                    if (options.revision !== stored.draftRevision) {
                        throw new DraftMutationConflict(
                            "stale_revision",
                            stored.draftRevision
                        );
                    }
                }
                const isLocked =
                    stored.status === "terkirim" ||
                    stored.status === "disetujui";
                if (isLocked) {
                    await client.query("rollback");
                    throw new DocumentLockedError(stored.status);
                }
                const transformRes = transform(stored.document, {
                    fieldChanges: stored.fieldChanges,
                });
                const updated =
                    transformRes &&
                    typeof transformRes === "object" &&
                    "document" in transformRes &&
                    transformRes.document
                        ? transformRes.document
                        : (transformRes as QuotationDocument);
                const nextFieldChanges =
                    transformRes &&
                    typeof transformRes === "object" &&
                    "fieldChanges" in transformRes &&
                    Array.isArray(transformRes.fieldChanges)
                        ? transformRes.fieldChanges
                        : stored.fieldChanges;

                const nextStatus: DocumentStatus =
                    transformRes &&
                    typeof transformRes === "object" &&
                    "status" in transformRes &&
                    transformRes.status
                        ? transformRes.status
                        : "draf";
                const result = await client.query(
                    `update documents
                     set data_json = $2,
                         field_changes = $3,
                         draft_revision = draft_revision + 1,
                         status = $4,
                         sent_to = null,
                         sent_at = null,
                         updated_at = now()
                     where id = $1::uuid
                     returning ${DOCUMENT_COLUMNS}`,
                    [
                        id,
                        JSON.stringify(updated),
                        JSON.stringify(nextFieldChanges),
                        nextStatus,
                    ]
                );
                if (options) {
                    await client.query(
                        "insert into document_patch_receipts(document_id,actor_id,request_key,fingerprint,result) values($1,$2,$3,$4,$5)",
                        [
                            id,
                            options.actorId,
                            options.key,
                            options.fingerprint,
                            JSON.stringify(result.rows[0]),
                        ]
                    );
                }
                await client.query("commit");
                return toStored(result.rows[0]);
            } catch (cause) {
                await client.query("rollback").catch(() => {
                    client.release(cause instanceof Error ? cause : undefined);
                    clientReleased = true;
                });
                throw cause;
            } finally {
                if (!clientReleased) client.release();
            }
        },

        async markSent(id, sentTo, contentHash) {
            if (!UUID_RE.test(id)) {
                return { ok: false, reason: "not_found" };
            }
            const client = await pool.connect();
            let clientReleased = false;
            try {
                await client.query("begin");
                const locked = await client.query(
                    `select ${DOCUMENT_COLUMNS}
                     from documents where id = $1::uuid for update`,
                    [id]
                );
                if (locked.rowCount === 0) {
                    await client.query("rollback");
                    return { ok: false, reason: "not_found" };
                }
                const stored = toStored(locked.rows[0]);
                if (contentHashOf(stored.document) !== contentHash) {
                    await client.query("rollback");
                    return { ok: false, reason: "changed" };
                }
                const result = await client.query(
                    `update documents
                     set status = 'terkirim',
                         sent_to = $2,
                         sent_at = now(),
                         updated_at = now()
                     where id = $1::uuid
                     returning ${DOCUMENT_COLUMNS}`,
                    [id, sentTo]
                );
                await client.query("commit");
                return { ok: true, document: toStored(result.rows[0]) };
            } catch (cause) {
                await client.query("rollback").catch(() => {
                    client.release(cause instanceof Error ? cause : undefined);
                    clientReleased = true;
                });
                throw cause;
            } finally {
                if (!clientReleased) client.release();
            }
        },

        async approve(id, userId, options) {
            if (!UUID_RE.test(id)) {
                return { ok: false, reason: "not_found" };
            }
            const client = await pool.connect();
            let clientReleased = false;
            try {
                await client.query("begin");
                const locked = await client.query(
                    `select ${DOCUMENT_COLUMNS}
                     from documents where id = $1::uuid for update`,
                    [id]
                );
                if (locked.rowCount === 0) {
                    await client.query("rollback");
                    return { ok: false, reason: "not_found" };
                }
                const stored = toStored(locked.rows[0]);

                if (stored.draftRevision !== options.revision) {
                    await client.query("rollback");
                    return {
                        ok: false,
                        reason:
                            stored.approvalRequestKey === options.key &&
                            stored.approvedBy === userId
                                ? "idempotency_conflict"
                                : "stale_revision",
                        draftRevision: stored.draftRevision,
                    };
                }
                if (
                    stored.status === "disetujui" ||
                    (stored.status === "terkirim" &&
                        stored.approvalRequestKey === options.key &&
                        stored.approvedBy === userId)
                ) {
                    await client.query("commit");
                    return { ok: true, document: stored };
                }

                // Invalid state if not draf
                if (stored.status !== "draf") {
                    await client.query("rollback");
                    return {
                        ok: false,
                        reason: "invalid_state",
                        status: stored.status,
                    };
                }

                // Must not have open confirmations. Legacy rows carry the
                // raw status 'perlu_konfirmasi' with an empty
                // butuh_konfirmasi array, so the raw status gates too.
                if (
                    stored.document.pekerjaan.length === 0 ||
                    stored.document.pekerjaan.some(
                        (item) =>
                            item.harga_satuan_minor === null ||
                            item.harga_satuan == null
                    ) ||
                    stored.rawStatus === "perlu_konfirmasi" ||
                    (stored.document.butuh_konfirmasi &&
                        stored.document.butuh_konfirmasi.length > 0)
                ) {
                    await client.query("rollback");
                    return { ok: false, reason: "needs_confirmation" };
                }

                const approvalYear =
                    options.approvalYear ?? new Date().getUTCFullYear();
                const nomor = await allocateDocumentNumber(
                    client,
                    approvalYear
                );

                const updatedDoc: QuotationDocument = {
                    ...stored.document,
                    nomor,
                };

                const result = await client.query(
                    `update documents
                     set nomor = $2,
                         data_json = $3,
                         status = 'disetujui',
                         approved_at = now(),
                         approved_by = $4,
                         approval_request_key = $5,
                         updated_at = now()
                     where id = $1::uuid
                     returning ${DOCUMENT_COLUMNS}`,
                    [id, nomor, JSON.stringify(updatedDoc), userId, options.key]
                );
                await client.query("commit");
                return { ok: true, document: toStored(result.rows[0]) };
            } catch (cause) {
                await client.query("rollback").catch(() => {
                    client.release(cause instanceof Error ? cause : undefined);
                    clientReleased = true;
                });
                throw cause;
            } finally {
                if (!clientReleased) client.release();
            }
        },

        async publishPdfSnapshot(id, pdfPath, documentHash) {
            if (
                !UUID_RE.test(id) ||
                !/^snapshots\/[a-f0-9]{64}\.pdf$/.test(pdfPath) ||
                !/^[a-f0-9]{64}$/.test(documentHash)
            )
                return null;
            const result = await pool.query<{ pdf_path: string }>(
                `update documents set pdf_document_hash = $3, pdf_path = $2, updated_at = now()
                 where id = $1::uuid and status in ('disetujui', 'siap') and approval_request_key is not null and pdf_path is null
                 returning pdf_path`,
                [id, pdfPath, documentHash]
            );
            if (result.rows[0]) return result.rows[0].pdf_path;
            const winner = await pool.query<{ pdf_path: string | null }>(
                "select pdf_path from documents where id=$1::uuid and status in ('disetujui','siap','terkirim') and pdf_document_hash=$2",
                [id, documentHash]
            );
            return winner.rows[0]?.pdf_path ?? null;
        },

        async createVersion(id, options) {
            if (!UUID_RE.test(id)) {
                return { ok: false, reason: "not_found" };
            }
            const client = await pool.connect();
            let clientReleased = false;
            try {
                await client.query("begin");
                const locked = await client.query(
                    `select ${DOCUMENT_COLUMNS}
                     from documents where id = $1::uuid for update`,
                    [id]
                );
                if (locked.rowCount === 0) {
                    await client.query("rollback");
                    return { ok: false, reason: "not_found" };
                }
                const parent = toStored(locked.rows[0]);

                // Concurrent double create: the parent was already superseded
                // while this transaction waited on the row lock.
                if (parent.supersededBy) {
                    await client.query("rollback");
                    return {
                        ok: false,
                        reason: "invalid_state",
                        status: parent.status,
                    };
                }

                // Rejects unapproved drafts (status: "draf")
                if (parent.status === "draf") {
                    await client.query("rollback");
                    return {
                        ok: false,
                        reason: "invalid_state",
                        status: parent.status,
                    };
                }

                const newId = randomUUID();
                const nextVersion = parent.version + 1;
                const rootId = parent.rootId;
                const parentId = parent.id;
                const rawUserId = options?.userId ?? parent.userId;
                const userId =
                    rawUserId && UUID_RE.test(rawUserId) ? rawUserId : null;
                const locale = parent.document.locale ?? "id";
                const turnsHash = locked.rows[0].turns_hash ?? "";

                const clonedDoc: QuotationDocument = {
                    ...parent.document,
                    nomor: null,
                };

                // Insert new document row
                let insertRes;
                try {
                    insertRes = await client.query(
                        `insert into documents (
                        id, session_id, locale, nomor, status, turns_hash,
                        data_json, user_id, field_changes, version,
                        root_id, parent_id
                     ) values (
                        $1::uuid, $2, $3, null, 'draf', $4,
                        $5, $6, $7, $8,
                        $9::uuid, $10::uuid
                     )
                     returning ${DOCUMENT_COLUMNS}`,
                        [
                            newId,
                            parent.sessionId,
                            locale,
                            turnsHash,
                            JSON.stringify(clonedDoc),
                            userId,
                            JSON.stringify(parent.fieldChanges),
                            nextVersion,
                            rootId,
                            parentId,
                        ]
                    );
                } catch (insertCause) {
                    // Concurrent double create that slipped past the
                    // superseded_by guard: the (root_id, version) unique
                    // index rejects the second insert. Map it to a 409
                    // conflict instead of a 500.
                    await client.query("rollback");
                    const code =
                        insertCause &&
                        typeof insertCause === "object" &&
                        "code" in insertCause
                            ? (insertCause as { code?: unknown }).code
                            : undefined;
                    if (code === "23505") {
                        return {
                            ok: false,
                            reason: "invalid_state",
                            status: parent.status,
                        } as const;
                    }
                    throw insertCause;
                }

                // Update parent row with superseded_by
                await client.query(
                    `update documents set superseded_by = $2::uuid, updated_at = now() where id = $1::uuid`,
                    [parentId, newId]
                );

                await client.query("commit");
                return { ok: true, document: toStored(insertRes.rows[0]) };
            } catch (cause) {
                await client.query("rollback").catch(() => {
                    client.release(cause instanceof Error ? cause : undefined);
                    clientReleased = true;
                });
                throw cause;
            } finally {
                if (!clientReleased) client.release();
            }
        },

        async listOwnedLatest(userId, query) {
            const result = await pool.query<DocumentListItem>(
                `with latest as (
                        select distinct on (coalesce(root_id,id)) *
                        from documents where user_id = $1::uuid
                        order by coalesce(root_id,id), version desc, id desc
                    )
                    select ${LIST_COLUMNS} from latest
                    where ($2::text is null or case status when 'perlu_konfirmasi' then 'draf' when 'siap' then 'disetujui' else status end = $2)
                    and ($3::text is null or strpos(lower(coalesce(nomor,'')),lower($3)) > 0
                        or strpos(lower(coalesce(data_json->'proyek'->>'nama','')),lower($3)) > 0
                        or strpos(lower(coalesce(data_json->'proyek'->>'klien','')),lower($3)) > 0)
                    and ($4::timestamptz is null or (created_at,id) < ($4::timestamptz,$5::uuid))
                    order by created_at desc,id desc limit $6`,
                [
                    userId,
                    query.status ?? null,
                    query.search ?? null,
                    query.cursor?.createdAt ?? null,
                    query.cursor?.id ?? null,
                    query.limit + 1,
                ]
            );
            return result.rows.map((row) => ({
                ...row,
                total: Number.isFinite(row.total) ? row.total : null,
            }));
        },

        async listOwnedVersions(userId, id) {
            const result = await pool.query<DocumentListItem>(
                `select ${LIST_COLUMNS} from documents
                     where user_id = $1::uuid and coalesce(root_id,id) = (
                         select coalesce(root_id,id) from documents where id = $2::uuid and user_id = $1::uuid
                     )
                     order by version desc,id desc`,
                [userId, id]
            );
            return result.rows.map((row) => ({
                ...row,
                total: Number.isFinite(row.total) ? row.total : null,
            }));
        },

        async listByUser(userId: string): Promise<StoredDocument[]> {
            const result = await pool.query(
                `select ${DOCUMENT_COLUMNS}
                 from documents
                 where user_id = $1
                 order by created_at desc`,
                [userId]
            );
            return result.rows.map(toStored);
        },

        async listByRootId(rootId: string): Promise<StoredDocument[]> {
            const result = await pool.query(
                `select ${DOCUMENT_COLUMNS}
                 from documents
                 where root_id = $1::uuid
                 order by version desc`,
                [rootId]
            );
            return result.rows.map(toStored);
        },

        async listAll(): Promise<AdminDocument[]> {
            const result = await pool.query(
                `select d.id, d.session_id, d.nomor, d.status, d.data_json, d.pdf_path, d.sent_to, d.sent_at, d.created_at, d.user_id, d.field_changes,
                        d.approved_at, d.approved_by, d.version, d.root_id, d.parent_id, d.superseded_by, d.turns_hash, d.draft_revision, d.approval_request_key, d.pdf_document_hash,
                        u.email as user_email, u.name as user_name
                 from documents d
                 left join auth_user u on d.user_id = u.id
                 order by d.created_at desc`
            );
            return result.rows.map((row) => ({
                ...toStored(row),
                userEmail: row.user_email ?? null,
                userName: row.user_name ?? null,
            }));
        },
    };
}

let shared: DocumentStore | null = null;

export function getPostgresDocumentStore(): DocumentStore {
    if (!shared) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL is not set");
        }
        shared = createPostgresDocumentStore(connectionString);
    }
    return shared;
}

export function resetDocumentStoreForTesting(): void {
    shared = null;
}
