import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
    allocateDocumentNumber,
    formatDocumentNumber,
} from "./documentNumber";

/**
 * The allocator and the 0003 renumber migration against a real Postgres, the
 * same way store.test.ts and documentStore.test.ts run. Point
 * `ASR_TEST_DATABASE_URL` at a throwaway database; it truncates the tables
 * it owns.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;
const YEAR = new Date().getFullYear();
const MIGRATION_SQL = await readFile("db/migrations/0003_documents.sql", "utf8");

async function applyMigration(pool: Pool): Promise<void> {
    await pool.query(MIGRATION_SQL);
}

async function seedSession(pool: Pool, sessionId: string): Promise<void> {
    await pool.query(
        "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ($1, 'id', 'sha', 1, '')",
        [sessionId]
    );
}

async function seedLegacyDocument(
    pool: Pool,
    sessionId: string,
    nomor: string,
    createdAt: string,
    turnsHash = "h"
): Promise<void> {
    await pool.query(
        `insert into documents (session_id, locale, nomor, turns_hash, data_json, created_at)
         values ($1::text, 'id', $2::text, $3::text, jsonb_build_object('nomor', $2::text, 'jenis', 'surat_penawaran'), $4::timestamptz)`,
        [sessionId, nomor, turnsHash, createdAt]
    );
}

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
        expect(() => formatDocumentNumber(999, 1)).toThrow();
        // An invalid year is rejected before the sequence row is touched.
        await expect(allocateDocumentNumber(pool, 999)).rejects.toThrow();
        const rows = await pool.query(
            "select count(*)::int as n from document_sequences where year = 999"
        );
        expect(rows.rows[0].n).toBe(0);
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
        // Both sessions exist, so the second insert reaches documents_nomor_uidx
        // and the unique index (not a foreign key) must be what rejects it.
        for (const sessionId of ["s-uniq", "s-uniq-2"]) {
            await pool.query(
                "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ($1, 'id', 'sha', 1, '')",
                [sessionId]
            );
        }
        const nomor = await allocateDocumentNumber(pool, YEAR);
        // Different session ids and turns hashes, so the idempotency index on
        // (session, hash, day) cannot fire either.
        const insert = (sessionId: string, hash: string) =>
            `insert into documents (session_id, locale, nomor, turns_hash, data_json)
             values ('${sessionId}', 'id', $1, '${hash}', '{}'::jsonb)`;
        await pool.query(insert("s-uniq", "h1"), [nomor]);
        await expect(
            pool.query(insert("s-uniq-2", "h2"), [nomor])
        ).rejects.toMatchObject({ code: "23505" });
    });

    it("fails cleanly and keeps the year allocatable when the sequence is exhausted", async () => {
        await pool.query(
            "insert into document_sequences (year, last_number) values ($1, 9999)",
            [YEAR]
        );
        await expect(allocateDocumentNumber(pool, YEAR)).rejects.toThrow(
            /exhausted/
        );
        const rows = await pool.query(
            "select last_number from document_sequences where year = $1",
            [YEAR]
        );
        expect(rows.rows[0].last_number).toBe(9999);

        // The same year is not poisoned: rolling back to 9998 (as a renumber
        // or manual correction would) makes it allocatable again.
        await pool.query(
            "update document_sequences set last_number = 9998 where year = $1",
            [YEAR]
        );
        expect(await allocateDocumentNumber(pool, YEAR)).toBe(
            `SL/QTN/${YEAR}/9999`
        );
        await expect(allocateDocumentNumber(pool, YEAR)).rejects.toThrow(
            /exhausted/
        );
    });
});

describe.skipIf(!TEST_DATABASE_URL)("0003 renumber migration", () => {
    let pool: Pool;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        // Self-sufficient setup: this suite must pass when selected alone, so
        // it applies the prerequisite migrations itself instead of relying on
        // the allocator describe's hooks having run first.
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
        ]) {
            await pool.query(await readFile(`db/migrations/${file}`, "utf8"));
        }
    });

    beforeEach(async () => {
        await pool.query(
            "truncate documents, document_sequences, sessions cascade"
        );
        await pool.query("drop index if exists documents_nomor_uidx");
    });

    afterAll(async () => {
        // The refusal tests leave dirty rows behind on purpose. Clear them so
        // another test file's beforeAll can run the migration cleanly.
        await pool.query(
            "truncate documents, document_sequences, sessions cascade"
        );
        await pool.query("drop index if exists documents_nomor_uidx");
        await pool.end();
    });

    it("renumbers duplicates oldest-first, continuing after issued numbers, in both column and payload", async () => {
        await seedSession(pool, "s1");
        await seedSession(pool, "s2");
        await seedSession(pool, "s3");
        // SL/QTN/2026/0001 and /0003 already issued; 2026 also has an issued
        // 0009. Two legacy duplicates from 2026 and one legacy row from 2025,
        // where 2025/0004 was already issued.
        await pool.query(
            `insert into documents (session_id, locale, nomor, turns_hash, data_json, created_at) values
             ('s1', 'id', 'SL/QTN/2026/0001', 'a', '{"nomor":"SL/QTN/2026/0001"}', '2026-10-29 08:00+00'),
             ('s2', 'id', 'SL/QTN/2026/0003', 'b', '{"nomor":"SL/QTN/2026/0003"}', '2026-10-29 09:00+00'),
             ('s1', 'id', 'SL/QTN/2026/0009', 'f', '{"nomor":"SL/QTN/2026/0009"}', '2026-10-30 08:00+00'),
             ('s3', 'id', 'SL/QTN/2026-10-29/001', 'c', '{"nomor":"SL/QTN/2026-10-29/001"}', '2026-10-29 10:00+00'),
             ('s1', 'id', 'SL/QTN/2026-11-02/001', 'd', '{"nomor":"SL/QTN/2026-11-02/001"}', '2026-11-02 10:00+00'),
             ('s2', 'id', 'SL/QTN/2025-12-31/009', 'e', '{"nomor":"SL/QTN/2025-12-31/009"}', '2025-12-31 09:00+00'),
             ('s2', 'id', 'SL/QTN/2025/0004', 'g', '{"nomor":"SL/QTN/2025/0004"}', '2025-12-30 09:00+00')`
        );

        await applyMigration(pool);

        const rows = await pool.query(
            "select nomor, data_json->>'nomor' as payload_nomor, created_at from documents order by nomor"
        );
        expect(rows.rows.map((r) => r.nomor)).toEqual([
            "SL/QTN/2025/0004",
            "SL/QTN/2025/0005",
            "SL/QTN/2026/0001",
            "SL/QTN/2026/0003",
            "SL/QTN/2026/0009",
            "SL/QTN/2026/0010",
            "SL/QTN/2026/0011",
        ]);
        // The API reads the number from data_json; it must move with the column.
        for (const row of rows.rows) {
            expect(row.payload_nomor).toBe(row.nomor);
        }
        // Oldest-first within the year: the 10-29 legacy row precedes 11-02.
        expect(
            rows.rows.find((r) => r.nomor === "SL/QTN/2026/0010").created_at
        ).toEqual(new Date("2026-10-29T10:00:00.000Z"));

        // The allocator resumes past everything now in the table.
        expect(await allocateDocumentNumber(pool, 2026)).toBe(
            "SL/QTN/2026/0012"
        );
        expect(await allocateDocumentNumber(pool, 2025)).toBe(
            "SL/QTN/2025/0006"
        );
    });

    it("reruns as a no-op on an already-migrated database", async () => {
        await seedSession(pool, "s1");
        await seedLegacyDocument(
            pool,
            "s1",
            "SL/QTN/2026-10-29/001",
            "2026-10-29 10:00+00"
        );
        await applyMigration(pool);
        const after = await pool.query(
            "select nomor from documents order by nomor"
        );
        await applyMigration(pool);
        const again = await pool.query(
            "select nomor from documents order by nomor"
        );
        expect(again.rows).toEqual(after.rows);
        expect(again.rows.map((r) => r.nomor)).toEqual(["SL/QTN/2026/0001"]);
    });

    it("refuses to renumber past 9999 when the year's sequence cannot fit the pending rows", async () => {
        await seedSession(pool, "s1");
        await seedSession(pool, "s2");
        await seedLegacyDocument(
            pool,
            "s2",
            `SL/QTN/${YEAR}-10-29/001`,
            `${YEAR}-10-29 10:00+00`,
            "b"
        );
        await seedSession(pool, "s3");
        await pool.query(
            `insert into documents (session_id, locale, nomor, turns_hash, data_json)
             values ('s3', 'id', $1::text, 'a', '{}'::jsonb)`,
            [`SL/QTN/${YEAR}/9999`]
        );

        await expect(applyMigration(pool)).rejects.toThrow(
            /exceed sequence 9999/
        );
        // Data left untouched: the legacy row keeps its old number.
        const rows = await pool.query(
            "select nomor from documents order by nomor"
        );
        // Lexical order: '-' (0x2d) sorts before '/' (0x2f), so the legacy
        // date-form nomor comes first.
        expect(rows.rows.map((r) => r.nomor)).toEqual([
            `SL/QTN/${YEAR}-10-29/001`,
            `SL/QTN/${YEAR}/9999`,
        ]);
        const index = await pool.query(
            "select 1 from pg_indexes where indexname = 'documents_nomor_uidx'"
        );
        expect(index.rowCount).toBe(0);
    });

    it("refuses a legacy nomor whose year is below 1000", async () => {
        await seedSession(pool, "s1");
        await seedLegacyDocument(
            pool,
            "s1",
            "SL/QTN/0999-05-05/001",
            "0999-05-05 10:00+00"
        );
        await expect(applyMigration(pool)).rejects.toThrow(
            /year below 1000/
        );
        const rows = await pool.query("select nomor from documents");
        expect(rows.rows[0].nomor).toBe("SL/QTN/0999-05-05/001");
    });
});
