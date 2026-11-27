"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/app/components/auth/AuthShell";

export default function ResetPasswordPage() {
    const t = useTranslations("auth");
    const locale = String(useParams().locale ?? "id");
    const query = useSearchParams();
    const [token, setToken] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [pending, setPending] = useState(false);
    const [complete, setComplete] = useState(false);
    const [message, setMessage] = useState("");
    useEffect(() => {
        const value =
            new URLSearchParams(window.location.hash.slice(1)).get("token") ??
            query.get("token");
        if (value) {
            setToken(value);
            window.history.replaceState(null, "", window.location.pathname);
        }
    }, [query]);

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (password !== confirmation) {
            setMessage(t("passwordMismatch"));
            return;
        }
        setPending(true);
        setMessage("");
        try {
            const result = await authClient.resetPassword({
                token,
                newPassword: password,
            });
            if (result.error) {
                setMessage(t("resetInvalid"));
                return;
            }
            setComplete(true);
            setToken("");
            setPassword("");
            setConfirmation("");
        } catch {
            setMessage(t("resetTryAgain"));
        } finally {
            setPending(false);
        }
    }

    return (
        <AuthShell
            title={t("resetPasswordTitle")}
            description={
                complete ? t("resetDone") : t("resetPasswordDescription")
            }
            footer={<Link href={"/" + locale + "/login"}>{t("login")}</Link>}
        >
            {complete ? null : !token ? (
                <p role="status">
                    {t("resetInvalid")}{" "}
                    <Link
                        className="underline"
                        href={"/" + locale + "/forgot-password"}
                    >
                        {t("sendResetLink")}
                    </Link>
                </p>
            ) : (
                <form onSubmit={submit} className="space-y-4">
                    <label
                        htmlFor="new-password"
                        className="block text-sm font-medium"
                    >
                        {t("newPassword")}
                    </label>
                    <input
                        id="new-password"
                        data-testid="reset-new-password"
                        required
                        minLength={8}
                        maxLength={128}
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-12 w-full rounded-xl border border-border bg-background px-4"
                    />
                    <label
                        htmlFor="confirm-password"
                        className="block text-sm font-medium"
                    >
                        {t("confirmNewPassword")}
                    </label>
                    <input
                        id="confirm-password"
                        required
                        minLength={8}
                        maxLength={128}
                        type="password"
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                        className="h-12 w-full rounded-xl border border-border bg-background px-4"
                    />
                    <button
                        disabled={pending}
                        type="submit"
                        className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                    >
                        {pending ? t("loading") : t("resetPasswordTitle")}
                    </button>
                    {message && <p role="alert">{message}</p>}
                </form>
            )}
        </AuthShell>
    );
}
