import { existsSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { countDefectiveFixtures } from "./defects";
import { runEval } from "./eval";
import { evaluateGate1Thresholds, GATE_1_THRESHOLDS } from "./thresholds";
import { computeMoneyVolumeWer, computeWer } from "./wer";

// Mock the Postgres store so evaluation tests run in memory without requiring a live database
const { storeStub, clearStore } = vi.hoisted(() => {
    const sessions = new Map<string, unknown>();
    return {
        clearStore: () => sessions.clear(),
        storeStub: {
            findSession: vi.fn(async (sessionId: string) => sessions.get(sessionId) ?? null),
            saveTranscription: vi.fn(async (record: { sessionId: string }) => {
                sessions.set(record.sessionId, record);
            }),
        },
    };
});

vi.mock("@/lib/server/db/store", () => ({ getTurnsStore: () => storeStub }));
vi.mock("../../lib/server/db/store", () => ({ getTurnsStore: () => storeStub }));
describe("scripts/eval: Gate 1 WER Evaluation", () => {
    beforeEach(() => {
        clearStore();
    });
    it("runs all 30 clean fixtures through the transcription pipeline and reports per-language WER", async () => {
        const summary = await runEval();

        // 1. All 30 fixtures must run (15 EN + 15 ID)
        expect(summary.totalRecordings).toBe(30);
        expect(summary.en.count).toBe(15);
        expect(summary.id.count).toBe(15);
        expect(summary.recordings).toHaveLength(30);

        // 2. Per-language WER reported and within Gate 1 thresholds
        expect(summary.en.wer).toBeLessThanOrEqual(GATE_1_THRESHOLDS.EN_TARGET); // <= 10%
        expect(summary.id.wer).toBeLessThanOrEqual(GATE_1_THRESHOLDS.ID_TARGET); // <= 15%
        expect(summary.en.passed).toBe(true);
        expect(summary.id.passed).toBe(true);

        // 3. Money/volume token WER reported
        expect(summary.en.moneyVolume.totalReferenceTokens).toBeGreaterThan(0);
        expect(summary.id.moneyVolume.totalReferenceTokens).toBeGreaterThan(0);
        expect(summary.combined.moneyVolume.wer).toBeLessThanOrEqual(
            GATE_1_THRESHOLDS.MONEY_VOLUME_TARGET // <= 10%
        );

        // 4. Gate 1 status is GO
        expect(summary.gate1.status).toBe("GO");
        expect(summary.gate1.stop24Jam).toBe(false);
        expect(summary.gate1.escalateTo).toBeNull();

        // 5. Output files written to disk
        const resultsDir = join(process.cwd(), "scripts", "eval", "results");
        expect(existsSync(join(resultsDir, "summary.json"))).toBe(true);
        expect(existsSync(join(resultsDir, "GATE-1-REPORT.md"))).toBe(true);
        expect(existsSync(join(resultsDir, "en-01-drywall-living-room.json"))).toBe(true);
        expect(existsSync(join(resultsDir, "id-01-pasang-keramik.json"))).toBe(true);

        // 6. Worst samples list is honestly populated (no dropped samples, sorted descending)
        expect(summary.worstSamples).toHaveLength(30);
        for (let i = 0; i < summary.worstSamples.length - 1; i++) {
            expect(summary.worstSamples[i].wer).toBeGreaterThanOrEqual(
                summary.worstSamples[i + 1].wer
            );
        }
    });

    it("counts all defective fixtures and categorizes defects correctly", () => {
        const defectiveDir = join(process.cwd(), "fixtures", "defective");
        const defects = countDefectiveFixtures(defectiveDir);

        expect(defects.total).toBe(12);
        expect(defects.items).toHaveLength(12);

        // All 8 frozen defect codes + 4 extensions present
        const expectedCodes = [
            "harga_lolos_sebagai_volume",
            "satuan_salah",
            "desimal_koma_id",
            "ratus_puluh_tertukar",
            "kutipan_sesi_lain",
            "kutipan_non_final",
            "twelve_hundred_en",
            "setengah_juta_id",
            "angka_tidak_ada_di_giliran",
            "jumlah_tidak_cocok",
            "total_tidak_cocok",
            "satuan_hilang",
        ];

        for (const code of expectedCodes) {
            expect(defects.byCode[code]).toBeGreaterThanOrEqual(1);
        }

        // All verdicts require confirmation
        expect(defects.byVerdict["butuh_konfirmasi"]).toBe(12);
    });

    it("correctly triggers STOP 24 jam flag and escalates to pemilik when ID WER > 25%", async () => {
        // Direct unit check on evaluateGate1Thresholds
        const stopDecision = evaluateGate1Thresholds({
            enWer: 0.05,
            idWer: 0.28, // > 25%
            moneyVolumeWer: 0.04,
        });

        expect(stopDecision.status).toBe("STOP_24_JAM");
        expect(stopDecision.stop24Jam).toBe(true);
        expect(stopDecision.escalateTo).toBe("pemilik");
        expect(stopDecision.passed).toBe(false);
        expect(stopDecision.reasons[0]).toContain("STOP 24 jam");

        // Boundary check at exactly 25.01%
        const boundaryStop = evaluateGate1Thresholds({
            enWer: 0.04,
            idWer: 0.2501,
        });
        expect(boundaryStop.stop24Jam).toBe(true);

        // Check when ID is within threshold (14%) vs STOP
        const passDecision = evaluateGate1Thresholds({
            enWer: 0.08,
            idWer: 0.14,
            moneyVolumeWer: 0.05,
        });
        expect(passDecision.status).toBe("GO");
        expect(passDecision.stop24Jam).toBe(false);

        // Full simulated high-ID WER run through pipeline
        const highIdSummary = await runEval({ simulateHighIdWer: true });
        expect(highIdSummary.id.wer).toBeGreaterThan(0.25);
        expect(highIdSummary.gate1.status).toBe("STOP_24_JAM");
        expect(highIdSummary.gate1.stop24Jam).toBe(true);
        expect(highIdSummary.gate1.escalateTo).toBe("pemilik");
    });

    it("computes Levenshtein edit distance and WER accurately", () => {
        // Exact match
        const exact = computeWer("twenty-four square feet", "twenty-four square feet");
        expect(exact.wer).toBe(0);
        expect(exact.distance).toBe(0);

        // 1 substitution out of 4 words = 25% WER
        const sub = computeWer("twenty four square feet", "twenty four cubic feet");
        expect(sub.distance).toBe(1);
        expect(sub.wer).toBe(0.25);

        // Money/volume token evaluation
        const mvEn = computeMoneyVolumeWer(
            "Drywall for the living room, twenty-four square feet at twenty-five dollars a square foot.",
            "Drywall for the living room, twenty-four square feet at twenty-five dollars per square foot.",
            "en"
        );
        expect(mvEn.referenceCount).toBeGreaterThan(0);
        expect(mvEn.distance).toBeLessThanOrEqual(1);

        const mvId = computeMoneyVolumeWer(
            "Pasang keramik ruang tamu, dua puluh empat meter persegi, seratus lima puluh ribu per meter persegi.",
            "Pasang keramik ruang tamu, dua puluh empat meter persegi, seratus lima puluh ribu tiap meter persegi.",
            "id"
        );
        expect(mvId.referenceCount).toBeGreaterThan(0);
        expect(mvId.distance).toBeLessThanOrEqual(1);
    });
});
