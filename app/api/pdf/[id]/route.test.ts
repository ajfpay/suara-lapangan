import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import {
    getDocumentStore,
    resetDocumentStoreForTesting,
} from "@/lib/server/guard/documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";

function doc(overrides?: Partial<QuotationDocument>): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: "SL/QTN/2026-10-30/001",
        tanggal: "2026-10-30",
        proyek: { nama: "Villa", lokasi: "Ubud", klien: "Pak Made" },
        pekerjaan: [
            {
                uraian: "Hebel",
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

describe("GET /api/pdf/[id]", () => {
    beforeEach(() => resetDocumentStoreForTesting());

    it("404 for unknown id", async () => {
        const res = await GET(new Request("http://localhost/api/pdf/nope"), {
            params: Promise.resolve({ id: "nope" }),
        });
        expect(res.status).toBe(404);
    });

    it("409 when butuh_konfirmasi non-empty", async () => {
        getDocumentStore().set(
            "s1",
            doc({ butuh_konfirmasi: [{ field: "x", alasan: "y", sumber_kutipan: null }] })
        );
        const res = await GET(new Request("http://localhost/api/pdf/s1"), {
            params: Promise.resolve({ id: "s1" }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe("needs_confirmation");
    });

    it("returns application/pdf with %PDF header, second call served from cache", async () => {
        getDocumentStore().set("s1", doc());
        const ctx = { params: Promise.resolve({ id: "s1" }) };
        const r1 = await GET(new Request("http://localhost/api/pdf/s1"), ctx);
        expect(r1.status).toBe(200);
        expect(r1.headers.get("content-type")).toBe("application/pdf");
        expect(r1.headers.get("x-pdf-cache")).toBe("MISS");
        const buf = Buffer.from(await r1.arrayBuffer());
        expect(buf.subarray(0, 4).toString()).toBe("%PDF");
        const r2 = await GET(new Request("http://localhost/api/pdf/s1"), {
            params: Promise.resolve({ id: "s1" }),
        });
        expect(r2.headers.get("x-pdf-cache")).toBe("HIT");
    }, 60000);
});
