import { describe, expect, it } from "vitest";

import { normalizeTurns } from "./turns";

/**
 * The K3 turn contract: `{turn_id, startMs, endMs, transcript, final}`, numbered
 * `turn_1..turn_N` in ascending `startMs` order, with no overlapping ranges.
 *
 * Every expectation below is written from that contract, not from the
 * implementation: Meta returns turns in arrival order and occasionally
 * overlapping, and the document guard later refuses to cite a range that is
 * not exactly what was said.
 */

describe("normalizeTurns", () => {
    it("numbers Meta turns turn_1..turn_N in ascending startMs order", () => {
        const turns = normalizeTurns({
            turns: [
                {
                    startMs: 8000,
                    endMs: 9500,
                    transcript: "and two bags of cement",
                },
                { startMs: 0, endMs: 4200, transcript: "good morning" },
                {
                    startMs: 4200,
                    endMs: 8000,
                    transcript: "I need ten meters of rebar",
                },
            ],
        });

        expect(turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 4200,
                transcript: "good morning",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_2",
                startMs: 4200,
                endMs: 8000,
                transcript: "I need ten meters of rebar",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_3",
                startMs: 8000,
                endMs: 9500,
                transcript: "and two bags of cement",
                final: true,
                speaker: null,
            },
        ]);
    });

    it("clamps an overlapping turn so no two ranges overlap", () => {
        const turns = normalizeTurns({
            turns: [
                { startMs: 0, endMs: 1000, transcript: "satu" },
                { startMs: 500, endMs: 1500, transcript: "dua" },
                { startMs: 1400, endMs: 2000, transcript: "tiga" },
            ],
        });

        expect(turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 1000,
                transcript: "satu",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_2",
                startMs: 1000,
                endMs: 1500,
                transcript: "dua",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_3",
                startMs: 1500,
                endMs: 2000,
                transcript: "tiga",
                final: true,
                speaker: null,
            },
        ]);
    });

    it("drops a turn that is entirely inside the one before it", () => {
        const turns = normalizeTurns({
            turns: [
                { startMs: 0, endMs: 4000, transcript: "harga borongan" },
                {
                    startMs: 2000,
                    endMs: 3000,
                    transcript: "echo of the same words",
                },
                { startMs: 3000, endMs: 5000, transcript: "dua puluh sak" },
            ],
        });

        expect(turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 4000,
                transcript: "harga borongan",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_2",
                startMs: 4000,
                endMs: 5000,
                transcript: "dua puluh sak",
                final: true,
                speaker: null,
            },
        ]);
    });

    it("treats a turn with a missing or null endMs as an empty range at its start", () => {
        const turns = normalizeTurns({
            turns: [
                { startMs: 1200, endMs: null, transcript: "tak terdengar" },
                { startMs: 3000, endMs: 3600, transcript: "lanjut" },
            ],
        });

        expect(turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 1200,
                endMs: 1200,
                transcript: "tak terdengar",
                final: true,
                speaker: null,
            },
            {
                turn_id: "turn_2",
                startMs: 3000,
                endMs: 3600,
                transcript: "lanjut",
                final: true,
                speaker: null,
            },
        ]);
    });

    it("falls back to one turn spanning the recording when Meta returns no turns", () => {
        const turns = normalizeTurns({
            transcript: "sepuluh meter kubik galian tanah",
            audioDurationMs: 9000,
        });

        expect(turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 9000,
                transcript: "sepuluh meter kubik galian tanah",
                final: true,
                speaker: null,
            },
        ]);
    });

    it("returns no turns for a recording Meta heard nothing in", () => {
        expect(
            normalizeTurns({ turns: [], transcript: "", audioDurationMs: 5000 })
        ).toEqual([]);
        expect(normalizeTurns({})).toEqual([]);
    });

    it("keeps ranges ascending and non-overlapping whatever Meta sent", () => {
        const turns = normalizeTurns({
            turns: [
                { startMs: 500, endMs: 900, transcript: "c" },
                { startMs: 100, endMs: 700, transcript: "b" },
                { startMs: 0, endMs: 200, transcript: "a" },
                { startMs: 3000, endMs: 3000, transcript: "d" },
            ],
        });

        for (const [index, turn] of turns.entries()) {
            expect(turn.turn_id).toBe(`turn_${index + 1}`);
            expect(turn.endMs).toBeGreaterThanOrEqual(turn.startMs);
            if (index > 0) {
                expect(turn.startMs).toBeGreaterThanOrEqual(
                    turns[index - 1].endMs
                );
            }
        }
    });

    it("passes speaker labels through from Meta in DIARIZATION mode", () => {
        const turns = normalizeTurns({
            turns: [
                {
                    startMs: 0,
                    endMs: 3000,
                    transcript: "Berapa sak semen?",
                    speaker: "A",
                },
                {
                    startMs: 3200,
                    endMs: 6000,
                    transcript: "Sepuluh sak cukup.",
                    speaker: "B",
                },
                {
                    startMs: 6200,
                    endMs: 8000,
                    transcript: "Siap, langsung kirim.",
                    speaker: "A",
                },
            ],
        });

        expect(turns).toEqual([
            {
                turn_id: "turn_1",
                startMs: 0,
                endMs: 3000,
                transcript: "Berapa sak semen?",
                final: true,
                speaker: "A",
            },
            {
                turn_id: "turn_2",
                startMs: 3200,
                endMs: 6000,
                transcript: "Sepuluh sak cukup.",
                final: true,
                speaker: "B",
            },
            {
                turn_id: "turn_3",
                startMs: 6200,
                endMs: 8000,
                transcript: "Siap, langsung kirim.",
                final: true,
                speaker: "A",
            },
        ]);
    });
});
