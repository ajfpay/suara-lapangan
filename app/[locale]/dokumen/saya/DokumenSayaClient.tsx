"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Send, Eye, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StoredDocument } from "@/lib/server/db/documentStore";
import { cn } from "@/lib/utils";

interface DokumenSayaClientProps {
    locale: string;
    documents: StoredDocument[];
}

export function DokumenSayaClient({ locale, documents: initialDocs }: DokumenSayaClientProps) {
    const t = useTranslations("dokumenSaya");
    const [docs, setDocs] = useState<StoredDocument[]>(initialDocs);
    const [sendModalDoc, setSendModalDoc] = useState<StoredDocument | null>(null);
    const [recipientEmail, setRecipientEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [sendSuccess, setSendSuccess] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);

    function formatCurrency(amount: number) {
        return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", {
            style: "currency",
            currency: "IDR",
            maximumFractionDigits: 0,
        }).format(amount);
    }

    async function handleSendEmail(e: React.FormEvent) {
        e.preventDefault();
        if (!sendModalDoc || !recipientEmail) return;

        setSending(true);
        setSendError(null);
        setSendSuccess(null);

        try {
            const res = await fetch(`/api/documents/${encodeURIComponent(sendModalDoc.id)}/email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: recipientEmail }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                setSendError(errData?.message || "Gagal mengirim email dokumen.");
                setSending(false);
                return;
            }

            setSendSuccess(`Dokumen ${sendModalDoc.nomor} berhasil dikirim ke ${recipientEmail}`);
            setDocs((prev) =>
                prev.map((d) =>
                    d.id === sendModalDoc.id
                        ? { ...d, status: "terkirim", sentTo: recipientEmail, sentAt: new Date() }
                        : d
                )
            );
            setTimeout(() => {
                setSendModalDoc(null);
                setRecipientEmail("");
                setSendSuccess(null);
            }, 1800);
        } catch {
            setSendError("Terjadi kesalahan jaringan.");
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="container py-8 sm:py-12">
            <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>
                <Link
                    href={`/${locale}/rekam`}
                    className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:bg-primary/90"
                >
                    {t("emptyAction")}
                </Link>
            </div>

            {docs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                        <FileText className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold">{t("empty")}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Mulai dengan merekam rincian pekerjaan di lapangan.
                    </p>
                    <Link
                        href={`/${locale}/rekam`}
                        className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        {t("emptyAction")}
                    </Link>
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm" data-testid="table-dokumen-saya">
                            <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3.5 sm:px-6">{t("tableNomor")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("tableTanggal")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("tableTotal")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("tableStatus")}</th>
                                    <th className="px-4 py-3.5 text-right sm:px-6">{t("tableActions")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {docs.map((doc) => {
                                    const total = doc.document.total_nominal ?? 0;
                                    const tanggal = doc.document.tanggal || new Date(doc.createdAt).toLocaleDateString(locale === "en" ? "en-US" : "id-ID");
                                    const isLocked = doc.status === "perlu_konfirmasi";

                                    return (
                                        <tr key={doc.id} className="transition hover:bg-muted/30">
                                            <td className="px-4 py-4 font-mono font-medium sm:px-6">
                                                <Link
                                                    href={`/${locale}/dokumen?doc=${doc.id}`}
                                                    className="text-primary hover:underline"
                                                >
                                                    {doc.nomor}
                                                </Link>
                                            </td>
                                            <td className="px-4 py-4 text-muted-foreground sm:px-6">
                                                {tanggal}
                                            </td>
                                            <td className="px-4 py-4 font-medium sm:px-6">
                                                {formatCurrency(total)}
                                            </td>
                                            <td className="px-4 py-4 sm:px-6">
                                                <span
                                                    className={cn(
                                                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                                                        doc.status === "perlu_konfirmasi" &&
                                                            "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                                                        doc.status === "siap" &&
                                                            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                                        doc.status === "terkirim" &&
                                                            "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                                    )}
                                                >
                                                    {doc.status === "perlu_konfirmasi" && t("statusPerluKonfirmasi")}
                                                    {doc.status === "siap" && t("statusSiap")}
                                                    {doc.status === "terkirim" && t("statusTerkirim")}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right sm:px-6">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Link
                                                        href={`/${locale}/dokumen?doc=${doc.id}`}
                                                        aria-label="Lihat dokumen"
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-accent"
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Link>

                                                    <a
                                                        href={`/api/documents/${doc.id}/pdf`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        aria-label="Unduh PDF"
                                                        data-testid={`btn-unduh-${doc.id}`}
                                                        className={cn(
                                                            "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent",
                                                            isLocked && "pointer-events-none opacity-40"
                                                        )}
                                                    >
                                                        <Download className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">{t("download")}</span>
                                                    </a>

                                                    <button
                                                        type="button"
                                                        data-testid={`btn-kirim-${doc.id}`}
                                                        onClick={() => {
                                                            setSendModalDoc(doc);
                                                            setRecipientEmail(doc.sentTo || "");
                                                            setSendError(null);
                                                            setSendSuccess(null);
                                                        }}
                                                        disabled={isLocked}
                                                        className={cn(
                                                            "inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40"
                                                        )}
                                                    >
                                                        <Send className="h-3.5 w-3.5" />
                                                        <span className="hidden sm:inline">{t("send")}</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {sendModalDoc && (
                <div
                    role="dialog"
                    aria-modal="true"
                    data-testid="send-email-modal"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-100"
                >
                    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-foreground">
                            Kirim Dokumen {sendModalDoc.nomor}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Surat Penawaran resmi dalam bentuk PDF akan dikirimkan ke alamat email tujuan.
                        </p>

                        {sendSuccess ? (
                            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-5 w-5 shrink-0" />
                                <span>{sendSuccess}</span>
                            </div>
                        ) : (
                            <form onSubmit={handleSendEmail} className="mt-4 space-y-4">
                                {sendError && (
                                    <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                                        <AlertCircle className="h-5 w-5 shrink-0" />
                                        <span>{sendError}</span>
                                    </div>
                                )}

                                <div>
                                    <label className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
                                        Email Penerima
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        autoFocus
                                        data-testid="input-recipient-email"
                                        value={recipientEmail}
                                        onChange={(e) => setRecipientEmail(e.target.value)}
                                        placeholder="klien@perusahaan.com"
                                        className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        disabled={sending}
                                        onClick={() => setSendModalDoc(null)}
                                        className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                                    >
                                        Batal
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={sending}
                                        data-testid="btn-confirm-send"
                                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                                        <span>{sending ? "Mengirim..." : "Kirim Sekarang"}</span>
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
