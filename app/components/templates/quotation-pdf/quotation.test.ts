import { describe, expect, it } from "vitest";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
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

for (const locale of ["id", "en"] as const) {
    it(`${locale}: never invents payment or validity terms`, () => {
        const html = renderQuotationHtml(doc(locale));
        expect(html).not.toContain("50%");
        expect(html).not.toContain("30 days");
        expect(html).not.toContain("30 hari");
        const explicit = renderQuotationHtml({
            ...doc(locale),
            syarat_pembayaran: "Payment <on delivery>",
            masa_berlaku_hari: 17,
        });
        expect(explicit).toContain("Payment &lt;on delivery&gt;");
        expect(explicit).toContain(locale === "id" ? "17 hari" : "17 days");
    });
}

it("draft watermark is repeated across real printed pages, official PDF is unmarked", async () => {
    const { renderPdf, resolveChromiumPath } = await import(
        "@/lib/server/pdf/storage"
    );
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    try {
        resolveChromiumPath();
        execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    } catch (error) {
        if (process.env.CI) throw error;
        return;
    }
    const root = await mkdtemp(join(tmpdir(), "quotation-print-"));
    try {
        for (const locale of ["id", "en"] as const) {
            const sample = doc(locale);
            const lengthy = {
                ...sample,
                pekerjaan: Array.from({ length: 90 }, (_, index) => ({
                    ...sample.pekerjaan[0],
                    uraian: `Item ${index}`,
                })),
            };
            for (const draft of [true, false]) {
                const bytes = await renderPdf(
                    renderQuotationHtml({
                        ...lengthy,
                        nomor: draft ? null : sample.nomor,
                    })
                );
                const file = join(root, "test.pdf");
                await writeFile(file, bytes);
                const pages = execFileSync("pdftotext", ["-raw", file, "-"], {
                    encoding: "utf8",
                })
                    .split("\f")
                    .filter((p) => p.trim());
                expect(pages.length).toBeGreaterThan(1);
                for (const page of pages) {
                    const marker = locale === "id" ? "DRAF" : "DRAFT";
                    const normalized = page.replace(/\s+/g, "");
                    if (draft) expect(normalized).toContain(marker);
                    else expect(normalized).not.toContain(marker);
                }
            }
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 60000);
