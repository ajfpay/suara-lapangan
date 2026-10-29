"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES } from "@/lib/variables";
import { cn } from "@/lib/utils";

/**
 * The language control is the choice itself, not a menu holding it.
 *
 * Each button's visible label is the language's own name, so the control says
 * what the alternative is rather than reporting the current state in a
 * two-letter code. The active one is filled; switching keeps you on the step
 * you were reading because next-intl's router swaps only the locale segment.
 */
const LocaleSwitcher = () => {
    const t = useTranslations("app");
    const router = useRouter();
    const pathname = usePathname();
    const params = useParams();

    const current = String(params.locale ?? "");

    return (
        <div
            role="group"
            aria-label={t("languages")}
            className="flex items-center rounded-full border border-border bg-card p-1"
        >
            {LOCALES.map(({ code, name }) => {
                const isActive = code === current;

                return (
                    <button
                        key={code}
                        type="button"
                        data-locale-code={code}
                        aria-pressed={isActive}
                        aria-label={isActive ? t("language") : undefined}
                        lang={code}
                        onClick={() => {
                            if (isActive) return;
                            router.replace(pathname, { locale: code });
                        }}
                        className={cn(
                            "inline-flex h-10 items-center rounded-full px-3 text-sm font-medium uppercase sm:px-3.5 sm:normal-case",
                            "transition-[background-color,color,transform] duration-150 ease-out",
                            "active:scale-[0.97]",
                            isActive
                                ? "bg-foreground text-background"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {/* Codes on a phone: the full names would push the
                            brand onto a second line at 375px. */}
                        <span className="sm:hidden">{code}</span>
                        <span className="hidden sm:inline">{name}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default LocaleSwitcher;
