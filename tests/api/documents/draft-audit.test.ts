import { describe, expect, it } from "vitest";
import { applyGuard } from "@/lib/server/guard/rules";
import { patchDocumentBodySchema } from "@/lib/server/validation/document";
import type { Turn } from "@/lib/server/guard/types";
const turns: Turn[] = [
    {
        turn_id: "turn_1",
        startMs: 0,
        endMs: 2000,
        transcript: "DP 30 persen, berlaku 14 hari.",
        final: true,
    },
];
const candidate = {
    locale: "id",
    pekerjaan: [
        {
            uraian: "Item",
            volume: 1,
            satuan: "unit",
            harga_satuan: 50,
            jumlah: 60,
            sumber_kutipan: "manual",
        },
    ],
    total_nominal: 60,
};
describe("derived confirmation and terms", () => {
    it("automatically resolves purely computed discrepancies and records the correction", () => {
        const result = applyGuard(candidate, []);
        expect(result.document.total_nominal).toBe(50);
        expect(result.butuh_konfirmasi).toEqual([]);
        expect(result.automaticFieldChanges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: "pekerjaan[0].jumlah",
                    original: 60,
                    current: 50,
                }),
                expect.objectContaining({
                    field: "total_nominal",
                    original: 60,
                    current: 50,
                }),
            ])
        );
    });
    it("accepts only grounded, pending AI term proposals", () => {
        const result = applyGuard(
            {
                ...candidate,
                syarat_pembayaran: {
                    nilai: "DP 30 persen",
                    sumber_kutipan: " turn_1 ",
                },
                masa_berlaku_hari: { nilai: 14, sumber_kutipan: "turn_1" },
            },
            turns
        );
        expect(result.document.syarat_pembayaran).toBe("DP 30 persen");
        expect(result.document.masa_berlaku_hari).toBe(14);
        expect(result.butuh_konfirmasi).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: "syarat_pembayaran",
                    sumber_kutipan: "turn_1",
                }),
                expect.objectContaining({
                    field: "masa_berlaku_hari",
                    sumber_kutipan: "turn_1",
                }),
            ])
        );
        const invalid = applyGuard(
            {
                ...candidate,
                syarat_pembayaran: {
                    nilai: "DP 50 persen",
                    sumber_kutipan: "turn_1",
                },
                masa_berlaku_hari: { nilai: 30, sumber_kutipan: "turn_1" },
            },
            turns
        );
        expect(invalid.document.syarat_pembayaran).toBeUndefined();
        expect(invalid.document.masa_berlaku_hari).toBeUndefined();
    });
    it("validates manual optional terms and rejects HTML or invalid duration", () => {
        expect(
            patchDocumentBodySchema.safeParse({
                field: "syarat_pembayaran",
                nilai: "DP 30 persen",
            }).success
        ).toBe(true);
        expect(
            patchDocumentBodySchema.safeParse({
                field: "syarat_pembayaran",
                nilai: "<b>DP</b>",
            }).success
        ).toBe(false);
        expect(
            patchDocumentBodySchema.safeParse({
                field: "syarat_pembayaran",
                nilai: "x".repeat(501),
            }).success
        ).toBe(false);
        expect(
            patchDocumentBodySchema.safeParse({
                field: "masa_berlaku_hari",
                nilai: 365,
            }).success
        ).toBe(true);
        expect(
            patchDocumentBodySchema.safeParse({
                field: "masa_berlaku_hari",
                nilai: 366,
            }).success
        ).toBe(false);
        expect(
            patchDocumentBodySchema.safeParse({
                field: "masa_berlaku_hari",
                nilai: null,
            }).success
        ).toBe(true);
    });
    it("keeps an explicitly spoken conflicting total pending", () => {
        const result = applyGuard({ ...candidate, total_nominal: 50 }, [
            {
                turn_id: "turn_2",
                startMs: 0,
                endMs: 1000,
                transcript: "Total 60 rupiah",
                final: true,
            },
        ]);
        expect(result.document.total_nominal).toBe(50);
        expect(result.butuh_konfirmasi).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: "total_nominal",
                    kind: "source",
                    sumber_kutipan: "turn_2",
                    proposed_value: 60,
                }),
            ])
        );
    });
    it("accepts explicit payment phrases and rejects partial-word evidence", () => {
        const propose = (nilai: string, transcript: string) =>
            applyGuard(
                {
                    ...candidate,
                    syarat_pembayaran: { nilai, sumber_kutipan: "turn_1" },
                },
                [{ ...turns[0], transcript }]
            ).document.syarat_pembayaran;
        expect(propose("bayar", "pembayaran")).toBeUndefined();
        expect(
            propose("jatuh tempo 14 hari", "Pembayaran jatuh tempo 14 hari.")
        ).toBe("jatuh tempo 14 hari");
        expect(propose("termin 2", "termin 2 setelah pekerjaan")).toBe(
            "termin 2"
        );
        expect(propose("net 30", "Invoice net 30.")).toBe("net 30");
    });
});
