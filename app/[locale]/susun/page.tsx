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
    return stepPage.metadata(params, 1);
}

export default async function SusunPage({ params }: LocaleParams) {
    const { locale } = await params;
    const { app, nav, steps, messages } = await stepPage.copy(locale);
    const key = "susun";
    const step = messages[key] as Record<string, string>;

    return (
        <StepScreen
            stepOf={(app.stepOf ?? "")
                .replace("{current}", "2")
                .replace("{total}", String(STEPS.length))}
            heading={steps[key]}
            title={step.title}
            body={step.body}
            actions={
                <>
                    {stepPage.previous(1, nav, steps)}
                    {stepPage.next(1, nav, steps)}
                </>
            }
        >
            {stepPage.workList(step)}
        </StepScreen>
    );
}
