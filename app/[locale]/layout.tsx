import { notFound } from "next/navigation";
import { createTranslator, hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { Metadata } from "next";

import {
    Faq,
    SiteFooter,
    SiteHeader,
    StepProgress,
} from "@/app/components";
import "@/lib/fonts";
import { buildJsonLd, languageAlternates, stepPath, STEPS } from "@/lib/seo";
import { BASE_URL, dirForLocale, LOCALES } from "@/lib/variables";
import { routing } from "@/i18n/routing";

type LocaleParams = { params: Promise<{ locale: string }> };

/**
 * Per-locale metadata.
 *
 * The canonical and the hreflang set point at each locale's own step path, so
 * no locale tells a search engine that another one is its canonical version.
 */
export async function generateMetadata({
    params,
}: LocaleParams): Promise<Metadata> {
    const { locale } = await params;
    const messages = await getMessages({ locale });
    const meta = (messages.meta ?? {}) as Record<string, string>;
    const title = meta.titleTemplate ?? "";
    const description = meta.description ?? "";

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        robots: { index: true, follow: true },
        alternates: {
            canonical: stepPath(locale, "/"),
            languages: languageAlternates("/"),
        },
        openGraph: {
            type: "website",
            siteName: "Suara Lapangan",
            title: meta.ogTitle ?? title,
            description: meta.ogDescription ?? description,
            url: stepPath(locale, "/"),
            locale,
        },
        twitter: {
            card: "summary_large_image",
            title: meta.ogTitle ?? title,
            description: meta.ogDescription ?? description,
        },
    };
}

export const viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: "#0f1722",
};

export function generateStaticParams() {
    return LOCALES.map(({ code }) => ({ locale: code }));
}

export default async function LocaleLayout(props: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await props.params;

    if (!hasLocale(routing.locales, locale)) {
        notFound();
    }

    const messages = await getMessages({ locale });
    const t = createTranslator({ locale, messages });
    const stepNames = STEPS.map(
        (step) =>
            ((messages.steps ?? {}) as Record<string, string>)[step.messageKey]
    );

    return (
        <html
            lang={locale}
            dir={dirForLocale(locale)}
            suppressHydrationWarning
        >
            <head>
                <script
                    type="application/ld+json"
                    id="json-ld"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify(buildJsonLd(locale)),
                    }}
                />
            </head>
            <body
                className="antialiased"
                suppressHydrationWarning
            >
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <a
                        href="#main"
                        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
                    >
                        {t("app.skipToContent")}
                    </a>

                    <div className="flex min-h-dvh flex-col">
                        <SiteHeader />
                        <StepProgress
                            locale={locale}
                            steps={stepNames}
                            label={t("app.stepsLabel")}
                        />
                        <div className="flex-1">
                            {props.children}
                            <Faq />
                            <SiteFooter />
                        </div>
                    </div>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
