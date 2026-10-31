import { Pool, type PoolClient } from "pg";

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
 * The upsert is a single statement, so Postgres takes the row lock on
 * `document_sequences.year` for its duration and concurrent callers serialize
 * on it: each committed allocation returns a distinct `last_number`. It runs
 * in autocommit, decoupled from the document insert — a failed insert burns
 * the number instead of handing it back, so a number is never reused.
 * Year rollover is implicit: a year with no row lands on the insert branch
 * and yields 1.
 */
export async function allocateDocumentNumber(
    db: Pool | PoolClient,
    year: number
): Promise<string> {
    const result = await db.query<{ last_number: number }>(
        `insert into document_sequences (year, last_number)
         values ($1, 1)
         on conflict (year) do update
             set last_number = document_sequences.last_number + 1
         returning last_number`,
        [year]
    );
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
    }
    return shared;
}

export function resetDocumentNumberPoolForTesting(): void {
    shared = null;
}
