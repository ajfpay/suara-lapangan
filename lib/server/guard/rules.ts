import type {
    ButuhKonfirmasiItem,
    CanonicalUnit,
    CandidateDocument,
    CandidatePekerjaanItem,
    DocumentResult,
    DocumentStatus,
    Locale,
    PekerjaanItem,
    Proyek,
    QuotationDocument,
    Turn,
} from "./types";
import {
    amountInWords,
    extractNumbersWithContext,
    PRICE_KEYWORDS,
    SPOKEN_UNITS,
    spokenUnitsIn,
    terbilang,
} from "./words";

export type GuardContext = {
    locale?: Locale;
    project?: Proyek;
    date?: string;
    nomor?: string;
    sessionId?: string;
};

const VALID_UNITS = new Set<string>(Object.keys(SPOKEN_UNITS));

function isCanonicalUnit(unit: unknown): unit is CanonicalUnit {
    return typeof unit === "string" && VALID_UNITS.has(unit);
}

function formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function defaultNomor(dateStr: string): string {
    return `SL/QTN/${dateStr}/001`;
}

/**
 * Validates candidate against schema baseline and applies the 5 deterministic guard rules:
 * 1. Citation isolation: sumber_kutipan must cite a final=true turn in the session.
 * 2. Unit and number presence in cited turn transcript.
 * 3. Context keywords ±6 words (harga vs volume).
 * 4. Bilingual normalization (kata-angka, koma, fractions, tens/hundreds).
 * 5. Server-computed arithmetic (jumlah, total_nominal, terbilang).
 */
export function applyGuard(
    candidate: CandidateDocument,
    turns: Turn[],
    context?: GuardContext
): DocumentResult {
    const butuh_konfirmasi: ButuhKonfirmasiItem[] = [];

    const locale: Locale =
        context?.locale === "en" || context?.locale === "id"
            ? context.locale
            : candidate.locale === "id"
              ? "id"
              : "en";

    const mata_uang: "USD" | "IDR" = locale === "en" ? "USD" : "IDR";
    const tanggal =
        typeof candidate.tanggal === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(candidate.tanggal)
            ? candidate.tanggal
            : context?.date ?? formatDate(new Date());

    const nomor = context?.nomor ?? defaultNomor(tanggal);

    // Project extraction
    const rawProyek =
        candidate.proyek && typeof candidate.proyek === "object"
            ? (candidate.proyek as Record<string, unknown>)
            : undefined;

    const proyek: Proyek = {
        nama:
            typeof rawProyek?.nama === "string" && rawProyek.nama.trim()
                ? rawProyek.nama
                : typeof context?.project?.nama === "string" && context.project.nama.trim()
                  ? context.project.nama
                  : "Proyek Lapangan",
        lokasi:
            typeof rawProyek?.lokasi === "string" && rawProyek.lokasi.trim()
                ? rawProyek.lokasi
                : typeof context?.project?.lokasi === "string" && context.project.lokasi.trim()
                  ? context.project.lokasi
                  : "Lokasi Proyek",
        klien:
            typeof rawProyek?.klien === "string" && rawProyek.klien.trim()
                ? rawProyek.klien
                : typeof context?.project?.klien === "string" && context.project.klien.trim()
                  ? context.project.klien
                  : "Klien",
    };

    // Pre-index turns
    const turnById = new Map<string, Turn>();
    for (const turn of turns) {
        turnById.set(turn.turn_id, turn);
    }

    const rawPekerjaan = Array.isArray(candidate.pekerjaan)
        ? (candidate.pekerjaan as CandidatePekerjaanItem[])
        : [];

    const pekerjaan: PekerjaanItem[] = [];

    // Process each pekerjaan item
    rawPekerjaan.forEach((rawItem, index) => {
        const itemFieldPrefix = `pekerjaan[${index}]`;

        const uraian =
            typeof rawItem.uraian === "string" && rawItem.uraian.trim()
                ? rawItem.uraian.trim()
                : `Pekerjaan ${index + 1}`;

        const volume =
            typeof rawItem.volume === "number" && !isNaN(rawItem.volume)
                ? rawItem.volume
                : typeof rawItem.volume === "string" &&
                    !isNaN(parseFloat(rawItem.volume))
                  ? parseFloat(rawItem.volume)
                  : 0;

        if (!isCanonicalUnit(rawItem.satuan)) {
            butuh_konfirmasi.push({
                field: `${itemFieldPrefix}.satuan`,
                alasan: `Satuan '${rawItem.satuan}' bukan satuan kanonikal yang valid`,
                sumber_kutipan: typeof rawItem.sumber_kutipan === "string" ? rawItem.sumber_kutipan : null,
            });
        }

        const satuan: CanonicalUnit = isCanonicalUnit(rawItem.satuan)
            ? rawItem.satuan
            : "unit";

        const harga_satuan =
            typeof rawItem.harga_satuan === "number" &&
            !isNaN(rawItem.harga_satuan)
                ? rawItem.harga_satuan
                : typeof rawItem.harga_satuan === "string" &&
                    !isNaN(parseFloat(rawItem.harga_satuan))
                  ? parseFloat(rawItem.harga_satuan)
                  : 0;

        const rawJumlah =
            typeof rawItem.jumlah === "number"
                ? rawItem.jumlah
                : typeof rawItem.jumlah === "string" &&
                    !isNaN(parseFloat(rawItem.jumlah))
                  ? parseFloat(rawItem.jumlah)
                  : undefined;

        const sumber_kutipan =
            typeof rawItem.sumber_kutipan === "string"
                ? rawItem.sumber_kutipan
                : "";

        // Rule 1: Citation isolation
        const citedTurn = turnById.get(sumber_kutipan);
        let turnValid = false;

        if (!sumber_kutipan || !citedTurn) {
            butuh_konfirmasi.push({
                field: `${itemFieldPrefix}.sumber_kutipan`,
                alasan: `sumber_kutipan '${sumber_kutipan || "null"}' bukan giliran dari sesi ini`,
                sumber_kutipan: sumber_kutipan || null,
            });
        } else if (citedTurn.final !== true) {
            butuh_konfirmasi.push({
                field: `${itemFieldPrefix}.sumber_kutipan`,
                alasan: `sumber_kutipan '${sumber_kutipan}' bukan giliran final (final = false)`,
                sumber_kutipan,
            });
        } else {
            turnValid = true;
        }

        if (turnValid && citedTurn) {
            const transcript = citedTurn.transcript;

            // Rule 2: Spoken unit check
            const spokenUnits = spokenUnitsIn(transcript);
            if (spokenUnits.size === 0) {
                if (satuan !== "unit") {
                    butuh_konfirmasi.push({
                        field: `${itemFieldPrefix}.satuan`,
                        alasan: `Tidak ada satuan yang disebutkan dalam giliran yang dikutip (${sumber_kutipan})`,
                        sumber_kutipan,
                    });
                }
            } else if (!spokenUnits.has(satuan)) {
                butuh_konfirmasi.push({
                    field: `${itemFieldPrefix}.satuan`,
                    alasan: `Satuan '${satuan}' tidak cocok dengan satuan yang diucapkan dalam giliran (${Array.from(spokenUnits).join(", ")})`,
                    sumber_kutipan,
                });
            }

            // Extract numbers from cited turn transcript with ±6 words context
            const extracted = extractNumbersWithContext(transcript, locale);

            // Rule 2 & 4: Volume number check
            const matchingVolumeMatches = extracted.filter(
                (ext) => Math.abs(ext.value - volume) < 1e-4
            );
            // Allow implied volume = 1 for lump sum / borongan / counted items with unit = "unit"
            const isImpliedUnitVolume =
                volume === 1 &&
                satuan === "unit" &&
                (/\b(borongan|whole\s+run|whole\s+thing)\b/i.test(transcript) ||
                    spokenUnits.size === 0);

            if (matchingVolumeMatches.length === 0 && !isImpliedUnitVolume) {
                butuh_konfirmasi.push({
                    field: `${itemFieldPrefix}.volume`,
                    alasan: `Angka volume (${volume}) tidak ditemukan dalam giliran yang dikutip (${sumber_kutipan})`,
                    sumber_kutipan,
                });
            } else if (matchingVolumeMatches.length > 0) {
                // Rule 3: Context keywords ±6 words (harga vs volume)
                // A number written as volume is actually a price if directly adjacent to price words.
                const isPriceNearVolume = matchingVolumeMatches.some((ext) => {
                    if (
                        ext.wordsAfter.length > 0 &&
                        PRICE_KEYWORDS.test(ext.wordsAfter[0])
                    ) {
                        return true;
                    }
                    if (
                        ext.wordsBefore.length > 0 &&
                        PRICE_KEYWORDS.test(
                            ext.wordsBefore[ext.wordsBefore.length - 1]
                        )
                    ) {
                        return true;
                    }
                    return false;
                });
                if (isPriceNearVolume) {
                    butuh_konfirmasi.push({
                        field: `${itemFieldPrefix}.volume`,
                        alasan: `Angka volume (${volume}) dideteksi sebagai harga karena berada di dekat kata kunci harga`,
                        sumber_kutipan,
                    });
                }
            }

            // Rule 2 & 4: Rate and Jumlah number check
            const matchingRateMatches = extracted.filter(
                (ext) =>
                    Math.abs(ext.value - harga_satuan) < 1e-4 &&
                    (PRICE_KEYWORDS.test(ext.raw) ||
                        ext.wordsBefore.some((w) => PRICE_KEYWORDS.test(w)) ||
                        ext.wordsAfter.some((w) => PRICE_KEYWORDS.test(w)))
            );

            if (matchingRateMatches.length === 0) {
                butuh_konfirmasi.push({
                    field: `${itemFieldPrefix}.harga_satuan`,
                    alasan: `Angka harga_satuan (${harga_satuan}) tidak cocok dengan transkrip ternormalisasi pada giliran (${sumber_kutipan})`,
                    sumber_kutipan,
                });

                // Also check if candidate rawJumlah was specified and disagrees with spoken price
                const spokenAmount = extracted.find((ext) => {
                    return (
                        ext.wordsBefore.some((w) => PRICE_KEYWORDS.test(w)) ||
                        ext.wordsAfter.some((w) => PRICE_KEYWORDS.test(w))
                    );
                });

                if (
                    rawJumlah !== undefined &&
                    spokenAmount &&
                    Math.abs(rawJumlah - spokenAmount.value) > 1e-4
                ) {
                    butuh_konfirmasi.push({
                        field: `${itemFieldPrefix}.jumlah`,
                        alasan: `Nilai jumlah (${rawJumlah}) tidak cocok dengan transkrip ternormalisasi (${spokenAmount.value})`,
                        sumber_kutipan,
                    });
                }
            }
        }

        // Rule 5: Server-computed jumlah = volume × harga_satuan
        const computedJumlah =
            Math.round(volume * harga_satuan * 100) / 100;

        if (
            rawJumlah !== undefined &&
            Math.abs(rawJumlah - computedJumlah) > 1e-4
        ) {
            // Only add if not already flagged
            if (
                !butuh_konfirmasi.some(
                    (b) => b.field === `${itemFieldPrefix}.jumlah`
                )
            ) {
                butuh_konfirmasi.push({
                    field: `${itemFieldPrefix}.jumlah`,
                    alasan: `jumlah (${rawJumlah}) tidak cocok dengan volume (${volume}) × harga_satuan (${harga_satuan}) = ${computedJumlah}`,
                    sumber_kutipan: sumber_kutipan || null,
                });
            }
        }

        pekerjaan.push({
            uraian,
            volume,
            satuan,
            harga_satuan,
            jumlah: computedJumlah,
            sumber_kutipan,
        });
    });

    // Rule 5: Server-computed total_nominal and terbilang
    const computedTotal = pekerjaan.reduce(
        (sum, item) => sum + item.jumlah,
        0
    );

    const rawTotal =
        typeof candidate.total_nominal === "number"
            ? candidate.total_nominal
            : typeof candidate.total_nominal === "string" &&
                !isNaN(parseFloat(candidate.total_nominal))
              ? parseFloat(candidate.total_nominal)
              : undefined;

    if (
        rawTotal !== undefined &&
        Math.abs(rawTotal - computedTotal) > 1e-4
    ) {
        butuh_konfirmasi.push({
            field: "total_nominal",
            alasan: `total_nominal (${rawTotal}) tidak cocok dengan jumlah total pekerjaan (${computedTotal})`,
            sumber_kutipan: null,
        });
    }

    const computedTerbilang =
        locale === "en"
            ? amountInWords(computedTotal)
            : terbilang(computedTotal);

    const doc: QuotationDocument = {
        jenis: "surat_penawaran",
        locale,
        mata_uang,
        nomor,
        tanggal,
        proyek,
        pekerjaan,
        total_nominal: computedTotal,
        terbilang: computedTerbilang,
        butuh_konfirmasi,
    };

    if (pekerjaan.length === 0) {
        butuh_konfirmasi.push({
            field: "pekerjaan",
            alasan: "Daftar pekerjaan kosong, minimal harus ada satu pekerjaan",
            sumber_kutipan: null,
        });
    }

    const status: DocumentStatus =
        butuh_konfirmasi.length > 0 ? "perlu_konfirmasi" : "siap";
    return {
        document: doc,
        butuh_konfirmasi,
        status,
    };
}
