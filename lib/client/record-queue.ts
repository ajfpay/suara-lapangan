/**
 * lib/client/record-queue.ts
 *
 * IndexedDB-backed FIFO queue for audio recordings.
 * Handles offline storage and idempotent upload per sessionId.
 */

import { DEFAULT_LOCALE, LOCALES } from "@/lib/variables";

const SHIPPED_LOCALES = new Set<string>(LOCALES.map((l) => l.code));

/**
 * Resolve the locale a recording uploads with. Unknown or missing values
 * fall back to the default shipped locale so the record uploads instead of
 * pending forever on a server 400.
 */
export function resolveUploadLocale(locale?: string): string {
  if (locale && SHIPPED_LOCALES.has(locale)) return locale;
  return DEFAULT_LOCALE;
}

const DB_NAME = "suara-lapangan";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

export type RecordingStatus = "pending" | "uploaded";
export type AsrMode = "ENDPOINTING" | "DIARIZATION";

export interface StoredRecording {
  id: string;
  sessionId: string;
  blob: Blob;
  createdAt: number;
  status: RecordingStatus;
  uploadedAt?: number;
  mode?: AsrMode;
  /**
   * Route locale ("en" | "id") the recording was made under. Stored per
   * record so a recording made before cross-locale navigation still uploads
   * with its own locale. Records written before this field existed upload
   * with the queue default.
   */
  locale?: string;
}

export interface RecordQueueOptions {
  uploadUrl: string;
  /**
   * Route locale ("en" | "id") the recorder page runs under. Sent as the ASR
   * `locale` field: the server only accepts shipped locales, so this must be
   * the route locale, never a BCP-47 tag like "id-ID".
   */
  locale?: string;
}

/**
 * RecordQueue manages a FIFO queue of audio recordings stored in IndexedDB.
 *
 * Key invariants:
 * - Recordings are never lost: they are stored in IndexedDB before upload.
 * - Upload is idempotent per sessionId: re-uploading the same sessionId is a no-op.
 * - The queue is FIFO: oldest recordings are uploaded first.
 * - processQueue() checks navigator.onLine and skips upload when offline.
 */
export class RecordQueue {
  private readonly uploadUrl: string;
  private locale: string;
  private db: IDBDatabase | null = null;

  constructor({ uploadUrl, locale = DEFAULT_LOCALE }: RecordQueueOptions) {
    this.uploadUrl = uploadUrl;
    this.locale = resolveUploadLocale(locale);
  }

  /**
   * Refresh the queue default locale (the current route locale). Per-record
   * locales passed to add() still win at upload time.
   */
  setLocale(locale: string): void {
    this.locale = resolveUploadLocale(locale);
  }

  private async openDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async tx(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest | void
  ): Promise<unknown> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = fn(store);
      if (!result) {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        return;
      }
      (result as IDBRequest).onsuccess = () => resolve((result as IDBRequest).result);
      (result as IDBRequest).onerror = () => reject((result as IDBRequest).error);
    });
  }

  /**
   * Add a recording to the queue.
   * @param blob - WAV audio blob from toWav16k().
   * @param sessionId - Unique session identifier (used for idempotency).
   * @returns The assigned id of the stored recording.
   */
  async add(blob: Blob, sessionId: string, mode: AsrMode = "ENDPOINTING", locale?: string): Promise<string> {
    const all = (await this.tx("readonly", (store) => store.getAll())) as StoredRecording[];
    const existing = all.find((r) => r.sessionId === sessionId && r.status === "pending");
    if (existing) {
      const updated: StoredRecording = {
        ...existing,
        blob,
        createdAt: Date.now(),
        mode,
        locale: locale ?? existing.locale,
      };
      await this.tx("readwrite", (store) => store.put(updated));
      return existing.id;
    }
    const uploaded = all.find((r) => r.sessionId === sessionId && r.status === "uploaded");
    if (uploaded) {
      return uploaded.id;
    }

    const record: StoredRecording = {
      id: crypto.randomUUID(),
      sessionId,
      blob,
      createdAt: Date.now(),
      status: "pending",
      mode,
      locale,
    };
    await this.tx("readwrite", (store) => store.add(record));
    return record.id;
  }

  /**
   * Get all pending recordings in FIFO order (oldest first).
   */
  async getPending(): Promise<StoredRecording[]> {
    const all = (await this.tx("readonly", (store) => store.getAll())) as StoredRecording[];
    return all
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Mark a recording as uploaded.
   */
  async markUploaded(id: string): Promise<void> {
    const existing = (await this.tx("readonly", (store) => store.get(id))) as StoredRecording | null;
    if (!existing) return;
    const updated: StoredRecording = {
      ...existing,
      status: "uploaded",
      uploadedAt: Date.now(),
    };
    await this.tx("readwrite", (store) => store.put(updated));
  }

  /**
   * Upload all pending recordings in FIFO order.
   * Idempotent: recordings already marked "uploaded" are skipped.
   * Skipped when offline.
   */
  async uploadPending(): Promise<void> {
    if (!navigator.onLine) return;
    const pending = await this.getPending();
    const seenSessions = new Set<string>();

    for (const record of pending) {
      if (seenSessions.has(record.sessionId)) {
        await this.markUploaded(record.id);
        continue;
      }
      seenSessions.add(record.sessionId);

      const form = new FormData();
      form.append("audio", record.blob, "recording.wav");
      form.append("sessionId", record.sessionId);
      form.append("locale", resolveUploadLocale(record.locale ?? this.locale));
      form.append("mode", record.mode ?? "ENDPOINTING");
      try {
        const res = await fetch(this.uploadUrl, { method: "POST", body: form });
        if (res.ok) {
          await this.markUploaded(record.id);
        }
      } catch {
        // Network error — leave as pending for next processQueue() call.
      }
    }
  }

  /**
   * Process the queue: upload pending recordings if online.
   * Call this on window 'online' events and periodically.
   */
  async processQueue(): Promise<void> {
    if (!navigator.onLine) return;
    await this.uploadPending();
  }

  /**
   * Check whether there are any pending recordings.
   */
  async isPending(): Promise<boolean> {
    const pending = await this.getPending();
    return pending.length > 0;
  }
}

// ── Singleton instance ─────────────────────────────────────────────────────────

let _instance: RecordQueue | null = null;

/**
 * Get the singleton RecordQueue instance.
 * Passing the current route locale ("en" | "id") refreshes the queue
 * default, so uploads after cross-locale navigation carry the new locale.
 * Individual recordings keep the locale passed to add(), which wins over
 * this default at upload time.
 */
export function getRecordQueue(locale?: string): RecordQueue {
  if (!_instance) {
    _instance = new RecordQueue({ uploadUrl: "/api/asr/transcribe", locale });
  } else if (locale !== undefined) {
    _instance.setLocale(locale);
  }
  return _instance;
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetRecordQueue(): void {
  _instance = null;
}
