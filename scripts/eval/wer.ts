/**
 * Word Error Rate (WER) and Levenshtein alignment computation.
 *
 * Implements standard speech recognition evaluation:
 *   WER = Levenshtein edit distance (words) / reference word count
 *
 * Also isolates money/volume tokens (numbers, units, currency, price keywords)
 * to evaluate numerical integrity separately from conversational phrasing.
 */

export type EditOp = "equal" | "substitute" | "insert" | "delete";

export interface AlignmentStep {
    op: EditOp;
    ref?: string;
    hyp?: string;
}

export interface WerResult {
    wer: number;
    distance: number;
    referenceWords: number;
    hypothesisWords: number;
    substitutions: number;
    insertions: number;
    deletions: number;
    alignment: AlignmentStep[];
}

export interface MoneyVolumeWerResult {
    wer: number;
    distance: number;
    referenceTokens: string[];
    hypothesisTokens: string[];
    referenceCount: number;
    hypothesisCount: number;
    substitutions: number;
    insertions: number;
    deletions: number;
}

const NUMBER_WORDS_EN = new Set([
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "hundred",
    "thousand",
    "million",
    "half",
]);

const NUMBER_WORDS_ID = new Set([
    "nol",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
    "belas",
    "puluh",
    "seratus",
    "ratus",
    "seribu",
    "ribu",
    "sejuta",
    "juta",
    "setengah",
]);

const SPOKEN_UNIT_TOKENS = new Set([
    "square",
    "feet",
    "foot",
    "sq",
    "ft",
    "sqft",
    "meters",
    "meter",
    "m2",
    "m3",
    "cubic",
    "linear",
    "lin",
    "bags",
    "bag",
    "sak",
    "sheets",
    "sheet",
    "lembar",
    "bars",
    "bar",
    "batang",
    "points",
    "point",
    "titik",
    "hours",
    "hour",
    "jam",
    "units",
    "unit",
    "buah",
    "hari",
    "fixtures",
    "fixture",
    "persegi",
    "kubik",
]);

const PRICE_TOKENS = new Set([
    "dollar",
    "dollars",
    "usd",
    "bucks",
    "buck",
    "cent",
    "cents",
    "rupiah",
    "rp",
    "ribu",
    "juta",
    "per",
    "each",
    "price",
    "harga",
    "rate",
    "cost",
    "total",
    "borongan",
    "sebatang",
    "semeter",
]);

/**
 * Normalizes text for ASR WER evaluation:
 * - case folding to lowercase
 * - replaces hyphens, underscores, slashes with spaces (e.g. "twenty-four" -> "twenty four")
 * - removes punctuation
 * - collapses multiple whitespaces
 */
export function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[-_/]/g, " ")
        .replace(/[^\w\s.,]/g, "")
        .replace(/[.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Tokenizes text into word tokens after normalization.
 */
export function tokenizeWords(text: string): string[] {
    const norm = normalizeText(text);
    if (!norm) return [];
    return norm.split(/\s+/).filter(Boolean);
}

/**
 * Extracts money and volume tokens (number words, digits, units, price words).
 */
export function extractMoneyVolumeTokens(
    text: string,
    locale: "en" | "id"
): string[] {
    const words = tokenizeWords(text);
    const numWords = locale === "id" ? NUMBER_WORDS_ID : NUMBER_WORDS_EN;

    return words.filter((token) => {
        if (/^\d+(?:[.,]\d+)?$/.test(token)) return true;
        if (numWords.has(token)) return true;
        if (SPOKEN_UNIT_TOKENS.has(token)) return true;
        if (PRICE_TOKENS.has(token)) return true;
        return false;
    });
}

/**
 * Levenshtein distance on token arrays with full alignment backtracking.
 */
export function levenshteinDistance(
    refTokens: string[],
    hypTokens: string[]
): {
    distance: number;
    substitutions: number;
    insertions: number;
    deletions: number;
    alignment: AlignmentStep[];
} {
    const m = refTokens.length;
    const n = hypTokens.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
        new Array(n + 1).fill(0)
    );

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (refTokens[i - 1] === hypTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] =
                    1 +
                    Math.min(
                        dp[i - 1][j], // deletion
                        dp[i][j - 1], // insertion
                        dp[i - 1][j - 1] // substitution
                    );
            }
        }
    }

    // Backtrack to extract alignment and error counts
    let i = m;
    let j = n;
    let substitutions = 0;
    let insertions = 0;
    let deletions = 0;
    const alignment: AlignmentStep[] = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && refTokens[i - 1] === hypTokens[j - 1]) {
            alignment.unshift({
                op: "equal",
                ref: refTokens[i - 1],
                hyp: hypTokens[j - 1],
            });
            i--;
            j--;
        } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
            alignment.unshift({
                op: "substitute",
                ref: refTokens[i - 1],
                hyp: hypTokens[j - 1],
            });
            substitutions++;
            i--;
            j--;
        } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
            alignment.unshift({ op: "delete", ref: refTokens[i - 1] });
            deletions++;
            i--;
        } else {
            alignment.unshift({ op: "insert", hyp: hypTokens[j - 1] });
            insertions++;
            j--;
        }
    }

    return {
        distance: dp[m][n],
        substitutions,
        insertions,
        deletions,
        alignment,
    };
}

/**
 * Computes overall WER between reference and hypothesis text.
 */
export function computeWer(
    reference: string,
    hypothesis: string
): WerResult {
    const refTokens = tokenizeWords(reference);
    const hypTokens = tokenizeWords(hypothesis);

    const lev = levenshteinDistance(refTokens, hypTokens);
    const m = refTokens.length;
    const n = hypTokens.length;
    const wer = m > 0 ? lev.distance / m : n > 0 ? 1 : 0;

    return {
        wer,
        distance: lev.distance,
        referenceWords: m,
        hypothesisWords: n,
        substitutions: lev.substitutions,
        insertions: lev.insertions,
        deletions: lev.deletions,
        alignment: lev.alignment,
    };
}

/**
 * Computes WER restricted specifically to money and volume tokens.
 */
export function computeMoneyVolumeWer(
    reference: string,
    hypothesis: string,
    locale: "en" | "id"
): MoneyVolumeWerResult {
    const refTokens = extractMoneyVolumeTokens(reference, locale);
    const hypTokens = extractMoneyVolumeTokens(hypothesis, locale);

    const lev = levenshteinDistance(refTokens, hypTokens);
    const m = refTokens.length;
    const n = hypTokens.length;
    const wer = m > 0 ? lev.distance / m : n > 0 ? 1 : 0;

    return {
        wer,
        distance: lev.distance,
        referenceTokens: refTokens,
        hypothesisTokens: hypTokens,
        referenceCount: m,
        hypothesisCount: n,
        substitutions: lev.substitutions,
        insertions: lev.insertions,
        deletions: lev.deletions,
    };
}
