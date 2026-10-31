import { mkdir, open, rename, unlink, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const NOMOR_RE = /^SL\/QTN\/(\d{4})\/(\d{4})$/;

export function resolvePdfStorageDir(): string {
    const configured = process.env.PDF_STORAGE_DIR;
    if (configured && configured.trim() !== "") {
        return path.resolve(process.cwd(), configured.trim());
    }
    return path.resolve(process.cwd(), "./data/pdf");
}

export function relativePdfPathFor(nomor: string): string {
    const match = NOMOR_RE.exec(nomor);
    if (match) {
        const [, year, seq] = match;
        return path.join(year, `${seq}.pdf`);
    }
    const sanitized = nomor.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
    return `${sanitized}.pdf`;
}

export function pdfPathFor(
    nomor: string,
    storageDir: string = resolvePdfStorageDir()
): string {
    return path.join(storageDir, relativePdfPathFor(nomor));
}

export async function writePdfAtomic(
    filePath: string,
    buffer: Buffer | Uint8Array,
    hash?: string
): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Write the sidecar hash FIRST, then the PDF. A reader never observes a
    // new PDF paired with a stale hash: the hash rename lands before the PDF
    // rename, so a document whose hash matches the disk hash always sees a
    // fully written, matching pair. The caller writes the database record
    // (pdf_path) last, so a reader whose document hash equals the disk hash
    // is always reading a pair written for that document version.
    if (hash) {
        const hashPath = `${filePath}.hash`;
        const hashTemp = path.join(
            dir,
            `.${path.basename(hashPath)}.tmp-${randomUUID()}`
        );
        let hashSuccess = false;
        try {
            const handle = await open(hashTemp, "w");
            try {
                await handle.writeFile(hash, "utf8");
                await handle.sync();
            } finally {
                await handle.close();
            }
            await rename(hashTemp, hashPath);
            hashSuccess = true;
        } finally {
            if (!hashSuccess) {
                await unlink(hashTemp).catch(() => {});
            }
        }
    }

    const tempPath = path.join(
        dir,
        `.${path.basename(filePath)}.tmp-${randomUUID()}`
    );
    let success = false;
    try {
        const handle = await open(tempPath, "w");
        try {
            await handle.writeFile(buffer);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(tempPath, filePath);
        success = true;
    } finally {
        if (!success) {
            await unlink(tempPath).catch(() => {});
            // The PDF write failed after the hash was already committed: remove
            // the orphaned hash so no half-written pair is left on disk.
            if (hash) {
                await unlink(`${filePath}.hash`).catch(() => {});
            }
        }
    }
}

export async function readPdf(filePath: string): Promise<Buffer | null> {
    try {
        return await readFile(filePath);
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
            return null;
        }
        throw err;
    }
}

/**
 * Read a PDF file and its sidecar hash as one snapshot.
 * Re-reads the hash after reading the bytes so a concurrent rewrite is detected:
 * if the hash changed while we read, the pair is inconsistent and we return null
 * so the caller re-renders instead of serving a mixed snapshot.
 */
export async function readPdfSnapshot(filePath: string): Promise<{
    pdf: Buffer;
    hash: string;
} | null> {
    const firstHash = await readPdfHash(filePath);
    if (firstHash === null) {
        return null;
    }
    const pdf = await readPdf(filePath);
    if (pdf === null) {
        return null;
    }
    const currentHash = await readPdfHash(filePath);
    if (currentHash !== firstHash) {
        return null;
    }
    return { pdf, hash: firstHash };
}

export async function writePdfHash(
    filePath: string,
    hash: string
): Promise<void> {
    const hashPath = `${filePath}.hash`;
    const dir = path.dirname(hashPath);
    await mkdir(dir, { recursive: true });

    const tempPath = path.join(
        dir,
        `.${path.basename(hashPath)}.tmp-${randomUUID()}`
    );
    let success = false;
    try {
        const handle = await open(tempPath, "w");
        try {
            await handle.writeFile(hash, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(tempPath, hashPath);
        success = true;
    } finally {
        if (!success) {
            await unlink(tempPath).catch(() => {});
        }
    }
}

export async function readPdfHash(filePath: string): Promise<string | null> {
    const hashPath = `${filePath}.hash`;
    try {
        const content = await readFile(hashPath, "utf8");
        return content.trim();
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
            return null;
        }
        throw err;
    }
}
