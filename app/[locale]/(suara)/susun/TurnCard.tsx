"use client";

import { AlertCircle, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TurnData {
    turn_id: string;
    startMs: number;
    endMs: number;
    transcript: string;
    final?: boolean;
    butuh_konfirmasi?: Array<{
        field?: string;
        alasan?: string;
    }>;
}

export interface TurnCardProps {
    turn: TurnData;
    index: number;
    locale: string;
    isPlaying: boolean;
    onPlay: () => void;
    isUnavailable: boolean;
    onDismissUnavailable: () => void;
}

function formatTimestamp(ms: number): string {
    const totalSeconds = Math.max(0, ms) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/**
 * Words or patterns often flagged as ambiguous in construction speech
 * (e.g. "delapan puluh" vs "delapan ratus", regional terms, or explicit queries).
 */
const AMBIGUOUS_WORDS_PATTERN =
    /\b(delapan puluh(?:\s+ribu)?|delapan ratus(?:\s+ribu)?|eighty|eight hundred|cakar ayam|realpaving|setengah|seperempat|half|quarter)\b/gi;

/**
 * Number patterns representing prices, volumes, units, or measurements.
 */
const HIGH_IMPORTANCE_NUMBER_PATTERN =
    /\b(?:\$|Rp\s*)?\d+(?:[.,]\d+)*(?:\s*(?:m2|m²|meter|sak|batang|titik|kg|sq\s*ft|lin\s*ft|bags|bars|ribu|juta|thousand|hundred|million|rupiah|dollar|USD|IDR))?\b/gi;

export function TurnCard({
    turn,
    index,
    locale,
    isPlaying,
    onPlay,
    isUnavailable,
    onDismissUnavailable,
}: TurnCardProps) {
    const isIndo = locale === "id";
    const turnLabel = isIndo ? `Giliran ${index}` : `Turn ${index}`;
    const quoteBadgeLabel = isIndo ? `Kutipan ${index}` : `Quote ${index}`;

    // Render transcript with highlighted confirmation phrases and number citation badges
    const renderTranscript = () => {
        const text = turn.transcript || "";
        if (!text) {
            return (
                <span className="italic text-muted-foreground">
                    {isIndo
                        ? "(Tidak ada ucapan terdeteksi)"
                        : "(No speech detected)"}
                </span>
            );
        }

        // Split text by tokens: ambiguous phrases, high-importance numbers, and normal text
        const combinedRegex =
            /(\b(?:delapan puluh(?:\s+ribu)?|delapan ratus(?:\s+ribu)?|eighty|eight hundred|cakar ayam|realpaving|setengah|seperempat|half|quarter)\b|\b(?:\$|Rp\s*)?\d+(?:[.,]\d+)*(?:\s*(?:m2|m²|meter|sak|batang|titik|kg|sq\s*ft|lin\s*ft|bags|bars|ribu|juta|thousand|hundred|million|rupiah|dollar|USD|IDR))?\b)/gi;

        const parts = text.split(combinedRegex);

        return parts.map((part, i) => {
            if (!part) return null;

            AMBIGUOUS_WORDS_PATTERN.lastIndex = 0;
            const isAmbiguous = AMBIGUOUS_WORDS_PATTERN.test(part);

            HIGH_IMPORTANCE_NUMBER_PATTERN.lastIndex = 0;
            const isNumber =
                !isAmbiguous && HIGH_IMPORTANCE_NUMBER_PATTERN.test(part);

            if (isAmbiguous) {
                return (
                    <mark
                        key={i}
                        className="rounded border border-amber-500 bg-amber-100 px-1.5 py-0.5 font-bold text-amber-950 underline decoration-amber-600 dark:border-amber-600 dark:bg-amber-950/80 dark:text-amber-100"
                        title={
                            isIndo
                                ? "Butuh konfirmasi: istilah atau angka ambigu"
                                : "Needs confirmation: ambiguous term or number"
                        }
                    >
                        {part}
                    </mark>
                );
            }

            if (isNumber) {
                return (
                    <span key={i} className="inline-flex items-center align-middle mx-0.5">
                        <strong className="font-bold text-foreground underline decoration-primary/40 underline-offset-4">
                            {part}
                        </strong>
                        <button
                            type="button"
                            onClick={onPlay}
                            className={cn(
                                "ml-1.5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-xl px-2.5 py-1 text-sm font-bold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 touch-manipulation align-middle",
                                isPlaying
                                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary"
                            )}
                            title={
                                isPlaying
                                    ? isIndo
                                        ? "Hentikan audio"
                                        : "Stop audio"
                                    : isIndo
                                      ? `Putar kutipan audio [${index}]`
                                      : `Play audio quote [${index}]`
                            }
                            aria-label={
                                isPlaying
                                    ? isIndo
                                        ? "Hentikan audio"
                                        : "Stop audio"
                                    : `${quoteBadgeLabel} [${index}]`
                            }
                        >
                            {isPlaying ? (
                                <>
                                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                                    <span>{index}</span>
                                </>
                            ) : (
                                <>
                                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>{index}</span>
                                </>
                            )}
                        </button>
                    </span>
                );
            }

            return <span key={i}>{part}</span>;
        });
    };

    return (
        <article
            className={cn(
                "flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:p-6 shadow-sm transition-all",
                isPlaying
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-border/80"
            )}
            data-testid={`turn-card-${index}`}
        >
            {/* Header: Turn label, time range, and citation badge */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                <div className="flex items-center gap-3">
                    <span className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                        {turnLabel}
                    </span>
                    <span className="font-mono text-sm font-semibold text-muted-foreground bg-muted px-2.5 py-1 rounded-md">
                        {formatTimestamp(turn.startMs)} →{" "}
                        {formatTimestamp(turn.endMs)}
                    </span>
                </div>

                {/* Primary Citation Badge Action (Large touch target for one-handed operation) */}
                <button
                    type="button"
                    onClick={onPlay}
                    className={cn(
                        "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-base font-bold touch-manipulation transition-colors shadow-sm",
                        isPlaying
                            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                    aria-label={
                        isPlaying
                            ? isIndo
                                ? "Hentikan audio"
                                : "Stop audio"
                            : `${quoteBadgeLabel} [${index}]`
                    }
                >
                    {isPlaying ? (
                        <>
                            <Square className="h-5 w-5 fill-current" />
                            <span>{isIndo ? "Berhenti" : "Stop"}</span>
                        </>
                    ) : (
                        <>
                            <Volume2 className="h-5 w-5" />
                            <span>
                                {quoteBadgeLabel}{" "}
                                <sup className="font-mono text-xs">
                                    [{index}]
                                </sup>
                            </span>
                        </>
                    )}
                </button>
            </div>

            {/* Transcript text with highlights */}
            <div className="text-lg leading-relaxed text-foreground sm:text-xl">
                {renderTranscript()}
            </div>

            {/* Flagged confirmation items if available */}
            {turn.butuh_konfirmasi && turn.butuh_konfirmasi.length > 0 && (
                <div className="mt-2 space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                    {turn.butuh_konfirmasi.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                            <span className="font-bold">⚠️ Butuh Konfirmasi:</span>
                            <span>{item.alasan ?? item.field}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Audio unavailable fallback note */}
            {isUnavailable && (
                <div
                    className="mt-2 flex items-start justify-between gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100"
                    role="alert"
                >
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="space-y-1">
                            <p className="font-bold text-base">
                                {isIndo
                                    ? "Audio asli tidak tersedia di perangkat ini"
                                    : "Original audio unavailable on this device"}
                            </p>
                            <p className="text-sm opacity-90">
                                {isIndo
                                    ? "Rekaman suara tersimpan di perangkat lokal perekam. Menampilkan teks transkrip:"
                                    : "The voice recording is stored on the original recording device. Showing transcript text:"}
                            </p>
                            <blockquote className="mt-2 border-l-2 border-amber-400 pl-3 text-base italic">
                                &ldquo;{turn.transcript}&rdquo;
                            </blockquote>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onDismissUnavailable}
                        className="rounded p-1 text-sm font-bold opacity-75 hover:opacity-100"
                        aria-label="Tutup pemberitahuan"
                    >
                        ✕
                    </button>
                </div>
            )}
        </article>
    );
}
