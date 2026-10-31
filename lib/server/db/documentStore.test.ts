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
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
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
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
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

    it("rejects a session that does not exist", async () => {
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
        await expect(store.create(input("no-such-session", doc()))).rejects.toThrow();
    });

    it("reuses the same document for an identical create on the same day", async () => {
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
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

    it("rejects a second document for the same session, hash, and day", async () => {
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
        await seedSession("s-unique");
        const hash = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }]);
        await store.create(input("s-unique", doc(), hash));
        await expect(store.create(input("s-unique", doc(), hash))).rejects.toThrow();
    });

    it("persists a patch and recomputes the status", async () => {
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
        await seedSession("s-patch");
        const created = await store.create(input("s-patch", doc()));
        const patched = await store.update(created.id, doc({
            pekerjaan: [
                {
                    uraian: "Pemasangan hebel",
                    volume: 20,
                    satuan: "m2",
                    harga_satuan: 50000,
                    jumlah: 1000000,
                    sumber_kutipan: "turn_1",
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
        const store = createPostgresDocumentStore(TEST_DATABASE_URL!);
        await seedSession("s-404");
        const created = await store.create(input("s-404", doc()));

        expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
        expect(await store.get("not-a-uuid")).toBeNull();

        const patched = await store.update("00000000-0000-0000-0000-000000000000", doc());
        expect(patched).toBeNull();

        await store.update(created.id, doc({ butuh_konfirmasi: [] }));
    });

    it("turnsHashOf separates turns that differ only in timing or text", async () => {
        const base = [{ startMs: 0, endMs: 500, transcript: "pagar" }];
        const same = turnsHashOf(base);
        expect(turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }])).toBe(same);
        expect(
            turnsHashOf([{ startMs: 0, endMs: 600, transcript: "pagar" }])
        ).not.toBe(same);
        expect(
            turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar besi" }])
        ).not.toBe(same);
    });
});
