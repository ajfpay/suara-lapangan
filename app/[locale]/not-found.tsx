import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

/**
 * The 404 inside a locale.
 *
 * Reached from `app/[locale]/[...rest]/page.tsx`, so an unknown address under
 * /en or /id keeps its URL, answers 404, and still renders the site chrome in
 * the reader's language. The locale-independent 404 at `app/not-found.tsx`
 * covers requests that never reach a locale at all.
 */
export default async function LocaleNotFound() {
    const t = await getTranslations("notFound");

    return (
        <main id="main" className="container py-20">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                404
            </p>
            <h1 className="font-display mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
                {t("title")}
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
                {t("body")}
            </p>
            <p className="mt-8">
                <Link
                    href="/"
                    className="font-semibold text-primary underline underline-offset-4"
                >
                    {t("home")}
                </Link>
            </p>
        </main>
    );
}
