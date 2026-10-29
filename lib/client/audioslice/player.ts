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
    const cachedBlobRef = useRef<Blob | null>(null);

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
        cleanupAudio();
        setState((prev) => ({
            ...prev,
            isPlaying: false,
            activeTurnId: null,
        }));
    }, [cleanupAudio]);

    const playTurnSlice = useCallback(
        async (turnId: string, startMs: number, endMs: number) => {
            if (state.isPlaying && state.activeTurnId === turnId) {
                stop();
                return;
            }

            cleanupAudio();

            try {
                let blob = cachedBlobRef.current;
                if (!blob) {
                    blob = await getLocalRecordingBlob(sessionId);
                    if (blob) {
                        cachedBlobRef.current = blob;
                    }
                }

                if (!blob) {
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
                const url = URL.createObjectURL(slicedBlob);
                objectUrlRef.current = url;

                const audio = new Audio(url);
                audioRef.current = audio;

                audio.onended = () => {
                    cleanupAudio();
                    setState((prev) => ({
                        ...prev,
                        isPlaying: false,
                        activeTurnId: null,
                    }));
                };

                audio.onerror = () => {
                    cleanupAudio();
                    setState((prev) => ({
                        ...prev,
                        isPlaying: false,
                        activeTurnId: null,
                        error: "Gagal memutar audio slice",
                    }));
                };

                await audio.play();
                setState({
                    isPlaying: true,
                    activeTurnId: turnId,
                    audioUnavailableTurnId: null,
                    error: null,
                });
            } catch (err: unknown) {
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

    useEffect(() => {
        return () => {
            cleanupAudio();
        };
    }, [cleanupAudio]);

    return {
        ...state,
        playTurnSlice,
        stop,
        clearUnavailableNotice,
    };
}
