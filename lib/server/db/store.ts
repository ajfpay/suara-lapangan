import { Pool } from "pg";

import { AsrError } from "@/lib/server/asr/errors";
import type { Locale } from "@/lib/server/asr/locale";
import type { Turn } from "@/lib/server/asr/turns";

export type TranscriptionRecord = {
    sessionId: string;
    locale: Locale;
    audioSha256: string;
    audioBytes: number;
    metaSessionId: string | null;
    transcript: string;
    audioDurationMs: number | null;
    /** Defaults to ENDPOINTING in the column when a caller omits it. */
    mode?: string;
    turns: Turn[];
};

export type StoredSession = {
    sessionId: string;
    locale: Locale;
    audioSha256: string;
    /**
     * The mode the turns were transcribed with. Optional because stores that
     * predate the column (and test doubles) do not report it; the cache check
     * treats a missing mode as ENDPOINTING.
     */
    mode?: string;
    turns: Turn[];
};

export interface TurnsStore {
    findSession(sessionId: string): Promise<StoredSession | null>;
    saveTranscription(record: TranscriptionRecord): Promise<void>;
}

export function createPostgresStore(connectionString: string): TurnsStore {
    const pool = new Pool({ connectionString });

    return {
        async findSession(sessionId) {
            const session = await pool.query<{
                locale: Locale;
                audio_sha256: string;
                mode: string;
            }>("select locale, audio_sha256, mode from sessions where id = $1", [
                sessionId,
            ]);
            if (session.rowCount === 0) return null;

            const stored = await pool.query<{
                turn_index: number;
                start_ms: number;
                end_ms: number;
                transcript: string;
                speaker: string | null;
            }>(
                "select turn_index, start_ms, end_ms, transcript, speaker from turns where session_id = $1 order by turn_index",
                [sessionId]
            );

            return {
                sessionId,
                locale: session.rows[0].locale,
                audioSha256: session.rows[0].audio_sha256,
                mode: session.rows[0].mode,
                turns: stored.rows.map((row) => ({
                    turn_id: `turn_${row.turn_index}`,
                    startMs: row.start_ms,
                    endMs: row.end_ms,
                    transcript: row.transcript,
                    final: true,
                    speaker: row.speaker ?? null,
                })),
            };
        },

        async saveTranscription(record) {
            const client = await pool.connect();
            try {
                await client.query("begin");
                await client.query(
                    `insert into sessions
                        (id, locale, audio_sha256, audio_bytes, meta_session_id, transcript, audio_duration_ms, mode, updated_at)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
                     on conflict (id) do update set
                        locale = excluded.locale,
                        audio_sha256 = excluded.audio_sha256,
                        audio_bytes = excluded.audio_bytes,
                        meta_session_id = excluded.meta_session_id,
                        transcript = excluded.transcript,
                        audio_duration_ms = excluded.audio_duration_ms,
                        mode = excluded.mode,
                        updated_at = now()`,
                    [
                        record.sessionId,
                        record.locale,
                        record.audioSha256,
                        record.audioBytes,
                        record.metaSessionId,
                        record.transcript,
                        record.audioDurationMs,
                        record.mode ?? "ENDPOINTING",
                    ]
                );

                // A re-upload of the same session replaces its turns rather than
                // appending a second set, so turn_1 always means the same range.
                await client.query("delete from turns where session_id = $1", [
                    record.sessionId,
                ]);
                for (const [index, turn] of record.turns.entries()) {
                    await client.query(
                        "insert into turns (session_id, turn_index, start_ms, end_ms, transcript, final, speaker) values ($1, $2, $3, $4, $5, $6, $7)",
                        [
                            record.sessionId,
                            index + 1,
                            turn.startMs,
                            turn.endMs,
                            turn.transcript,
                            turn.final,
                            turn.speaker ?? null,
                        ]
                    );
                }
                await client.query("commit");
            } catch (cause) {
                await client.query("rollback");
                throw cause;
            } finally {
                client.release();
            }
        },
    };
}

let shared: TurnsStore | null = null;

export function getTurnsStore(): TurnsStore {
    if (!shared) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new AsrError("not_configured", {
                detail: "DATABASE_URL is not set",
            });
        }
        shared = createPostgresStore(connectionString);
    }

    return shared;
}
