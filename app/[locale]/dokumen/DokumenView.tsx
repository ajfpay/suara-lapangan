"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, FileText } from "lucide-react";

export type DocumentStatus =
    | "draf"
    | "disetujui"
    | "terkirim"
    | "perlu_konfirmasi"
    | "siap";

export type DocumentVersionItem = {
    id: string;
    version: number;
    nomor: string | null;
    status: DocumentStatus;
    supersededBy?: string | null;
    rootId?: string;
};

type Summary = {
    id: string;
    nomor: string | null;
    status: DocumentStatus;
    pendingCount: number;
    version: number;
    rootId: string;
    supersededBy: string | null;
    versions: DocumentVersionItem[];
};

type PdfState =
    | { kind: "draft" }
    | { kind: "locked" }
    | { kind: "loading" }
    | { kind: "ready"; url: string }
    | { kind: "error" };

type ViewState =
    | { kind: "empty"; reason: "missing" | "not_found" }
    | { kind: "loading" }
    | { kind: "error"; code: string | null }
    | { kind: "unauthorized" }
    | { kind: "ready"; document: Summary; pdf: PdfState };

interface DokumenViewProps {
    locale: string;
    docId: string | null;
    copy: Record<string, string>;
    versions?: DocumentVersionItem[];
}

function pdfUrl(id: string): string {
    return `/api/documents/${encodeURIComponent(id)}/pdf`;
}

function getLoginUrl(locale: string, defaultDocId?: string | null): string {
    const here =
        typeof window !== "undefined" && window.location
            ? window.location.pathname + window.location.search
            : `/${locale}/dokumen${defaultDocId ? `?doc=${encodeURIComponent(defaultDocId)}` : ""}`;
    return `/${locale}/login?callbackUrl=${encodeURIComponent(here)}`;
}

function toSummary(
    body: unknown,
    fallbackVersions?: DocumentVersionItem[]
): Summary | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const doc = b.document;
    if (!doc || typeof doc !== "object") return null;
    const d = doc as Record<string, unknown>;

    if (typeof d.id !== "string" || d.id.trim() === "") return null;

    let nomor: string | null = null;
    if (typeof d.nomor === "string" && d.nomor.trim() !== "") {
        nomor = d.nomor;
    } else if (typeof b.nomor === "string" && b.nomor.trim() !== "") {
        nomor = b.nomor;
    }

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
        rawStatus === "draf" ||
        rawStatus === "disetujui" ||
        rawStatus === "terkirim" ||
        rawStatus === "perlu_konfirmasi" ||
        rawStatus === "siap"
    ) {
        status = rawStatus;
    } else {
        status = pendingCount > 0 ? "perlu_konfirmasi" : "siap";
    }

    const version =
        typeof b.version === "number"
            ? b.version
            : typeof d.version === "number"
              ? d.version
              : 1;

    const rootId =
        typeof b.root_id === "string"
            ? b.root_id
            : typeof d.root_id === "string"
              ? d.root_id
              : typeof b.rootId === "string"
                ? b.rootId
                : typeof d.rootId === "string"
                  ? d.rootId
                  : d.id;

    const supersededBy =
        typeof b.superseded_by === "string"
            ? b.superseded_by
            : typeof d.superseded_by === "string"
              ? d.superseded_by
              : typeof b.supersededBy === "string"
                ? b.supersededBy
                : typeof d.supersededBy === "string"
                  ? d.supersededBy
                  : null;

    const rawVersions = Array.isArray(b.versions)
        ? b.versions
        : Array.isArray(b.lineage)
          ? b.lineage
          : Array.isArray(d.versions)
            ? d.versions
            : null;

    let versions: DocumentVersionItem[] = [];
    if (rawVersions) {
        versions = rawVersions
            .filter(
                (v): v is Record<string, unknown> =>
                    typeof v === "object" && v !== null
            )
            .map((v) => {
                const vNomor =
                    typeof v.nomor === "string" && v.nomor.trim() !== ""
                        ? v.nomor
                        : null;
                const vStatus = (
                    v.status === "draf" ||
                    v.status === "disetujui" ||
                    v.status === "terkirim" ||
                    v.status === "perlu_konfirmasi" ||
                    v.status === "siap"
                        ? v.status
                        : "draf"
                ) as DocumentStatus;
                const vSupersededBy =
                    typeof v.superseded_by === "string"
                        ? v.superseded_by
                        : typeof v.supersededBy === "string"
                          ? v.supersededBy
                          : null;
                return {
                    id: String(v.id),
                    version: typeof v.version === "number" ? v.version : 1,
                    nomor: vNomor,
                    status: vStatus,
                    supersededBy: vSupersededBy,
                    rootId:
                        typeof v.root_id === "string"
                            ? v.root_id
                            : typeof v.rootId === "string"
                              ? v.rootId
                              : undefined,
                };
            });
    } else if (fallbackVersions && fallbackVersions.length > 0) {
        versions = fallbackVersions;
    }

    return {
        id: d.id,
        nomor,
        status,
        pendingCount,
        version,
        rootId,
        supersededBy,
        versions,
    };
}

export function DokumenView({
    locale,
    docId,
    copy,
    versions: initialVersions,
}: DokumenViewProps) {
    const isIndo = locale === "id";
    const [activeDocId, setActiveDocId] = useState<string | null>(docId);
    const [lineageVersions, setLineageVersions] = useState<
        DocumentVersionItem[]
    >(initialVersions ?? []);
    const lineageVersionsRef = useRef<DocumentVersionItem[]>(
        initialVersions ?? []
    );
    const initialVersionsRef = useRef<DocumentVersionItem[] | undefined>(
        initialVersions
    );

    useEffect(() => {
        initialVersionsRef.current = initialVersions;
    }, [initialVersions]);

    useEffect(() => {
        lineageVersionsRef.current = lineageVersions;
    }, [lineageVersions]);
    const [attempt, setAttempt] = useState(0);
    const [pdfAttempt, setPdfAttempt] = useState(0);
    const [downloadState, setDownloadState] = useState<
        "idle" | "loading" | "error"
    >("idle");
    const [recipientEmail, setRecipientEmail] = useState("");
    const [sendState, setSendState] = useState<
        "idle" | "sending" | "success" | "error"
    >("idle");
    const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(
        null
    );
    const [creatingVersion, setCreatingVersion] = useState(false);
    const [newVersionError, setNewVersionError] = useState<string | null>(null);

    const prevDocIdRef = useRef<string | null>(docId);
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
        setActiveDocId(docId);
    }, [docId]);

    useEffect(() => {
        if (prevDocIdRef.current !== activeDocId) {
            prevDocIdRef.current = activeDocId;
            setRecipientEmail("");
            setSendState("idle");
            setSendErrorMessage(null);
            setDownloadState("idle");
            setCreatingVersion(false);
            setNewVersionError(null);
        }
    }, [activeDocId]);

    useEffect(() => {
        revokeBlobUrl();
        revokeDownloadUrl();
        setDownloadState("idle");
        if (activeDocId === null) {
            setViewState({ kind: "empty", reason: "missing" });
            return;
        }

        setViewState({ kind: "loading" });
        const controller = new AbortController();
        let cancelled = false;

        const fetchDocument = async () => {
            try {
                const res = await fetch(
                    `/api/documents/${encodeURIComponent(activeDocId)}`,
                    {
                        signal: controller.signal,
                        cache: "no-store",
                    }
                );

                if (cancelled) return;

                if (res.status === 401) {
                    const targetUrl = getLoginUrl(locale, activeDocId);
                    window.location.href = targetUrl;
                    setViewState({ kind: "unauthorized" });
                    return;
                }

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

                const fallback =
                    lineageVersionsRef.current.length > 0
                        ? lineageVersionsRef.current
                        : initialVersionsRef.current;
                const summary = toSummary(body, fallback);
                if (!summary) {
                    setViewState({ kind: "error", code: "invalid_response" });
                    return;
                }

                if (summary.versions.length > 0) {
                    lineageVersionsRef.current = summary.versions;
                    setLineageVersions(summary.versions);
                } else if (lineageVersionsRef.current.length > 0) {
                    summary.versions = lineageVersionsRef.current;
                }

                let initialPdfState: PdfState;
                if (summary.status === "draf") {
                    initialPdfState = { kind: "draft" };
                } else if (
                    summary.status === "perlu_konfirmasi" ||
                    summary.pendingCount > 0
                ) {
                    initialPdfState = { kind: "locked" };
                } else {
                    initialPdfState = { kind: "loading" };
                }

                setViewState({
                    kind: "ready",
                    document: summary,
                    pdf: initialPdfState,
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
    }, [activeDocId, attempt, locale]);

    const isPdfLoading =
        viewState.kind === "ready" && viewState.pdf.kind === "loading";
    const readyDocId =
        viewState.kind === "ready" && viewState.document.status !== "draf"
            ? viewState.document.id
            : null;

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

                if (res.status === 401) {
                    window.location.href = getLoginUrl(locale, readyDocId);
                    return;
                }

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
    }, [isPdfLoading, readyDocId, pdfAttempt, locale]);

    const downloadPdf = async () => {
        if (viewState.kind !== "ready" || downloadState === "loading") return;
        const doc = viewState.document;
        if (doc.status === "draf") return;

        setDownloadState("loading");
        try {
            const res = await fetch(pdfUrl(doc.id), { cache: "no-store" });
            if (res.status === 401) {
                window.location.href = getLoginUrl(locale, doc.id);
                setDownloadState("idle");
                return;
            }
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const disposition = res.headers.get("content-disposition") ?? "";
            const match = disposition.match(/filename="?([^";]+)"?/i);
            const fallbackNomor = doc.nomor
                ? doc.nomor.replaceAll("/", "-")
                : `dokumen-${doc.id}`;
            const filename = match?.[1] ?? `${fallbackNomor}.pdf`;
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

    const sendEmail = async () => {
        if (viewState.kind !== "ready" || sendState === "sending") return;
        const doc = viewState.document;
        if (doc.status === "draf") return;

        const trimmed = recipientEmail.trim();
        if (!trimmed || !trimmed.includes("@")) {
            setSendState("error");
            setSendErrorMessage(
                copy.sendInvalidEmail || "Enter a valid email address."
            );
            return;
        }

        const sentDocId = doc.id;

        setSendState("sending");
        setSendErrorMessage(null);

        try {
            const res = await fetch(
                `/api/documents/${encodeURIComponent(sentDocId)}/email`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ to: trimmed }),
                }
            );

            if (prevDocIdRef.current !== sentDocId) return;

            if (res.status === 401) {
                window.location.href = getLoginUrl(locale, sentDocId);
                return;
            }

            if (!res.ok) {
                let errorMsg = copy.sendError || "Failed to send document.";
                try {
                    const errJson = await res.json();
                    if (errJson?.error === "email_not_configured") {
                        errorMsg = copy.sendNotConfigured || copy.sendError;
                    } else if (
                        errJson?.message &&
                        typeof errJson.message === "string"
                    ) {
                        errorMsg = errJson.message;
                    }
                } catch {
                    // Ignore json parse error
                }
                setSendState("error");
                setSendErrorMessage(errorMsg);
                setAttempt((c) => c + 1);
                return;
            }

            setSendState("success");
            setSendErrorMessage(null);
            setAttempt((c) => c + 1);
        } catch {
            if (prevDocIdRef.current !== sentDocId) return;
            setSendState("error");
            setSendErrorMessage(copy.sendError || "Failed to send document.");
        }
    };

    const createNewVersion = async () => {
        if (viewState.kind !== "ready" || creatingVersion) return;
        const doc = viewState.document;
        setCreatingVersion(true);
        setNewVersionError(null);

        try {
            const res = await fetch(
                `/api/documents/${encodeURIComponent(doc.id)}/new-version`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                }
            );

            if (res.status === 401) {
                window.location.href = getLoginUrl(locale, doc.id);
                return;
            }

            if (!res.ok) {
                let errorMsg =
                    copy.newVersionError || "Failed to create a new version.";
                try {
                    const errJson = await res.json();
                    if (
                        errJson?.message &&
                        typeof errJson.message === "string"
                    ) {
                        errorMsg = errJson.message;
                    }
                } catch {
                    // Ignore body parse error
                }
                setNewVersionError(errorMsg);
                return;
            }

            const data = await res.json();
            const newDocId = data?.document?.id;
            if (newDocId) {
                window.location.href = `/${locale}/susun?doc=${encodeURIComponent(newDocId)}`;
            } else {
                window.location.href = `/${locale}/susun`;
            }
        } catch {
            setNewVersionError(
                copy.newVersionError || "Failed to create a new version."
            );
        } finally {
            setCreatingVersion(false);
        }
    };

    const statusLabels: Record<Summary["status"], string> = {
        draf: copy.statusDraf || (isIndo ? "Draf" : "Draft"),
        disetujui: copy.statusDisetujui || (isIndo ? "Disetujui" : "Approved"),
        terkirim: copy.statusTerkirim || (isIndo ? "Terkirim" : "Sent"),
        perlu_konfirmasi:
            copy.statusPerluKonfirmasi ||
            (isIndo ? "Perlu konfirmasi" : "Needs confirmation"),
        siap: copy.statusSiap || (isIndo ? "Siap" : "Ready"),
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

            {viewState.kind === "unauthorized" && (
                <div
                    role="alert"
                    data-testid="dokumen-unauthorized"
                    className="space-y-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-foreground text-center"
                >
                    <h3 className="text-lg font-bold text-amber-700 dark:text-amber-300">
                        {copy.unauthorizedTitle ||
                            (isIndo ? "Perlu masuk akun" : "Sign in required")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {copy.unauthorizedBody ||
                            (isIndo
                                ? "Anda perlu masuk untuk mengakses dokumen ini."
                                : "You need to sign in to access this document.")}
                    </p>
                    <div>
                        <Link
                            href={getLoginUrl(locale, activeDocId)}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)]"
                        >
                            {copy.signInCta || (isIndo ? "Masuk" : "Sign in")}
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
                    const isDraft = doc.status === "draf";
                    const isApproved =
                        doc.status === "disetujui" ||
                        doc.status === "terkirim" ||
                        doc.status === "siap";
                    const locked =
                        doc.status === "perlu_konfirmasi" ||
                        doc.pendingCount > 0;
                    const isSuperseded = Boolean(doc.supersededBy);
                    const localizedStatus =
                        statusLabels[doc.status] ?? doc.status;
                    const displayNomor =
                        doc.nomor ??
                        (copy.draftNomor ||
                            (isIndo ? "Belum ditetapkan" : "Not yet assigned"));

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
                                        {displayNomor}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {copy.statusLabel}:
                                    </span>
                                    <span
                                        data-testid="document-status"
                                        className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-semibold"
                                    >
                                        {localizedStatus}
                                    </span>
                                    {isSuperseded && (
                                        <span
                                            data-testid="superseded-badge"
                                            className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
                                        >
                                            {copy.supersededLabel ||
                                                (isIndo
                                                    ? "Digantikan"
                                                    : "Superseded")}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {doc.versions.length > 1 && (
                                <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
                                    <label
                                        htmlFor="version-selector"
                                        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                                    >
                                        {copy.versionsLabel ||
                                            (isIndo
                                                ? "Riwayat versi"
                                                : "Version history")}
                                        :
                                    </label>
                                    <select
                                        id="version-selector"
                                        data-testid="version-selector"
                                        value={doc.id}
                                        onChange={(e) => {
                                            const newId = e.target.value;
                                            if (newId !== doc.id) {
                                                setActiveDocId(newId);
                                                if (
                                                    typeof window !==
                                                        "undefined" &&
                                                    window.history?.pushState
                                                ) {
                                                    window.history.pushState(
                                                        null,
                                                        "",
                                                        `/${locale}/dokumen?doc=${encodeURIComponent(newId)}`
                                                    );
                                                }
                                            }
                                        }}
                                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        {doc.versions.map((v) => {
                                            const vNomor =
                                                v.nomor ??
                                                (copy.draftNomor ||
                                                    (isIndo
                                                        ? "Belum ditetapkan"
                                                        : "Not yet assigned"));
                                            const vStatus =
                                                statusLabels[v.status] ??
                                                v.status;
                                            const vIsSuperseded = Boolean(
                                                v.supersededBy
                                            );
                                            const label = `v${v.version} — ${vNomor} (${vStatus})${
                                                vIsSuperseded
                                                    ? ` — ${
                                                          copy.supersededLabel ||
                                                          (isIndo
                                                              ? "Digantikan"
                                                              : "Superseded")
                                                      }`
                                                    : ""
                                            }`;
                                            return (
                                                <option
                                                    key={v.id}
                                                    value={v.id}
                                                    data-testid={`version-option-${v.version}`}
                                                >
                                                    {label}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            )}

                            {isSuperseded && (
                                <div
                                    data-testid="superseded-banner"
                                    role="note"
                                    className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
                                >
                                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <span>
                                        {copy.supersededBanner ||
                                            (isIndo
                                                ? "Versi ini telah digantikan oleh versi yang lebih baru."
                                                : "This version has been superseded by a newer version.")}
                                    </span>
                                </div>
                            )}

                            <div>
                                {isDraft && (
                                    <div
                                        role="status"
                                        data-testid="approval-pending"
                                        className="flex h-[40vh] min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center"
                                    >
                                        <FileText className="h-10 w-10 text-muted-foreground" />
                                        <p className="text-base font-medium text-foreground">
                                            {copy.draftApprovalPending ||
                                                (isIndo
                                                    ? "Dokumen berupa draf dan menunggu persetujuan."
                                                    : "Document is a draft and pending approval.")}
                                        </p>
                                        <Link
                                            href={`/${locale}/susun`}
                                            className="inline-flex min-h-[44px] items-center justify-center font-bold text-primary underline underline-offset-4 hover:opacity-80"
                                        >
                                            {copy.resolveLink}
                                        </Link>
                                    </div>
                                )}

                                {!isDraft && pdf.kind === "locked" && (
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

                                {!isDraft && pdf.kind === "loading" && (
                                    <div
                                        role="status"
                                        aria-busy="true"
                                        className="flex h-[60vh] min-h-[360px] w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-muted-foreground"
                                    >
                                        {copy.loading}
                                    </div>
                                )}

                                {!isDraft && pdf.kind === "error" && (
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

                                {!isDraft && pdf.kind === "ready" && (
                                    <iframe
                                        src={pdf.url}
                                        title={copy.pdfFrameTitle.replace(
                                            "{nomor}",
                                            doc.nomor ?? ""
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
                                        isDraft ||
                                        locked ||
                                        downloadState === "loading"
                                    }
                                    title={
                                        isDraft
                                            ? copy.approveFirst ||
                                              (isIndo
                                                  ? "Setujui dokumen terlebih dahulu"
                                                  : "Approve document first")
                                            : locked
                                              ? copy.lockedReason
                                              : undefined
                                    }
                                    className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)] disabled:opacity-50"
                                    data-testid="btn-unduh"
                                >
                                    {downloadState === "loading"
                                        ? copy.loading
                                        : copy.download}
                                </button>
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        type="email"
                                        value={recipientEmail}
                                        onChange={(e) =>
                                            setRecipientEmail(e.target.value)
                                        }
                                        disabled={
                                            isDraft ||
                                            locked ||
                                            sendState === "sending"
                                        }
                                        placeholder={
                                            copy.sendRecipientPlaceholder
                                        }
                                        className="min-h-[48px] rounded-xl border border-border bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                                        data-testid="input-recipient"
                                        aria-label={
                                            copy.sendRecipientPlaceholder
                                        }
                                    />
                                    <button
                                        type="button"
                                        onClick={sendEmail}
                                        disabled={
                                            isDraft ||
                                            locked ||
                                            sendState === "sending"
                                        }
                                        title={
                                            isDraft
                                                ? copy.approveFirst ||
                                                  (isIndo
                                                      ? "Setujui dokumen terlebih dahulu"
                                                      : "Approve document first")
                                                : locked
                                                  ? copy.lockedReason
                                                  : undefined
                                        }
                                        className="min-h-[48px] rounded-xl bg-secondary px-5 py-2 font-bold text-secondary-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)] disabled:opacity-50"
                                        data-testid="btn-kirim"
                                    >
                                        {sendState === "sending"
                                            ? copy.sendSending
                                            : copy.send}
                                    </button>
                                </div>
                                {isApproved && (
                                    <button
                                        type="button"
                                        onClick={createNewVersion}
                                        disabled={
                                            creatingVersion || isSuperseded
                                        }
                                        title={
                                            isSuperseded
                                                ? copy.alreadySuperseded ||
                                                  (isIndo
                                                      ? "Versi ini telah digantikan"
                                                      : "This version has already been superseded")
                                                : undefined
                                        }
                                        className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-border bg-background px-5 py-2 font-bold text-foreground transition-transform duration-150 ease-out active:[transform:scale(0.97)] disabled:opacity-50"
                                        data-testid="btn-new-version"
                                    >
                                        {creatingVersion
                                            ? copy.creatingVersion ||
                                              (isIndo
                                                  ? "Membuat versi baru…"
                                                  : "Creating new version…")
                                            : copy.newVersion ||
                                              (isIndo
                                                  ? "Buat versi baru"
                                                  : "Create new version")}
                                    </button>
                                )}
                            </div>

                            <div className="space-y-2 text-sm">
                                {isDraft && (
                                    <p
                                        data-testid="draft-helper"
                                        className="flex items-start gap-2 text-muted-foreground"
                                    >
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>
                                            {copy.approveFirst ||
                                                (isIndo
                                                    ? "Setujui dokumen terlebih dahulu"
                                                    : "Approve document first")}
                                        </span>
                                    </p>
                                )}
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
                                {newVersionError && (
                                    <p
                                        role="alert"
                                        className="flex items-start gap-2 text-destructive"
                                        data-testid="new-version-error"
                                    >
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>{newVersionError}</span>
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
                                {sendState === "success" && (
                                    <p
                                        role="status"
                                        className="flex items-start gap-2 font-medium text-emerald-600 dark:text-emerald-400"
                                        data-testid="send-success-message"
                                    >
                                        <span>{copy.sendSuccess}</span>
                                    </p>
                                )}
                                {sendState === "error" && (
                                    <p
                                        role="alert"
                                        className="flex items-start gap-2 text-destructive"
                                        data-testid="send-error-message"
                                    >
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>
                                            {sendErrorMessage || copy.sendError}
                                        </span>
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })()}
        </section>
    );
}
