"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { sanitizeCallbackUrl } from "@/lib/client/sanitizeCallbackUrl";

export default function LoginPage() {
    const t = useTranslations("auth");
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const locale = String(params.locale ?? "id");

    const rawCallbackUrl = searchParams.get("callbackUrl") || `/${locale}/dokumen/saya`;
    const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl, locale);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const res = await signIn.email({
                email,
                password,
            });

            if (res.error) {
                if (res.error.message?.toLowerCase().includes("verified")) {
                    setError(t("emailNotVerified"));
                } else {
                    setError(t("invalidCredentials"));
                }
                setLoading(false);
                return;
            }

            router.push(callbackUrl);
            router.refresh();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "";
            if (msg.toLowerCase().includes("verified")) {
                setError(t("emailNotVerified"));
            } else {
                setError(t("invalidCredentials"));
            }
            setLoading(false);
        }
    }

    async function handleGoogle() {
        setLoading(true);
        setError(null);
        try {
            await signIn.social({
                provider: "google",
                callbackURL: callbackUrl,
            });
        } catch {
            setError(t("googleFailed"));
            setLoading(false);
        }
    }

    return (
        <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
                <div className="mb-6 text-center">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                        {t("loginTitle")}
                    </h1>
                </div>

                {error && (
                    <div
                        data-testid="login-error"
                        className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                    >
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase">
                            {t("email")}
                        </label>
                        <input
                            type="email"
                            data-testid="input-email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="nama@email.com"
                            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase">
                            {t("password")}
                        </label>
                        <input
                            type="password"
                            data-testid="input-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    <button
                        type="submit"
                        data-testid="btn-submit-login"
                        disabled={loading}
                        className={cn(
                            "w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow transition",
                            "hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
                        )}
                    >
                        {loading ? "..." : t("login")}
                    </button>
                </form>

                <div className="my-6 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground uppercase">{t("or")}</span>
                    <div className="h-px flex-1 bg-border" />
                </div>

                <button
                    type="button"
                    data-testid="btn-google-login"
                    onClick={handleGoogle}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background py-2.5 text-sm font-medium text-foreground transition hover:bg-accent active:scale-[0.99] disabled:opacity-50"
                >
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                        <path
                            fill="#4285F4"
                            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                        />
                        <path
                            fill="#34A853"
                            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                        />
                        <path
                            fill="#FBBC05"
                            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                        />
                        <path
                            fill="#EA4335"
                            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                        />
                    </svg>
                    <span>{t("google")}</span>
                </button>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                    {t("noAccount")}{" "}
                    <Link
                        href={`/${locale}/register`}
                        data-testid="link-to-register"
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                        {t("register")}
                    </Link>
                </p>
            </div>
        </main>
    );
}
