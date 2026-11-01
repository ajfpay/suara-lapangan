import { createHash } from "node:crypto";

import { Pool } from "pg";

import { redactSecrets } from "@/lib/server/asr/log";
import type { DocumentStatus, QuotationDocument } from "@/lib/server/guard/types";

export type StoredDocument = {
    id: string;
    sessionId: string;
    nomor: string;
    status: DocumentStatus;
    createdAt: Date;
    document: QuotationDocument;
    pdfPath?: string | null;
    sentTo?: string | null;
    sentAt?: Date | null;
};

export type MarkSentResult =
    | { ok: true; document: StoredDocument }
    | { ok: false; reason: "not_found" | "changed" };

/**
 * Fingerprints the stored document payload. The PDF route writes this hash
 * beside a rendered PDF, and markSent uses it to prove the version that was
 * emailed is still the version on disk.
 */
export function contentHashOf(document: QuotationDocument): string {
    return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

export type CreateDocumentInput = {
    sessionId: string;
    locale: QuotationDocument["locale"];
    nomor: string;
    turnsHash: string;
    document: QuotationDocument;
};

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
        transform: (document: QuotationDocument) => QuotationDocument
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
        (turn) => `${turn.startMs}:${turn.endMs}:${turn.transcript.length}:${turn.transcript}`
    );
    if (context) {
        parts.push(`locale:${context.locale ?? ""}`);
        if (context.project) parts.push(`project:${JSON.stringify(context.project)}`);
    }
    return createHash("sha256").update(parts.join("\n")).digest("hex");
}

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
        nomor: string;
        status: DocumentStatus;
        data_json: QuotationDocument;
        pdf_path?: string | null;
        sent_to?: string | null;
        sent_at?: Date | null;
        created_at: Date;
    }): StoredDocument {
        return {
            id: row.id,
            sessionId: row.session_id,
            nomor: row.nomor,
            status: row.status,
            createdAt: row.created_at,
            document: row.data_json,
            pdfPath: row.pdf_path ?? null,
            sentTo: row.sent_to ?? null,
            sentAt: row.sent_at
                ? row.sent_at instanceof Date
                    ? row.sent_at
                    : new Date(row.sent_at)
                : null,
        };
    }

    return {
        async findByIdempotencyKey(sessionId, turnsHash) {
            const result = await pool.query(
                `select id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at
                 from documents
                 where session_id = $1
                   and turns_hash = $2
                   and (created_at at time zone 'UTC')::date
                       = (now() at time zone 'UTC')::date
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
                await client.query("select pg_advisory_xact_lock(hashtext($1))", [
                    input.sessionId,
                ]);
                const existing = await client.query(
                    `select id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at
                     from documents
                     where session_id = $1
                       and turns_hash = $2
                       and (created_at at time zone 'UTC')::date
                           = (now() at time zone 'UTC')::date
                     limit 1`,
                    [input.sessionId, input.turnsHash]
                );
                if ((existing.rowCount ?? 0) > 0) {
                    await client.query("commit");
                    return toStored(existing.rows[0]);
                }
                const result = await client.query(
                    `insert into documents (session_id, locale, nomor, status, turns_hash, data_json)
                     values ($1, $2, $3, $4, $5, $6)
                     returning id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at`,
                    [
                        input.sessionId,
                        input.locale,
                        input.nomor,
                        input.document.butuh_konfirmasi.length > 0
                            ? "perlu_konfirmasi"
                            : "siap",
                        input.turnsHash,
                        JSON.stringify(input.document),
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
                `select id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at
                 from documents where id = $1::uuid`,
                [id]
            );
            if (result.rowCount === 0) return null;
            return toStored(result.rows[0]);
        },

        async update(id, transform) {
            if (!UUID_RE.test(id)) return null;
            const client = await pool.connect();
            let clientReleased = false;
            try {
                await client.query("begin");
                // Serializes overlapping PATCHes on this document: the second
                // one reads the first one's committed payload, so its recomputed
                // totals build on the corrected numbers instead of overwriting.
                const locked = await client.query(
                    `select id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at
                     from documents where id = $1::uuid for update`,
                    [id]
                );
                if (locked.rowCount === 0) {
                    await client.query("rollback");
                    return null;
                }
                const stored = toStored(locked.rows[0]);
                const updated = transform(stored.document);
                const nextStatus: DocumentStatus =
                    updated.butuh_konfirmasi.length > 0
                        ? "perlu_konfirmasi"
                        : "siap";
                // A PATCH edits the payload, so any previously sent version no
                // longer exists. The send record is cleared so a document never
                // carries a sent record for a version that was never sent; a
                // fresh send (via markSent) sets it again.
                const result = await client.query(
                    `update documents
                     set data_json = $2,
                         status = $3,
                         sent_to = $4,
                         sent_at = $5,
                         updated_at = now()
                     where id = $1::uuid
                     returning id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at`,
                    [
                        id,
                        JSON.stringify(updated),
                        nextStatus,
                        null,
                        null,
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

        async markSent(id, sentTo, contentHash) {
            if (!UUID_RE.test(id)) {
                return { ok: false, reason: "not_found" };
            }
            const client = await pool.connect();
            let clientReleased = false;
            try {
                await client.query("begin");
                const locked = await client.query(
                    `select id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at
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
                     returning id, session_id, nomor, status, data_json, pdf_path, sent_to, sent_at, created_at`,
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
