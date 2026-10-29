import type { Metadata } from "next";

import { StepScreen } from "@/app/components";

import { STEPS } from "@/lib/seo";

import { stepPage, type LocaleParams } from "../step-page";

export const dynamicParams = false;

export function generateStaticParams() {
    return [{ locale: "en" }, { locale: "id" }];
}

export async function generateMetadata({
    params,
}: LocaleParams): Promise<Metadata> {
    return stepPage.metadata(params, 2);
}

export default async function DokumenPage({ params }: LocaleParams) {
    const { locale } = await params;
    const { app, nav, steps, messages } = await stepPage.copy(locale);
    const key = "dokumen";
    const step = messages[key] as Record<string, string>;

    return (
        <StepScreen
            stepOf={(app.stepOf ?? "")
                .replace("{current}", "3")
                .replace("{total}", String(STEPS.length))}
            heading={steps[key]}
            title={step.title}
            body={step.body}
            actions={
                <>
                    {stepPage.previous(2, nav, steps)}
                    {stepPage.next(2, nav, steps)}
                </>
            }
        >
            {stepPage.workList(step)}
        </StepScreen>
    );
}
