import { describe, expect, it } from "vitest";

import {
    fieldLabel,
    isNumericField,
    parseOptions,
} from "@/app/[locale]/(suara)/susun/konfirmasi";

describe("konfirmasi helpers", () => {
    it("parses bracket options", () => {
        expect(parseOptions("delapan [ratus/puluh] ribu")).toEqual([
            "ratus",
            "puluh",
        ]);
    });

    it("returns [] without brackets", () => {
        expect(parseOptions("tidak jelas")).toEqual([]);
        expect(parseOptions(null)).toEqual([]);
    });

    it("labels pekerjaan fields", () => {
        expect(fieldLabel("pekerjaan[0].harga_satuan", "id")).toContain(
            "Pekerjaan 1"
        );
        expect(fieldLabel("pekerjaan[1].volume", "en")).toContain("Item 2");
    });

    it("detects numeric fields", () => {
        expect(isNumericField("pekerjaan[0].volume")).toBe(true);
        expect(isNumericField("pekerjaan[0].harga_satuan")).toBe(true);
        expect(isNumericField("pekerjaan[0].satuan")).toBe(false);
    });
});
