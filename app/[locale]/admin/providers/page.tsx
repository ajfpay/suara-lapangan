import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { ArrowLeft, Settings2 } from "lucide-react";
import { auth } from "@/lib/server/auth";

interface PageProps {
    params: Promise<{ locale: string }>;
}

export default async function AdminProvidersPage({ params }: PageProps) {
    const { locale } = await params;
    const reqHeaders = await headers();
    const session = await auth.api.getSession({
        headers: reqHeaders,
    });

    if (!session?.user) {
        redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/admin/providers`)}`);
    }

    if ((session.user as { role?: string }).role !== "admin") {
        return (
            <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
                <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
                        <ShieldAlert className="h-8 w-8" />
                    </div>
                    <h1 className="mt-4 text-xl font-bold text-foreground">
                        403 — Akses Ditolak
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Halaman ini hanya dapat diakses oleh pengguna dengan peran admin.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <div className="container py-8 sm:py-12">
            <div className="mb-6">
                <Link
                    href={`/${locale}/admin`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Kembali ke Dasbor Admin</span>
                </Link>
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center shadow-sm">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Settings2 className="h-7 w-7" />
                </div>
                <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
                    Pengaturan Provider AI
                </h1>
                <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
                    Slot konfigurasi penyedia model (Meta, Muse Spark, dsb.) sedang dikembangkan oleh tiket paralel dan saat ini dilindungi oleh token admin environment.
                </p>
                <div className="mt-6 inline-block rounded-xl border border-border bg-muted/40 px-4 py-2 font-mono text-xs text-muted-foreground">
                    Placeholder: /[locale]/admin/providers
                </div>
            </div>
        </div>
    );
}
