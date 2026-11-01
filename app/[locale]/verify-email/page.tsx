"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function VerifyEmailPage() {
    const t = useTranslations("auth");
    const params = useParams();
    const searchParams = useSearchParams();
    const locale = String(params.locale ?? "id");

    const email = searchParams.get("email");
    const token = searchParams.get("token");

    const [verifying, setVerifying] = useState(Boolean(token));
    const [verified, setVerified] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;

        let active = true;
        async function verify() {
            try {
                const res = await fetch(`/api/auth/verify-email?token=${token}`, {
                    method: "GET",
                });
                if (active) {
                    if (res.ok) {
                        setVerified(true);
                    } else {
                        setError("Tautan verifikasi tidak valid atau telah kedaluwarsa.");
                    }
                    setVerifying(false);
                }
            } catch {
                if (active) {
                    setError("Gagal memverifikasi email.");
                    setVerifying(false);
                }
            }
        }
        verify();

        return () => {
            active = false;
        };
    }, [token]);

    return (
        <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
                {verifying ? (
                    <div className="space-y-4 py-8">
                        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                        <p className="text-sm text-muted-foreground">Memverifikasi email Anda...</p>
                    </div>
                ) : verified ? (
                    <div className="space-y-4">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                            <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            {t("verifyEmailSuccess")}
                        </h1>
                        <Link
                            href={`/${locale}/login`}
                            data-testid="link-login-after-verify"
                            className={cn(
                                "inline-flex w-full items-center justify-center rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow transition",
                                "hover:bg-primary/90 active:scale-[0.99]"
                            )}
                        >
                            {t("login")}
                        </Link>
                    </div>
                ) : error ? (
                    <div className="space-y-4">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
                            <AlertCircle className="h-8 w-8" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight text-foreground">
                            Verifikasi Gagal
                        </h1>
                        <p className="text-sm text-muted-foreground">{error}</p>
                        <Link
                            href={`/${locale}/login`}
                            className="inline-flex w-full items-center justify-center rounded-xl border border-border bg-background py-2.5 text-sm font-medium text-foreground hover:bg-accent"
                        >
                            {t("login")}
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground">
                            <Mail className="h-7 w-7" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">
                            {t("verifyEmailTitle")}
                        </h1>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {t("verifyEmailBody")}
                        </p>
                        {email && (
                            <div className="rounded-xl border border-border bg-muted/50 p-2.5 text-xs font-mono font-medium text-foreground break-all">
                                {email}
                            </div>
                        )}
                        <div className="pt-2">
                            <Link
                                href={`/${locale}/login`}
                                className="inline-flex w-full items-center justify-center rounded-xl border border-border bg-background py-2.5 text-sm font-medium text-foreground hover:bg-accent"
                            >
                                {t("login")}
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
