import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import quotationSchema from "@/contracts/quotation.schema.json";
import { SPOKEN_UNITS } from "@/lib/server/guard/words";

import {
    buildKeywords,
    KEYWORDS,
    LANGUAGE_BIAS,
    SCHEMA_UNIT_TERMS,
} from "./vocabulary";

describe("vocabulary biasing", () => {
    it("always includes both English and Indonesian in LANGUAGE_BIAS", () => {
        expect(LANGUAGE_BIAS.en).toContain("English");
        expect(LANGUAGE_BIAS.en).toContain("Indonesian");
        expect(LANGUAGE_BIAS.id).toContain("English");
        expect(LANGUAGE_BIAS.id).toContain("Indonesian");
    });

    it("includes curated keywords and spoken domain terms for Indonesian", () => {
        const keywords = buildKeywords("id");

        // Curated baseline
        for (const kw of KEYWORDS.id) {
            expect(keywords).toContain(kw);
        }

        // Domain vocabulary from quotation schema
        expect(keywords).toContain("meter persegi");
        expect(keywords).toContain("square foot");
        expect(keywords).toContain("sak");
        expect(keywords).toContain("batang");
        expect(keywords).toContain("titik");
        expect(keywords).toContain("borongan");
        expect(keywords).toContain("m2");
    });

    it("includes curated keywords and spoken domain terms for English", () => {
        const keywords = buildKeywords("en");

        // Curated baseline
        for (const kw of KEYWORDS.en) {
            expect(keywords).toContain(kw);
        }

        // Domain vocabulary
        expect(keywords).toContain("square meter");
        expect(keywords).toContain("square foot");
        expect(keywords).toContain("linear foot");
        expect(keywords).toContain("sq ft");
        expect(keywords).toContain("lin ft");
        expect(keywords).toContain("drywall");
        expect(keywords).toContain("rebar");
    });

    it("extracts significant terms from passed string terms", () => {
        const keywords = buildKeywords("id", ["Pak Budi", "Proyek Kemang"]);

        expect(keywords).toContain("Pak Budi");
        expect(keywords).toContain("Proyek Kemang");
        expect(keywords).toContain("Budi");
        expect(keywords).toContain("Kemang");
    });

    it("extracts significant terms from prior turn objects", () => {
        const keywords = buildKeywords("id", [
            { transcript: "Pekerjaan renovasi rumah Pak Budi di Kemang." },
            { transcript: "Tolong kirimkan invoice ke PT Wika." },
        ]);

        expect(keywords).toContain("Budi");
        expect(keywords).toContain("Kemang");
        expect(keywords).toContain("Wika");
        expect(keywords).toContain("PT");
    });

    it("deduplicates terms case-insensitively", () => {
        const keywords = buildKeywords("id", ["sak", "SAK", "m2", "M2"]);
        const lowerList = keywords.map((k) => k.toLowerCase());
        const sakCount = lowerList.filter((k) => k === "sak").length;
        const m2Count = lowerList.filter((k) => k === "m2").length;

        expect(sakCount).toBe(1);
        expect(m2Count).toBe(1);
    });

    it("does not add short phrases made only of stop words like 'Good morning' or 'Selamat pagi'", () => {
        const keywordsId = buildKeywords("id", ["Selamat pagi", "Pak Budi"]);
        expect(keywordsId).not.toContain("Selamat pagi");
        expect(keywordsId).not.toContain("selamat pagi");
        expect(keywordsId).not.toContain("Selamat");
        expect(keywordsId).not.toContain("pagi");
        expect(keywordsId).toContain("Pak Budi");
        expect(keywordsId).toContain("Budi");

        const keywordsEn = buildKeywords("en", ["Good morning", "Alice Walker"]);
        expect(keywordsEn).not.toContain("Good morning");
        expect(keywordsEn).not.toContain("good morning");
        expect(keywordsEn).not.toContain("Good");
        expect(keywordsEn).not.toContain("morning");
        expect(keywordsEn).toContain("Alice Walker");
        expect(keywordsEn).toContain("Alice");
        expect(keywordsEn).toContain("Walker");
    });

    it("derives the unit vocabulary from the shipped quotation schema", () => {
        const units =
            quotationSchema.properties.pekerjaan.items.properties.satuan.enum;
        const spokenForms = SPOKEN_UNITS as unknown as Record<
            string,
            readonly string[]
        >;

        expect(units.length).toBeGreaterThan(0);
        expect(SCHEMA_UNIT_TERMS).toHaveLength(
            units.reduce((total, unit) => total + spokenForms[unit].length, 0)
        );

        const keywords = buildKeywords("id").map((kw) => kw.toLowerCase());
        for (const unit of units) {
            expect(spokenForms[unit], `no spoken forms for ${unit}`).toBeDefined();
            expect(
                spokenForms[unit].some((form) =>
                    keywords.includes(form.toLowerCase())
                ),
                `satuan ${unit} is not biased`
            ).toBe(true);
        }
    });

    it("biases materials and field terms from the quotation seed corpus", () => {
        const fixture = JSON.parse(
            readFileSync(
                join(
                    process.cwd(),
                    "fixtures",
                    "transcripts",
                    "id-02-semen-plester.json"
                ),
                "utf8"
            )
        );
        const uraian: string = fixture.expected_document.pekerjaan[0].uraian;
        const material = uraian
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .find((word) => word.length >= 4 && !KEYWORDS.id.includes(word));

        expect(material).toBeDefined();
        expect(buildKeywords("id")).toContain(material);
        expect(buildKeywords("en")).toContain("drywall");
    });
});
