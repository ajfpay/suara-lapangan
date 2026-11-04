import { describe, expect, it } from "vitest";

import {
    citationOptions,
    fieldLabel,
    isCitationField,
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

    it("detects citation fields", () => {
        expect(isCitationField("pekerjaan[0].sumber_kutipan")).toBe(true);
        expect(isCitationField("pekerjaan[1].sumber_kutipan")).toBe(true);
        expect(isCitationField("pekerjaan[0].volume")).toBe(false);
    });

    it("labels citation fields in id and en", () => {
        expect(fieldLabel("pekerjaan[0].sumber_kutipan", "id")).toBe(
            "Pekerjaan 1 — Sumber kutipan"
        );
        expect(fieldLabel("pekerjaan[0].sumber_kutipan", "en")).toBe(
            "Item 1 — Citation source"
        );
    });

    it("builds citation options with manual and cited turn id", () => {
        expect(citationOptions("turn_1")).toEqual(["manual", "turn_1"]);
        expect(
            citationOptions({
                sumber_kutipan: "turn_5",
            })
        ).toEqual(["manual", "turn_5"]);
        expect(citationOptions(null)).toEqual(["manual"]);
        expect(citationOptions("manual")).toEqual(["manual"]);
    });
});
