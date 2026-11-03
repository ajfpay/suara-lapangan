import { createHash } from "node:crypto";

import { getTurnsStore } from "@/lib/server/db/store";
import {
    assertQuotaAvailable,
    recordUsage,
} from "@/lib/server/quota/usage-meter";

import { AsrError, SessionOwnershipError } from "./errors";
export { SessionOwnershipError } from "./errors";
import type { Locale } from "./locale";
import { transcribeWithMeta, type AsrMode } from "./meta";
import { normalizeTurns, type Turn } from "./turns";
import { buildKeywords } from "./vocabulary";

export type TranscribeInput = {
    sessionId: string;
    locale: Locale;
    audio: Uint8Array;
    mode?: AsrMode;
    /** Caller identity for the cache-hit ownership check. */
    userId?: string | null;
    isAdmin?: boolean;
};

function checkSessionOwnership(
    storedUserId: string | null | undefined,
    callerUserId: string | null | undefined,
    isAdmin: boolean
): void {
    if (storedUserId == null) {
        if (!isAdmin) throw new SessionOwnershipError(403);
        return;
    }
    if (callerUserId == null || storedUserId !== callerUserId) {
        throw new SessionOwnershipError(404);
    }
}

/**
 * One recording in, the session's turns out.
 *
 * Idempotent by `sessionId` + the SHA-256 of the audio + the mode: a re-upload
 * of the same recording in the same mode replays the stored turns instead of
 * paying for a second transcription and renumbering what the user already
 * quoted. The mode is part of that identity because DIARIZATION adds speaker
 * labels ENDPOINTING does not, so replaying across modes would hide them. The
 * same session id with different audio is a new recording and replaces the old
 * turns, so `turn_1` always means the range the stored transcript says it does.
 */
export async function transcribeSession({
    sessionId,
    locale,
    audio,
    mode = "ENDPOINTING",
    userId = null,
    isAdmin = false,
}: TranscribeInput): Promise<Turn[]> {
    const audioSha256 = createHash("sha256").update(audio).digest("hex");
    const store = getTurnsStore();

    const stored = await store.findSession(sessionId);
    // A store that predates the mode column reports none; those rows were all
    // transcribed with ENDPOINTING, which is the column default.
    const storedMode = stored?.mode ?? "ENDPOINTING";
    if (stored && stored.audioSha256 === audioSha256 && storedMode === mode) {
        // Cache hit: verify the caller owns the session before replaying.
        // No quota is spent on a denied hit.
        checkSessionOwnership(stored.userId, userId, isAdmin);
        return stored.turns;
    }
    if (stored) {
        // Different audio or mode overwrites the session: the existing row
        // must already belong to the caller (or be a legacy ownerless row
        // an admin may adopt).
        checkSessionOwnership(stored.userId, userId, isAdmin);
    }

    // Hard-stop check: reject NEW session when daily cap reached
    await assertQuotaAvailable({ locale });

    const apiKey = process.env.MODEL_API_KEY;
    if (!apiKey) {
        throw new AsrError("not_configured", {
            detail: "MODEL_API_KEY is not set",
        });
    }

    const keywords = buildKeywords(locale, stored?.turns);
    const meta = await transcribeWithMeta({
        audio,
        locale,
        sessionId,
        apiKey,
        mode,
        keywords,
    });
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
        mode,
        turns,
        userId: userId ?? null,
    });

    const audioSeconds =
        typeof meta.audioDurationMs === "number"
            ? meta.audioDurationMs / 1000
            : audio.byteLength / 32000;

    await recordUsage({
        audioSeconds,
        tokens: 0,
        estCost: (audioSeconds / 3600) * 0.18,
    });

    return turns;
}
