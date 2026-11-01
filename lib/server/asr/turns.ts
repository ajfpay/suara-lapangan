/**
 * Turn contract K3 — the shape the document layer quotes from.
 *
 * `turn_id` is positional, not a Meta identifier: the document guard resolves a
 * citation by `(sessionId, turn_id)` and must be able to check that the quoted
 * range really is the turn the transcript says it is.
 */
export type Turn = {
    turn_id: string;
    startMs: number;
    endMs: number;
    transcript: string;
    final: true;
    speaker?: string | null;
};

/** A turn as Meta returns it. Only `turns` from `ENDPOINTING` and `DIARIZATION` reaches this. */
export type MetaTurn = {
    startMs?: number | null;
    endMs?: number | null;
    transcript?: string | null;
    speaker?: string | null;
};
/** The one-shot transcription response. `turns` is absent outside the speech modes. */
export type MetaTranscription = {
    sessionId?: string | null;
    transcript?: string | null;
    audioDurationMs?: number | null;
    turns?: MetaTurn[] | null;
};

function milliseconds(
    value: number | null | undefined,
    fallback: number
): number {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : fallback;
}

/**
 * Meta's turns arrive in detection order and its ranges occasionally overlap or
 * nest. Ours are numbered from one in ascending `startMs` order and never
 * overlap, so a quoted range always maps back to exactly one utterance.
 */
export function normalizeTurns(meta: MetaTranscription): Turn[] {
    const candidates = meta.turns?.length
        ? meta.turns.map((turn) => {
              const startMs = milliseconds(turn.startMs, 0);
              return {
                  startMs,
                  endMs: milliseconds(turn.endMs, startMs),
                  transcript: turn.transcript ?? "",
                  speaker: turn.speaker ?? null,
              };
          })
        : meta.transcript
          ? [
                {
                    startMs: 0,
                    endMs: milliseconds(meta.audioDurationMs, 0),
                    transcript: meta.transcript,
                    speaker: null,
                },
            ]
          : [];
    const turns: Turn[] = [];
    let previousEnd = 0;

    for (const candidate of [...candidates].sort(
        (a, b) => a.startMs - b.startMs
    )) {
        const startMs = Math.max(candidate.startMs, previousEnd);
        // Clamping a nested turn would leave it ending before it starts; its
        // words are already covered by the turn that contains it.
        if (candidate.endMs < startMs) continue;

        turns.push({
            turn_id: `turn_${turns.length + 1}`,
            startMs,
            endMs: candidate.endMs,
            transcript: candidate.transcript,
            final: true,
            speaker: candidate.speaker ?? null,
        });
        previousEnd = candidate.endMs;
    }

    return turns;
}
