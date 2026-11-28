import { createHash, randomUUID } from "node:crypto";
import type { QuotationDocument } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable identities for legacy drafts, including reads before their first edit. */
export function withDraftItemIds(document: QuotationDocument, documentId: string): QuotationDocument {
    const seen = new Set<string>();
    return {
        ...document,
        pekerjaan: (document.pekerjaan ?? []).map((item, index) => {
            let id = item.id;
            if (!id || !UUID.test(id) || seen.has(id)) {
                const h = createHash("sha256").update(`${documentId}:item:${index}`).digest("hex");
                id = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
                if (seen.has(id)) throw new Error("Duplicate generated draft item identity");
            }
            seen.add(id);
            return { ...item, id };
        }),
    };
}

/** The server, not a model or caller, assigns IDs to freshly created items. */
export function newDraftItemIds(document: QuotationDocument): QuotationDocument {
    return { ...document, pekerjaan: document.pekerjaan.map(item => ({ ...item, id: randomUUID() })) };
}
