import { describe, expect, it } from "vitest";
import { applyDraftMutation } from "@/lib/server/guard/draftMutation";
import { patchDocumentBodySchema } from "@/lib/server/validation/document";
import type { QuotationDocument } from "@/lib/server/guard/types";

const id = "6cc5673d-b56c-4b48-a7a7-3a0c5ba11b78";
function draft(): QuotationDocument {
    return {
        jenis:"surat_penawaran", locale:"id", mata_uang:"IDR", nomor:null, tanggal:"2026-11-28",
        proyek:{nama:"Project", lokasi:"Location", klien:"Client"},
        pekerjaan:[{id, uraian:"Item", volume:1, satuan:"unit", harga_satuan:50, harga_satuan_minor:50, jumlah:50, jumlah_minor:50, sumber_kutipan:"turn_1"}],
        total_nominal:50, total_nominal_minor:50, terbilang:"Lima puluh rupiah",
        butuh_konfirmasi:[
            {field:"pekerjaan[0].volume", alasan:"Check volume", sumber_kutipan:"turn_1", kind:"source"},
            {field:"total_nominal", alasan:"Spoken total 60", sumber_kutipan:"turn_1", kind:"source", proposed_value:60},
        ],
    };
}
const mutate = (doc: QuotationDocument, patch: unknown) => applyDraftMutation(doc, [], patchDocumentBodySchema.parse(patch), "fixture", () => true);
describe("explicit draft confirmation", () => {
    it("does not clear unchanged source confirmations on bulk line saves", () => {
        const result = mutate(draft(), {op:"update_line", item_id:id, changes:{uraian:"Updated", volume:1}});
        expect(result.document.butuh_konfirmasi.map(c => c.field)).toContain("pekerjaan[0].volume");
    });
    it("rejects a derived confirmation request for spoken discrepancies", () => {
        const doc = draft();
        expect(() => mutate(doc, {op:"confirm_derived", field:"total_nominal"})).toThrow();
        expect(doc.butuh_konfirmasi).toHaveLength(2);
    });
    it("lets the user explicitly acknowledge the spoken total with provenance", () => {
        const result = mutate(draft(), {op:"confirm_source", field:"total_nominal"});
        expect(result.document.butuh_konfirmasi.map(c => c.field)).toEqual(["pekerjaan[0].volume"]);
        expect(result.fieldChanges).toContainEqual(expect.objectContaining({field:"total_nominal", original:60, current:50, kind:"confirmation", source_before:"turn_1", source_after:"turn_1"}));
    });
    it("allows an explicit same-value scalar confirmation", () => {
        const result = mutate(draft(), {field:"pekerjaan[0].volume", nilai:1});
        expect(result.document.butuh_konfirmasi.map(c => c.field)).toEqual(["total_nominal"]);
        expect(result.fieldChanges).toContainEqual(expect.objectContaining({field:"pekerjaan[0].volume", original:1,current:1,kind:"confirmation"}));
    });
});
