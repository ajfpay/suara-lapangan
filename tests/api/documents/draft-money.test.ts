import { describe, expect, it } from "vitest";
import { applyGuard } from "@/lib/server/guard/rules";
import { patchDocumentBodySchema } from "@/lib/server/validation/document";

const line = (volume: unknown, price: unknown) => ({ uraian: "Item", volume, satuan: "unit", harga_satuan: price, sumber_kutipan: "manual" });
const guard = (locale: "id" | "en", pekerjaan: unknown[]) => applyGuard({ locale, pekerjaan }, [], { locale }).document;
describe("quotation money", () => {
    it("rounds each line half-up in IDR rupiah and USD cents before summing", () => {
        const id = guard("id", [line(.5, 1), line(.5, 1)]);
        expect(id.pekerjaan.map(i => i.jumlah)).toEqual([1, 1]);
        expect(id.total_nominal).toBe(2);
        const en = guard("en", [line(.5, .01), line(.5, .01)]);
        expect(en.pekerjaan.map(i => i.jumlah_minor)).toEqual([1, 1]);
        expect(en.total_nominal_minor).toBe(2);
        expect(en.total_nominal).toBe(.02);
    });
    it("does not treat missing price as explicit zero", () => {
        const doc = guard("id", [line(1, null), line(1, 0)]);
        expect(doc.pekerjaan[0].harga_satuan_minor).toBeNull();
        expect(doc.pekerjaan[1].harga_satuan_minor).toBe(0);
        expect(doc.butuh_konfirmasi).toEqual(expect.arrayContaining([expect.objectContaining({ field: "pekerjaan[0].harga_satuan" })]));
    });
    it.each([0, -1, 1000001, .0001, "", "1e2", "0x10"])("rejects invalid quantity %s", volume => {
        expect(() => guard("id", [line(volume, 1)])).toThrow();
        expect(patchDocumentBodySchema.safeParse({ field: "pekerjaan[0].volume", nilai: volume }).success).toBe(false);
    });
    it("rejects unsupported precision, IDR price over limit and unsafe totals", () => {
        expect(() => guard("id", [line(1, 1.1)])).toThrow();
        expect(() => guard("id", [line(1, 1000000000001)])).toThrow();
        expect(() => guard("en", [line(1, .001)])).toThrow();
        expect(() => guard("id", [line(1000000, 1000000000000)])).toThrow();
    });
});
