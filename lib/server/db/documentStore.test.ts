import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
    createPostgresDocumentStore,
    turnsHashOf,
    type CreateDocumentInput,
} from "./documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";

/**
 * The migration and the document queries against a real Postgres, the same way
 * store.test.ts exercises the turns store. Point `ASR_TEST_DATABASE_URL` at a
 * throwaway database; it truncates the tables it owns.
 */

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

function doc(overrides?: Partial<QuotationDocument>): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: "SL/QTN/2026-10-31/001",
        tanggal: "2026-10-31",
        proyek: { nama: "Renovasi", lokasi: "Sleman", klien: "Pak Budi" },
        pekerjaan: [
            {
                uraian: "Pemasangan hebel",
                volume: 10,
                satuan: "m2",
                harga_satuan: 50000,
                jumlah: 500000,
                sumber_kutipan: "turn_1",
            },
        ],
        total_nominal: 500000,
        terbilang: "Lima ratus ribu rupiah",
        butuh_konfirmasi: [],
        ...overrides,
    };
}

function input(
    sessionId: string,
    document: QuotationDocument,
    turnsHash = turnsHashOf([
        { startMs: 0, endMs: 500, transcript: "pagar" },
    ])
): CreateDocumentInput {
    return { sessionId, locale: document.locale, nomor: document.nomor, turnsHash, document };
}

describe.skipIf(!TEST_DATABASE_URL)("postgres documents store", () => {
    let pool: Pool;
    let store: ReturnType<typeof createPostgresDocumentStore>;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        const migrations = await import("node:fs/promises").then(async (fs) => {
            const dir = "db/migrations";
            const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
            return Promise.all(files.map((f) => fs.readFile(`${dir}/${f}`, "utf8")));
        });
        for (const sql of migrations) {
            await pool.query(sql);
        }
        store = createPostgresDocumentStore(TEST_DATABASE_URL!);
        await pool.query("truncate documents, sessions cascade");
    });

    beforeEach(async () => {
        await pool.query("truncate documents, sessions cascade");
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seedSession(sessionId: string) {
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ($1, 'id', 'sha', 1, '')",
            [sessionId]
        );
    }

    it("round-trips create and get, deriving status from butuh_konfirmasi", async () => {
        await seedSession("s-create");

        const created = await store.create(
            input("s-create", doc({ butuh_konfirmasi: [] }))
        );
        expect(created.status).toBe("siap");
        expect(created.document.total_nominal).toBe(500000);

        const fetched = await store.get(created.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.document).toEqual(created.document);
        expect(fetched!.sessionId).toBe("s-create");
    });

    it("maps a payload with open confirmations to perlu_konfirmasi", async () => {
        await seedSession("s-confirm");
        const created = await store.create(
            input(
                "s-confirm",
                doc({
                    butuh_konfirmasi: [
                        { field: "pekerjaan[0].volume", alasan: "a", sumber_kutipan: null },
                    ],
                })
            )
        );
        expect(created.status).toBe("perlu_konfirmasi");
    });

    it("rejects a session that does not exist with the FK violation code", async () => {
        await expect(store.create(input("no-such-session", doc()))).rejects.toMatchObject({
            code: "23503",
        });
    });

    it("reuses the same document for an identical create on the same day", async () => {
        await seedSession("s-idem");
        const hash = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }]);

        const first = await store.create(input("s-idem", doc(), hash));
        const found = await store.findByIdempotencyKey("s-idem", hash);
        expect(found).not.toBeNull();
        expect(found!.id).toBe(first.id);

        // A different fingerprint must not resolve to the first document.
        const otherHash = turnsHashOf([
            { startMs: 0, endMs: 900, transcript: "pagar besi" },
        ]);
        const second = await store.create(input("s-idem", doc({ nomor: "SL/QTN/2026-10-31/002" }), otherHash));
        expect(second.id).not.toBe(first.id);
        expect(await store.findByIdempotencyKey("s-idem", otherHash))!.toMatchObject({ id: second.id });
    });

    it("creates a distinct document when the same session+hash repeats the next day", async () => {
        await seedSession("s-nextday");
        const hash = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }]);
        const first = await store.create(input("s-nextday", doc(), hash));

        // Backdate the first document out of today so the unique index no longer
        // sees it (the calendar day of created_at is what scopes the reuse).
        await pool.query(
            "update documents set created_at = now() - interval '1 day', updated_at = now() - interval '1 day' where id = $1",
            [first.id]
        );

        const second = await store.create(input("s-nextday", doc(), hash));
        expect(second.id).not.toBe(first.id);
        expect(
            await store.findByIdempotencyKey("s-nextday", hash)
        ).toMatchObject({ id: second.id });
    });

    it("converges on one document for a second create with the same session, hash, and day", async () => {
        await seedSession("s-unique");
        const hash = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }]);
        const first = await store.create(input("s-unique", doc(), hash));
        // The create path re-checks inside its per-session lock, so a second
        // identical create converges on the first document instead of a 500.
        const second = await store.create(input("s-unique", doc(), hash));
        expect(second.id).toBe(first.id);
        const rows = await pool.query(
            "select count(*)::int as n from documents where session_id = 's-unique'"
        );
        expect(rows.rows[0].n).toBe(1);
    });

    it("concurrent identical creates converge on one document", async () => {
        await seedSession("s-race");
        const hash = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }]);
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                store.create(input("s-race", doc(), hash))
            )
        );
        const ids = new Set(results.map((r) => r.id));
        expect(ids.size).toBe(1);
        const rows = await pool.query(
            "select count(*)::int as n from documents where session_id = 's-race'"
        );
        expect(rows.rows[0].n).toBe(1);
    }, 30000);

    it("persists a patch and recomputes the status", async () => {
        await seedSession("s-patch");
        const created = await store.create(input("s-patch", doc()));
        const patched = await store.update(created.id, (document) => ({
            ...document,
            pekerjaan: [
                {
                    ...document.pekerjaan[0],
                    volume: 20,
                    jumlah: 1000000,
                },
            ],
            total_nominal: 1000000,
            terbilang: "Satu juta rupiah",
        }));

        expect(patched!.document.pekerjaan[0].volume).toBe(20);
        expect(patched!.status).toBe("siap");

        const reread = await store.get(created.id);
        expect(reread!.document.total_nominal).toBe(1000000);
    });

    it("get and update answer null for unknown or malformed ids", async () => {

        expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
        expect(await store.get("not-a-uuid")).toBeNull();

        const patched = await store.update(
            "00000000-0000-0000-0000-000000000000",
            (document) => document
        );
        expect(patched).toBeNull();
    });


});

 describe("turnsHashOf", () => {
    it("separates turns that differ only in timing or text", () => {
        const base = [{ startMs: 0, endMs: 500, transcript: "pagar" }];
        const same = turnsHashOf(base);
        expect(turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }])).toBe(same);
        expect(
            turnsHashOf([{ startMs: 0, endMs: 600, transcript: "pagar" }])
        ).not.toBe(same);
        expect(
            turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar besi" }])
        ).not.toBe(same);
        // A transcript containing the separator cannot alias a different sequence.
        expect(
            turnsHashOf([
                { startMs: 0, endMs: 1, transcript: "a" },
                { startMs: 2, endMs: 3, transcript: "b" },
            ])
        ).not.toBe(
            turnsHashOf([{ startMs: 0, endMs: 1, transcript: "a\n2:3:1:b" }])
        );
        // Same turns, different locale or project → different fingerprint.
        expect(turnsHashOf(base, { locale: "en" })).not.toBe(same);
        expect(
            turnsHashOf(base, {
                project: { nama: "X", lokasi: "Y", klien: "Z" },
            })
        ).not.toBe(same);
    });
});
