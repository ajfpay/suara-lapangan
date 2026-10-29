"use client";

import { Mic, Square, Loader2, CloudOff } from "lucide-react";
import { useRecorder } from "@/lib/client/use-recorder";
import { cn } from "@/lib/utils";

interface RecorderControlProps {
  copy: {
    primary: string;
    recording: string;
    stop: string;
    processing: string;
    uploadPending: string;
    holdHint: string;
    recordingHint: string;
  };
}

export function RecorderControl({ copy }: RecorderControlProps) {
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
  } = useRecorder();

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const showPendingBadge = !isOnline || pendingCount > 0;

  return (
    <div className="mt-8 flex flex-col items-center gap-6 rounded-2xl border border-border bg-card p-6 sm:p-10">
      {showPendingBadge && (
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
      )}

      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          data-testid="record-button"
          aria-label={isRecording ? copy.stop : copy.primary}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          disabled={isProcessing}
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

        <p className="text-sm font-medium text-muted-foreground">
          {isRecording
            ? copy.recordingHint
            : isProcessing
            ? copy.processing
            : copy.holdHint}
        </p>

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
