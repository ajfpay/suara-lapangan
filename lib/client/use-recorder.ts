"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toWav16k } from "@/lib/client/audio";
import { getRecordQueue, type AsrMode } from "@/lib/client/record-queue";

export type { AsrMode };

export type RecorderStatus = "idle" | "recording" | "processing" | "error";

export interface UseRecorderOptions {
  /**
   * Optional prefix for minted session IDs.
   * Every completed recording generates a new unique sessionId prefixed with this value:
   * `${sessionId}${crypto.randomUUID()}`.
   */
  sessionId?: string;
  /**
   * Route locale ("en" | "id") the recorder page runs under. Passed to the
   * record queue so the upload carries a locale the ASR route accepts.
   */
  locale?: string;
  onRecordingComplete?: (blob: Blob) => void;
  minPressDurationMs?: number;
  mode?: AsrMode;
  initialMode?: AsrMode;
}

export function useRecorder(options: UseRecorderOptions = {}) {
  const { minPressDurationMs = 300, onRecordingComplete } = options;

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [mode, setModeState] = useState<AsrMode>(options.mode ?? options.initialMode ?? "ENDPOINTING");
  const modeRef = useRef<AsrMode>(mode);
  modeRef.current = mode;

  const setMode = useCallback((newMode: AsrMode) => {
    modeRef.current = newMode;
    setModeState(newMode);
  }, []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressTriggeredRef = useRef(false);
  // Synchronous in-flight flag: two startRecording calls before the first
  // getUserMedia resolves must share one mic request, not open two streams.
  const startingRef = useRef(false);
  // Set on unmount: a getUserMedia that resolves after unmount must have its
  // stream released immediately instead of starting a recording.
  const unmountedRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const q = getRecordQueue(options.locale);
      const pending = await q.getPending();
      setPendingCount(pending.length);
    } catch {
      // IndexedDB access may fail in private mode or SSR
    }
  }, [options.locale]);

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    const handleOnline = () => {
      setIsOnline(true);
      getRecordQueue(options.locale).processQueue().then(refreshPendingCount);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    refreshPendingCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(durationTimerRef.current as NodeJS.Timeout);
      clearTimeout(pressTimerRef.current as NodeJS.Timeout);
      unmountedRef.current = true;
      // Unmount while recording: detach handlers first so the forced stop
      // below cannot fire onstop into an unmounted hook, then stop the
      // recorder and release the mic.
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // Already stopping; tracks are released below regardless.
          }
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
    };
  }, [refreshPendingCount, options.locale]);
  const startRecording = useCallback(async () => {
    // Re-entry guard: no second getUserMedia while a capture is active.
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      return;
    }
    if (status === "recording" || status === "processing") return;
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (unmountedRef.current) {
        // Unmounted while the mic request was in flight: release the
        // late-arriving stream immediately; never start a recording.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      setStatus("recording");
      setDuration(0);

      durationTimerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Gagal mengakses mikrofon";
      setError(message);
      setStatus("error");
    } finally {
      startingRef.current = false;
    }
  }, [status]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    setStatus("processing");
    setDuration(0);
    setProcessingStartedAt(Date.now());
    durationTimerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);

    let resolvePromise: () => void = () => {};
    const promise = new Promise<void>((res) => {
      resolvePromise = res;
    });
    recorder.onstop = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const rawBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        const arrayBuffer = await rawBlob.arrayBuffer();
        const AudioContextConstructor =
          window.AudioContext ||
          ("webkitAudioContext" in window
            ? (window.webkitAudioContext as typeof AudioContext)
            : null);
        if (!AudioContextConstructor) {
          throw new Error("AudioContext tidak didukung di browser ini");
        }
        const audioCtx = new AudioContextConstructor();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioCtx.close();

        const wavBlob = toWav16k(audioBuffer);
        const queue = getRecordQueue(options.locale);
        // Every completed recording requires a unique sessionId:
        // 1. RecordQueue dedupes by sessionId; with an already-uploaded record, a matching
        //    sessionId causes subsequent recordings to be silently discarded.
        // 2. The ticket-03 ASR route replaces existing turns when the same sessionId arrives
        //    with different audio.
        // Generating a fresh id per recording guarantees all audio is preserved and uploaded.
        const prefix = options.sessionId ?? "";
        const recordingSessionId = `${prefix}${crypto.randomUUID()}`;
        await queue.add(wavBlob, recordingSessionId, modeRef.current, options.locale);
        await refreshPendingCount();

        if (navigator.onLine) {
          await queue.processQueue();
          await refreshPendingCount();
        }

        if (onRecordingComplete) {
          onRecordingComplete(wavBlob);
        }

        setStatus("idle");
        resolvePromise();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Gagal memproses rekaman";
        setError(message);
        setStatus("error");
        resolvePromise();
      } finally {
        if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
        }
        setProcessingStartedAt(null);
      }
    };

    recorder.stop();
    return promise;
  }, [onRecordingComplete, refreshPendingCount, options.sessionId, options.locale]);
  const toggleRecording = useCallback(() => {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle") {
      startRecording();
    }
  }, [status, startRecording, stopRecording]);

  const handlePointerDown = useCallback(() => {
    pressTriggeredRef.current = false;
    clearTimeout(pressTimerRef.current as NodeJS.Timeout);

    pressTimerRef.current = setTimeout(() => {
      pressTriggeredRef.current = true;
      toggleRecording();
    }, minPressDurationMs);
  }, [minPressDurationMs, toggleRecording]);

  const handlePointerUp = useCallback(() => {
    clearTimeout(pressTimerRef.current as NodeJS.Timeout);
    pressTimerRef.current = null;
  }, []);

  const handlePointerCancel = useCallback(() => {
    clearTimeout(pressTimerRef.current as NodeJS.Timeout);
    pressTimerRef.current = null;
  }, []);

  return {
    status,
    isRecording: status === "recording",
    isProcessing: status === "processing",
    duration,
    processingStartedAt,
    error,
    isOnline,
    pendingCount,
    get mode() {
      return modeRef.current;
    },
    setMode,
    startRecording,
    stopRecording,
    toggleRecording,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    refreshPendingCount,
  };
}
