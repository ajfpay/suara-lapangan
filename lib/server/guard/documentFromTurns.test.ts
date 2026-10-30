import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { documentFromTurns } from "./documentFromTurns";
import type { PekerjaanItem, Proyek, Turn } from "./types";

const repoRoot = path.resolve(__dirname, "../../..");
const validDir = path.join(repoRoot, "fixtures", "transcripts");
const defectiveDir = path.join(repoRoot, "fixtures", "defective");

describe("documentFromTurns() - 10+ Defective Fixtures (K4)", () => {
    const files = fs.readdirSync(defectiveDir).filter((f) => f.endsWith(".json"));

    it("covers at least 10 defective fixtures", () => {
        expect(files.length).toBeGreaterThanOrEqual(10);
    });

    for (const file of files) {
        it(`holds defective fixture ${file} in perlu_konfirmasi with correct reason`, () => {
            const data = JSON.parse(
                fs.readFileSync(path.join(defectiveDir, file), "utf8")
            );
            const turns: Turn[] = data.turns;
            const candidate = data.document;
            const project: Proyek = data.project;
            const locale = data.locale;

            const result = documentFromTurns(turns, locale, project, candidate);

            expect(result.status).toBe("perlu_konfirmasi");
            expect(result.butuh_konfirmasi.length).toBeGreaterThan(0);

            const expectedField = data.expectation.field;
            const matched = result.butuh_konfirmasi.find(
                (b) => b.field === expectedField
            );

            expect(
                matched,
                `Expected defect on field ${expectedField} in ${file}. Got findings: ${JSON.stringify(
                    result.butuh_konfirmasi
                )}`
            ).toBeDefined();

            expect(matched?.alasan).toBeTruthy();
            expect(typeof matched?.alasan).toBe("string");
            expect(matched!.alasan.length).toBeGreaterThanOrEqual(10);

            const defectCode = data.cacat?.code;
            if (defectCode === "harga_lolos_sebagai_volume") {
                expect(matched?.alasan).toMatch(/harga|volume/i);
            } else if (defectCode === "satuan_salah" || defectCode === "satuan_hilang") {
                expect(matched?.alasan).toMatch(/satuan/i);
            } else if (defectCode === "desimal_koma_id") {
                expect(matched?.alasan).toMatch(/angka|volume|harga|giliran/i);
            } else if (
                defectCode === "ratus_puluh_tertukar" ||
                defectCode === "twelve_hundred_en" ||
                defectCode === "setengah_juta_id"
            ) {
                expect(matched?.alasan).toMatch(/angka|harga|volume|transkrip/i);
            } else if (defectCode === "kutipan_sesi_lain" || defectCode === "kutipan_non_final") {
                expect(matched?.alasan).toMatch(/sumber_kutipan|giliran|final|sesi/i);
            } else if (defectCode === "jumlah_tidak_cocok") {
                expect(matched?.alasan).toMatch(/jumlah/i);
            } else if (defectCode === "total_tidak_cocok") {
                expect(matched?.alasan).toMatch(/total/i);
            } else if (defectCode === "angka_tidak_ada_di_giliran") {
                expect(matched?.alasan).toMatch(/angka|tidak ditemukan|tidak cocok|giliran/i);
            }
        });
    }
});

describe("documentFromTurns() - 30 Clean Fixtures (K4)", () => {
    const files = fs.readdirSync(validDir).filter((f) => f.endsWith(".json"));

    it("covers at least 30 clean fixtures", () => {
        expect(files.length).toBeGreaterThanOrEqual(30);
    });

    for (const file of files) {
        it(`processes clean fixture ${file} with 0 hallucinations and status siap`, () => {
            const data = JSON.parse(
                fs.readFileSync(path.join(validDir, file), "utf8")
            );
            const turns: Turn[] = data.turns;
            const expectedDoc = data.expected_document;
            const project: Proyek = data.project;
            const locale = data.locale;

            // Test seam with candidate document
            const resultWithCandidate = documentFromTurns(
                turns,
                locale,
                project,
                expectedDoc
            );

            expect(resultWithCandidate.status).toBe("siap");
            expect(resultWithCandidate.butuh_konfirmasi).toEqual([]);
            expect(resultWithCandidate.document.total_nominal).toBe(
                expectedDoc.total_nominal
            );
            expect(resultWithCandidate.document.terbilang).toBe(
                expectedDoc.terbilang
            );

            // Test seam with automatic extraction from turns
            const resultFromTurnsOnly = documentFromTurns(
                turns,
                locale,
                project
            );

            expect(resultFromTurnsOnly.status).toBe("siap");
            expect(resultFromTurnsOnly.butuh_konfirmasi).toEqual([]);
            expect(resultFromTurnsOnly.document.pekerjaan.length).toBe(
                expectedDoc.pekerjaan.length
            );

            expectedDoc.pekerjaan.forEach((expectedItem: PekerjaanItem, idx: number) => {
                const actualItem = resultFromTurnsOnly.document.pekerjaan[idx];
                expect(actualItem).toBeDefined();
                expect(actualItem.volume).toBe(expectedItem.volume);
                expect(actualItem.satuan).toBe(expectedItem.satuan);
                expect(actualItem.harga_satuan).toBe(expectedItem.harga_satuan);
                expect(actualItem.jumlah).toBe(expectedItem.jumlah);
                expect(actualItem.sumber_kutipan).toBe(expectedItem.sumber_kutipan);
            });

            expect(resultFromTurnsOnly.document.total_nominal).toBe(
                expectedDoc.total_nominal
            );
            expect(resultFromTurnsOnly.document.terbilang).toBe(
                expectedDoc.terbilang
            );
        });
    }
});
