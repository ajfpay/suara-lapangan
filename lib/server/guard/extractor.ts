import type {
    CandidateDocument,
    CandidatePekerjaanItem,
    CanonicalUnit,
    Locale,
    Proyek,
    Turn,
} from "./types";
import {
    ExtractedNumber,
    extractNumbersWithContext,
    PRICE_KEYWORDS,
    spokenUnitsIn,
} from "./words";

function getImmediateUnitForNumber(num: ExtractedNumber): CanonicalUnit | null {
    if (num.wordsAfter.length > 0) {
        const immediate2 = num.wordsAfter.slice(0, 2).join(" ");
        const units2 = spokenUnitsIn(immediate2);
        if (units2.size > 0) return Array.from(units2)[0];
    }
    return null;
}

function isPriceNumber(num: ExtractedNumber): boolean {
    return (
        PRICE_KEYWORDS.test(num.raw) ||
        num.wordsBefore.some((w) => PRICE_KEYWORDS.test(w)) ||
        num.wordsAfter.some((w) => PRICE_KEYWORDS.test(w))
    );
}
/**
 * Deterministically extracts candidate document structure from turns when no LLM candidate is supplied.
 */
export function extractCandidateFromTurns(
    turns: Turn[],
    locale: Locale,
    project?: Proyek
): CandidateDocument {
    const pekerjaan: CandidatePekerjaanItem[] = [];

    for (const turn of turns) {
        if (!turn.final) continue;
        const transcript = turn.transcript.trim();
        if (!transcript) continue;

        // Violation 1: Require a price keyword before creating a priced line item
        if (!PRICE_KEYWORDS.test(transcript)) {
            continue;
        }

        const numbers = extractNumbersWithContext(transcript, locale);
        if (numbers.length === 0) continue;

        const allSpokenUnits = spokenUnitsIn(transcript);

        // Violation 2: Associate each value with its unit and price context
        const rateCandidates = numbers.filter(isPriceNumber);
        const rateNum =
            rateCandidates.length > 0
                ? rateCandidates[rateCandidates.length - 1]
                : numbers[numbers.length - 1];

        const nonRateNumbers = numbers.filter((n) => n !== rateNum);
        let volumeNum = nonRateNumbers.find(
            (n) => getImmediateUnitForNumber(n) !== null
        );

        let unit: CanonicalUnit = "unit";
        if (volumeNum) {
            unit =
                getImmediateUnitForNumber(volumeNum) ||
                (allSpokenUnits.size > 0
                    ? Array.from(allSpokenUnits)[0]
                    : "unit");
        } else if (nonRateNumbers.length > 0) {
            volumeNum = nonRateNumbers[0];
            unit =
                allSpokenUnits.size > 0
                    ? Array.from(allSpokenUnits)[0]
                    : "unit";
        } else {
            unit =
                allSpokenUnits.size > 0
                    ? Array.from(allSpokenUnits)[0]
                    : "unit";
        }

        const vol = volumeNum ? volumeNum.value : 1;
        const rate = rateNum.value;

        const cutIdx = volumeNum
            ? Math.min(volumeNum.startIndex, rateNum.startIndex)
            : rateNum.startIndex;
        let uraian = transcript
            .slice(0, cutIdx)
            .trim()
            .replace(/[,;:]+$/, "")
            .trim();
        if (!uraian || uraian.length < 3) {
            uraian = transcript
                .split(",")[0]
                .trim()
                .replace(/[,;:]+$/, "")
                .trim();
        }

        pekerjaan.push({
            uraian: uraian || `Pekerjaan ${pekerjaan.length + 1}`,
            volume: vol,
            satuan: unit,
            harga_satuan: rate,
            sumber_kutipan: turn.turn_id,
        });
    }

    return {
        jenis: "surat_penawaran",
        locale,
        mata_uang: locale === "en" ? "USD" : "IDR",
        proyek: project || {
            nama: "Proyek Lapangan",
            lokasi: "Lokasi Proyek",
            klien: "Klien",
        },
        pekerjaan,
    };
}
