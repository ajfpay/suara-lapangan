"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sliceWav } from "./slice";
import { getLocalRecordingBlob } from "./storage";

export interface PlaybackState {
    isPlaying: boolean;
    activeTurnId: string | null;
    audioUnavailableTurnId: string | null;
    error: string | null;
}

export function useAudioSlicePlayer(sessionId: string) {
    const [state, setState] = useState<PlaybackState>({
        isPlaying: false,
        activeTurnId: null,
        audioUnavailableTurnId: null,
        error: null,
    });

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const cachedBlobRef = useRef<{ sessionId: string; blob: Blob } | null>(
        null
    );
    const generationRef = useRef<number>(0);
    const pendingTurnIdRef = useRef<string | null>(null);

    const cleanupAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
            audioRef.current = null;
        }
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
    }, []);

    const stop = useCallback(() => {
        generationRef.current += 1;
        pendingTurnIdRef.current = null;
        cleanupAudio();
        setState((prev) => ({
            ...prev,
            isPlaying: false,
            activeTurnId: null,
        }));
    }, [cleanupAudio]);

    // B2: Reset cached blob and stop any in-flight playback when sessionId changes
    useEffect(() => {
        cachedBlobRef.current = null;
        stop();
    }, [sessionId, stop]);

    const playTurnSlice = useCallback(
        async (turnId: string, startMs: number, endMs: number) => {
            if (
                (state.isPlaying && state.activeTurnId === turnId) ||
                pendingTurnIdRef.current === turnId
            ) {
                stop();
                return;
            }

            const generation = ++generationRef.current;
            pendingTurnIdRef.current = turnId;
            cleanupAudio();

            try {
                let blob =
                    cachedBlobRef.current?.sessionId === sessionId
                        ? cachedBlobRef.current.blob
                        : null;
                if (!blob) {
                    const fetched = await getLocalRecordingBlob(sessionId);
                    if (generation !== generationRef.current) {
                        return;
                    }
                    if (fetched) {
                        cachedBlobRef.current = { sessionId, blob: fetched };
                        blob = fetched;
                    }
                }

                if (!blob) {
                    if (generation !== generationRef.current) {
                        return;
                    }
                    if (pendingTurnIdRef.current === turnId) {
                        pendingTurnIdRef.current = null;
                    }
                    setState((prev) => ({
                        ...prev,
                        isPlaying: false,
                        activeTurnId: null,
                        audioUnavailableTurnId: turnId,
                        error: null,
                    }));
                    return;
                }

                const slicedBlob = await sliceWav(blob, startMs, endMs);
                if (generation !== generationRef.current) {
                    return;
                }

                // Revoke any previously created object URL before overwriting
                if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current);
                    objectUrlRef.current = null;
                }

                const url = URL.createObjectURL(slicedBlob);
                if (generation !== generationRef.current) {
                    URL.revokeObjectURL(url);
                    return;
                }
                objectUrlRef.current = url;

                const audio = new Audio(url);
                if (generation !== generationRef.current) {
                    cleanupAudio();
                    return;
                }
                audioRef.current = audio;

                audio.onended = () => {
                    if (generation !== generationRef.current) return;
                    cleanupAudio();
                    setState((prev) => ({
                        ...prev,
                        isPlaying: false,
                        activeTurnId: null,
                    }));
                };

                audio.onerror = () => {
                    if (generation !== generationRef.current) return;
                    cleanupAudio();
                    setState((prev) => ({
                        ...prev,
                        isPlaying: false,
                        activeTurnId: null,
                        error: "Gagal memutar audio slice",
                    }));
                };

                if (generation !== generationRef.current) {
                    cleanupAudio();
                    return;
                }

                await audio.play();
                if (generation !== generationRef.current) {
                    cleanupAudio();
                    return;
                }

                if (pendingTurnIdRef.current === turnId) {
                    pendingTurnIdRef.current = null;
                }
                setState({
                    isPlaying: true,
                    activeTurnId: turnId,
                    audioUnavailableTurnId: null,
                    error: null,
                });
            } catch (err: unknown) {
                if (generation !== generationRef.current) {
                    return;
                }
                if (pendingTurnIdRef.current === turnId) {
                    pendingTurnIdRef.current = null;
                }
                cleanupAudio();
                const msg =
                    err instanceof Error ? err.message : "Error playing audio";
                setState((prev) => ({
                    ...prev,
                    isPlaying: false,
                    activeTurnId: null,
                    error: msg,
                }));
            }
        },
        [sessionId, state.isPlaying, state.activeTurnId, stop, cleanupAudio]
    );

    const clearUnavailableNotice = useCallback(() => {
        setState((prev) => ({
            ...prev,
            audioUnavailableTurnId: null,
        }));
    }, []);

    const clearError = useCallback(() => {
        setState((prev) => ({
            ...prev,
            error: null,
        }));
    }, []);

    useEffect(() => {
        return () => {
            generationRef.current += 1;
            cleanupAudio();
        };
    }, [cleanupAudio]);

    return {
        ...state,
        playTurnSlice,
        stop,
        clearUnavailableNotice,
        clearError,
    };
}
