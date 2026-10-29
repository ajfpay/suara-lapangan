import { beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "./route";
import {
    getDocumentStore,
    resetDocumentStoreForTesting,
} from "@/lib/server/guard/documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";

function createTestDocument(
    overrides?: Partial<QuotationDocument>
): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: "SL/QTN/2026-10-29/001",
        tanggal: "2026-10-29",
        proyek: {
            nama: "Renovasi Rumah",
            lokasi: "Jl. Kaliurang km 5",
            klien: "Pak Bambang",
        },
        pekerjaan: [
            {
                uraian: "Pemasangan hebel",
                volume: 10,
                satuan: "m2",
                harga_satuan: 50000,
                jumlah: 500000,
                sumber_kutipan: "turn_1",
            },
            {
                uraian: "Plester aci",
                volume: 5,
                satuan: "m2",
                harga_satuan: 40000,
                jumlah: 200000,
                sumber_kutipan: "turn_2",
            },
        ],
        total_nominal: 700000,
        terbilang: "Tujuh ratus ribu rupiah",
        butuh_konfirmasi: [],
        ...overrides,
    };
}

describe("PATCH /api/documents/[id] route handler", () => {
    beforeEach(() => {
        resetDocumentStoreForTesting();
    });

    it("rejects non-JSON body with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            body: "invalid-json-content",
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects non-object JSON body with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify("plain string not object"),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects missing field with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nilai: 10 }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects empty or whitespace-only field with 400", async () => {
        const emptyReq = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "", nilai: 10 }),
        });
        const emptyRes = await PATCH(emptyReq, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(emptyRes.status).toBe(400);
        const emptyData = await emptyRes.json();
        expect(emptyData.error).toBe("invalid_request");

        const wsReq = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "   ", nilai: 10 }),
        });
        const wsRes = await PATCH(wsReq, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(wsRes.status).toBe(400);
        const wsData = await wsRes.json();
        expect(wsData.error).toBe("invalid_request");
    });

    it("rejects non-string field with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: 12345, nilai: 10 }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects unsupported field format with 400", async () => {
        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "proyek.nama", nilai: "Baru" }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("returns 404 for an unknown id", async () => {
        const req = new Request("http://localhost/api/documents/unknown-id", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 15,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "unknown-id" }),
        });
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toBe("not_found");
    });

    it("rejects pekerjaan index out of bounds with 400", async () => {
        const store = getDocumentStore();
        store.set("doc-1", createTestDocument());

        const req = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[99].volume",
                nilai: 15,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("invalid_request");
    });

    it("rejects invalid numeric values with 400", async () => {
        const store = getDocumentStore();
        store.set("doc-1", createTestDocument());

        const nonNumReq = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: "bukan_angka",
            }),
        });
        const nonNumRes = await PATCH(nonNumReq, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(nonNumRes.status).toBe(400);
        const nonNumData = await nonNumRes.json();
        expect(nonNumData.error).toBe("invalid_request");

        const negReq = new Request("http://localhost/api/documents/doc-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: -10,
            }),
        });
        const negRes = await PATCH(negReq, {
            params: Promise.resolve({ id: "doc-1" }),
        });
        expect(negRes.status).toBe(400);
        const negData = await negRes.json();
        expect(negData.error).toBe("invalid_request");
    });

    it("correcting pekerjaan[i].volume recomputes jumlah, total_nominal, and terbilang on the server", async () => {
        const store = getDocumentStore();
        const initialDoc = createTestDocument();
        store.set("doc-vol-1", initialDoc);

        // Initial state:
        // Item 0: volume 10, harga 50000 -> 500000
        // Item 1: volume 5, harga 40000 -> 200000
        // Total: 700000
        expect(initialDoc.pekerjaan[0].jumlah).toBe(500000);
        expect(initialDoc.total_nominal).toBe(700000);

        // Patch volume of item 0 to 20
        const req = new Request("http://localhost/api/documents/doc-vol-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 20,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-vol-1" }),
        });
        expect(res.status).toBe(200);

        const data = await res.json();
        // Server recomputations:
        // Item 0 jumlah: 20 * 50000 = 1,000,000
        // Item 1 jumlah: 5 * 40000 = 200,000
        // total_nominal: 1,000,000 + 200,000 = 1,200,000
        // terbilang: "Satu juta dua ratus ribu rupiah"
        expect(data.document.pekerjaan[0].volume).toBe(20);
        expect(data.document.pekerjaan[0].jumlah).toBe(1000000);
        expect(data.document.pekerjaan[1].jumlah).toBe(200000);
        expect(data.document.total_nominal).toBe(1200000);
        expect(data.document.terbilang).toBe("Satu juta dua ratus ribu rupiah");
        expect(data.status).toBe("siap");
    });

    it("correcting pekerjaan[i].harga_satuan with string coercion in English locale document", async () => {
        const store = getDocumentStore();
        const enDoc: QuotationDocument = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: "SL/QTN/2026-10-29/002",
            tanggal: "2026-10-29",
            proyek: {
                nama: "Drywall project",
                lokasi: "Seattle, WA",
                klien: "John Doe",
            },
            pekerjaan: [
                {
                    uraian: "Install drywall",
                    volume: 4,
                    satuan: "sheet",
                    harga_satuan: 25,
                    jumlah: 100,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 100,
            terbilang: "One hundred US dollars",
            butuh_konfirmasi: [],
        };
        store.set("doc-en-1", enDoc);

        // Patch harga_satuan as string "30.5"
        const req = new Request("http://localhost/api/documents/doc-en-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].harga_satuan",
                nilai: "30.5",
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-en-1" }),
        });
        expect(res.status).toBe(200);

        const data = await res.json();
        // 4 * 30.5 = 122
        expect(data.document.pekerjaan[0].harga_satuan).toBe(30.5);
        expect(data.document.pekerjaan[0].jumlah).toBe(122);
        expect(data.document.total_nominal).toBe(122);
        expect(data.document.terbilang).toBe("One hundred twenty-two US dollars");
        expect(data.status).toBe("siap");
    });

    it("patches string fields (satuan and uraian)", async () => {
        const store = getDocumentStore();
        store.set("doc-str-1", createTestDocument());

        const req1 = new Request("http://localhost/api/documents/doc-str-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].satuan",
                nilai: "sak",
            }),
        });
        const res1 = await PATCH(req1, {
            params: Promise.resolve({ id: "doc-str-1" }),
        });
        expect(res1.status).toBe(200);
        const data1 = await res1.json();
        expect(data1.document.pekerjaan[0].satuan).toBe("sak");

        const req2 = new Request("http://localhost/api/documents/doc-str-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].uraian",
                nilai: "Pemasangan hebel tebal 10cm",
            }),
        });
        const res2 = await PATCH(req2, {
            params: Promise.resolve({ id: "doc-str-1" }),
        });
        expect(res2.status).toBe(200);
        const data2 = await res2.json();
        expect(data2.document.pekerjaan[0].uraian).toBe(
            "Pemasangan hebel tebal 10cm"
        );
    });

    it("removes matching entry from butuh_konfirmasi and status flips from perlu_konfirmasi to siap only when empty", async () => {
        const store = getDocumentStore();
        const docWithDefects = createTestDocument({
            butuh_konfirmasi: [
                {
                    field: "pekerjaan[0].volume",
                    alasan: "Volume tidak cocok dengan transkrip",
                    sumber_kutipan: "turn_1",
                },
                {
                    field: "pekerjaan[0].harga_satuan",
                    alasan: "Harga satuan tidak cocok dengan transkrip",
                    sumber_kutipan: "turn_1",
                },
            ],
        });
        store.set("doc-def-1", docWithDefects);

        // First patch: fix pekerjaan[0].volume
        const req1 = new Request("http://localhost/api/documents/doc-def-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 15,
            }),
        });

        const res1 = await PATCH(req1, {
            params: Promise.resolve({ id: "doc-def-1" }),
        });
        expect(res1.status).toBe(200);
        const data1 = await res1.json();

        // pekerjaan[0].volume removed, but pekerjaan[0].harga_satuan remains -> status still "perlu_konfirmasi"
        expect(data1.status).toBe("perlu_konfirmasi");
        expect(data1.butuh_konfirmasi).toHaveLength(1);
        expect(data1.butuh_konfirmasi[0].field).toBe("pekerjaan[0].harga_satuan");
        expect(data1.document.butuh_konfirmasi).toHaveLength(1);

        // Second patch: fix pekerjaan[0].harga_satuan
        const req2 = new Request("http://localhost/api/documents/doc-def-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].harga_satuan",
                nilai: 60000,
            }),
        });

        const res2 = await PATCH(req2, {
            params: Promise.resolve({ id: "doc-def-1" }),
        });
        expect(res2.status).toBe(200);
        const data2 = await res2.json();

        // Both defects cleared -> status flips to "siap"
        expect(data2.status).toBe("siap");
        expect(data2.butuh_konfirmasi).toHaveLength(0);
        expect(data2.document.butuh_konfirmasi).toHaveLength(0);
    });

    it("persists document so a second read reflects the patch", async () => {
        const store = getDocumentStore();
        store.set("doc-persist-1", createTestDocument());

        const req = new Request("http://localhost/api/documents/doc-persist-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                field: "pekerjaan[0].volume",
                nilai: 25,
            }),
        });

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "doc-persist-1" }),
        });
        expect(res.status).toBe(200);

        // Second read from store directly
        const storedDoc = store.get("doc-persist-1");
        expect(storedDoc).toBeDefined();
        expect(storedDoc?.pekerjaan[0].volume).toBe(25);
        expect(storedDoc?.pekerjaan[0].jumlah).toBe(1250000);
        expect(storedDoc?.total_nominal).toBe(1450000);
        expect(storedDoc?.terbilang).toBe(
            "Satu juta empat ratus lima puluh ribu rupiah"
        );
    });

    it("allows patching using nomor as the id parameter", async () => {
        const store = getDocumentStore();
        const doc = createTestDocument({ nomor: "SL/QTN/2026-10-29/077" });
        store.set("sess-alias-77", doc);

        const req = new Request(
            "http://localhost/api/documents/SL/QTN/2026-10-29/077",
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    field: "pekerjaan[0].volume",
                    nilai: 12,
                }),
            }
        );

        const res = await PATCH(req, {
            params: Promise.resolve({ id: "SL/QTN/2026-10-29/077" }),
        });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.document.pekerjaan[0].volume).toBe(12);

        // Both session id and nomor aliases reflect the updated state
        expect(store.get("sess-alias-77")?.pekerjaan[0].volume).toBe(12);
        expect(store.get("SL/QTN/2026-10-29/077")?.pekerjaan[0].volume).toBe(12);
    });
});
