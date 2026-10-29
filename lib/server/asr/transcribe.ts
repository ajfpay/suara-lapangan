import { createHash } from "node:crypto";

import { getTurnsStore } from "@/lib/server/db/store";

import { AsrError } from "./errors";
import type { Locale } from "./locale";
import { transcribeWithMeta } from "./meta";
import { normalizeTurns, type Turn } from "./turns";

export type TranscribeInput = {
    sessionId: string;
    locale: Locale;
    audio: Uint8Array;
};

/**
 * One recording in, the session's turns out.
 *
 * Idempotent by `sessionId` + the SHA-256 of the audio: a re-upload of the same
 * recording replays the stored turns instead of paying for a second
 * transcription and renumbering what the user already quoted. The same session
 * id with different audio is a new recording and replaces the old turns, so
 * `turn_1` always means the range the stored transcript says it does.
 */
export async function transcribeSession({
    sessionId,
    locale,
    audio,
}: TranscribeInput): Promise<Turn[]> {
    const audioSha256 = createHash("sha256").update(audio).digest("hex");
    const store = getTurnsStore();

    const stored = await store.findSession(sessionId);
    if (stored && stored.audioSha256 === audioSha256) return stored.turns;

    const apiKey = process.env.MODEL_API_KEY;
    if (!apiKey) {
        throw new AsrError("not_configured", {
            detail: "MODEL_API_KEY is not set",
        });
    }

    const meta = await transcribeWithMeta({ audio, locale, sessionId, apiKey });
    const turns = normalizeTurns(meta);

    await store.saveTranscription({
        sessionId,
        locale,
        audioSha256,
        audioBytes: audio.byteLength,
        metaSessionId:
            typeof meta.sessionId === "string" ? meta.sessionId : null,
        transcript: meta.transcript ?? "",
        audioDurationMs:
            typeof meta.audioDurationMs === "number"
                ? meta.audioDurationMs
                : null,
        turns,
    });

    return turns;
}
