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
        await pool.query(
            "insert into sessions(id,locale,audio_sha256,audio_bytes,transcript) values($1,'id','fixture',1,'')",
            [sessionId]
        );
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
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor: null,
            tanggal: "2026-11-28",
            proyek: { nama: "Fixture", lokasi: "Location", klien: "Client" },
            pekerjaan: [
                {
                    uraian: "Item",
                    volume: 1,
                    satuan: "unit",
                    harga_satuan: 5,
                    jumlah: 5,
                    sumber_kutipan: "manual",
                },
            ],
            total_nominal: 5,
            terbilang: "lima rupiah",
            butuh_konfirmasi: [],
        };
        const created = await store.create({
            sessionId,
            locale: "id",
            turnsHash: "fixture",
            document,
        });
        expect(created.draftRevision).toBe(1);
        const options = {
            revision: 1,
            actorId: "fixture",
            key: "first",
            fingerprint: "first",
        };
        const transform = (doc: QuotationDocument) => ({
            ...doc,
            proyek: { ...doc.proyek, nama: "Updated" },
        });
        const first = await store.update(created.id, transform, options);
        expect(first?.draftRevision).toBe(2);
        const replay = await store.update(created.id, transform, options);
        expect(replay).toEqual(first);
        await expect(
            store.update(created.id, transform, { ...options, key: "second" })
        ).rejects.toMatchObject({ code: "stale_revision", revision: 2 });
        await expect(
            store.update(created.id, transform, {
                ...options,
                fingerprint: "different",
            })
        ).rejects.toMatchObject({ code: "idempotency_conflict" });
        expect((await store.get(created.id))?.draftRevision).toBe(2);
    });
    it("requires revision and key and updates a server-issued item ID atomically", async () => {
        const document: QuotationDocument = {
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor: null,
            tanggal: "2026-11-28",
            proyek: { nama: "Fixture", lokasi: "Location", klien: "Client" },
            pekerjaan: [
                {
                    uraian: "Item",
                    volume: 1,
                    satuan: "unit",
                    harga_satuan: 5,
                    jumlah: 5,
                    sumber_kutipan: "manual",
                },
            ],
            total_nominal: 5,
            terbilang: "lima rupiah",
            butuh_konfirmasi: [],
        };
        const created = await store.create({
            sessionId,
            locale: "id",
            turnsHash: "route-fixture",
            document,
        });
        const context = { params: Promise.resolve({ id: created.id }) };
        const url = `http://localhost/api/documents/${created.id}`;
        const get = async () => (await GET(new Request(url), context)).json();
        const patch = (body: unknown, key?: string) =>
            PATCH(
                new Request(url, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        ...(key ? { "Idempotency-Key": key } : {}),
                    },
                    body: JSON.stringify(body),
                }),
                context
            );
        const before = await get();
        expect(before.draft_revision).toBe(1);
        const itemId = before.document.pekerjaan[0].id;
        expect(itemId).toMatch(/^[a-f0-9-]{36}$/);
        expect((await get()).document.pekerjaan[0].id).toBe(itemId);
        expect(
            (await patch({ field: "pekerjaan[0].volume", nilai: 2 })).status
        ).toBe(400);
        const body = {
            op: "update_line",
            item_id: itemId,
            changes: { volume: 2, harga_satuan: 7 },
            draft_revision: 1,
        };
        const result = await patch(body, "atomic");
        expect(result.status).toBe(200);
        const changed = await result.json();
        expect(changed.draft_revision).toBe(2);
        expect(changed.document.pekerjaan[0]).toMatchObject({
            id: itemId,
            volume: 2,
            harga_satuan: 7,
            jumlah: 14,
        });
        expect(await (await patch(body, "atomic")).json()).toEqual(changed);
        expect(
            (await patch({ ...body, changes: { volume: 3 } }, "atomic")).status
        ).toBe(409);
        const stale = await patch({ ...body, changes: { volume: 4 } }, "stale");
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({
            error: "stale_revision",
            draft_revision: 2,
        });
        expect((await get()).document.pekerjaan[0].volume).toBe(2);
    });
    it("preserves provenance through source changes, reorder and removal; rejects invalid source without losing confirmation", async () => {
        await pool.query(
            "insert into turns(session_id,turn_index,start_ms,end_ms,transcript,final) values($1,1,0,100,'Item',true),($1,2,100,200,'Item again',true),($1,3,200,300,'Unfinished',false)",
            [sessionId]
        );
        const document: QuotationDocument = {
            jenis: "surat_penawaran",
            locale: "id",
            mata_uang: "IDR",
            nomor: null,
            tanggal: "2026-11-28",
            proyek: { nama: "Fixture", lokasi: "Location", klien: "Client" },
            pekerjaan: [
                {
                    uraian: "Audio",
                    volume: 1,
                    satuan: "unit",
                    harga_satuan: 5,
                    jumlah: 5,
                    sumber_kutipan: "turn_1",
                },
                {
                    uraian: "Other",
                    volume: 1,
                    satuan: "unit",
                    harga_satuan: 2,
                    jumlah: 2,
                    sumber_kutipan: "manual",
                },
            ],
            total_nominal: 7,
            terbilang: "tujuh rupiah",
            butuh_konfirmasi: [
                {
                    field: "pekerjaan[0].sumber_kutipan",
                    alasan: "Check source",
                    sumber_kutipan: "turn_1",
                },
            ],
        };
        const created = await store.create({
            sessionId,
            locale: "id",
            turnsHash: "audit-fixture",
            document,
        });
        const context = { params: Promise.resolve({ id: created.id }) };
        const url = `http://localhost/api/documents/${created.id}`;
        const patch = (
            operation: object,
            revision: number,
            key = randomUUID()
        ) =>
            PATCH(
                new Request(url, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": key,
                    },
                    body: JSON.stringify({
                        ...operation,
                        draft_revision: revision,
                    }),
                }),
                context
            );
        const id = created.document.pekerjaan[0].id!;
        const bad = await patch(
            { field: " pekerjaan[0].sumber_kutipan ", nilai: " turn_999 " },
            1
        );
        expect(bad.status).toBe(400);
        expect(
            (await store.get(created.id))?.document.butuh_konfirmasi
        ).toHaveLength(1);
        const nonfinal = await patch({ field: "pekerjaan[0].sumber_kutipan", nilai: "turn_3" }, 1);
        expect(nonfinal.status).toBe(400);
        expect((await store.get(created.id))?.document.butuh_konfirmasi).toHaveLength(1);
        const manual = await patch(
            { field: " pekerjaan[0].sumber_kutipan ", nilai: " manual " },
            1
        );
        expect(manual.status).toBe(200);
        const edit = await patch(
            {
                op: "update_line",
                item_id: id,
                changes: { volume: 3, sumber_kutipan: " turn_2 " },
            },
            2
        );
        expect(edit.status).toBe(200);
        const moved = await patch(
            { op: "move_line", item_id: id, toIndex: 1 },
            3
        );
        expect(moved.status).toBe(200);
        const removed = await patch({ op: "remove_line", item_id: id }, 4);
        expect(removed.status).toBe(200);
        const body = await removed.json();
        expect(
            body.document.pekerjaan.map((line: { id: string }) => line.id)
        ).not.toContain(id);
        expect(body.field_changes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    item_id: id,
                    source_before: "turn_1",
                    source_after: "manual",
                }),
                expect.objectContaining({
                    item_id: id,
                    source_before: "manual",
                    source_after: "turn_2",
                    original_source: "turn_1",
                }),
                expect.objectContaining({ item_id: id, kind: "remove" }),
            ])
        );
        const outcomes = await Promise.all([
            patch({ field: "syarat_pembayaran", nilai: "DP 30%" }, 5),
            patch({ field: "masa_berlaku_hari", nilai: 14 }, 5),
        ]);
        expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
        expect((await store.get(created.id))?.draftRevision).toBe(6);
    });
});
