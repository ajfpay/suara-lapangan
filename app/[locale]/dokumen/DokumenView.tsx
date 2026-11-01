"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

type Summary = {
    id: string;
    nomor: string;
    status: "perlu_konfirmasi" | "siap" | "terkirim";
    pendingCount: number;
};

type PdfState =
    | { kind: "locked" }
    | { kind: "loading" }
    | { kind: "ready"; url: string }
    | { kind: "error" };

type ViewState =
    | { kind: "empty"; reason: "missing" | "not_found" }
    | { kind: "loading" }
    | { kind: "error"; code: string | null }
    | { kind: "ready"; document: Summary; pdf: PdfState };

interface DokumenViewProps {
    locale: string;
    docId: string | null;
    copy: Record<string, string>;
}

function pdfUrl(id: string): string {
    return `/api/documents/${encodeURIComponent(id)}/pdf`;
}

function toSummary(body: unknown): Summary | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const doc = b.document;
    if (!doc || typeof doc !== "object") return null;
    const d = doc as Record<string, unknown>;

    if (typeof d.id !== "string" || d.id.trim() === "") return null;
    if (typeof d.nomor !== "string" || d.nomor.trim() === "") return null;

    let pendingCount = 0;
    if (Array.isArray(b.butuh_konfirmasi)) {
        pendingCount = b.butuh_konfirmasi.length;
    } else if (Array.isArray(d.butuh_konfirmasi)) {
        pendingCount = d.butuh_konfirmasi.length;
    }

    const rawStatus = (
        typeof b.status === "string"
            ? b.status
            : typeof d.status === "string"
              ? d.status
              : ""
    ) as string;

    let status: Summary["status"];
    if (
        rawStatus === "perlu_konfirmasi" ||
        rawStatus === "siap" ||
        rawStatus === "terkirim"
    ) {
        status = rawStatus;
    } else {
        status = pendingCount > 0 ? "perlu_konfirmasi" : "siap";
    }

    return {
        id: d.id,
        nomor: d.nomor,
        status,
        pendingCount,
    };
}

export function DokumenView({ locale, docId, copy }: DokumenViewProps) {
    const [attempt, setAttempt] = useState(0);
    const [pdfAttempt, setPdfAttempt] = useState(0);
    const [downloadState, setDownloadState] = useState<
        "idle" | "loading" | "error"
    >("idle");
    const [viewState, setViewState] = useState<ViewState>(() =>
        docId === null
            ? { kind: "empty", reason: "missing" }
            : { kind: "loading" }
    );

    const blobUrlRef = useRef<string | null>(null);
    const downloadUrlRef = useRef<string | null>(null);

    const revokeBlobUrl = () => {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
    };

    const revokeDownloadUrl = () => {
        if (downloadUrlRef.current) {
            URL.revokeObjectURL(downloadUrlRef.current);
            downloadUrlRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            revokeBlobUrl();
            revokeDownloadUrl();
        };
    }, []);

    useEffect(() => {
        revokeBlobUrl();
        revokeDownloadUrl();
        setDownloadState("idle");
        if (docId === null) {
            setViewState({ kind: "empty", reason: "missing" });
            return;
        }

        setViewState({ kind: "loading" });
        const controller = new AbortController();
        // A fetch that resolved before this cleanup ran must not write over the
        // document the effect now shows.
        let cancelled = false;

        const fetchDocument = async () => {
            try {
                const res = await fetch(
                    `/api/documents/${encodeURIComponent(docId)}`,
                    {
                        signal: controller.signal,
                        cache: "no-store",
                    }
                );

                if (cancelled) return;

                if (res.status === 404 || res.status === 400) {
                    setViewState({ kind: "empty", reason: "not_found" });
                    return;
                }

                if (!res.ok) {
                    let code: string | null = null;
                    try {
                        const errJson = await res.json();
                        if (
                            errJson &&
                            typeof errJson === "object" &&
                            typeof errJson.error === "string"
                        ) {
                            code = errJson.error;
                        }
                    } catch {
                        // ignore body parse error
                    }
                    if (cancelled) return;
                    setViewState({ kind: "error", code });
                    return;
                }

                let body: unknown;
                try {
                    body = await res.json();
                } catch {
                    if (cancelled) return;
                    setViewState({ kind: "error", code: "invalid_response" });
                    return;
                }

                if (cancelled) return;

                const summary = toSummary(body);
                if (!summary) {
                    setViewState({ kind: "error", code: "invalid_response" });
                    return;
                }

                const locked =
                    summary.status === "perlu_konfirmasi" ||
                    summary.pendingCount > 0;
                setViewState({
                    kind: "ready",
                    document: summary,
                    pdf: locked ? { kind: "locked" } : { kind: "loading" },
                });
            } catch {
                if (cancelled) return;
                setViewState({ kind: "error", code: null });
            }
        };

        fetchDocument();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [docId, attempt]);

    const isPdfLoading =
        viewState.kind === "ready" && viewState.pdf.kind === "loading";
    const readyDocId =
        viewState.kind === "ready" ? viewState.document.id : null;

    useEffect(() => {
        if (!isPdfLoading || !readyDocId) {
            return;
        }

        const controller = new AbortController();

        const fetchPdf = async () => {
            try {
                const res = await fetch(pdfUrl(readyDocId), {
                    signal: controller.signal,
                    cache: "no-store",
                });

                if (!res.ok) {
                    setViewState((prev) =>
                        prev.kind === "ready"
                            ? { ...prev, pdf: { kind: "error" } }
                            : prev
                    );
                    return;
                }

                const blob = await res.blob();
                if (controller.signal.aborted) return;

                revokeBlobUrl();
                const url = URL.createObjectURL(blob);
                blobUrlRef.current = url;

                setViewState((prev) =>
                    prev.kind === "ready"
                        ? { ...prev, pdf: { kind: "ready", url } }
                        : prev
                );
            } catch {
                if (controller.signal.aborted) return;
                setViewState((prev) =>
                    prev.kind === "ready"
                        ? { ...prev, pdf: { kind: "error" } }
                        : prev
                );
            }
        };

        fetchPdf();

        return () => {
            controller.abort();
        };
    }, [isPdfLoading, readyDocId, pdfAttempt]);

    const downloadPdf = async () => {
        if (viewState.kind !== "ready" || downloadState === "loading") return;
        const doc = viewState.document;
        setDownloadState("loading");
        try {
            const res = await fetch(pdfUrl(doc.id), { cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const disposition = res.headers.get("content-disposition") ?? "";
            const match = disposition.match(/filename="?([^";]+)"?/i);
            const filename =
                match?.[1] ?? `${doc.nomor.replaceAll("/", "-")}.pdf`;
            revokeDownloadUrl();
            const url = URL.createObjectURL(blob);
            downloadUrlRef.current = url;
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setDownloadState("idle");
        } catch {
            setDownloadState("error");
        }
    };

    const statusLabels: Record<Summary["status"], string> = {
        perlu_konfirmasi: copy.statusPerluKonfirmasi,
        siap: copy.statusSiap,
        terkirim: copy.statusTerkirim,
    };

    return (
        <section
            aria-labelledby="dokumen-viewer-title"
            className="mt-10 max-w-4xl space-y-4"
        >
            <h2 id="dokumen-viewer-title" className="text-xl font-bold">
                {copy.viewerTitle}
            </h2>

            {viewState.kind === "loading" && (
                <div
                    role="status"
                    aria-busy="true"
                    className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground"
                >
                    {copy.loading}
                </div>
            )}

            {viewState.kind === "empty" && (
                <div
                    role="status"
                    data-testid="dokumen-empty"
                    className="space-y-4 rounded-2xl border border-dashed border-border p-8 text-center"
                >
                    <h3 className="text-lg font-semibold text-foreground">
                        {copy.emptyTitle}
                    </h3>
                    <p className="text-muted-foreground">
                        {viewState.reason === "missing"
                            ? copy.emptyBody
                            : copy.notFoundBody}
                    </p>
                    <div>
                        <Link
                            href={`/${locale}/susun`}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)]"
                        >
                            {copy.emptyCta}
                        </Link>
                    </div>
                </div>
            )}

            {viewState.kind === "error" && (
                <div
                    role="alert"
                    data-testid="dokumen-error"
                    className="space-y-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-foreground"
                >
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
                        <div className="space-y-1 text-left">
                            <h3 className="text-lg font-bold text-destructive">
                                {copy.errorTitle}
                            </h3>
                            <p className="text-sm text-foreground">
                                {copy.errorBody}
                                {viewState.code ? ` (${viewState.code})` : ""}
                            </p>
                        </div>
                    </div>
                    <div className="text-left">
                        <button
                            type="button"
                            onClick={() => setAttempt((c) => c + 1)}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-destructive px-5 py-2 font-bold text-destructive-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)]"
                        >
                            {copy.retry}
                        </button>
                    </div>
                </div>
            )}

            {viewState.kind === "ready" &&
                (() => {
                    const doc = viewState.document;
                    const pdf = viewState.pdf;
                    const locked =
                        doc.status === "perlu_konfirmasi" ||
                        doc.pendingCount > 0;
                    const localizedStatus =
                        statusLabels[doc.status] ?? doc.status;

                    return (
                        <div className="space-y-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
                            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                                <div>
                                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        {copy.nomorLabel}
                                    </span>
                                    <p
                                        data-testid="document-nomor"
                                        className="font-mono text-xl font-bold"
                                    >
                                        {doc.nomor}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {copy.statusLabel}:
                                    </span>
                                    <span
                                        data-testid="document-status"
                                        className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-semibold"
                                    >
                                        {localizedStatus}
                                    </span>
                                </div>
                            </div>

                            <div>
                                {pdf.kind === "locked" && (
                                    <div
                                        role="note"
                                        className="flex flex-col items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 sm:flex-row sm:items-center dark:text-amber-200"
                                    >
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                                            <span>{copy.pdfLocked}</span>
                                        </div>
                                        <Link
                                            href={`/${locale}/susun`}
                                            className="inline-flex min-h-[44px] items-center justify-center font-bold text-primary underline underline-offset-4 hover:opacity-80"
                                        >
                                            {copy.resolveLink}
                                        </Link>
                                    </div>
                                )}

                                {pdf.kind === "loading" && (
                                    <div
                                        role="status"
                                        aria-busy="true"
                                        className="flex h-[60vh] min-h-[360px] w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-muted-foreground"
                                    >
                                        {copy.loading}
                                    </div>
                                )}

                                {pdf.kind === "error" && (
                                    <div
                                        role="alert"
                                        className="flex h-[60vh] min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/20 p-6 text-center"
                                    >
                                        <p className="text-muted-foreground">
                                            {copy.pdfUnavailable}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPdfAttempt((c) => c + 1);
                                                setViewState((prev) =>
                                                    prev.kind === "ready"
                                                        ? {
                                                              ...prev,
                                                              pdf: {
                                                                  kind: "loading",
                                                              },
                                                          }
                                                        : prev
                                                );
                                            }}
                                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-secondary px-5 py-2 font-bold text-secondary-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)]"
                                        >
                                            {copy.retry}
                                        </button>
                                    </div>
                                )}

                                {pdf.kind === "ready" && (
                                    <iframe
                                        src={pdf.url}
                                        title={copy.pdfFrameTitle.replace(
                                            "{nomor}",
                                            doc.nomor
                                        )}
                                        className="h-[60vh] min-h-[360px] w-full rounded-xl border border-border bg-muted/20"
                                        data-testid="pdf-frame"
                                    />
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={downloadPdf}
                                    disabled={
                                        locked || downloadState === "loading"
                                    }
                                    title={locked ? copy.lockedReason : undefined}
                                    className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)] disabled:opacity-50"
                                    data-testid="btn-unduh"
                                >
                                    {downloadState === "loading"
                                        ? copy.loading
                                        : copy.download}
                                </button>
                                <button
                                    type="button"
                                    disabled
                                    title={
                                        locked
                                            ? copy.lockedReason
                                            : copy.sendComingSoon
                                    }
                                    className="min-h-[48px] rounded-xl bg-secondary px-5 py-2 font-bold text-secondary-foreground disabled:opacity-50"
                                    data-testid="btn-kirim"
                                >
                                    {copy.send}
                                </button>
                            </div>

                            <div className="space-y-2 text-sm">
                                {locked && (
                                    <p
                                        className="flex items-start gap-2 text-amber-800 dark:text-amber-200"
                                        role="note"
                                    >
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>
                                            {doc.pendingCount > 0
                                                ? copy.lockedNote.replace(
                                                      "{count}",
                                                      String(doc.pendingCount)
                                                  )
                                                : copy.lockedReason}
                                        </span>
                                    </p>
                                )}
                                {downloadState === "error" && (
                                    <p
                                        role="alert"
                                        className="flex items-start gap-2 text-destructive"
                                    >
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>{copy.downloadError}</span>
                                    </p>
                                )}
                                <p className="text-muted-foreground">
                                    {copy.sendComingSoon}
                                </p>
                            </div>
                        </div>
                    );
                })()}
        </section>
    );
}
