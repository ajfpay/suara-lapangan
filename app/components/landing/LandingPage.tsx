import { ArrowDown, ArrowRight, Check, FileText, Mic2, WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Faq from "@/app/components/layout/Faq";

export default async function LandingPage() {
    const t = await getTranslations("landing");
    const steps = [
        { icon: Mic2, number: "01", title: t("steps.recordTitle"), body: t("steps.recordBody") },
        { icon: Check, number: "02", title: t("steps.reviewTitle"), body: t("steps.reviewBody") },
        { icon: FileText, number: "03", title: t("steps.documentTitle"), body: t("steps.documentBody") },
    ];

    return (
        <main id="main" className="flex-1 overflow-hidden">
            <section className="container grid gap-10 pb-16 pt-10 sm:pb-20 sm:pt-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-14 lg:pb-24 lg:pt-20">
                <div className="relative z-10 min-w-0 max-w-2xl">
                    <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />{t("eyebrow")}
                    </p>
                    <h1 className="mt-6 max-w-xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-[3.6rem]">
                        {t("hero.title")}
                    </h1>
                    <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">{t("hero.body")}</p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Link href="/register" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
                            {t("hero.primary")}<ArrowRight aria-hidden="true" className="h-4 w-4" />
                        </Link>
                        <a href="#cara-kerja" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                            {t("hero.secondary")}<ArrowDown aria-hidden="true" className="h-4 w-4" />
                        </a>
                    </div>
                    <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("hero.note")}</p>
                </div>

                <div className="relative mx-auto w-full min-w-0 max-w-[680px] lg:mr-0">
                    {/* Decorative tilted backdrop: on phones it must stay inside the viewport
                        (mobile `main` has no overflow clip), so it hugs the card at -inset-1;
                        sm+ restores the wide -inset-5 bleed. */}
                    <div aria-hidden="true" className="absolute -inset-1 -rotate-2 rounded-[2rem] bg-primary/10 sm:-inset-5 sm:rounded-[2.5rem]" />
                    {/* Decorative, aria-hidden ring. On phones it stays inside the card's
                        box: hanging it off the right edge pushes page width past the
                        viewport, and the mobile `main` has no overflow to clip it into. */}
                    <div aria-hidden="true" className="absolute right-2 top-8 h-28 w-28 rounded-full border-[18px] border-primary/15 sm:-right-12 sm:right-auto sm:top-12 sm:h-40 sm:w-40 sm:border-[24px]" />
                    <div className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-card shadow-[0_22px_70px_-28px_rgba(24,35,48,0.35)] sm:rounded-[1.5rem]">
                        <div className="flex h-11 items-center gap-2 border-b border-border bg-white/80 px-4 sm:h-12 sm:px-5">
                            <span className="h-2.5 w-2.5 rounded-full bg-primary/35" /><span className="h-2.5 w-2.5 rounded-full bg-foreground/15" /><span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
                            <span className="ml-auto text-[10px] font-medium text-muted-foreground sm:text-xs">{t("demo.window")}</span>
                        </div>
                        <div className="grid gap-0 sm:grid-cols-[0.8fr_1.2fr]">
                            <div className="hidden border-r border-border bg-background p-5 sm:block">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("demo.workspace")}</p>
                                <div className="mt-5 space-y-3 text-xs">
                                    <p className="rounded-lg bg-primary/10 px-3 py-2 font-semibold text-primary">{t("demo.active")}</p>
                                    <p className="px-3 py-1.5 text-muted-foreground">{t("demo.history")}</p>
                                    <p className="px-3 py-1.5 text-muted-foreground">{t("demo.documents")}</p>
                                </div>
                                <div className="mt-12 rounded-xl border border-border bg-card p-3">
                                    <div className="flex items-center gap-2 text-[10px] font-semibold"><WifiOff className="h-3.5 w-3.5 text-primary" />{t("demo.fieldReady")}</div>
                                    <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{t("demo.fieldNote")}</p>
                                </div>
                            </div>
                            <div className="p-4 sm:p-6">
                                <div className="flex items-start justify-between gap-3">
                                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-primary">{t("demo.sample")}</p><h2 className="mt-1.5 text-lg font-semibold tracking-tight sm:text-xl">{t("demo.title")}</h2></div>
                                    <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">{t("demo.draft")}</span>
                                </div>
                                <div className="mt-5 rounded-xl bg-background p-3.5 sm:p-4">
                                    <div className="flex items-center gap-3">
                                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Mic2 className="h-4 w-4" /></span>
                                        <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{t("demo.recording")}</p>{/*
                                            The waveform is decorative (aria-hidden row below), but its
                                            bars must not impose a fixed min-content width: 39 fixed-width
                                            bars inflate every grid item's automatic minimum and push the
                                            card past a phone viewport. Sizing each bar as a minmax(0,1fr)
                                            track lets the waveform compress with the row instead.
                                        */}<div className="mt-2 grid h-4 grid-cols-[repeat(39,minmax(0,1fr))] items-center gap-1" aria-hidden="true">{[8, 13, 7, 16, 10, 18, 8, 14, 6, 17, 9, 13, 7, 18, 10, 15, 6, 12, 17, 9, 14, 7, 16, 10, 13, 6, 18, 8, 12, 16, 7, 13, 9, 17, 6, 12, 15, 8].map((height, i) => <span key={i} className="rounded-full bg-primary/65" style={{ height }} />)}</div></div>
                                    </div>
                                </div>
                                <div className="mt-5">
                                    <div className="flex items-center justify-between"><p className="text-xs font-semibold">{t("demo.items")}</p><span className="text-[10px] text-muted-foreground">{t("demo.checkNumbers")}</span></div>
                                    <div className="mt-2.5 divide-y divide-border rounded-xl border border-border">
                                        {[{ name: t("demo.itemOne"), amount: t("demo.amountOne") }, { name: t("demo.itemTwo"), amount: t("demo.amountTwo") }].map((item) => <div key={item.name} className="flex items-center justify-between gap-3 px-3 py-3 text-xs sm:px-4"><span className="min-w-0 truncate text-foreground">{item.name}</span><span className="shrink-0 font-semibold tabular-nums">{item.amount}</span></div>)}
                                    </div>
                                </div>
                                <div className="mt-5 flex items-center justify-between rounded-xl bg-accent px-3.5 py-3 text-accent-foreground sm:px-4">
                                    <div className="flex items-center gap-2.5"><FileText className="h-4 w-4 text-primary" /><div><p className="text-xs font-semibold">{t("demo.output")}</p><p className="mt-0.5 text-[10px] text-accent-foreground/70">{t("demo.outputType")}</p></div></div><ArrowRight className="h-4 w-4" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <p className="relative mt-4 text-center text-xs text-muted-foreground">{t("demo.caption")}</p>
                </div>
            </section>

            <section id="cara-kerja" className="border-y border-border bg-card py-16 sm:py-20">
                <div className="container">
                    <div className="mx-auto max-w-xl text-center"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{t("steps.eyebrow")}</p><h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("steps.title")}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">{t("steps.body")}</p></div>
                    <div className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
                        {steps.map(({ icon: Icon, number, title, body }) => <article key={number} className="rounded-2xl border border-border bg-background p-5 sm:p-6"><div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden="true" className="h-5 w-5" /></span><span className="font-display text-sm font-semibold tabular-nums text-muted-foreground/70">{number}</span></div><h3 className="mt-6 text-lg font-semibold tracking-tight">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></article>)}
                    </div>
                </div>
            </section>

            <section id="keunggulan" className="container py-16 sm:py-20">
                <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
                    <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{t("benefits.eyebrow")}</p><h2 className="mt-3 max-w-md font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("benefits.title")}</h2><p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">{t("benefits.body")}</p><Link href="/register" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline">{t("benefits.cta")}<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <article className="rounded-2xl bg-accent p-5 text-accent-foreground sm:col-span-2 sm:p-7"><WifiOff aria-hidden="true" className="h-5 w-5 text-primary"/><h3 className="mt-4 text-lg font-semibold">{t("benefits.offlineTitle")}</h3><p className="mt-2 max-w-xl text-sm leading-6 text-accent-foreground/75">{t("benefits.offlineBody")}</p></article>
                        <article className="rounded-2xl border border-border bg-card p-5"><Check aria-hidden="true" className="h-5 w-5 text-primary"/><h3 className="mt-4 text-base font-semibold">{t("benefits.reviewTitle")}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("benefits.reviewBody")}</p></article>
                        <article className="rounded-2xl border border-border bg-card p-5"><FileText aria-hidden="true" className="h-5 w-5 text-primary"/><h3 className="mt-4 text-base font-semibold">{t("benefits.documentTitle")}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("benefits.documentBody")}</p></article>
                    </div>
                </div>
            </section>

            <div id="pertanyaan"><Faq /></div>

            <section className="container pb-16 pt-16 sm:pb-20 sm:pt-20">
                <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-14 lg:px-14">
                    {/* Decorative ring: pulled fully inside on phones (mobile `main` has no
                        overflow clip), restored to its sm+ bleed further down. */}
                    <div aria-hidden="true" className="absolute right-0 top-4 h-40 w-40 rounded-full border-[24px] border-white/10 sm:-right-6 sm:top-[-6rem] sm:h-80 sm:w-80" />
                    <div className="relative max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">{t("closing.eyebrow")}</p><h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("closing.title")}</h2><p className="mt-3 max-w-xl text-sm leading-6 text-white/80 sm:text-base">{t("closing.body")}</p><Link href="/register" className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-card px-6 text-sm font-semibold text-foreground transition-transform hover:-translate-y-0.5 active:translate-y-0">{t("closing.cta")}<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link></div>
                </div>
            </section>
        </main>
    );
}
