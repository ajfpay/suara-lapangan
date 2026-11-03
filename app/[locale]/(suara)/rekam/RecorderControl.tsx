"use client";
import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Mic, Square, Loader2, CloudOff, LogIn } from "lucide-react";
import { useRecorder, type AsrMode } from "@/lib/client/use-recorder";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface RecorderControlProps {
  copy: {
    primary: string;
    recording: string;
    stop: string;
    processing: string;
    processingHint?: string;
    uploadPending: string;
    holdHint: string;
    recordingHint: string;
    modeLabel: string;
    modeEndpointing: string;
    modeDiarization: string;
  };
}

export function RecorderControl({ copy }: RecorderControlProps) {
  const params = useParams();
  const locale = String(params?.locale ?? "id");
  const {
    isRecording,
    isProcessing,
    duration,
    error,
    isOnline,
    pendingCount,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    mode,
    setMode,
    stopRecording,
  } = useRecorder({ locale });
  const { data: authSession, isPending } = useSession();

  // Auth race (spec R40/S3): if the session resolves to null while our own
  // recorder is still running, stop it (stopRecording stops all MediaStream
  // tracks and releases the stream) so audio is never captured without a
  // visible stop control.
  React.useEffect(() => {
    if (!isPending && !authSession && isRecording) {
      void Promise.resolve()
        .then(() => stopRecording())
        .catch((err: unknown) => {
          console.error(
            "[recorder] auth-race stop failed:",
            err instanceof Error ? err.message : String(err)
          );
        });
    }
  }, [isPending, authSession, isRecording, stopRecording]);
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const showPendingBadge = !isOnline || pendingCount > 0;

  const pendingBadge = showPendingBadge ? (
    <div
      data-testid="pending-upload-badge"
      className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400"
    >
      <CloudOff className="h-4 w-4" aria-hidden="true" />
      <span>
        {copy.uploadPending}
        {pendingCount > 0 && ` (${pendingCount})`}
      </span>
    </div>
  ) : null;

  // Never show the logged-out notice while our own recorder is still
  // running — its stop control would be gone while capture continues.
  if (!isPending && !authSession && !isRecording) {
    return (
      <div
        className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 sm:p-10"
        data-testid="login-required-notice"
      >
        {/* Logged-out visitors have no queue of their own, so only show the
            badge when there is something actually pending. */}
        {pendingCount > 0 && pendingBadge}
        <LogIn className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-center text-sm text-muted-foreground">
          {locale === "id"
            ? "Masuk untuk mulai merekam. Hasil rekaman tersimpan ke akun Anda."
            : "Log in to start recording. Your recordings are saved to your account."}
        </p>
        <Link
          href={`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/rekam`)}`}
          className="min-h-[48px] rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground"
        >
          {locale === "id" ? "Masuk untuk merekam" : "Log in to record"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col items-center gap-6 rounded-2xl border border-border bg-card p-6 sm:p-10">
      {pendingBadge}

      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}
      <div className="flex flex-col items-center gap-1.5">
        <label
          htmlFor="asr-mode-select"
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {copy.modeLabel}
        </label>
        <select
          id="asr-mode-select"
          data-testid="asr-mode-select"
          value={mode}
          onChange={(e) => setMode(e.target.value as AsrMode)}
          disabled={isRecording || isProcessing}
          className="min-h-[44px] rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="ENDPOINTING">{copy.modeEndpointing}</option>
          <option value="DIARIZATION">{copy.modeDiarization}</option>
        </select>
      </div>

      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          data-testid="record-button"
          aria-label={isRecording ? copy.stop : copy.primary}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          disabled={isProcessing || isPending}
          className={cn(
            "relative flex h-32 w-32 min-h-[96px] min-w-[96px] select-none items-center justify-center rounded-full font-bold shadow-lg transition-[transform,background-color] duration-150 active:scale-95 sm:h-36 sm:w-36",
            isRecording
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
            isProcessing && "opacity-60 cursor-not-allowed"
          )}
        >
          {isProcessing ? (
            <Loader2 className="h-12 w-12 animate-spin" aria-hidden="true" />
          ) : isRecording ? (
            <Square className="h-12 w-12 fill-current" aria-hidden="true" />
          ) : (
            <Mic className="h-12 w-12" aria-hidden="true" />
          )}
        </button>

        <p className="text-sm font-medium text-muted-foreground text-center">
          {isRecording
            ? copy.recordingHint
            : isProcessing
            ? copy.processing.replace("{seconds}", String(duration))
            : copy.holdHint}
        </p>

        {isProcessing && copy.processingHint && (
          <p className="text-xs text-muted-foreground/80 text-center max-w-xs -mt-2">
            {copy.processingHint}
          </p>
        )}

        {isRecording && (
          <div
            data-testid="record-duration"
            className="font-mono text-2xl font-bold tracking-wider text-destructive"
          >
            {formatDuration(duration)}
          </div>
        )}
      </div>
    </div>
  );
}
