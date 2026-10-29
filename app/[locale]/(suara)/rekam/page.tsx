import type { Metadata } from "next";

import { StepScreen } from "@/app/components";
import { STEPS } from "@/lib/seo";

import { stepPage, type LocaleParams } from "../../step-page";
import { RecorderControl } from "./RecorderControl";

export const dynamicParams = false;

export function generateStaticParams() {
    return [{ locale: "en" }, { locale: "id" }];
}

export async function generateMetadata({
    params,
}: LocaleParams): Promise<Metadata> {
    return stepPage.metadata(params, 0);
}

export default async function RekamStepPage({ params }: LocaleParams) {
    const { locale } = await params;
    const { app, nav, steps, messages } = await stepPage.copy(locale);
    const key = "rekam";
    const step = messages[key] as Record<string, string>;

    return (
        <StepScreen
            stepOf={(app.stepOf ?? "")
                .replace("{current}", "1")
                .replace("{total}", String(STEPS.length))}
            heading={steps[key]}
            title={step.title}
            body={step.body}
            actions={
                <>
                    {stepPage.previous(0, nav, steps)}
                    {stepPage.next(0, nav, steps)}
                </>
            }
        >
            <RecorderControl
                copy={{
                    primary: step.primary,
                    recording: step.recording,
                    stop: step.stop,
                    processing: step.processing,
                    uploadPending: step.uploadPending,
                    holdHint: step.holdHint,
                    recordingHint: step.recordingHint,
                }}
            />
            {stepPage.workList(step)}
        </StepScreen>
    );
}
