/**
 * lib/client/audioslice/storage.ts
 *
 * IndexedDB helper for reading local recordings from the "suara-lapangan" database.
 * Gracefully returns null if running in SSR, private mode, or if record is absent.
 */

const DB_NAME = "suara-lapangan";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

interface StoredRecordingRow {
    id: string;
    sessionId: string;
    blob: Blob;
    createdAt: number;
    status: string;
    uploadedAt?: number;
}

function openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

/**
 * Retrieve the audio Blob stored for a given sessionId.
 * Returns null if not found (e.g. session recorded on another device or cleared).
 */
export async function getLocalRecordingBlob(
    sessionId: string
): Promise<Blob | null> {
    const db = await openDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.close();
                return resolve(null);
            }

            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => {
                const rows = (req.result || []) as StoredRecordingRow[];
                const match = rows.find((r) => r.sessionId === sessionId);
                db.close();
                resolve(match?.blob ?? null);
            };

            req.onerror = () => {
                db.close();
                resolve(null);
            };
        } catch {
            db.close();
            resolve(null);
        }
    });
}

/**
 * Check whether local audio exists for this sessionId.
 */
export async function hasLocalRecording(sessionId: string): Promise<boolean> {
    const blob = await getLocalRecordingBlob(sessionId);
    return blob !== null;
}

/**
 * Get the newest sessionId from local recordings, if any.
 */
export async function getLatestLocalRecordingSessionId(): Promise<string | null> {
    const db = await openDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.close();
                return resolve(null);
            }

            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => {
                const rows = (req.result || []) as StoredRecordingRow[];
                db.close();
                if (rows.length === 0) return resolve(null);
                rows.sort((a, b) => b.createdAt - a.createdAt);
                resolve(rows[0].sessionId);
            };

            req.onerror = () => {
                db.close();
                resolve(null);
            };
        } catch {
            db.close();
            resolve(null);
        }
    });
}

/**
 * List all local recordings stored in IndexedDB.
 */
export async function listLocalRecordings(): Promise<
    Array<{ id: string; sessionId: string; createdAt: number; size: number }>
> {
    const db = await openDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.close();
                return resolve([]);
            }

            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();

            req.onsuccess = () => {
                const rows = (req.result || []) as StoredRecordingRow[];
                db.close();
                resolve(
                    rows.map((r) => ({
                        id: r.id,
                        sessionId: r.sessionId,
                        createdAt: r.createdAt,
                        size: r.blob?.size ?? 0,
                    }))
                );
            };

            req.onerror = () => {
                db.close();
                resolve([]);
            };
        } catch {
            db.close();
            resolve([]);
        }
    });
}
