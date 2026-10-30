"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    AlertCircle,
    ArrowRight,
    Loader2,
    RefreshCw,
    Volume2,
} from "lucide-react";

import { useAudioSlicePlayer } from "@/lib/client/audioslice/player";
import { getLatestLocalRecordingSessionId } from "@/lib/client/audioslice/storage";
import { TurnCard, type TurnData } from "./TurnCard";
import { KonfirmasiPanel } from "./KonfirmasiPanel";

interface TurnReviewProps {
    locale: string;
    copy: {
        title: string;
        body: string;
        workItemsTitle?: string;
        workItemsEmpty?: string;
        workItemsEmptyBody?: string;
        manualSessionIdLabel?: string;
        manualSessionIdPlaceholder?: string;
    };
}

export function TurnReview({ locale, copy }: TurnReviewProps) {
    const isIndo = locale === "id";
    const searchParams = useSearchParams();

    const paramSessionId =
        searchParams?.get("sessionId") ?? searchParams?.get("session") ?? null;

    const [sessionId, setSessionId] = useState<string | null>(paramSessionId);
    const [turns, setTurns] = useState<TurnData[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [manualSessionInput, setManualSessionInput] = useState<string>("");

    // Audio slice player
    const {
        isPlaying,
        activeTurnId,
        audioUnavailableTurnId,
        error: playbackError,
        playTurnSlice,
        clearUnavailableNotice,
        clearError,
    } = useAudioSlicePlayer(sessionId ?? "", isIndo ? "id" : "en");

    // Resolve sessionId if not provided in URL
    useEffect(() => {
        if (paramSessionId) {
            setSessionId(paramSessionId);
            return;
        }

        let isMounted = true;
        getLatestLocalRecordingSessionId()
            .then((latestId) => {
                if (isMounted && latestId) {
                    setSessionId(latestId);
                } else if (isMounted) {
                    setIsLoading(false);
                }
            })
            .catch(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [paramSessionId]);

    // Fetch turns from GET /api/sessions/${sessionId}/turns
    const fetchTurns = useCallback(
        async (targetSessionId: string) => {
            if (!targetSessionId) {
                setTurns([]);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const res = await fetch(
                    `/api/sessions/${encodeURIComponent(targetSessionId)}/turns`
                );

                if (!res.ok) {
                    if (res.status === 404) {
                        setTurns([]);
                        setError(
                            isIndo
                                ? "Sesi rekaman belum memiliki transkrip di server. Pastikan rekaman sudah diunggah."
                                : "Recording session has no transcripts on the server yet. Please ensure recording has been uploaded."
                        );
                    } else {
                        const json = await res.json().catch(() => null);
                        const msg =
                            json?.error?.message ??
                            (isIndo
                                ? "Gagal memuat giliran dari server."
                                : "Failed to load turns from server.");
                        setError(msg);
                    }
                    setIsLoading(false);
                    return;
                }

                const data = await res.json();
                const fetchedTurns = (data?.turns ?? []) as TurnData[];
                // Ensure strictly ordered by ascending startMs
                fetchedTurns.sort((a, b) => a.startMs - b.startMs);
                setTurns(fetchedTurns);
            } catch (err: unknown) {
                const message =
                    err instanceof Error
                        ? err.message
                        : isIndo
                          ? "Koneksi terputus saat mengambil data giliran."
                          : "Connection error loading turns.";
                setError(message);
            } finally {
                setIsLoading(false);
            }
        },
        [isIndo]
    );

    useEffect(() => {
        if (sessionId) {
            fetchTurns(sessionId);
        }
    }, [sessionId, fetchTurns]);

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = manualSessionInput.trim();
        if (trimmed) {
            setSessionId(trimmed);
        }
    };

    // ── Render Loading State ───────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="mt-8 flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-xl font-bold text-foreground">
                    {isIndo
                        ? "Memuat giliran rekaman..."
                        : "Loading recording turns..."}
                </p>
                <p className="text-base text-muted-foreground">
                    {isIndo
                        ? "Mengambil data transkrip dan stempel waktu"
                        : "Retrieving transcripts and timestamps"}
                </p>
            </div>
        );
    }

    // ── Render Empty State (No session or 0 turns) ─────────────────────────────
    if (!sessionId || (turns.length === 0 && !error)) {
        return (
            <section
                aria-labelledby="empty-turns-title"
                className="mt-8 space-y-6"
            >
                <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 px-6 py-12 text-center">
                    <p
                        id="empty-turns-title"
                        className="text-2xl font-bold text-foreground"
                    >
                        {copy.workItemsEmpty ??
                            (isIndo
                                ? "Belum ada rekaman untuk disusun"
                                : "No recording to assemble yet")}
                    </p>
                    <p className="mx-auto mt-3 max-w-lg text-lg text-muted-foreground">
                        {copy.workItemsEmptyBody ??
                            (isIndo
                                ? "Langkah 1 (Rekam) yang menambahkannya. Ucapkan pekerjaan dan sistem akan membaginya ke dalam giliran."
                                : "Step 1 (Record) adds one. Speak the job and the system will split it into turns.")}
                    </p>

                    <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                        <a
                            href={`/${locale}/rekam`}
                            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-lg font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                        >
                            <span>
                                {isIndo
                                    ? "Ke Langkah 1: Rekam"
                                    : "Go to Step 1: Record"}
                            </span>
                            <ArrowRight className="h-5 w-5" />
                        </a>
                    </div>

                    {/* Manual session lookup helper for testing/recovery */}
                    <div className="mx-auto mt-10 max-w-md border-t border-border/60 pt-6">
                        <p className="text-sm font-semibold text-muted-foreground">
                            {copy.manualSessionIdLabel ??
                                (isIndo
                                    ? "Atau masukkan ID sesi secara manual:"
                                    : "Or enter Session ID manually:")}
                        </p>
                        <form
                            onSubmit={handleManualSubmit}
                            className="mt-3 flex gap-2"
                        >
                            <input
                                type="text"
                                value={manualSessionInput}
                                onChange={(e) =>
                                    setManualSessionInput(e.target.value)
                                }
                                placeholder={
                                    copy.manualSessionIdPlaceholder ??
                                    (isIndo ? "contoh: sess-123" : "e.g. sess-123")
                                }
                                className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <button
                                type="submit"
                                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-secondary px-4 py-2.5 font-bold text-secondary-foreground hover:bg-secondary/80 transition-colors"
                            >
                                {isIndo ? "Muat" : "Load"}
                            </button>
                        </form>
                    </div>
                </div>
            </section>
        );
    }

    // ── Render Error State ─────────────────────────────────────────────────────
    if (error && turns.length === 0) {
        return (
            <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 sm:p-8 text-foreground shadow-sm">
                <div className="flex items-start gap-3">
                    <AlertCircle className="mt-1 h-7 w-7 text-destructive flex-shrink-0" />
                    <div className="space-y-2 flex-1">
                        <h3 className="text-xl font-bold text-destructive">
                            {isIndo
                                ? "Terjadi Kendala Memuat Giliran"
                                : "Problem Loading Turns"}
                        </h3>
                        <p className="text-base text-muted-foreground">{error}</p>
                        {sessionId && (
                            <p className="font-mono text-sm text-foreground">
                                {isIndo ? "ID sesi:" : "Session ID:"} {sessionId}
                            </p>
                        )}
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => sessionId && fetchTurns(sessionId)}
                                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-base font-bold text-destructive-foreground hover:bg-destructive/90 transition-colors"
                            >
                                <RefreshCw className="h-4 w-4" />
                                <span>{isIndo ? "Coba Lagi" : "Try Again"}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Render Turns List ──────────────────────────────────────────────────────
    return (
        <section aria-labelledby="turns-title" className="mt-8 space-y-6">
            {/* Top Toolbar / Status Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card/60 px-5 py-3">
                <div className="flex items-center gap-3">
                    <span className="font-display text-xl font-bold text-foreground">
                        {isIndo
                            ? `${turns.length} Giliran Terdaftar`
                            : `${turns.length} Turns Recorded`}
                    </span>
                    {sessionId && (
                        <span className="hidden sm:inline-block font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                            {sessionId}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => sessionId && fetchTurns(sessionId)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                        title={
                            isIndo
                                ? "Segarkan daftar giliran"
                                : "Refresh turns list"
                        }
                    >
                        <RefreshCw className="h-4 w-4" />
                        <span>{isIndo ? "Segarkan" : "Refresh"}</span>
                    </button>
                </div>
            </div>

            {/* Playback Error Alert */}
            {playbackError && (
                <div
                    className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-foreground shadow-sm"
                    role="alert"
                >
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                        <div className="space-y-1">
                            <p className="font-bold text-sm text-destructive">
                                {isIndo
                                    ? "Gagal memutar kutipan audio"
                                    : "Failed to play audio quote"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {playbackError}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={clearError}
                        className="rounded p-1 text-sm font-bold text-destructive hover:opacity-80"
                        aria-label={
                            isIndo ? "Tutup pesan error" : "Dismiss error"
                        }
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Turn Cards List */}
            <div className="flex flex-col gap-5">
                {turns.map((turn, idx) => {
                    const turnIndex = idx + 1;
                    const isCurrentPlaying =
                        isPlaying && activeTurnId === turn.turn_id;
                    const isCurrentUnavailable =
                        audioUnavailableTurnId === turn.turn_id;

                    return (
                        <TurnCard
                            key={turn.turn_id || idx}
                            turn={turn}
                            index={turnIndex}
                            locale={locale}
                            isPlaying={isCurrentPlaying}
                            onPlay={() =>
                                playTurnSlice(
                                    turn.turn_id,
                                    turn.startMs,
                                    turn.endMs
                                )
                            }
                            isUnavailable={isCurrentUnavailable}
                            onDismissUnavailable={clearUnavailableNotice}
                        />
                    );
                })}
            </div>

            {/* Floating Audio Playback Banner when playing */}
            {isPlaying && activeTurnId && (
                <div
                    className="sticky bottom-4 z-30 flex items-center justify-between gap-4 rounded-2xl border border-primary bg-primary p-4 text-primary-foreground shadow-xl"
                    role="status"
                    aria-live="polite"
                >
                    <div className="flex items-center gap-3">
                        <Volume2 className="h-6 w-6 animate-pulse" />
                        <div>
                            <p className="font-bold text-base sm:text-lg">
                                {isIndo
                                    ? `Memutar audio giliran (${activeTurnId})`
                                    : `Playing turn audio slice (${activeTurnId})`}
                            </p>
                            <p className="text-xs opacity-90">
                                {isIndo
                                    ? "Hanya memutar rentang detik suara giliran ini"
                                    : "Playing only the seconds for this turn"}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <KonfirmasiPanel
                locale={locale}
                sessionId={sessionId}
                onPlayEvidence={(turnId) => {
                    const t = turns.find((x) => x.turn_id === turnId);
                    if (t) playTurnSlice(t.turn_id, t.startMs, t.endMs);
                }}
            />
        </section>
    );
}
