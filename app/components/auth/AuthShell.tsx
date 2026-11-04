"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

type AuthShellProps = {
    title: string;
    description: string;
    children: ReactNode;
    footer: ReactNode;
};

export function AuthShell({
    title,
    description,
    children,
    footer,
}: AuthShellProps) {
    const t = useTranslations("auth");
    const step = useTranslations("steps");
    const brand = useTranslations("brand");

    return (
        <main
            id="main"
            className="container flex flex-1 items-center justify-center py-8 sm:py-12 lg:py-16"
        >
            <section className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card shadow-sm md:grid-cols-[0.9fr_1.1fr]">
                <aside className="relative isolate flex flex-col justify-between gap-8 overflow-hidden bg-accent px-6 py-7 text-accent-foreground sm:px-10 sm:py-9 md:min-h-[560px] md:px-11 md:py-12">
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -end-24 -top-28 -z-10 h-72 w-72 rounded-full border border-accent-foreground/10"
                    />
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -end-12 -top-16 -z-10 h-48 w-48 rounded-full border border-accent-foreground/10"
                    />

                    <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 40 40"
                                className="h-6 w-6"
                                fill="none"
                                focusable="false"
                            >
                                <path
                                    d="M20 11v10m-6.5-2a6.5 6.5 0 0 0 13 0M20 29h7"
                                    stroke="currentColor"
                                    strokeWidth="2.6"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </span>
                        <span className="text-base font-semibold tracking-tight sm:text-lg">
                            {brand("name")}
                        </span>
                    </div>

                    <div className="max-w-md">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">
                            {t("authEyebrow")}
                        </p>
                        <h2 className="font-display mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
                            {t("storyTitle")}
                        </h2>
                        <p className="mt-4 max-w-sm text-base leading-relaxed text-accent-foreground/80 sm:text-lg">
                            {t("storyDescription")}
                        </p>
                    </div>

                    <ol className="hidden items-center gap-3 border-t border-accent-foreground/15 pt-5 md:flex">
                        {[step("rekam"), step("susun"), step("dokumen")].map(
                            (label, index) => (
                                <li
                                    key={label}
                                    className="flex min-w-0 items-center gap-3"
                                >
                                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent-foreground/25 text-xs font-semibold text-accent-foreground/90">
                                        0{index + 1}
                                    </span>
                                    <span className="text-sm font-medium text-accent-foreground/90">
                                        {label}
                                    </span>
                                    {index < 2 && (
                                        <span
                                            aria-hidden="true"
                                            className="h-px w-5 shrink-0 bg-accent-foreground/25"
                                        />
                                    )}
                                </li>
                            )
                        )}
                    </ol>
                </aside>

                <div className="flex flex-col justify-center px-6 py-8 sm:px-10 sm:py-11 md:px-12 lg:px-16">
                    <div className="mb-7 max-w-lg">
                        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
                            {title}
                        </h1>
                        <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
                            {description}
                        </p>
                    </div>
                    {children}
                    <div className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
                        {footer}
                    </div>
                </div>
            </section>
        </main>
    );
}
