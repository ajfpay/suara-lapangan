import { describe, expect, it } from "vitest";
import { renderQuotationHtml } from "./render";
import { formatMoney } from "./QuotationTemplate";
import type { QuotationDocument } from "@/lib/server/guard/types";

function doc(locale: "en" | "id"): QuotationDocument {
    const pekerjaan = Array.from({ length: 12 }, (_, i) => ({
        uraian: `Work item ${i + 1}`,
        volume: 10,
        satuan: "m2" as const,
        harga_satuan: 50000,
        jumlah: 500000,
        sumber_kutipan: "turn 1",
    }));
    return {
        jenis: "surat_penawaran",
        locale,
        mata_uang: locale === "id" ? "IDR" : "USD",
        nomor: "SL/QTN/2026-10-30/001",
        tanggal: "2026-10-30",
        proyek: { nama: "Villa", lokasi: "Ubud", klien: "Pak Made" },
        pekerjaan,
        total_nominal: 6000000,
        terbilang: locale === "id" ? "enam juta rupiah" : "six million dollars",
        butuh_konfirmasi: [],
    };
}

describe("QuotationTemplate", () => {
    it("renders id labels, nomor, 12 rows, terbilang", () => {
        const html = renderQuotationHtml(doc("id"));
        expect(html).toContain("Surat Penawaran");
        expect(html).toContain("SL/QTN/2026-10-30/001");
        expect(html).toContain("Terbilang");
        expect(html).toContain("enam juta rupiah");
        expect(html).toContain("Work item 12");
        expect(html).toContain("Stempel");
    });
    it("renders en labels and USD", () => {
        const html = renderQuotationHtml(doc("en"));
        expect(html).toContain("Quotation");
        expect(html).toContain("six million dollars");
        expect(formatMoney(1500.5, "en", "USD")).toContain("$");
        expect(formatMoney(6000000, "id", "IDR")).toContain("Rp");
    });
});
