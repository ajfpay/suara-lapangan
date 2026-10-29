import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    parseWav,
    sliceWav,
    sliceWavBuffer,
} from "./slice";

const FIXTURE_DIR = join(
    process.cwd(),
    "lib/server/asr/__fixtures__"
);
const sampleWav = new Uint8Array(
    readFileSync(join(FIXTURE_DIR, "sample-16k.wav"))
);

describe("lib/client/audioslice/slice", () => {
    describe("parseWav", () => {
        it("parses valid 16kHz mono PCM fixture", () => {
            const info = parseWav(sampleWav);
            expect(info.sampleRate).toBe(16000);
            expect(info.numChannels).toBe(1);
            expect(info.bitsPerSample).toBe(16);
            expect(info.blockAlign).toBe(2);
            expect(info.byteRate).toBe(32000);
            expect(info.totalSamples).toBe(16000);
            expect(Math.round(info.durationMs)).toBe(1000);
        });

        it("throws on empty or non-WAV buffer", () => {
            expect(() => parseWav(new Uint8Array(5))).toThrow(
                "Invalid WAV: file too small"
            );
            expect(() =>
                parseWav(new TextEncoder().encode("NOT_A_WAV_FILE_HEADER"))
            ).toThrow("Invalid WAV: missing RIFF header");
        });
    });

    describe("sliceWavBuffer", () => {
        it("slices middle 400ms exactly", () => {
            // 300ms to 700ms = 400ms = 0.4s * 16000 = 6400 samples * 2 bytes = 12800 bytes
            const sliced = sliceWavBuffer(sampleWav, 300, 700);
            const info = parseWav(sliced);

            expect(info.sampleRate).toBe(16000);
            expect(info.numChannels).toBe(1);
            expect(info.totalSamples).toBe(6400);
            expect(info.dataLength).toBe(12800);
            expect(info.durationMs).toBe(400);
            expect(sliced.byteLength).toBe(44 + 12800);
        });

        it("clamps negative startMs to 0", () => {
            const sliced = sliceWavBuffer(sampleWav, -200, 500);
            const info = parseWav(sliced);

            expect(info.durationMs).toBe(500);
            expect(info.totalSamples).toBe(8000);
        });

        it("clamps endMs exceeding file duration", () => {
            const sliced = sliceWavBuffer(sampleWav, 800, 5000);
            const info = parseWav(sliced);

            expect(info.durationMs).toBe(200);
            expect(info.totalSamples).toBe(3200);
        });

        it("handles startMs >= endMs gracefully with empty slice", () => {
            const sliced = sliceWavBuffer(sampleWav, 500, 300);
            const info = parseWav(sliced);

            expect(info.totalSamples).toBe(0);
            expect(info.dataLength).toBe(0);
            expect(sliced.byteLength).toBe(44);
        });
    });

    describe("sliceWav (Blob)", () => {
        it("returns a Blob of type audio/wav", async () => {
            const blob = await sliceWav(sampleWav, 100, 600);
            expect(blob.type).toBe("audio/wav");
            expect(blob.size).toBe(44 + 16000); // 500ms = 8000 samples = 16000 bytes
        });
    });
});
