import type { QuotationDocument } from "./types";

export interface DocumentStore {
    get(id: string): QuotationDocument | undefined;
    set(id: string, doc: QuotationDocument): void;
    has(id: string): boolean;
}

// DEMO-ONLY: In-memory bounded document store for hackathon prototype.
// Documents disappear on process restart or across server instances.
// In production, persist documents in durable database storage (e.g. Postgres).
export class InMemoryDocumentStore implements DocumentStore {
    private readonly sessionDocs = new Map<string, QuotationDocument>();
    private readonly nomorToSession = new Map<string, string>();
    private readonly maxEntries: number;

    constructor(maxEntries = 500) {
        this.maxEntries = maxEntries;
    }

    get(idOrNomor: string): QuotationDocument | undefined {
        const direct = this.sessionDocs.get(idOrNomor);
        if (direct) return direct;
        const sessionId = this.nomorToSession.get(idOrNomor);
        if (sessionId) return this.sessionDocs.get(sessionId);
        return undefined;
    }

    has(idOrNomor: string): boolean {
        return this.sessionDocs.has(idOrNomor) || this.nomorToSession.has(idOrNomor);
    }

    set(id: string, doc: QuotationDocument): void {
        // If not already present, enforce bounded capacity on logical sessions
        if (!this.sessionDocs.has(id)) {
            while (this.sessionDocs.size >= this.maxEntries) {
                const oldestSession = this.sessionDocs.keys().next().value;
                if (!oldestSession) break;
                const oldDoc = this.sessionDocs.get(oldestSession);
                if (oldDoc?.nomor && this.nomorToSession.get(oldDoc.nomor) === oldestSession) {
                    this.nomorToSession.delete(oldDoc.nomor);
                }
                this.sessionDocs.delete(oldestSession);
            }
        }

        // Clean up old nomor alias if session previously had a different nomor
        const existing = this.sessionDocs.get(id);
        if (existing?.nomor && existing.nomor !== doc.nomor) {
            if (this.nomorToSession.get(existing.nomor) === id) {
                this.nomorToSession.delete(existing.nomor);
            }
        }

        this.sessionDocs.set(id, doc);
        if (doc.nomor) {
            this.nomorToSession.set(doc.nomor, id);
        }
    }
}

let sharedDocumentStore: DocumentStore | null = null;

export function getDocumentStore(): DocumentStore {
    if (!sharedDocumentStore) {
        sharedDocumentStore = new InMemoryDocumentStore();
    }
    return sharedDocumentStore;
}

export function resetDocumentStoreForTesting(): void {
    sharedDocumentStore = null;
}
