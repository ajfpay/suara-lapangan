"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { signUp, signIn } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { AuthShell } from "@/app/components/auth/AuthShell";

export default function RegisterPage() {
    const t = useTranslations("auth");
    const params = useParams();
    const router = useRouter();
    const locale = String(params.locale ?? "id");

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const res = await signUp.email({
                name,
                email,
                password,
            });

            if (res.error) {
                setError(res.error.message || t("registrationFailed"));
                setLoading(false);
                return;
            }

            // Registration succeeded: redirect to email verification notice
            router.push(`/${locale}/verify-email?email=${encodeURIComponent(email)}`);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t("registrationFailed"));
            setLoading(false);
        }
    }

    async function handleGoogle() {
        setLoading(true);
        setError(null);
        try {
            const res = await signIn.social({
                provider: "google",
                callbackURL: `/${locale}/dokumen/saya`,
            });
            // `signIn.social` returns an error result instead of throwing for
            // provider-level failures; reset loading so the email form stays usable.
            if (res.error) {
                setError(t("googleFailed"));
                setLoading(false);
            }
        } catch {
            setError(t("googleFailed"));
            setLoading(false);
        }
    }

    return (
        <AuthShell
            title={t("registerTitle")}
            description={t("registerDescription")}
            footer={
                <p>
                    {t("hasAccount")} {" "}
                    <Link
                        href={`/${locale}/login`}
                        data-testid="link-to-login"
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                        {t("login")}
                    </Link>
                </p>
            }
        >
            {error && (
                <div
                    data-testid="register-error"
                    role="alert"
                    className="mb-5 rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-sm leading-relaxed text-destructive"
                >
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                    <label
                        htmlFor="register-name"
                        className="block text-sm font-semibold text-foreground"
                    >
                        {t("name")}
                    </label>
                    <input
                        id="register-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        data-testid="input-name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("placeholderName")}
                        className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground transition-colors placeholder:text-muted-foreground/75 focus-visible:border-primary"
                    />
                </div>

                <div className="space-y-2">
                    <label
                        htmlFor="register-email"
                        className="block text-sm font-semibold text-foreground"
                    >
                        {t("email")}
                    </label>
                    <input
                        id="register-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        data-testid="input-email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t("placeholderEmail")}
                        className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground transition-colors placeholder:text-muted-foreground/75 focus-visible:border-primary"
                    />
                </div>

                <div className="space-y-2">
                    <label
                        htmlFor="register-password"
                        className="block text-sm font-semibold text-foreground"
                    >
                        {t("password")}
                    </label>
                    <input
                        id="register-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        data-testid="input-password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("placeholderPassword")}
                        aria-describedby="register-password-hint"
                        className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground transition-colors placeholder:text-muted-foreground/75 focus-visible:border-primary"
                    />
                    <p
                        id="register-password-hint"
                        className="text-sm leading-relaxed text-muted-foreground"
                    >
                        {t("passwordHint")}
                    </p>
                </div>

                <button
                    type="submit"
                    data-testid="btn-submit-register"
                    disabled={loading}
                    aria-busy={loading}
                    className={cn(
                        "min-h-12 w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground shadow-sm",
                        "transition-[background-color,transform,box-shadow] duration-150 ease-out hover:bg-primary/90 enabled:active:scale-[0.96] disabled:cursor-wait disabled:opacity-60"
                    )}
                >
                    {loading ? t("loading") : t("register")}
                </button>
            </form>

            <div className="my-6 flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-muted-foreground">
                    {t("or")}
                </span>
                <div className="h-px flex-1 bg-border" />
            </div>

            <button
                type="button"
                data-testid="btn-google-register"
                onClick={handleGoogle}
                disabled={loading}
                aria-busy={loading}
                className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-base font-semibold text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-muted enabled:active:scale-[0.96] disabled:cursor-wait disabled:opacity-60"
            >
                <svg
                    aria-hidden="true"
                    focusable="false"
                    className="h-5 w-5 shrink-0"
                    viewBox="0 0 24 24"
                >
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
        </AuthShell>
    );
}
