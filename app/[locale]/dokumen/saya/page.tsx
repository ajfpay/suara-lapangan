import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/server/auth";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import { DokumenSayaClient } from "./DokumenSayaClient";

interface PageProps {
    params: Promise<{ locale: string }>;
}

export default async function DokumenSayaPage({ params }: PageProps) {
    const { locale } = await params;
    const reqHeaders = await headers();
    const session = await auth.api.getSession({
        headers: reqHeaders,
    });

    if (!session?.user) {
        redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/dokumen/saya`)}`);
    }

    const docStore = getPostgresDocumentStore();
    const documents = await docStore.listByUser(session.user.id);

    return <DokumenSayaClient locale={locale} documents={documents} />;
}
