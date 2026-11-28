import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresDocumentStore } from "@/lib/server/db/documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";

const url = process.env.ASR_TEST_DATABASE_URL;
vi.mock("@/lib/server/auth", () => ({
    getSession: async () => ({ user: { id: "fixture", role: "admin" } }),
    canAccessDocument: () => true,
}));
import { GET, PATCH } from "@/app/api/documents/[id]/route";
if (url) process.env.DATABASE_URL = url;
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
    it("requires revision and key and updates a server-issued item ID atomically", async () => {
        const document: QuotationDocument = {
            jenis: "surat_penawaran", locale: "id", mata_uang: "IDR", nomor: null, tanggal: "2026-11-28",
            proyek: { nama: "Fixture", lokasi: "Location", klien: "Client" },
            pekerjaan: [{ uraian: "Item", volume: 1, satuan: "unit", harga_satuan: 5, jumlah: 5, sumber_kutipan: "manual" }],
            total_nominal: 5, terbilang: "lima rupiah", butuh_konfirmasi: [],
        };
        const created = await store.create({ sessionId, locale: "id", turnsHash: "route-fixture", document });
        const context = { params: Promise.resolve({ id: created.id }) };
        const url = `http://localhost/api/documents/${created.id}`;
        const get = async () => (await GET(new Request(url), context)).json();
        const patch = (body: unknown, key?: string) => PATCH(new Request(url, {
            method: "PATCH", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body),
        }), context);
        const before = await get();
        expect(before.draft_revision).toBe(1);
        const itemId = before.document.pekerjaan[0].id;
        expect(itemId).toMatch(/^[a-f0-9-]{36}$/);
        expect((await get()).document.pekerjaan[0].id).toBe(itemId);
        expect((await patch({ field: "pekerjaan[0].volume", nilai: 2 })).status).toBe(400);
        const body = { op: "update_line", item_id: itemId, changes: { volume: 2, harga_satuan: 7 }, draft_revision: 1 };
        const result = await patch(body, "atomic");
        expect(result.status).toBe(200);
        const changed = await result.json();
        expect(changed.draft_revision).toBe(2);
        expect(changed.document.pekerjaan[0]).toMatchObject({ id: itemId, volume: 2, harga_satuan: 7, jumlah: 14 });
        expect(await (await patch(body, "atomic")).json()).toEqual(changed);
        expect((await patch({ ...body, changes: { volume: 3 } }, "atomic")).status).toBe(409);
        const stale = await patch({ ...body, changes: { volume: 4 } }, "stale");
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({ error: "stale_revision", draft_revision: 2 });
        expect((await get()).document.pekerjaan[0].volume).toBe(2);
    });
});
