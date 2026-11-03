import { Pool } from "pg";

import { AsrError, SessionOwnershipError } from "@/lib/server/asr/errors";
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
    /** Owner written to sessions.user_id; null for rows that predate auth. */
    userId?: string | null;
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
    /** Owner from sessions.user_id; null for rows created before migration 0010. */
    userId?: string | null;
    turns: Turn[];
};

export interface TurnsStore {
    findSession(sessionId: string): Promise<StoredSession | null>;
    saveTranscription(record: TranscriptionRecord): Promise<void>;
    setSessionOwner?(sessionId: string, userId: string): Promise<void>;
    /**
     * First-writer-wins claim: sets owner only when the row exists and is
     * ownerless. When `create` is provided and no row exists yet, the claim
     * atomically inserts a placeholder row owned by the caller
     * (INSERT ... ON CONFLICT DO NOTHING) and re-reads ownership, so two
     * simultaneous first uploads converge: the winner gets 'claimed', the
     * loser gets 'foreign'. Without `create`, a missing row returns
     * 'missing' and the caller must create it. Returns 'claimed' when the
     * caller now owns the row, 'foreign' when another user owns it,
     * 'orphan' when the row is ownerless and the caller is not an admin.
     */
    claimSessionOwner?(
        sessionId: string,
        userId: string,
        isAdmin?: boolean,
        create?: { locale: Locale; audioSha256: string; audioBytes: number }
    ): Promise<"claimed" | "foreign" | "missing" | "orphan">;
}

export function createPostgresStore(connectionString: string): TurnsStore {
    const pool = new Pool({ connectionString });

    return {
        async findSession(sessionId) {
            const session = await pool.query<{
                locale: Locale;
                audio_sha256: string;
                mode: string;
                user_id: string | null;
            }>("select locale, audio_sha256, mode, user_id from sessions where id = $1", [
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
                userId: session.rows[0].user_id ?? null,
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
                // Race guard: the claim check in the route happens before the
                // (paid) transcription, so a second caller can create the row
                // in between. Re-check ownership inside this transaction: a
                // foreign-owned row must never be overwritten with our audio.
                const ownerRow = await client.query<{
                    user_id: string | null;
                }>("select user_id from sessions where id = $1 for update", [
                    record.sessionId,
                ]);
                if (ownerRow.rowCount === 1) {
                    const owner = ownerRow.rows[0].user_id;
                    if (owner != null && owner !== (record.userId ?? null)) {
                        await client.query("rollback");
                        throw new SessionOwnershipError(404);
                    }
                }
                await client.query(
                    `insert into sessions
                        (id, locale, audio_sha256, audio_bytes, meta_session_id, transcript, audio_duration_ms, mode, user_id, updated_at)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
                     on conflict (id) do update set
                        locale = excluded.locale,
                        audio_sha256 = excluded.audio_sha256,
                        audio_bytes = excluded.audio_bytes,
                        meta_session_id = excluded.meta_session_id,
                        transcript = excluded.transcript,
                        audio_duration_ms = excluded.audio_duration_ms,
                        mode = excluded.mode,
                        user_id = coalesce(sessions.user_id, excluded.user_id),
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
                        record.userId ?? null,
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

        async setSessionOwner(sessionId, userId) {
            await pool.query(
                "update sessions set user_id = $1 where id = $2 and user_id is null",
                [userId, sessionId]
            );
        },

        async claimSessionOwner(
            sessionId: string,
            userId: string,
            isAdmin = false,
            create?: { locale: string; audioSha256: string; audioBytes: number }
        ) {
            const existing = await pool.query<{ user_id: string | null }>(
                "select user_id from sessions where id = $1",
                [sessionId]
            );
            if (existing.rowCount === 0) {
                // No row yet: atomically insert a placeholder owned by the
                // caller so two simultaneous first uploads converge. The
                // winner's insert lands and gets 'claimed'; the loser's
                // insert conflicts and the re-read below reports 'foreign'.
                // Without create data there is nothing to insert, so report
                // 'missing' and let the caller create the row.
                if (!create) return "missing";
                await pool.query(
                    `insert into sessions
                        (id, locale, audio_sha256, audio_bytes, transcript, user_id, updated_at)
                     values ($1, $2, $3, $4, '', $5, now())
                     on conflict (id) do nothing`,
                    [
                        sessionId,
                        create.locale,
                        create.audioSha256,
                        create.audioBytes,
                        userId,
                    ]
                );
                const raced = await pool.query<{ user_id: string | null }>(
                    "select user_id from sessions where id = $1",
                    [sessionId]
                );
                if (raced.rowCount === 0) return "missing";
                return raced.rows[0].user_id === userId
                    ? "claimed"
                    : "foreign";
            }
            const owner = existing.rows[0].user_id;
            if (owner != null) return owner === userId ? "claimed" : "foreign";
            // Ownerless legacy row: only an admin may adopt it. A non-admin
            // caller must get the same 403 the cache/overwrite paths raise,
            // never silently become the owner.
            if (!isAdmin) return "orphan";
            const result = await pool.query<{
                user_id: string | null;
            }>(
                `update sessions set user_id = $1
                 where id = $2 and user_id is null
                 returning user_id`,
                [userId, sessionId]
            );
            if (result.rowCount === 1) return "claimed";
            const raced = await pool.query<{ user_id: string | null }>(
                "select user_id from sessions where id = $1",
                [sessionId]
            );
            if (raced.rowCount === 0) return "missing";
            return raced.rows[0].user_id === userId ? "claimed" : "foreign";
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
