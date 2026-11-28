import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyGuard } from "./rules";
import type { Turn, Proyek } from "./types";

const repoRoot = path.resolve(__dirname, "../../..");
const validDir = path.join(repoRoot, "fixtures", "transcripts");
const defectiveDir = path.join(repoRoot, "fixtures", "defective");

describe("Guard Rules §B2 - Defective Fixtures", () => {
    const files = fs
        .readdirSync(defectiveDir)
        .filter((f) => f.endsWith(".json"));

    it("has 12 defective fixtures", () => {
        expect(files.length).toBe(12);
    });

    for (const file of files) {
        it(`catches defect in ${file}`, () => {
            const data = JSON.parse(
                fs.readFileSync(path.join(defectiveDir, file), "utf8")
            );
            const turns: Turn[] = data.turns;
            const doc = data.document;
            const project: Proyek = data.project;
            const locale = data.locale;

            const result = applyGuard(doc, turns, { locale, project });

            if (/^d1[01]-/.test(file)) {
                expect(result.status).toBe("siap");
                if (file.startsWith("d10-")) {
                    expect(result.document.pekerjaan[0]).toMatchObject({
                        jumlah: 1240000,
                        jumlah_minor: 1240000,
                    });
                    expect(result.document.total_nominal_minor).toBe(1240000);
                } else {
                    expect(result.document.total_nominal).toBe(620);
                    expect(result.document.total_nominal_minor).toBe(62000);
                }
                expect(result.butuh_konfirmasi).toEqual([]);
                expect(result.automaticFieldChanges).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            field: data.expectation.field,
                            kind: "derived_confirmation",
                        }),
                    ])
                );
                return;
            }

            expect(result.status).toBe("perlu_konfirmasi");
            expect(result.butuh_konfirmasi.length).toBeGreaterThan(0);

            // Check that the expected field is in butuh_konfirmasi
            const expectedField = data.expectation.field;
            const matchedField = result.butuh_konfirmasi.some(
                (b) => b.field === expectedField
            );

            expect(
                matchedField,
                `Expected field ${expectedField} to be flagged in ${file}, got: ${JSON.stringify(
                    result.butuh_konfirmasi
                )}`
            ).toBe(true);
        });
    }
});

describe("Guard Rules §B2 - Clean Fixtures with Expected Documents", () => {
    const files = fs.readdirSync(validDir).filter((f) => f.endsWith(".json"));

    it("has at least 30 clean fixtures", () => {
        expect(files.length).toBeGreaterThanOrEqual(30);
    });

    for (const file of files) {
        it(`approves clean fixture ${file}`, () => {
            const data = JSON.parse(
                fs.readFileSync(path.join(validDir, file), "utf8")
            );
            const turns: Turn[] = data.turns;
            const doc = data.expected_document;
            const project: Proyek = data.project;
            const locale = data.locale;

            const result = applyGuard(doc, turns, {
                locale,
                project,
                date: doc.tanggal,
                nomor: doc.nomor,
            });

            expect(result.status).toBe("siap");
            expect(result.butuh_konfirmasi).toEqual([]);
            expect(result.document.nomor).toMatch(/^SL\/QTN\/\d{4}\/\d{4}$/);
            expect(result.document).toEqual({
                ...doc,
                total_nominal_minor: Math.round(
                    doc.total_nominal * (locale === "en" ? 100 : 1)
                ),
                pekerjaan: doc.pekerjaan.map(
                    (line: (typeof doc.pekerjaan)[number]) => ({
                        ...line,
                        harga_satuan_minor: Math.round(
                            line.harga_satuan * (locale === "en" ? 100 : 1)
                        ),
                        jumlah_minor: Math.round(
                            line.jumlah * (locale === "en" ? 100 : 1)
                        ),
                    })
                ),
            });
        });
    }
});

describe("Guard Rules §B2 - locale and currency stay paired", () => {
    it("recomputes mata_uang from the locale instead of trusting the document", () => {
        const turns: Turn[] = [
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 3000,
                transcript: "twenty square feet of drywall for 500 dollars",
                final: true,
            },
        ];
        const project: Proyek = {
            nama: "Austin",
            lokasi: "Austin",
            klien: "Bob",
        };
        const candidate = {
            jenis: "surat_penawaran" as const,
            locale: "en" as const,
            mata_uang: "IDR" as const,
            nomor: "SL/QTN/2026/0001",
            tanggal: "2026-10-30",
            proyek: project,
            pekerjaan: [
                {
                    uraian: "Drywall",
                    volume: 20,
                    satuan: "sq_ft" as const,
                    harga_satuan: 25,
                    jumlah: 500,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 500,
            terbilang: "Five hundred US dollars",
            butuh_konfirmasi: [],
        };

        const result = applyGuard(candidate, turns, {
            locale: "en",
            project,
        });

        expect(result.document.mata_uang).toBe("USD");
    });
});
