import {
    contentHashOf,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { readOfficialPdf } from "./storage";

export async function verifiedOfficialPdf(
    stored: StoredDocument
): Promise<Buffer> {
    if (!stored.pdfPath) throw new Error("Official PDF snapshot not published");
    if (
        !stored.pdfDocumentHash ||
        stored.pdfDocumentHash !== contentHashOf(stored.document)
    )
        throw new Error("Official PDF document fingerprint mismatch");
    return readOfficialPdf(stored.pdfPath);
}
