import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
    allocateDocumentNumber,
    formatDocumentNumber,
} from "./documentNumber";

/**
 * The allocator against a real Postgres, the same way store.test.ts and
 * documentStore.test.ts run. Point `ASR_TEST_DATABASE_URL` at a throwaway
 * database; it truncates the tables it owns.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;
const YEAR = new Date().getFullYear();

describe.skipIf(!TEST_DATABASE_URL)("document number allocator", () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
        ]) {
            const sql = await import("node:fs/promises").then((fs) =>
                fs.readFile(`db/migrations/${file}`, "utf8")
            );
            await pool.query(sql);
        }
    });

    beforeEach(async () => {
        await pool.query("truncate document_sequences, documents, sessions cascade");
    });

    afterAll(async () => {
        await pool.end();
    });

    it("formats the first number of a year as SL/QTN/<year>/0001", async () => {
        expect(formatDocumentNumber(YEAR, 1)).toBe(`SL/QTN/${YEAR}/0001`);
        const nomor = await allocateDocumentNumber(pool, YEAR);
        expect(nomor).toBe(`SL/QTN/${YEAR}/0001`);
        expect(() => formatDocumentNumber(YEAR, 0)).toThrow();
        expect(() => formatDocumentNumber(YEAR, 10000)).toThrow();
    });

    it("increments sequentially within a year", async () => {
        const first = await allocateDocumentNumber(pool, YEAR);
        const second = await allocateDocumentNumber(pool, YEAR);
        expect(first).toBe(`SL/QTN/${YEAR}/0001`);
        expect(second).toBe(`SL/QTN/${YEAR}/0002`);
    });

    it("resets a year with no row to 0001 and continues from an injected row", async () => {
        const fresh = await allocateDocumentNumber(pool, YEAR);
        expect(fresh).toBe(`SL/QTN/${YEAR}/0001`);

        await pool.query("delete from document_sequences where year = $1", [YEAR]);
        await pool.query(
            "insert into document_sequences (year, last_number) values ($1, 41)",
            [YEAR]
        );
        const next = await allocateDocumentNumber(pool, YEAR);
        expect(next).toBe(`SL/QTN/${YEAR}/0042`);
    });

    it("gives five concurrent allocations five distinct numbers", async () => {
        const numbers = await Promise.all(
            Array.from({ length: 5 }, () => allocateDocumentNumber(pool, YEAR))
        );
        expect(new Set(numbers).size).toBe(5);
        expect(numbers.sort()).toEqual([
            `SL/QTN/${YEAR}/0001`,
            `SL/QTN/${YEAR}/0002`,
            `SL/QTN/${YEAR}/0003`,
            `SL/QTN/${YEAR}/0004`,
            `SL/QTN/${YEAR}/0005`,
        ]);
    });

    it("never reuses a number whose document insert failed after allocation", async () => {
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('s-burn', 'id', 'sha', 1, '')"
        );
        const burned = await allocateDocumentNumber(pool, YEAR);
        // The document insert carrying the number fails (session foreign key
        // violated); the allocation has already committed, so the number is
        // burned rather than handed back.
        await expect(
            pool.query(
                "insert into documents (session_id, locale, nomor, turns_hash, data_json) values ('s-burn-nonexistent', 'id', $1, 'h', '{}'::jsonb)",
                [burned]
            )
        ).rejects.toThrow();
        const later = await allocateDocumentNumber(pool, YEAR);
        expect(later).not.toBe(burned);
        expect(later).toBe(`SL/QTN/${YEAR}/0002`);
    });

    it("rejects two documents carrying the same nomor", async () => {
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('s-uniq', 'id', 'sha', 1, '')"
        );
        const nomor = await allocateDocumentNumber(pool, YEAR);
        // Different session ids and turns hashes, so the idempotency index on
        // (session, hash, day) cannot fire and the duplicate nomor itself must
        // be what the unique index rejects.
        const insert = (sessionId: string, hash: string) =>
            `insert into documents (session_id, locale, nomor, turns_hash, data_json)
             values ('${sessionId}', 'id', $1, '${hash}', '{}'::jsonb)`;
        await pool.query(insert("s-uniq", "h1"), [nomor]);
        await expect(pool.query(insert("s-uniq-2", "h2"), [nomor])).rejects.toThrow();
    });
});
