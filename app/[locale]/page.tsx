import type { Metadata } from "next";
import { getMessages } from "next-intl/server";
import LandingPage from "@/app/components/landing/LandingPage";
import type { LocaleParams } from "./step-page";
import { BASE_URL } from "@/lib/variables";
import { languageAlternates, stepPath } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
    return [{ locale: "en" }, { locale: "id" }];
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
    const { locale } = await params;
    const messages = await getMessages({ locale });
    const landing = (messages.landing ?? {}) as { meta?: Record<string, string> };
    const meta = landing.meta ?? {};
    const title = meta.title ?? "Suara Lapangan — From spoken work to a clear quotation";
    const description = meta.description ?? "Record job details, review quantities and prices, and prepare a formal client quotation.";

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        robots: { index: true, follow: true },
        alternates: { canonical: stepPath(locale, "/"), languages: languageAlternates("/") },
        openGraph: { type: "website", siteName: "Suara Lapangan", title, description, url: stepPath(locale, "/"), locale },
        twitter: { card: "summary_large_image", title, description },
    };
}

export default function IndexPage() {
    return <LandingPage />;
}
