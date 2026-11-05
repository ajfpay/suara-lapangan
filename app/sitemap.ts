import type { MetadataRoute } from "next";

import { languageAlternates, stepPath, STEPS } from "@/lib/seo";
import { BASE_URL, LOCALES } from "@/lib/variables";

/**
 * Public landing page plus the three steps per locale, each carrying the full hreflang set.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    const lastModified = new Date();

    return LOCALES.flatMap(({ code }) => [
        {
            url: `${BASE_URL}${stepPath(code, "/")}`,
            lastModified,
            changeFrequency: "monthly" as const,
            priority: 1,
            alternates: {
                languages: Object.fromEntries(
                    Object.entries(languageAlternates("/")).map(([lang, p]) => [
                        lang,
                        `${BASE_URL}${p}`,
                    ])
                ),
            },
        },
        ...STEPS.map(({ path }) => ({
            url: `${BASE_URL}${stepPath(code, path)}`,
            lastModified,
            changeFrequency: "monthly" as const,
            priority: 0.7,
            alternates: {
                languages: Object.fromEntries(
                    Object.entries(languageAlternates(path)).map(
                        ([lang, p]) => [lang, `${BASE_URL}${p}`]
                    )
                ),
            },
        })),
    ]);
}
