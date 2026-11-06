"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

export default function MarketingNav() {
    const pathname = usePathname();
    const t = useTranslations("landing.nav");
    if (pathname !== "/") return null;

    return (
        <nav aria-label={t("label")} className="hidden items-center gap-7 md:flex">
            <a className="text-sm text-muted-foreground transition-colors hover:text-foreground" href="#cara-kerja">{t("how")}</a>
            <a className="text-sm text-muted-foreground transition-colors hover:text-foreground" href="#keunggulan">{t("why")}</a>
            <a className="text-sm text-muted-foreground transition-colors hover:text-foreground" href="#pertanyaan">{t("faq")}</a>
            <Link href="/register" className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0">{t("start")}</Link>
        </nav>
    );
}
