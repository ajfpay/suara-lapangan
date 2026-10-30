#!/usr/bin/env node

/**
 * CLI runner for Suara Lapangan MVP Gate 1 WER Evaluation.
 *
 * Usage:
 *   node scripts/eval/run.mjs
 */

import { register } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const loaderPath = resolve(here, "loader.mjs");
register(pathToFileURL(loaderPath).href, import.meta.url);

async function main() {
    console.log(
        "==============================================================="
    );
    console.log("   SUARA LAPANGAN MVP - GATE 1 EVALUASI WER (EN & ID)");
    console.log(
        "===============================================================\n"
    );

    const { runEval } = await import("./eval.ts");

    const summary = await runEval();

    console.log(
        `Evaluated ${summary.totalRecordings} clean fixture recordings:`
    );
    console.log(`- English (Native):      ${summary.en.count} recordings`);
    console.log(`- Indonesian (Accented): ${summary.id.count} recordings\n`);

    console.log(
        `--- HASIL EVALUASI WER ${summary.isSynthetic ? "(SYNTHETIC SMOKE TEST)" : "(REAL ASR)"} ---`
    );
    if (summary.isSynthetic) {
        console.log(
            "[PERINGATAN B1] Hipotesis transkripsi berasal dari mock K5 sintetis (circular oracle)."
        );
        console.log(
            "               Angka WER di bawah adalah uji asap pipeline, BUKAN akurasi model ASR riil.\n"
        );
    }
    console.log(
        `EN WER:              ${(summary.en.wer * 100).toFixed(2)}% (${summary.en.totalDistance}/${summary.en.totalReferenceWords} words) [Threshold <= 10.00%]`
    );
    console.log(
        `ID WER:              ${(summary.id.wer * 100).toFixed(2)}% (${summary.id.totalDistance}/${summary.id.totalReferenceWords} words) [Threshold <= 15.00%]`
    );
    console.log(
        `EN Money/Volume WER: ${(summary.en.moneyVolume.wer * 100).toFixed(2)}% (${summary.en.moneyVolume.totalDistance}/${summary.en.moneyVolume.totalReferenceTokens} tokens)`
    );
    console.log(
        `ID Money/Volume WER: ${(summary.id.moneyVolume.wer * 100).toFixed(2)}% (${summary.id.moneyVolume.totalDistance}/${summary.id.moneyVolume.totalReferenceTokens} tokens)`
    );
    console.log(
        `Total Money/Vol WER: ${(summary.combined.moneyVolume.wer * 100).toFixed(2)}% (${summary.combined.moneyVolume.totalDistance}/${summary.combined.moneyVolume.totalReferenceTokens} tokens) [Threshold <= 10.00%]\n`
    );
    console.log("--- KEPUTUSAN GATE 1 ---");
    console.log(`Status:              ${summary.gate1.status}`);
    console.log(
        `STOP 24 Jam Flag:    ${summary.gate1.stop24Jam ? "YES" : "NO"}`
    );
    if (summary.gate1.escalateTo) {
        console.log(`Eskalasi ke:         ${summary.gate1.escalateTo}`);
    }
    console.log(`Alasan:`);
    for (const reason of summary.gate1.reasons) {
        console.log(`  * ${reason}`);
    }

    console.log("\n--- INVENTARISASI KASUS CACAT (DEFECTIVE FIXTURES) ---");
    console.log(
        `Total kasus cacat terdaftar: ${summary.defects.total} (dicatat/didaftar, bukan diuji guard)`
    );
    for (const [code, count] of Object.entries(summary.defects.byCode)) {
        console.log(`  * ${code}: ${count}`);
    }
    console.log("\n--- TOP 5 SAMPEL TERBURUK (HONEST REPORTING) ---");
    for (const sample of summary.worstSamples.slice(0, 5)) {
        console.log(
            `  #${sample.rank} [${sample.locale.toUpperCase()}] ${sample.id}: WER ${(sample.wer * 100).toFixed(2)}% (${sample.distance}/${sample.referenceWords} words)`
        );
    }

    console.log(
        `\nSemua berkas hasil rekaman tersimpan di: scripts/eval/results/`
    );
    console.log(`Laporan lengkap: scripts/eval/results/GATE-1-REPORT.md`);

    if (summary.gate1.status === "STOP_24_JAM") {
        console.error("\n[STOP 24 JAM] Evaluasi Gate 1 menolak jalur ini.");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Evaluation failed with unhandled error:", err);
    process.exit(1);
});
