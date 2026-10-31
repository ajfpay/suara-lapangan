import { createHash } from "node:crypto";

import { Pool } from "pg";

import type { DocumentStatus, QuotationDocument } from "@/lib/server/guard/types";

export type StoredDocument = {
    id: string;
    sessionId: string;
    nomor: string;
    status: DocumentStatus;
    createdAt: Date;
    document: QuotationDocument;
};

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
    /** Rewrites data_json and recomputes status from the payload's butuh_konfirmasi. */
    update(id: string, document: QuotationDocument): Promise<StoredDocument | null>;
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
    function toStored(row: {
        id: string;
        session_id: string;
        nomor: string;
        status: DocumentStatus;
        data_json: QuotationDocument;
        created_at: Date;
    }): StoredDocument {
        return {
            id: row.id,
            sessionId: row.session_id,
            nomor: row.nomor,
            status: row.status,
            createdAt: row.created_at,
            document: row.data_json,
        };
    }

    return {
        async findByIdempotencyKey(sessionId, turnsHash) {
            const result = await pool.query(
                `select id, session_id, nomor, status, data_json, created_at
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
            try {
                await client.query("begin");
                await client.query("select pg_advisory_xact_lock(hashtext($1))", [
                    input.sessionId,
                ]);
                const existing = await client.query(
                    `select id, session_id, nomor, status, data_json, created_at
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
                     returning id, session_id, nomor, status, data_json, created_at`,
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
                await client.query("rollback");
                throw cause;
            } finally {
                client.release();
            }
        },

        async get(id) {
            if (!UUID_RE.test(id)) return null;
            const result = await pool.query(
                `select id, session_id, nomor, status, data_json, created_at
                 from documents where id = $1::uuid`,
                [id]
            );
            if (result.rowCount === 0) return null;
            return toStored(result.rows[0]);
        },

        async update(id, document) {
            if (!UUID_RE.test(id)) return null;
            const result = await pool.query(
                `update documents
                 set data_json = $2,
                     status = $3,
                     updated_at = now()
                 where id = $1::uuid
                 returning id, session_id, nomor, status, data_json, created_at`,
                [
                    id,
                    JSON.stringify(document),
                    document.butuh_konfirmasi.length > 0
                        ? "perlu_konfirmasi"
                        : "siap",
                ]
            );
            if (result.rowCount === 0) return null;
            return toStored(result.rows[0]);
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
