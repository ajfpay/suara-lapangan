"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

import { KonfirmasiCard, type KonfirmasiItem } from "./KonfirmasiCard";
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
    const [items, setItems] = useState<KonfirmasiItem[]>([]);
    const [status, setStatus] = useState<"siap" | "perlu_konfirmasi" | null>(
        null
    );
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState<number | null>(null);

    const load = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(
                `/api/documents?sessionId=${encodeURIComponent(sessionId)}`
            );
            if (!res.ok) return;
            const j = await res.json();
            const doc = j.document;
            if (!doc) return;
            setDocId(doc.nomor ?? sessionId);
            setTotal(
                typeof doc.total_nominal === "number" ? doc.total_nominal : null
            );
            setItems(j.butuh_konfirmasi ?? doc.butuh_konfirmasi ?? []);
            setStatus(j.status ?? null);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        load();
    }, [load]);

    if (!sessionId || loading) return null;
    if (!docId && items.length === 0) return null;

    const blocked = status === "perlu_konfirmasi" || items.length > 0;
    const shareBlocked = isShareBlocked(status, items.length);
    const shareUrl = buildWhatsAppShareUrl(
        buildShareSummary({
            nomor: docId ?? sessionId ?? "",
            total,
            pendingCount: items.length,
            locale,
        })
    );

    return (
        <section
            aria-labelledby="konfirmasi-title"
            className="mt-8 space-y-4"
            data-testid="konfirmasi-panel"
        >
            <h2 id="konfirmasi-title" className="text-xl font-bold">
                {isIndo ? "Konfirmasi Dokumen" : "Confirm Document"}
            </h2>
            {items.map((item) => (
                <KonfirmasiCard
                    key={item.field}
                    item={item}
                    locale={locale}
                    documentId={docId ?? sessionId}
                    onPlayEvidence={onPlayEvidence}
                    onResolved={(field) => {
                        setItems((prev) =>
                            prev.filter((i) => i.field !== field)
                        );
                        setItems((prev) => {
                            if (prev.length === 0) setStatus("siap");
                            return prev;
                        });
                    }}
                />
            ))}
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={blocked}
                    title={
                        blocked
                            ? isIndo
                                ? "Selesaikan semua konfirmasi dulu"
                                : "Resolve all confirmations first"
                            : undefined
                    }
                    className="min-h-[48px] rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50"
                    data-testid="btn-unduh"
                >
                    {isIndo ? "Unduh PDF" : "Download PDF"}
                </button>
                <button
                    type="button"
                    disabled={blocked}
                    title={
                        blocked
                            ? isIndo
                                ? "Selesaikan semua konfirmasi dulu"
                                : "Resolve all confirmations first"
                            : undefined
                    }
                    className="min-h-[48px] rounded-xl bg-secondary px-5 py-2 font-bold text-secondary-foreground disabled:opacity-50"
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
                    {isIndo ? "Bagikan via WhatsApp" : "Share via WhatsApp"}
                </a>
            </div>
            {blocked && (
                <p
                    className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200"
                    role="note"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {isIndo
                        ? `Masih ada ${items.length} field yang perlu dikonfirmasi sebelum dokumen siap.`
                        : `${items.length} field(s) still need confirmation before the document is ready.`}
                </p>
            )}
        </section>
    );
}
