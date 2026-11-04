"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import {
    KonfirmasiCard,
    type KonfirmasiItem,
} from "./KonfirmasiCard";
import {
    buildShareSummary,
    buildWhatsAppShareUrl,
    isShareBlocked,
} from "./share";

interface Props {
    locale: string;
    sessionId: string | null;
    onPlayEvidence: (turnId: string) => void;
}

export function KonfirmasiPanel({ locale, sessionId, onPlayEvidence }: Props) {
    const isIndo = locale === "id";
    const [docId, setDocId] = useState<string | null>(null);
    const [nomor, setNomor] = useState<string | null>(null);
    const [items, setItems] = useState<KonfirmasiItem[]>([]);
    const [status, setStatus] = useState<"draf" | "disetujui" | null>(
        null
    );
    const [total, setTotal] = useState<number | null>(null);
    const [creating, setCreating] = useState(false);
    const [approving, setApproving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!sessionId) return null;

    const createDocument = async () => {
        if (!sessionId || creating) return;
        setCreating(true);
        setError(null);
        try {
            const res = await fetch("/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    locale,
                }),
            });

            if (res.status === 401) {
                const here = window.location.pathname;
                window.location.href = `/${locale}/login?callbackUrl=${encodeURIComponent(here)}`;
                return;
            }

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                const fallback = isIndo
                    ? "Gagal membuat dokumen"
                    : "Failed to create document";
                let errMsg = fallback;
                if (data?.error && data?.message) {
                    errMsg = `${fallback} (${data.error}): ${data.message}`;
                } else if (data?.error) {
                    errMsg = `${fallback} (${data.error})`;
                } else if (data?.message) {
                    errMsg = `${fallback}: ${data.message}`;
                }
                setError(errMsg);
                return;
            }

            const data = await res.json();
            const doc = data.document;
            if (!doc?.id) {
                const fallback = isIndo
                    ? "Gagal membuat dokumen"
                    : "Failed to create document";
                const detail = isIndo
                    ? "server mengembalikan 200 tanpa id dokumen"
                    : "server returned 200 without a document id";
                setError(`${fallback} (no_document_id): ${detail}`);
                return;
            }
            setDocId(doc.id);
            if (doc.nomor) {
                setNomor(doc.nomor);
            }
            setTotal(
                typeof doc.total_nominal === "number"
                    ? doc.total_nominal
                    : null
            );
            const rawItems =
                data.butuh_konfirmasi ?? doc.butuh_konfirmasi ?? [];
            setItems(rawItems);
            const resolvedStatus =
                data.status ??
                doc.status ??
                (rawItems.length > 0 ? "draf" : "disetujui");
            setStatus(resolvedStatus);
        } catch (e) {
            const fallback = isIndo
                ? "Gagal membuat dokumen"
                : "Failed to create document";
            const detail = e instanceof Error ? e.message : String(e);
            setError(`${fallback}: ${detail}`);
        } finally {
            setCreating(false);
        }
    };

    const hasPending = items.length > 0;
    const blocked = status === "draf" || hasPending;
    const canApprove = status === "draf" && !hasPending;
    const shareBlocked = isShareBlocked(status, items.length);
    const shareUrl = buildWhatsAppShareUrl(
        buildShareSummary({
            nomor: nomor ?? docId ?? sessionId ?? "",
            total,
            pendingCount: items.length,
            locale,
        })
    );

    const handleApprove = async () => {
        if (!docId || approving || !canApprove) return;
        setApproving(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/documents/${encodeURIComponent(docId)}/approve`,
                {
                    method: "POST",
                }
            );

            if (res.status === 401) {
                const here = window.location.pathname;
                window.location.href = `/${locale}/login?callbackUrl=${encodeURIComponent(here)}`;
                return;
            }

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                const fallback = isIndo
                    ? "Gagal menyetujui dokumen"
                    : "Failed to approve document";
                let errMsg = fallback;
                if (data?.error && data?.message) {
                    errMsg = `${fallback} (${data.error}): ${data.message}`;
                } else if (data?.error) {
                    errMsg = `${fallback} (${data.error})`;
                } else if (data?.message) {
                    errMsg = `${fallback}: ${data.message}`;
                }
                setError(errMsg);
                return;
            }

            const data = await res.json();
            const nextStatus =
                data.status ?? data.document?.status ?? "disetujui";
            setStatus(nextStatus);
            const nextNomor = data.nomor ?? data.document?.nomor ?? null;
            if (nextNomor) setNomor(nextNomor);
            setItems([]);
        } catch (e) {
            const fallback = isIndo
                ? "Gagal menyetujui dokumen"
                : "Failed to approve document";
            const detail = e instanceof Error ? e.message : String(e);
            setError(`${fallback}: ${detail}`);
        } finally {
            setApproving(false);
        }
    };

    const handleUnduh = async () => {
        if (!docId || blocked) return;
        setError(null);
        try {
            const res = await fetch(`/api/pdf/${encodeURIComponent(docId)}`);

            if (res.status === 401) {
                const here = window.location.pathname;
                window.location.href = `/${locale}/login?callbackUrl=${encodeURIComponent(here)}`;
                return;
            }

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                const fallback = isIndo
                    ? "Gagal mengunduh PDF"
                    : "Failed to download PDF";
                let errMsg = fallback;
                if (data?.error && data?.message) {
                    errMsg = `${fallback} (${data.error}): ${data.message}`;
                } else if (data?.error) {
                    errMsg = `${fallback} (${data.error})`;
                } else if (data?.message) {
                    errMsg = `${fallback}: ${data.message}`;
                }
                setError(errMsg);
                return;
            }

            const blob = await res.blob();
            const disposition = res.headers.get("content-disposition") ?? "";
            const match = disposition.match(/filename="?([^";]+)"?/i);
            const fallbackNomor = nomor
                ? nomor.replaceAll("/", "-")
                : `dokumen-${docId}`;
            const filename = match?.[1] ?? `${fallbackNomor}.pdf`;
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            const fallback = isIndo
                ? "Gagal mengunduh PDF"
                : "Failed to download PDF";
            const detail = e instanceof Error ? e.message : String(e);
            setError(`${fallback}: ${detail}`);
        }
    };

    const handleKirim = () => {
        if (blocked) return;
        window.open(shareUrl, "_blank", "noopener");
    };
    return (
        <section
            aria-labelledby="konfirmasi-title"
            className="mt-8 space-y-4"
            data-testid="konfirmasi-panel"
        >
            <h2 id="konfirmasi-title" className="text-xl font-bold">
                {isIndo ? "Konfirmasi Dokumen" : "Confirm Document"}
            </h2>
            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                    data-testid="create-error"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                    <Link
                        href={`/${locale}/login?callbackUrl=${encodeURIComponent(
                            typeof window !== "undefined"
                                ? window.location.pathname + (sessionId ? `?sessionId=${sessionId}` : "")
                                : `/${locale}/susun`
                        )}`}
                        className="font-bold underline"
                    >
                        {isIndo ? "Masuk" : "Log in"}
                    </Link>
                </div>
            )}

            {!docId ? (
                <div>
                    <button
                        type="button"
                        onClick={createDocument}
                        disabled={creating}
                        className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[48px] rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50"
                        data-testid="btn-buat-dokumen"
                    >
                        {creating
                            ? isIndo
                                ? "Membuat…"
                                : "Creating…"
                            : isIndo
                              ? "Buat dokumen"
                              : "Create document"}
                    </button>
                </div>
            ) : (
                <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        {isIndo ? "Dokumen dibuat" : "Document created"}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="space-y-1">
                            <p className="text-sm text-muted-foreground">
                                {isIndo ? "Nomor dokumen:" : "Document number:"}{" "}
                                <span
                                    className="font-bold text-foreground"
                                    data-testid="document-nomor"
                                >
                                    {nomor}
                                </span>
                            </p>
                            <p className="text-sm text-muted-foreground">
                                Status:{" "}
                                <span
                                    className="font-bold text-foreground"
                                    data-testid="document-status"
                                >
                                    {status}
                                </span>
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                href={`/${locale}/dokumen?doc=${encodeURIComponent(
                                    docId
                                )}`}
                                className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-90"
                                data-testid="link-lihat-dokumen"
                            >
                                {isIndo ? "Lihat dokumen" : "View document"}
                            </Link>
                            {status !== "disetujui" && (
                                <button
                                    type="button"
                                    onClick={handleApprove}
                                    disabled={!canApprove || approving}
                                    className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[44px] rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                                    data-testid="btn-setujui"
                                >
                                    {approving
                                        ? isIndo
                                            ? "Menyetujui…"
                                            : "Approving…"
                                        : isIndo
                                          ? "Setujui dokumen"
                                          : "Approve document"}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={createDocument}
                                disabled={creating}
                                className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[44px] rounded-xl border border-input bg-background px-4 py-2 font-semibold text-foreground hover:bg-accent disabled:opacity-50"
                                data-testid="btn-buat-dokumen-retry"
                            >
                                {creating
                                    ? isIndo
                                         ? "Membuat…"
                                         : "Creating…"
                                    : isIndo
                                      ? "Buat dokumen"
                                      : "Create document"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {docId && (
                <>
                    {items.map((item) => (
                        <KonfirmasiCard
                            key={item.field}
                            item={item}
                            locale={locale}
                            documentId={docId}
                            onPlayEvidence={onPlayEvidence}
                            onResolved={(_field, response) => {
                                const serverItems =
                                    response.butuh_konfirmasi ??
                                    response.document?.butuh_konfirmasi ??
                                    [];
                                setItems(serverItems);
                                const serverStatus =
                                    response.status ??
                                    response.document?.status ??
                                    "draf";
                                setStatus(serverStatus);
                            }}
                        />
                    ))}
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handleUnduh}
                            disabled={blocked}
                            title={
                                blocked
                                    ? isIndo
                                        ? "Selesaikan semua konfirmasi dulu"
                                        : "Resolve all confirmations first"
                                    : undefined
                            }
                            className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[48px] rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50"
                            data-testid="btn-unduh"
                        >
                            {isIndo ? "Unduh PDF" : "Download PDF"}
                        </button>
                        <button
                            type="button"
                            onClick={handleKirim}
                            disabled={blocked}
                            title={
                                blocked
                                    ? isIndo
                                        ? "Selesaikan semua konfirmasi dulu"
                                        : "Resolve all confirmations first"
                                    : undefined
                            }
                            className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[48px] rounded-xl bg-secondary px-5 py-2 font-bold text-secondary-foreground disabled:opacity-50"
                            data-testid="btn-kirim"
                        >
                            {isIndo ? "Kirim" : "Send"}
                        </button>
                        <a
                            href={shareBlocked ? undefined : shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-disabled={shareBlocked}
                            onClick={(e) => {
                                if (shareBlocked) e.preventDefault();
                            }}
                            title={
                                shareBlocked
                                    ? isIndo
                                        ? "Selesaikan semua konfirmasi dulu"
                                        : "Resolve all confirmations first"
                                    : undefined
                            }
                            className={`inline-flex min-h-[48px] items-center rounded-xl bg-secondary px-5 py-2 font-bold text-secondary-foreground ${
                                shareBlocked
                                    ? "pointer-events-none opacity-50"
                                    : ""
                            }`}
                            data-testid="btn-share-wa"
                        >
                            {isIndo
                                ? "Bagikan via WhatsApp"
                                : "Share via WhatsApp"}
                        </a>
                    </div>
                    {blocked && (
                        <p
                            className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200"
                            role="note"
                        >
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            {isIndo
                                ? `Masih ada ${items.length} field yang perlu dikonfirmasi sebelum dokumen disetujui.`
                                : `${items.length} field(s) still need confirmation before the document is approved.`}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
