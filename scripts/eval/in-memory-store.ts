import type {
    StoredSession,
    TranscriptionRecord,
    TurnsStore,
} from "@/lib/server/db/store";

const sessionMap = new Map<string, StoredSession>();

/**
 * Clean in-memory store for evaluation runs that do not require an active PostgreSQL instance.
 */
export function getInMemoryTurnsStore(): TurnsStore {
    return {
        async findSession(sessionId: string): Promise<StoredSession | null> {
            return sessionMap.get(sessionId) ?? null;
        },
        async saveTranscription(record: TranscriptionRecord): Promise<void> {
            sessionMap.set(record.sessionId, {
                sessionId: record.sessionId,
                locale: record.locale,
                audioSha256: record.audioSha256,
                turns: record.turns,
            });
        },
    };
}

export function getTurnsStore(): TurnsStore {
    return getInMemoryTurnsStore();
}

export function clearInMemoryTurnsStore(): void {
    sessionMap.clear();
}
