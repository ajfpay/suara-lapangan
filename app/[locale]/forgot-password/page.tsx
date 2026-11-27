"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/app/components/auth/AuthShell";

export default function ForgotPasswordPage() {
    const t = useTranslations("auth");
    const locale = String(useParams().locale ?? "id");
    const [email, setEmail] = useState("");
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState("");

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setPending(true);
        setMessage("");
        try {
            const result = await authClient.requestPasswordReset({
                email,
                redirectTo: "/" + locale + "/reset-password",
            });
            setMessage(result.error ? t("resetTryAgain") : t("resetRequested"));
        } catch {
            setMessage(t("resetTryAgain"));
        } finally {
            setPending(false);
        }
    }

    return (
        <AuthShell
            title={t("forgotPassword")}
            description={t("resetDescription")}
            footer={<Link href={"/" + locale + "/login"}>{t("login")}</Link>}
        >
            <form onSubmit={submit} className="space-y-4">
                <label
                    htmlFor="reset-email"
                    className="block text-sm font-medium"
                >
                    {t("email")}
                </label>
                <input
                    id="reset-email"
                    data-testid="reset-email"
                    required
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 w-full rounded-xl border border-border bg-background px-4"
                />
                <button
                    disabled={pending}
                    type="submit"
                    className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                >
                    {pending ? t("loading") : t("sendResetLink")}
                </button>
                {message && (
                    <p
                        role="status"
                        data-testid="reset-message"
                        className="text-sm"
                    >
                        {message}
                    </p>
                )}
            </form>
        </AuthShell>
    );
}
