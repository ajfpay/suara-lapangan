import type { Locale } from "./locale";

/**
 * Curated per-locale baseline keywords.
 * Biases recognition without constraining it.
 */
export const KEYWORDS: Record<Locale, string[]> = {
    en: ["drywall", "rebar", "sq ft", "lin ft", "bags", "bars"],
    id: ["cakar ayam", "sak", "batang", "titik", "m2", "borongan"],
};

/**
 * Supported speech recognition languages.
 * Always includes both English and Indonesian to support code-switching.
 */
export const LANGUAGE_BIAS: Record<Locale, string[]> = {
    en: ["English", "Indonesian"],
    id: ["Indonesian", "English"],
};

/**
 * Spoken domain vocabulary derived from quotation.schema.json `satuan` enum:
 * "m2", "m3", "meter", "sq_ft", "lin_ft", "sak", "batang", "titik", "bag",
 * "sheet", "bar", "point", "hour", "unit", "hari", "fixture" — 16 satuan units.
 * Maps machine keys to their spoken forms plus common trade units.
 */
const SATUAN_SPOKEN_TERMS: Record<Locale, string[]> = {
    en: [
        "square meter",
        "cubic meter",
        "square foot",
        "linear foot",
        "sq ft",
        "lin ft",
        "bags",
        "bars",
        "sheets",
        "points",
        "hours",
        "units",
        "days",
        "fixtures",
        "m2",
    ],
    id: [
        "meter persegi",
        "meter kubik",
        "square foot",
        "sq ft",
        "sak",
        "batang",
        "titik",
        "borongan",
        "m2",
        "m3",
        "lembar",
        "kantong",
        "jam",
        "hari",
        "unit",
        "fixture",
    ],
};

const COMMON_STOP_WORDS = new Set([
    // Indonesian
    "dan",
    "di",
    "ke",
    "dari",
    "ini",
    "itu",
    "ada",
    "untuk",
    "dengan",
    "yang",
    "saya",
    "kami",
    "kita",
    "bisa",
    "tolong",
    "halo",
    "selamat",
    "pagi",
    "siang",
    "sore",
    "malam",
    "terima",
    "kasih",
    "ya",
    "sudah",
    "belum",
    "akan",
    // English
    "the",
    "and",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "this",
    "that",
    "it",
    "we",
    "you",
    "good",
    "morning",
    "afternoon",
    "evening",
    "hello",
    "please",
    "thanks",
    "thank",
    "need",
    "have",
    "yes",
    "no",
    "not",
]);

export type SpokenTermInput = string | { transcript?: string | null };

/**
 * Extracts significant terms (e.g. client, project, place names, capitalized proper nouns)
 * from a spoken phrase or sentence.
 */
function extractTermsFromText(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const extracted: string[] = [];

    // If the entire text is a short term or name (<= 4 words, no sentence end punctuation),
    // include it directly.
    const words = trimmed.split(/\s+/);
    if (words.length <= 4 && !/[.!?]$/.test(trimmed)) {
        if (!COMMON_STOP_WORDS.has(trimmed.toLowerCase())) {
            extracted.push(trimmed);
        }
    }

    // Extract capitalized words or acronyms (e.g. "Budi", "Kemang", "Wika", "PT")
    const capitalizedMatches = trimmed.match(/\b[A-Z][a-zA-Z0-9_-]{1,30}\b/g);
    if (capitalizedMatches) {
        for (const match of capitalizedMatches) {
            if (!COMMON_STOP_WORDS.has(match.toLowerCase())) {
                extracted.push(match);
            }
        }
    }

    return extracted;
}

/**
 * Builds vocabulary biasing keywords merging:
 * 1. Curated per-locale KEYWORDS baseline.
 * 2. Spoken domain vocabulary derived from quotation.schema.json `satuan` enum.
 * 3. Significant terms from recorded turns or project vocabulary (client/project/place names).
 */
export function buildKeywords(
    locale: Locale,
    spokenTerms?: readonly SpokenTermInput[] | null
): string[] {
    const baseline = KEYWORDS[locale] ?? KEYWORDS.id;
    const domain = SATUAN_SPOKEN_TERMS[locale] ?? SATUAN_SPOKEN_TERMS.id;

    const sessionTerms: string[] = [];
    if (spokenTerms && Array.isArray(spokenTerms)) {
        for (const item of spokenTerms) {
            if (!item) continue;
            const text = typeof item === "string" ? item : item.transcript;
            if (text && typeof text === "string") {
                sessionTerms.push(...extractTermsFromText(text));
            }
        }
    }

    const merged = [...baseline, ...domain, ...sessionTerms];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const term of merged) {
        const cleaned = term.trim();
        if (!cleaned) continue;
        const normalized = cleaned.toLowerCase();
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(cleaned);
        }
    }

    return result;
}
