import type { Metadata } from "next";

import { StepScreen } from "@/app/components";

import { STEPS } from "@/lib/seo";

import { stepPage, type LocaleParams } from "../step-page";
import { docIdFrom } from "./doc-param";
import { DokumenView } from "./DokumenView";

export const dynamicParams = false;

export function generateStaticParams() {
    return [{ locale: "en" }, { locale: "id" }];
}

export async function generateMetadata({
    params,
}: LocaleParams): Promise<Metadata> {
    return stepPage.metadata(params, 2);
}

type DokumenPageProps = LocaleParams & {
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function DokumenPage({
    params,
    searchParams,
}: DokumenPageProps) {
    const { locale } = await params;
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const docId = docIdFrom(resolvedSearchParams?.doc);
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
            <DokumenView locale={locale} docId={docId} copy={step} />
        </StepScreen>
    );
}
