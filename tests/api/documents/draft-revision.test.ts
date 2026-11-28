import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDocumentStore } from "@/lib/server/db/documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";

const url = process.env.ASR_TEST_DATABASE_URL;
describe.skipIf(!url)("draft revision and replay", () => {
    const sessionId = `draft-revision-${randomUUID()}`;
    let pool: Pool;
    let store: ReturnType<typeof createPostgresDocumentStore>;
    beforeAll(async () => {
        pool = new Pool({ connectionString: url });
        await pool.query("insert into sessions(id,locale,audio_sha256,audio_bytes,transcript) values($1,'id','fixture',1,'')", [sessionId]);
        store = createPostgresDocumentStore(url!);
    });
    afterAll(async () => {
        if (pool) {
            await pool.query("delete from sessions where id=$1", [sessionId]);
            await pool.end();
        }
    });
    it("replays a completed mutation and rejects a stale revision without changing the draft", async () => {
        const document: QuotationDocument = {
            jenis: "surat_penawaran", locale: "id", mata_uang: "IDR", nomor: null, tanggal: "2026-11-28",
            proyek: { nama: "Fixture", lokasi: "Location", klien: "Client" },
            pekerjaan: [{ uraian: "Item", volume: 1, satuan: "unit", harga_satuan: 5, jumlah: 5, sumber_kutipan: "manual" }],
            total_nominal: 5, terbilang: "lima rupiah", butuh_konfirmasi: [],
        };
        const created = await store.create({ sessionId, locale: "id", turnsHash: "fixture", document });
        expect(created.draftRevision).toBe(1);
        const options = { revision: 1, actorId: "fixture", key: "first", fingerprint: "first" };
        const transform = (doc: QuotationDocument) => ({ ...doc, proyek: { ...doc.proyek, nama: "Updated" } });
        const first = await store.update(created.id, transform, options);
        expect(first?.draftRevision).toBe(2);
        const replay = await store.update(created.id, transform, options);
        expect(replay).toEqual(first);
        await expect(store.update(created.id, transform, { ...options, key: "second" })).rejects.toMatchObject({ code: "stale_revision", revision: 2 });
        await expect(store.update(created.id, transform, { ...options, fingerprint: "different" })).rejects.toMatchObject({ code: "idempotency_conflict" });
        expect((await store.get(created.id))?.draftRevision).toBe(2);
    });
});
