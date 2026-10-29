import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

export default async function IndexRedirectPage({ params }: LocaleParams) {
    const { locale } = await params;
    redirect(`/${locale}/rekam`);
}
