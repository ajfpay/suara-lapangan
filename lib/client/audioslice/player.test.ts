// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioSlicePlayer } from "./player";
import { sliceWavBuffer } from "./slice";
import * as storage from "./storage";

const FIXTURE_DIR = join(process.cwd(), "lib/server/asr/__fixtures__");
const sampleWav = new Uint8Array(
    readFileSync(join(FIXTURE_DIR, "sample-16k.wav"))
);

/** Synchronous WAV Blob from fixture. */
const fakeBlob: Blob = (() => {
    const buf = sliceWavBuffer(sampleWav, 0, 1000);
    return new Blob([buf], { type: "audio/wav" });
})();

describe("lib/client/audioslice/player", () => {
    let revokedUrls: string[];
    let playMock: ReturnType<typeof vi.fn>;
    let currentAudioEl: {
        src: string;
        play: ReturnType<typeof vi.fn>;
        pause: ReturnType<typeof vi.fn>;
        onended: (() => void) | null;
        onerror: (() => void) | null;
        addEventListener: ReturnType<typeof vi.fn>;
        removeEventListener: ReturnType<typeof vi.fn>;
    } | null;

    beforeEach(() => {
        revokedUrls = [];
        playMock = vi.fn().mockResolvedValue(undefined);
        currentAudioEl = null;

        vi.spyOn(storage, "getLocalRecordingBlob").mockResolvedValue(fakeBlob);

        // Stub URL utilities
        const mockCreateObjectURL = vi.fn(() => "blob:http://localhost/test-slice");
        const mockRevokeObjectURL = vi.fn((url: string) => {
            revokedUrls.push(url);
        });

        vi.stubGlobal("URL", {
            createObjectURL: mockCreateObjectURL,
            revokeObjectURL: mockRevokeObjectURL,
        });

        // Stub Audio constructor
        const AudioMock = vi.fn().mockImplementation((src?: string) => {
            const el = {
                src: src ?? "",
                play: playMock,
                pause: vi.fn(),
                onended: null as (() => void) | null,
                onerror: null as (() => void) | null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            };
            currentAudioEl = el;
            return el;
        });
        vi.stubGlobal("Audio", AudioMock);
    });

    // vitest runs with globals: false here, so @testing-library/react cannot
    // register its own afterEach cleanup; unmount explicitly or every hook
    // render in this file stays mounted.
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("play path — audio.play() resolves, isPlaying becomes true and activeTurnId is set", async () => {
        const { result } = renderHook(() => useAudioSlicePlayer("session-play-1", "id"));

        await act(async () => {
            await result.current.playTurnSlice("turn_1", 0, 1000);
        });

        expect(playMock).toHaveBeenCalled();
        expect(result.current.isPlaying).toBe(true);
        expect(result.current.activeTurnId).toBe("turn_1");
        expect(result.current.audioUnavailableTurnId).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it("stop() — clears state and revokes object URL", async () => {
        const { result } = renderHook(() => useAudioSlicePlayer("session-play-2", "id"));

        await act(async () => {
            await result.current.playTurnSlice("turn_1", 0, 1000);
        });

        expect(result.current.isPlaying).toBe(true);
        expect(result.current.activeTurnId).toBe("turn_1");

        act(() => {
            result.current.stop();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-slice");
        expect(revokedUrls).toContain("blob:http://localhost/test-slice");
    });

    it("autoplay-blocked path — audio.play() rejects with NotAllowedError, distinct error message is set", async () => {
        playMock.mockRejectedValue(
            new DOMException(
                "play() failed because user did not interact with document first",
                "NotAllowedError"
            )
        );

        const { result } = renderHook(() => useAudioSlicePlayer("session-play-3", "id"));

        await act(async () => {
            await result.current.playTurnSlice("turn_2", 0, 1000);
        });

        expect(playMock).toHaveBeenCalled();
        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
        expect(result.current.audioUnavailableTurnId).toBeNull();
        expect(result.current.autoplayBlockedTurnId).toBe("turn_2");
        expect(result.current.error).toBe("Autoplay diblokir: interaksi pengguna diperlukan");
    });

    it("autoplay-blocked path with English locale sets English error message", async () => {
        playMock.mockRejectedValue(
            new DOMException(
                "play() failed because user did not interact with document first",
                "NotAllowedError"
            )
        );

        const { result } = renderHook(() => useAudioSlicePlayer("session-play-4", "en"));

        await act(async () => {
            await result.current.playTurnSlice("turn_2", 0, 1000);
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
        expect(result.current.autoplayBlockedTurnId).toBe("turn_2");
        expect(result.current.error).toBe("Autoplay blocked: user interaction required");
    });

    it("missing recording blob sets audioUnavailableTurnId", async () => {
        vi.spyOn(storage, "getLocalRecordingBlob").mockResolvedValue(null);

        const { result } = renderHook(() => useAudioSlicePlayer("session-no-blob", "id"));

        await act(async () => {
            await result.current.playTurnSlice("turn_missing", 0, 1000);
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
        expect(result.current.audioUnavailableTurnId).toBe("turn_missing");
        expect(result.current.error).toBeNull();
    });

    it("audio onended resets isPlaying and activeTurnId", async () => {
        const { result } = renderHook(() => useAudioSlicePlayer("session-ended", "id"));

        await act(async () => {
            await result.current.playTurnSlice("turn_1", 0, 1000);
        });
        expect(result.current.isPlaying).toBe(true);

        act(() => {
            currentAudioEl?.onended?.();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
    });

    it("audio onerror reports the failure in the active locale", async () => {
        const { result } = renderHook(() =>
            useAudioSlicePlayer("session-error-en", "en")
        );

        await act(async () => {
            await result.current.playTurnSlice("turn_1", 0, 1000);
        });
        expect(result.current.isPlaying).toBe(true);

        act(() => {
            currentAudioEl?.onerror?.();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
        expect(result.current.error).toBe("Failed to play the audio slice");
    });

    it("a non-autoplay play() rejection surfaces the error, not the device notice", async () => {
        playMock.mockRejectedValue(new Error("decode failed"));

        const { result } = renderHook(() =>
            useAudioSlicePlayer("session-play-5", "en")
        );

        await act(async () => {
            await result.current.playTurnSlice("turn_3", 0, 1000);
        });

        expect(result.current.isPlaying).toBe(false);
        expect(result.current.activeTurnId).toBeNull();
        expect(result.current.audioUnavailableTurnId).toBeNull();
        expect(result.current.autoplayBlockedTurnId ?? null).toBeNull();
        expect(result.current.error).toBe("decode failed");
    });
});
