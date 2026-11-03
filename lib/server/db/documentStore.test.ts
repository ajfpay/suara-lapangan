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
        nomor: null,
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
    return { sessionId, locale: document.locale, turnsHash, document };
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
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values
               ('00000000-0000-0000-0000-000000000001','test1@suara-lapangan.local',true,'Test User 1','user'),
               ('00000000-0000-0000-0000-000000000002','test2@suara-lapangan.local',true,'Test User 2','user')
             on conflict (id) do nothing`
        );
        store = createPostgresDocumentStore(TEST_DATABASE_URL!);
        await pool.query("truncate documents, sessions, document_sequences cascade");
    });

    beforeEach(async () => {
        await pool.query("truncate documents, sessions, document_sequences cascade");
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

    it("creates a draft with status='draf', nomor=null, version=1, and root_id=id", async () => {
        await seedSession("s-create");

        const created = await store.create(
            input("s-create", doc({ butuh_konfirmasi: [] }))
        );
        expect(created.status).toBe("draf");
        expect(created.nomor).toBeNull();
        expect(created.document.total_nominal).toBe(500000);

        const fetched = await store.get(created.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.status).toBe("draf");
        expect(fetched!.nomor).toBeNull();
        expect(fetched!.document).toEqual(created.document);
        expect(fetched!.sessionId).toBe("s-create");

        // Verify underlying database columns: status, nomor, version, root_id
        const row = await pool.query(
            "select status, nomor, version, root_id from documents where id = $1::uuid",
            [created.id]
        );
        expect(row.rowCount).toBe(1);
        expect(row.rows[0].status).toBe("draf");
        expect(row.rows[0].nomor).toBeNull();
        expect(row.rows[0].version).toBe(1);
        expect(row.rows[0].root_id).toBe(created.id);
    });

    it("stores status='draf' even when butuh_konfirmasi is not empty", async () => {
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
        expect(created.status).toBe("draf");
        expect(created.nomor).toBeNull();
    });

    it("normalizes legacy statuses on read: perlu_konfirmasi -> draf, siap -> disetujui", async () => {
        await seedSession("s-legacy");
        const hash1 = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "legacy 1" }]);
        const hash2 = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "legacy 2" }]);

        const res1 = await pool.query(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json)
             values ('s-legacy', 'id', 'SL/QTN/2026/0001', 'perlu_konfirmasi', $1, $2)
             returning id`,
            [hash1, JSON.stringify(doc({ nomor: "SL/QTN/2026/0001" }))]
        );
        const legacyId1 = res1.rows[0].id;

        const res2 = await pool.query(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json)
             values ('s-legacy', 'id', 'SL/QTN/2026/0002', 'siap', $1, $2)
             returning id`,
            [hash2, JSON.stringify(doc({ nomor: "SL/QTN/2026/0002" }))]
        );
        const legacyId2 = res2.rows[0].id;

        const fetched1 = await store.get(legacyId1);
        expect(fetched1).not.toBeNull();
        expect(fetched1!.status).toBe("draf");
        expect(fetched1!.nomor).toBe("SL/QTN/2026/0001");

        const fetched2 = await store.get(legacyId2);
        expect(fetched2).not.toBeNull();
        expect(fetched2!.status).toBe("disetujui");
        expect(fetched2!.nomor).toBe("SL/QTN/2026/0002");

        const foundByIdem1 = await store.findByIdempotencyKey("s-legacy", hash1);
        expect(foundByIdem1?.status).toBe("draf");

        const foundByIdem2 = await store.findByIdempotencyKey("s-legacy", hash2);
        expect(foundByIdem2?.status).toBe("disetujui");
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
        const second = await store.create(input("s-idem", doc({ nomor: "SL/QTN/2026/0002" }), otherHash));
        expect(second.id).not.toBe(first.id);
        expect(await store.findByIdempotencyKey("s-idem", otherHash))!.toMatchObject({ id: second.id });
    });

    it("creates a distinct document when the same session+hash repeats the next day", async () => {
        await seedSession("s-nextday");
        const hash = turnsHashOf([{ startMs: 0, endMs: 500, transcript: "pagar" }]);
        const first = await store.create(input("s-nextday", doc(), hash));

        // Backdate the first document out of today so the unique index no longer
        // sees it (the calendar day of created_at is what scopes the reuse), and
        // give it last year's nomor so documents_nomor_uidx cannot collide with
        // the second create's fixed SL/QTN/2026/0001 fixture number.
        await pool.query(
            "update documents set created_at = now() - interval '1 year', updated_at = now() - interval '1 year', nomor = 'SL/QTN/' || ((extract(year from now()))::int - 1)::text || '/0001' where id = $1",
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
        expect(patched!.status).toBe("disetujui");

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

    it("approve: rejects non-existent id with not_found", async () => {
        const res = await store.approve("00000000-0000-0000-0000-000000000000", "user-1");
        expect(res).toEqual({ ok: false, reason: "not_found" });
    });

    it("approve: rejects draft with open butuh_konfirmasi with needs_confirmation", async () => {
        await seedSession("s-approve-confirm");
        const created = await store.create(
            input(
                "s-approve-confirm",
                doc({
                    butuh_konfirmasi: [
                        { field: "pekerjaan[0].volume", alasan: "unclear", sumber_kutipan: null },
                    ],
                })
            )
        );
        const res = await store.approve(created.id, "user-1");
        expect(res).toEqual({ ok: false, reason: "needs_confirmation" });
    });

    it("approve: rejects non-draft status with invalid_state", async () => {
        await seedSession("s-approve-state");
        const created = await store.create(input("s-approve-state", doc()));
        // Force status to terkirim
        await pool.query("update documents set status = 'terkirim' where id = $1::uuid", [created.id]);
        const res = await store.approve(created.id, "user-1");
        expect(res).toMatchObject({ ok: false, reason: "invalid_state" });
    });

    it("approve: atomically allocates sequence number, sets status='disetujui', approved_at, approved_by", async () => {
        await seedSession("s-approve-happy");
        const created = await store.create(input("s-approve-happy", doc()));
        expect(created.status).toBe("draf");
        expect(created.nomor).toBeNull();

        const res = await store.approve(created.id, "00000000-0000-0000-0000-000000000001");
        expect(res.ok).toBe(true);
        if (!res.ok) return;

        const currentYear = new Date().getUTCFullYear();
        const expectedNomor = `SL/QTN/${currentYear}/0001`;
        expect(res.document.status).toBe("disetujui");
        expect(res.document.nomor).toBe(expectedNomor);
        expect(res.document.document.nomor).toBe(expectedNomor);
        expect(res.document.approvedBy).toBe("00000000-0000-0000-0000-000000000001");
        expect(res.document.approvedAt).toBeInstanceOf(Date);

        // Verify directly in DB
        const dbRow = await pool.query<{
            status: string;
            nomor: string;
            data_json: QuotationDocument;
            approved_by: string;
            approved_at: Date;
        }>(
            "select status, nomor, data_json, approved_by, approved_at from documents where id = $1::uuid",
            [created.id]
        );
        expect(dbRow.rows[0].status).toBe("disetujui");
        expect(dbRow.rows[0].nomor).toBe(expectedNomor);
        expect(dbRow.rows[0].data_json.nomor).toBe(expectedNomor);
        expect(dbRow.rows[0].approved_by).toBe("00000000-0000-0000-0000-000000000001");
        expect(dbRow.rows[0].approved_at).not.toBeNull();
    });

    it("approve: uses approval calendar year (UTC) for sequence allocation (Dec 2026 draft approved Jan 2027)", async () => {
        await seedSession("s-approve-year");
        const created = await store.create(input("s-approve-year", doc()));
        // Draft created in Dec 2026
        await pool.query(
            "update documents set created_at = '2026-12-25T12:00:00Z' where id = $1::uuid",
            [created.id]
        );

        // Approved with approval year 2027
        const res = await store.approve(created.id, "user-1", { approvalYear: 2027 });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.document.nomor).toBe("SL/QTN/2027/0001");
        expect(res.document.document.nomor).toBe("SL/QTN/2027/0001");
    });

    it("approve: idempotent re-approve returns existing document without allocating new sequence", async () => {
        await seedSession("s-approve-idem");
        const created = await store.create(input("s-approve-idem", doc()));
        const first = await store.approve(created.id, "user-1");
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const allocatedNomor = first.document.nomor;

        // Second approve call
        const second = await store.approve(created.id, "user-1");
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.document.nomor).toBe(allocatedNomor);

        // document_sequences last_number must remain 1
        const year = new Date().getUTCFullYear();
        const seqRow = await pool.query<{ last_number: number }>(
            "select last_number from document_sequences where year = $1",
            [year]
        );
        expect(seqRow.rows[0].last_number).toBe(1);
    });

    it("approve: concurrent approvals serialize and allocate exactly one sequence number", async () => {
        await seedSession("s-approve-race");
        const created = await store.create(input("s-approve-race", doc()));
        const results = await Promise.all([
            store.approve(created.id, "user-1"),
            store.approve(created.id, "user-1"),
            store.approve(created.id, "user-1"),
        ]);
        for (const res of results) {
            expect(res.ok).toBe(true);
        }
        const nomors = new Set(results.map((r) => (r.ok ? r.document.nomor : null)));
        expect(nomors.size).toBe(1);

        const year = new Date().getUTCFullYear();
        const seqRow = await pool.query<{ last_number: number }>(
            "select last_number from document_sequences where year = $1",
            [year]
        );
        expect(seqRow.rows[0].last_number).toBe(1);
    });

    it("setPdfPath: updates documents.pdf_path", async () => {
        await seedSession("s-pdf-path");
        const created = await store.create(input("s-pdf-path", doc()));
        await store.setPdfPath(created.id, `${created.id}.pdf`);
        const fetched = await store.get(created.id);
        expect(fetched?.pdfPath).toBe(`${created.id}.pdf`);
    });

    it("createVersion: rejects unapproved draft with invalid_state", async () => {
        await seedSession("s-ver-draft");
        const created = await store.create(input("s-ver-draft", doc()));
        const res = await store.createVersion(created.id);
        expect(res).toMatchObject({ ok: false, reason: "invalid_state" });
    });

    it("createVersion: creates version 2 with nomor=null, status='draf', sets parent superseded_by", async () => {
        await seedSession("s-ver-happy");
        const created = await store.create(input("s-ver-happy", doc()));
        // Add a field change to parent
        await store.update(created.id, (d) => ({
            document: d,
            fieldChanges: [
                {
                    field: "pekerjaan[0].volume",
                    original: 10,
                    current: 12,
                    changed_by: "user-1",
                    changed_at: "2026-11-01T00:00:00Z",
                },
            ],
        }));
        // Approve parent
        const approved = await store.approve(created.id, "user-1");
        expect(approved.ok).toBe(true);
        if (!approved.ok) return;

        const res = await store.createVersion(created.id);
        expect(res.ok).toBe(true);
        if (!res.ok) return;

        const v2 = res.document;
        expect(v2.id).not.toBe(created.id);
        expect(v2.version).toBe(2);
        expect(v2.rootId).toBe(created.id);
        expect(v2.parentId).toBe(created.id);
        expect(v2.nomor).toBeNull();
        expect(v2.status).toBe("draf");
        expect(v2.approvedAt).toBeNull();
        expect(v2.approvedBy).toBeNull();
        expect(v2.document.nomor).toBeNull();
        expect(v2.fieldChanges).toEqual(approved.document.fieldChanges);

        // Verify parent is updated with superseded_by
        const parentReread = await store.get(created.id);
        expect(parentReread?.supersededBy).toBe(v2.id);
        // Parent remains disetujui with original nomor
        expect(parentReread?.status).toBe("disetujui");
        expect(parentReread?.nomor).toBe(approved.document.nomor);
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
