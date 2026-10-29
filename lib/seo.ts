import { BASE_URL, DEFAULT_LOCALE, LOCALES } from "@/lib/variables";

export const ROOTKEYWORDS = [
    "surat penawaran",
    "quotation",
    "construction estimate",
    "voice to document",
    "rab rambud",
];

/**
 * The three steps, in order. The first is the locale root.
 *
 * `messageKey` is the catalogue key for the step's name, used by the stepper,
 * the page headings and the Next / Previous labels.
 */
export const STEPS = [
    { path: "/rekam", messageKey: "rekam" },
    { path: "/susun", messageKey: "susun" },
    { path: "/dokumen", messageKey: "dokumen" },
] as const;

export type Step = (typeof STEPS)[number];

/** Path for a locale, always prefixed — routing uses localePrefix "always". */
export const localePath = (locale: string) => `/${locale}`;

/** Full path for a step in a locale; the first step is the locale root. */
export const stepPath = (locale: string, path: string) =>
    `${localePath(locale)}${path}`;

/**
 * `alternates.languages` for Next's metadata.
 *
 * Every locale points at its own path, plus an `x-default` on English.
 */
export function languageAlternates(
    path = "/"
): Record<string, string> {
    const languages: Record<string, string> = {};
    for (const { code } of LOCALES) {
        languages[code] = stepPath(code, path);
    }
    languages["x-default"] = stepPath(DEFAULT_LOCALE, path);
    return languages;
}

/**
 * Structured data for the site.
 *
 * The image points at the generated Open Graph route rather than a hashed
 * build asset, so it cannot go stale after a rebuild.
 */
export function buildJsonLd(locale: string) {
    const url = `${BASE_URL}${localePath(locale)}`;

    return {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "@id": `${BASE_URL}/#app`,
        name: "Suara Lapangan",
        url,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Any",
        description:
            "Record a job in English or Indonesian, check every number against the recording, and issue a formal Quotation / Surat Penawaran.",
        inLanguage: locale,
        keywords: ROOTKEYWORDS,
        image: `${BASE_URL}${localePath(locale)}/opengraph-image`,
        offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
        },
    };
}

/** FAQPage structured data, paired with the FAQ rendered on each step. */
export function buildFaqJsonLd(faqs: { q: string; a: string }[]) {
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
        })),
    };
}
