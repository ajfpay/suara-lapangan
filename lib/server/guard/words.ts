import type { CanonicalUnit, Locale } from "./types";

export const SPOKEN_UNITS: Record<CanonicalUnit, string[]> = {
    m2: ["square meters", "square meter", "meter persegi", "sq m", "m2"],
    m3: ["cubic meters", "meter kubik", "kubik", "m3"],
    meter: ["linear meters", "meter"],
    sq_ft: ["square feet", "square foot", "sq ft", "sqft"],
    lin_ft: ["linear feet", "linear foot", "lin ft"],
    sak: ["sak"],
    batang: ["batang"],
    titik: ["titik"],
    bag: ["bags", "bag"],
    sheet: ["sheets", "sheet"],
    bar: ["bars", "bar"],
    point: ["points", "point"],
    hour: ["hours", "hour"],
    unit: ["units", "unit", "buah"],
    hari: ["hari"],
    fixture: ["fixtures", "fixture"],
};

export const PRICE_KEYWORDS =
    /\b(harga|price|rate|cost|dollars?|usd|bucks|rupiah|ribu|juta|borongan|per|each|total)\b/i;

export const VOLUME_KEYWORDS =
    /\b(meter|meters|m2|m3|sak|batang|titik|sq\s*ft|lin\s*ft|bags?|sheets?|bars?|points?|hours?|units?|hari|fixtures?|square|sq|feet|foot|linear|lin|kubik)\b/i;

export const EN_NUMBER_WORD_PATTERN =
    /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|hundred|thousand|million)(?:\s+(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|hundred|thousand|million|and))*\b/gi;

/** Returns canonical units mentioned in text. */
export function spokenUnitsIn(text: string): Set<CanonicalUnit> {
    const found = new Set<CanonicalUnit>();
    const phrases = (
        Object.entries(SPOKEN_UNITS) as [CanonicalUnit, string[]][]
    )
        .flatMap(([unit, words]) => words.map((word) => [word, unit] as const))
        .sort((a, b) => b[0].length - a[0].length);

    const matchedSpans: [number, number][] = [];
    for (const [phrase, unit] of phrases) {
        const regex = new RegExp(`\\b${phrase}\\b`, "gi");
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            const overlaps = matchedSpans.some(([s, e]) => start < e && end > s);
            if (!overlaps) {
                matchedSpans.push([start, end]);
                found.add(unit);
            }
        }
    }
    return found;
}

function terbilangNumber(n: number): string {
    const SATUAN = [
        "",
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
    ];
    if (n === 0) return "nol";
    if (n < 12) return SATUAN[n];
    if (n < 20) return terbilangNumber(n - 10) + " belas";
    if (n < 100) {
        const rest = n % 10;
        return (
            terbilangNumber(Math.floor(n / 10)) +
            " puluh" +
            (rest ? " " + terbilangNumber(rest) : "")
        );
    }
    if (n < 200)
        return "seratus" + (n % 100 ? " " + terbilangNumber(n % 100) : "");
    if (n < 1000) {
        const rest = n % 100;
        return (
            terbilangNumber(Math.floor(n / 100)) +
            " ratus" +
            (rest ? " " + terbilangNumber(rest) : "")
        );
    }
    if (n < 2000)
        return "seribu" + (n % 1000 ? " " + terbilangNumber(n % 1000) : "");
    if (n < 1000000) {
        const rest = n % 1000;
        return (
            terbilangNumber(Math.floor(n / 1000)) +
            " ribu" +
            (rest ? " " + terbilangNumber(rest) : "")
        );
    }
    if (n < 1000000000) {
        const rest = n % 1000000;
        return (
            terbilangNumber(Math.floor(n / 1000000)) +
            " juta" +
            (rest ? " " + terbilangNumber(rest) : "")
        );
    }
    if (n < 1000000000000) {
        const rest = n % 1000000000;
        return (
            terbilangNumber(Math.floor(n / 1000000000)) +
            " miliar" +
            (rest ? " " + terbilangNumber(rest) : "")
        );
    }
    if (n < 1000000000000000) {
        const rest = n % 1000000000000;
        return (
            terbilangNumber(Math.floor(n / 1000000000000)) +
            " triliun" +
            (rest ? " " + terbilangNumber(rest) : "")
        );
    }
    return String(n);
}

/** Formats integer as Indonesian terbilang ending in "rupiah". */
export function terbilang(n: number): string {
    const text = terbilangNumber(Math.round(n));
    return text.charAt(0).toUpperCase() + text.slice(1) + " rupiah";
}

function englishNumber(n: number): string {
    const ONES = [
        "",
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
    ];
    const TENS = [
        "",
        "",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
    ];
    if (n === 0) return "zero";
    if (n < 20) return ONES[n];
    if (n < 100) {
        const rest = n % 10;
        return TENS[Math.floor(n / 10)] + (rest ? "-" + ONES[rest] : "");
    }
    if (n < 1000) {
        const rest = n % 100;
        return (
            ONES[Math.floor(n / 100)] +
            " hundred" +
            (rest ? " " + englishNumber(rest) : "")
        );
    }
    if (n < 1000000) {
        const rest = n % 1000;
        return (
            englishNumber(Math.floor(n / 1000)) +
            " thousand" +
            (rest ? " " + englishNumber(rest) : "")
        );
    }
    if (n < 1000000000) {
        const rest = n % 1000000;
        return (
            englishNumber(Math.floor(n / 1000000)) +
            " million" +
            (rest ? " " + englishNumber(rest) : "")
        );
    }
    if (n < 1000000000000) {
        const rest = n % 1000000000;
        return (
            englishNumber(Math.floor(n / 1000000000)) +
            " billion" +
            (rest ? " " + englishNumber(rest) : "")
        );
    }
    if (n < 1000000000000000) {
        const rest = n % 1000000000000;
        return (
            englishNumber(Math.floor(n / 1000000000000)) +
            " trillion" +
            (rest ? " " + englishNumber(rest) : "")
        );
    }
    return String(n);
}

/** Formats amount as English words ending in "US dollars", including cents if non-integer. */
export function amountInWords(n: number): string {
    const totalCents = Math.round(n * 100);
    const dollars = Math.floor(totalCents / 100);
    const cents = totalCents % 100;
    const dollarText = englishNumber(dollars);
    const cap = dollarText.charAt(0).toUpperCase() + dollarText.slice(1);
    if (cents > 0) {
        const centText = englishNumber(cents);
        return `${cap} US dollars and ${centText} cents`;
    }
    return `${cap} US dollars`;
}

export type ExtractedNumber = {
    value: number;
    raw: string;
    startIndex: number;
    endIndex: number;
    wordsBefore: string[];
    wordsAfter: string[];
};

/**
 * Extracts all numeric values from text (both digits and spoken words) in English or Indonesian,
 * including context words ±6 words.
 */
export function extractNumbersWithContext(
    transcript: string,
    locale: Locale
): ExtractedNumber[] {
    const rawCandidates: ExtractedNumber[] = [];

    // Helper to get surrounding words
    const getSurroundingWords = (charStart: number, charEnd: number) => {
        const beforeStr = transcript.slice(0, charStart).trim();
        const afterStr = transcript.slice(charEnd).trim();
        const wordsBefore = beforeStr
            ? beforeStr
                  .split(/\s+/)
                  .map((w) => w.replace(/[^\w-]/g, "").toLowerCase())
                  .filter(Boolean)
                  .slice(-6)
            : [];
        const wordsAfter = afterStr
            ? afterStr
                  .split(/\s+/)
                  .map((w) => w.replace(/[^\w-]/g, "").toLowerCase())
                  .filter(Boolean)
                  .slice(0, 6)
            : [];
        return { wordsBefore, wordsAfter };
    };

    let match: RegExpExecArray | null;

    if (locale === "id") {
        // ID thousands grouping (150.000 or 1.500.000)
        const idThousandsRegex = /\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g;
        while ((match = idThousandsRegex.exec(transcript)) !== null) {
            const clean = match[0].replace(/\./g, "").replace(",", ".");
            const val = parseFloat(clean);
            const { wordsBefore, wordsAfter } = getSurroundingWords(
                match.index,
                match.index + match[0].length
            );
            rawCandidates.push({
                value: val,
                raw: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                wordsBefore,
                wordsAfter,
            });
        }

        // ID comma decimal (24,5 or 12,5)
        const idCommaDecimalRegex = /\b\d+,\d+\b/g;
        while ((match = idCommaDecimalRegex.exec(transcript)) !== null) {
            const val = parseFloat(match[0].replace(",", "."));
            const { wordsBefore, wordsAfter } = getSurroundingWords(
                match.index,
                match.index + match[0].length
            );
            rawCandidates.push({
                value: val,
                raw: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                wordsBefore,
                wordsAfter,
            });
        }

        // ID dot decimal with 1 or 2 fractional digits (e.g. 2.5 or 2.5 juta)
        const idDotDecimalRegex = /\b\d+\.\d{1,2}\b/g;
        while ((match = idDotDecimalRegex.exec(transcript)) !== null) {
            const val = parseFloat(match[0]);
            const { wordsBefore, wordsAfter } = getSurroundingWords(
                match.index,
                match.index + match[0].length
            );
            rawCandidates.push({
                value: val,
                raw: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                wordsBefore,
                wordsAfter,
            });
        }
    } else {
        // EN thousands grouping (1,500 or 1,500,000)
        const enThousandsRegex = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g;
        while ((match = enThousandsRegex.exec(transcript)) !== null) {
            const clean = match[0].replace(/,/g, "");
            const val = parseFloat(clean);
            const { wordsBefore, wordsAfter } = getSurroundingWords(
                match.index,
                match.index + match[0].length
            );
            rawCandidates.push({
                value: val,
                raw: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                wordsBefore,
                wordsAfter,
            });
        }

        // EN dot decimal (24.5 or 12.5)
        const enDotDecimalRegex = /\b\d+\.\d+\b/g;
        while ((match = enDotDecimalRegex.exec(transcript)) !== null) {
            const val = parseFloat(match[0]);
            const { wordsBefore, wordsAfter } = getSurroundingWords(
                match.index,
                match.index + match[0].length
            );
            rawCandidates.push({
                value: val,
                raw: match[0],
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                wordsBefore,
                wordsAfter,
            });
        }
    }

    // Plain integers (e.g. "24", "800")
    const integerRegex = /\b\d+\b/g;
    while ((match = integerRegex.exec(transcript)) !== null) {
        const val = parseInt(match[0], 10);
        const { wordsBefore, wordsAfter } = getSurroundingWords(
            match.index,
            match.index + match[0].length
        );
        rawCandidates.push({
            value: val,
            raw: match[0],
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            wordsBefore,
            wordsAfter,
        });
    }

    if (locale === "id") {
        const idPhrases: [RegExp, (m: RegExpExecArray) => number][] = [
            [/\bsetengah\s+juta\b/gi, () => 500000],
            [/\bseperempat\s+juta\b/gi, () => 250000],
            [/\bsetengah\b/gi, () => 0.5],
            [/\bseperempat\b/gi, () => 0.25],
        ];
        for (const [pattern, resolver] of idPhrases) {
            pattern.lastIndex = 0;
            while ((match = pattern.exec(transcript)) !== null) {
                const val = resolver(match);
                const { wordsBefore, wordsAfter } = getSurroundingWords(
                    match.index,
                    match.index + match[0].length
                );
                rawCandidates.push({
                    value: val,
                    raw: match[0],
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                    wordsBefore,
                    wordsAfter,
                });
            }
        }

        const idNumWordsPattern =
            /\b(?:(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|belas|puluh|ratus|ribu|juta)(?:\s+koma\s+(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|nol)(?:\s+(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|nol))*)?(?:\s+(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|belas|puluh|ratus|ribu|juta))*)\b/gi;

        while ((match = idNumWordsPattern.exec(transcript)) !== null) {
            const raw = match[0].trim();
            const val = parseIndonesianPhrase(raw);
            if (val !== null && !isNaN(val)) {
                const { wordsBefore, wordsAfter } = getSurroundingWords(
                    match.index,
                    match.index + raw.length
                );
                rawCandidates.push({
                    value: val,
                    raw,
                    startIndex: match.index,
                    endIndex: match.index + raw.length,
                    wordsBefore,
                    wordsAfter,
                });
            }
        }
    } else {
        const enPhrases: [RegExp, (m: RegExpExecArray) => number][] = [
            [/\bhalf\s+a\s+million\b/gi, () => 500000],
            [/\bhalf\b/gi, () => 0.5],
            [/\ba\s+quarter\b/gi, () => 0.25],
            [/\bquarter\b/gi, () => 0.25],
            [
                /\b(\w+)\s+dollars?\s+and\s+(\w+)\s+cents?\b/gi,
                (m) => {
                    const dol = parseEnglishPhrase(m[1]) ?? 0;
                    const cent = parseEnglishPhrase(m[2]) ?? 0;
                    return dol + cent / 100;
                },
            ],
        ];

        for (const [pattern, resolver] of enPhrases) {
            pattern.lastIndex = 0;
            while ((match = pattern.exec(transcript)) !== null) {
                const val = resolver(match);
                const { wordsBefore, wordsAfter } = getSurroundingWords(
                    match.index,
                    match.index + match[0].length
                );
                rawCandidates.push({
                    value: val,
                    raw: match[0],
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                    wordsBefore,
                    wordsAfter,
                });
            }
        }

        EN_NUMBER_WORD_PATTERN.lastIndex = 0;
        while ((match = EN_NUMBER_WORD_PATTERN.exec(transcript)) !== null) {
            const raw = match[0].trim();
            const val = parseEnglishPhrase(raw);
            if (val !== null && !isNaN(val)) {
                const { wordsBefore, wordsAfter } = getSurroundingWords(
                    match.index,
                    match.index + raw.length
                );
                rawCandidates.push({
                    value: val,
                    raw,
                    startIndex: match.index,
                    endIndex: match.index + raw.length,
                    wordsBefore,
                    wordsAfter,
                });
            }
        }
    }

    // Keep longest match per span
    const sortedByLength = [...rawCandidates].sort((a, b) => {
        const lenA = a.endIndex - a.startIndex;
        const lenB = b.endIndex - b.startIndex;
        if (lenB !== lenA) return lenB - lenA;
        return a.startIndex - b.startIndex;
    });

    const accepted: ExtractedNumber[] = [];
    for (const cand of sortedByLength) {
        const overlaps = accepted.some(
            (acc) => cand.startIndex < acc.endIndex && cand.endIndex > acc.startIndex
        );
        if (!overlaps) {
            accepted.push(cand);
        }
    }

    // Return sorted in transcript order
    accepted.sort((a, b) => a.startIndex - b.startIndex);
    return accepted;
}

export function parseIndonesianPhrase(phrase: string): number | null {
    const clean = phrase.trim().toLowerCase();
    if (clean === "setengah juta") return 500000;
    if (clean === "seperempat juta") return 250000;
    if (clean === "setengah") return 0.5;
    if (clean === "seperempat") return 0.25;

    if (clean.includes(" koma ")) {
        const parts = clean.split(" koma ");
        if (parts.length === 2) {
            const w = parseIndonesianPhrase(parts[0]);
            if (w !== null) {
                const fracTokens = parts[1].trim().split(/\s+/).filter(Boolean);
                const fracDigitsMap: Record<string, string> = {
                    nol: "0", satu: "1", dua: "2", tiga: "3", empat: "4",
                    lima: "5", enam: "6", tujuh: "7", delapan: "8", sembilan: "9"
                };
                let fracStr = "";
                let allDigits = true;
                for (const token of fracTokens) {
                    if (token in fracDigitsMap) {
                        fracStr += fracDigitsMap[token];
                    } else if (/^\d+$/.test(token)) {
                        fracStr += token;
                    } else {
                        allDigits = false;
                        break;
                    }
                }
                if (allDigits && fracStr.length > 0) {
                    return parseFloat(`${w}.${fracStr}`);
                }
                const f = parseIndonesianPhrase(parts[1]);
                if (f !== null) {
                    return parseFloat(`${w}.${f}`);
                }
            }
        }
    }


    const DIGITS: Record<string, number> = {
        nol: 0,
        satu: 1,
        dua: 2,
        tiga: 3,
        empat: 4,
        lima: 5,
        enam: 6,
        tujuh: 7,
        delapan: 8,
        sembilan: 9,
        sepuluh: 10,
        sebelas: 11,
        seratus: 100,
        seribu: 1000,
        sejuta: 1000000,
    };

    const tokens = clean.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;

    let total = 0;
    let section = 0;
    let current = 0;

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === "setengah") {
            current += 0.5;
        } else if (t === "seperempat") {
            current += 0.25;
        } else if (t in DIGITS) {
            if (t === "seratus") {
                section += 100;
                current = 0;
            } else if (t === "seribu") {
                total += (section || current || 1) * 1000;
                section = 0;
                current = 0;
            } else if (t === "sejuta") {
                total += (section || current || 1) * 1000000;
                section = 0;
                current = 0;
            } else {
                current = DIGITS[t];
            }
        } else if (t === "belas") {
            section += current + 10;
            current = 0;
        } else if (t === "puluh") {
            section += current * 10;
            current = 0;
        } else if (t === "ratus") {
            section += current * 100;
            current = 0;
        } else if (t === "ribu") {
            const mult = section + current || 1;
            total += mult * 1000;
            section = 0;
            current = 0;
        } else if (t === "juta") {
            const mult = section + current || 1;
            total += mult * 1000000;
            section = 0;
            current = 0;
        } else {
            return null;
        }
    }
    return total + section + current;
}

export function parseEnglishPhrase(phrase: string): number | null {
    const ONES: Record<string, number> = {
        zero: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12,
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
        nineteen: 19,
    };
    const TENS: Record<string, number> = {
        twenty: 20,
        thirty: 30,
        forty: 40,
        fifty: 50,
        sixty: 60,
        seventy: 70,
        eighty: 80,
        ninety: 90,
    };

    const rawTokens = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!rawTokens.length) return null;

    const tokens: string[] = [];
    for (const token of rawTokens) {
        if (token.includes("-")) {
            tokens.push(...token.split("-"));
        } else {
            tokens.push(token);
        }
    }

    let total = 0;
    let current = 0;

    for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i];
        if (word === "and") continue;
        if (word === "half") {
            current += 0.5;
        } else if (word === "quarter") {
            current += 0.25;
        } else if (word in ONES) {
            current += ONES[word];
        } else if (word in TENS) {
            current += TENS[word];
        } else if (word === "hundred") {
            // "three hundred" -> 300, "twelve hundred" -> 1200
            current = (current === 0 ? 1 : current) * 100;
        } else if (word === "thousand") {
            total += (current === 0 ? 1 : current) * 1000;
            current = 0;
        } else if (word === "million") {
            total += (current === 0 ? 1 : current) * 1000000;
            current = 0;
        } else {
            return null;
        }
    }
    return total + current;
}
