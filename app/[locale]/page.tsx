import type { Metadata } from "next";

import { StepScreen } from "@/app/components";

import { STEPS } from "@/lib/seo";

import { stepPage, type LocaleParams } from "./step-page";

export const dynamicParams = false;

export function generateStaticParams() {
    return [{ locale: "en" }, { locale: "id" }];
}

export async function generateMetadata({
    params,
}: LocaleParams): Promise<Metadata> {
    return stepPage.metadata(params, 0);
}

export default async function RekamPage({ params }: LocaleParams) {
    const { locale } = await params;
    const { app, nav, steps, messages } = await stepPage.copy(locale);
    const rekam = messages.rekam as Record<string, string>;

    return (
        <StepScreen
            stepOf={(app.stepOf ?? "")
                .replace("{current}", "1")
                .replace("{total}", String(STEPS.length))}
            heading={steps.rekam}
            title={rekam.title}
            body={rekam.body}
            actions={
                <>
                    {stepPage.previous(0, nav, steps)}
                    {stepPage.next(0, nav, steps)}
                </>
            }
        >
            {stepPage.workList(rekam)}
        </StepScreen>
    );
}
