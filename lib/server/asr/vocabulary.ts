import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import quotationSchema from "@/contracts/quotation.schema.json";
import { SPOKEN_UNITS } from "@/lib/server/guard/words";

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

/** Kept short: the bias list rides along with every transcription request. */
const MAX_SEED_TERMS_PER_LOCALE = 32;
const SEED_TRANSCRIPT_DIR = join(process.cwd(), "fixtures", "transcripts");

const SPOKEN_FORMS = SPOKEN_UNITS as unknown as Record<
    string,
    readonly string[] | undefined
>;

/**
 * Every `satuan` the quotation contract accepts, expressed the way a
 * technician says it. A new unit in the schema must also get spoken forms in
 * the guard lexicon; failing here keeps the two vocabularies from drifting.
 */
export const SCHEMA_UNIT_TERMS: readonly string[] =
    quotationSchema.properties.pekerjaan.items.properties.satuan.enum.flatMap(
        (unit) => {
            const spoken = SPOKEN_FORMS[unit];
            if (!spoken) {
                throw new Error(
                    `No spoken forms for satuan "${unit}" in SPOKEN_UNITS`
                );
            }
            return [...spoken];
        }
    );

type SeedFixture = {
    locale?: unknown;
    expected_document?: {
        pekerjaan?: { uraian?: unknown; satuan?: unknown }[];
    };
};

/**
 * Materials, units and field terms the app already ships as expected quotation
 * data, read from `uraian` and `satuan` only. Project, client and place names
 * are deliberately not seeded — they arrive as session terms from recorded
 * turns. Terms are counted per locale so one-off items do not dominate the
 * bias list; the corpus is read at startup, not copied into this file.
 */
function seedTermsFromCorpus(): Record<Locale, string[]> {
    const counts: Record<Locale, Map<string, number>> = {
        en: new Map(),
        id: new Map(),
    };
    let files: string[];
    try {
        files = readdirSync(SEED_TRANSCRIPT_DIR).filter((name) =>
            name.endsWith(".json")
        );
    } catch {
        // A deployment that omits the fixture corpus still gets schema units.
        return { en: [], id: [] };
    }

    for (const name of files) {
        let fixture: SeedFixture;
        try {
            fixture = JSON.parse(
                readFileSync(join(SEED_TRANSCRIPT_DIR, name), "utf8")
            ) as SeedFixture;
        } catch {
            continue;
        }
        if (fixture.locale !== "en" && fixture.locale !== "id") continue;

        const texts: string[] = [];
        for (const item of fixture.expected_document?.pekerjaan ?? []) {
            if (typeof item?.uraian === "string") texts.push(item.uraian);
            if (typeof item?.satuan === "string") texts.push(item.satuan);
        }

        const inThisFixture = new Set<string>();
        for (const text of texts) {
            for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
                if (
                    word.length < 4 ||
                    /^\d+$/.test(word) ||
                    COMMON_STOP_WORDS.has(word)
                ) {
                    continue;
                }
                inThisFixture.add(word);
            }
        }
        const localeCounts = counts[fixture.locale];
        for (const word of inThisFixture) {
            localeCounts.set(word, (localeCounts.get(word) ?? 0) + 1);
        }
    }

    const pick = (locale: Locale): string[] =>
        [...counts[locale].entries()]
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, MAX_SEED_TERMS_PER_LOCALE)
            .map(([word]) => word);

    return { en: pick("en"), id: pick("id") };
}

const SEED_TERMS = seedTermsFromCorpus();

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
        const isAllStopWords = words.every((word) => {
            const cleaned = word.toLowerCase().replace(/[^a-z0-9_-]/g, "");
            return cleaned.length > 0 && COMMON_STOP_WORDS.has(cleaned);
        });
        if (!isAllStopWords) {
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
 * 2. Spoken forms of every `satuan` in quotation.schema.json.
 * 3. Materials and field terms from the shipped quotation seed corpus.
 * 4. Significant terms from recorded turns or project vocabulary (client/project/place names).
 */
export function buildKeywords(
    locale: Locale,
    spokenTerms?: readonly SpokenTermInput[] | null
): string[] {
    const baseline = KEYWORDS[locale] ?? KEYWORDS.id;
    const domain: readonly string[] = SCHEMA_UNIT_TERMS;
    const seed = SEED_TERMS[locale] ?? SEED_TERMS.id;

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

    const merged = [...baseline, ...domain, ...seed, ...sessionTerms];
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
