import { Pool, type PoolClient } from "pg";

import { redactSecrets } from "@/lib/server/asr/log";

export const MAX_DOCUMENT_SEQUENCE = 9999;

export function formatDocumentNumber(year: number, sequence: number): string {
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        throw new Error(`document year ${year} is not a four-digit integer`);
    }
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
        throw new Error(
            `document sequence ${sequence} for year ${year} is outside 0001..9999`
        );
    }
    return `SL/QTN/${year}/${String(sequence).padStart(4, "0")}`;
}

/**
 * Allocates the next document number for a calendar year.
 *
 * The counter row is advanced by a single conditional UPDATE, so Postgres
 * takes the row lock for its duration and concurrent callers serialize on
 * it: each committed allocation returns a distinct `last_number`, and a
 * caller that waits on the lock re-evaluates the ceiling predicate against
 * the latest committed value instead of the one it read. Under the
 * review-before-pdf lifecycle (ticket 03), allocation is deferred to
 * document approval and executes within the approval database transaction on
 * a PoolClient, committing atomically with the status transition to
 * `disetujui`. If called on a standalone Pool, the UPDATE commits in autocommit.
 * Year rollover is implicit: a year with no row is seeded at 0 and the
 * first UPDATE yields 1.
 *
 * The ceiling is enforced by the predicate, not by checking after the
 * increment: an exhausted year returns a clear error and leaves
 * `last_number` at 9999, so the year fails cleanly instead of being
 * poisoned past the four-digit contract.
 */
export async function allocateDocumentNumber(
    db: Pool | PoolClient,
    year: number
): Promise<string> {
    formatDocumentNumber(year, 1);
    await db.query(
        `insert into document_sequences (year, last_number)
         values ($1, 0)
         on conflict (year) do nothing`,
        [year]
    );
    const result = await db.query<{ last_number: number }>(
        `update document_sequences
         set last_number = last_number + 1
         where year = $1 and last_number < $2
         returning last_number`,
        [year, MAX_DOCUMENT_SEQUENCE]
    );
    if (result.rowCount === 0) {
        throw new Error(
            `document number sequence for year ${year} is exhausted (${MAX_DOCUMENT_SEQUENCE} allocated)`
        );
    }
    return formatDocumentNumber(year, result.rows[0].last_number);
}

let shared: Pool | null = null;

/** Pool for the allocator, separate from the document store's own pool. */
export function getDocumentNumberPool(): Pool {
    if (!shared) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL is not set");
        }
        shared = new Pool({ connectionString });
        // Without a listener, pg emits 'error' on the pool for a background
        // idle client failure and Node crashes the process; log it through
        // redactSecrets and let the pool reconnect (same as documentStore).
        shared.on("error", (err) => {
            console.error(
                redactSecrets(`[documents] allocator pool error: ${String(err)}`)
            );
        });
    }
    return shared;
}

export function resetDocumentNumberPoolForTesting(): void {
    shared = null;
}
