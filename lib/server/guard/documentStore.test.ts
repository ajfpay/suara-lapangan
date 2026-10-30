import { beforeEach, describe, expect, it } from "vitest";
import {
    getDocumentStore,
    InMemoryDocumentStore,
    resetDocumentStoreForTesting,
} from "./documentStore";
import type { QuotationDocument } from "./types";

function mockDocument(nomor: string, uraian = "Sample Work"): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor,
        tanggal: "2026-10-29",
        proyek: {
            nama: "Proyek Test",
            lokasi: "Yogyakarta",
            klien: "Pak Test",
        },
        pekerjaan: [
            {
                uraian,
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
    };
}

describe("getDocumentStore", () => {
    beforeEach(() => {
        resetDocumentStoreForTesting();
    });

    it("returns singleton store instance", () => {
        const store1 = getDocumentStore();
        const store2 = getDocumentStore();
        expect(store1).toBe(store2);
    });

    it("supports set, get, has operations by sessionId and nomor", () => {
        const store = getDocumentStore();
        const doc = mockDocument("SL/QTN/2026-10-29/001");

        expect(store.has("sess-1")).toBe(false);
        store.set("sess-1", doc);

        expect(store.has("sess-1")).toBe(true);
        expect(store.get("sess-1")).toEqual(doc);

        // Aliased by nomor
        expect(store.has("SL/QTN/2026-10-29/001")).toBe(true);
        expect(store.get("SL/QTN/2026-10-29/001")).toEqual(doc);
    });

    it("cleans up old nomor alias when updating session document", () => {
        const store = getDocumentStore();
        const doc1 = mockDocument("SL/QTN/2026-10-29/001");
        const doc2 = mockDocument("SL/QTN/2026-10-29/002");

        store.set("sess-1", doc1);
        expect(store.has("SL/QTN/2026-10-29/001")).toBe(true);

        // Update session with new nomor
        store.set("sess-1", doc2);
        expect(store.get("sess-1")).toEqual(doc2);
        expect(store.has("SL/QTN/2026-10-29/002")).toBe(true);
        // Old nomor alias should be removed
        expect(store.has("SL/QTN/2026-10-29/001")).toBe(false);
    });

    it("handles bounded capacity and eviction", () => {
        const store = new InMemoryDocumentStore(2);
        const docA = mockDocument("SL/QTN/2026-10-29/001");
        const docB = mockDocument("SL/QTN/2026-10-29/002");
        const docC = mockDocument("SL/QTN/2026-10-29/003");

        store.set("sess-A", docA);
        store.set("sess-B", docB);
        expect(store.has("sess-A")).toBe(true);
        expect(store.has("sess-B")).toBe(true);

        // Inserting third session exceeds capacity 2, oldest (sess-A) should be evicted
        store.set("sess-C", docC);
        expect(store.has("sess-A")).toBe(false);
        expect(store.has("SL/QTN/2026-10-29/001")).toBe(false);
        expect(store.has("sess-B")).toBe(true);
        expect(store.has("sess-C")).toBe(true);
    });
});
