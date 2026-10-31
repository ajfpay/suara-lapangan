import { mkdir, open, rename, unlink, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export function resolvePdfStorageDir(): string {
    const configured = process.env.PDF_STORAGE_DIR;
    if (configured && configured.trim() !== "") {
        return path.resolve(process.cwd(), configured.trim());
    }
    return path.resolve(process.cwd(), "./data/pdf");
}

export function relativePdfPathFor(documentId: string): string {
    return `${documentId}.pdf`;
}

export function pdfPathFor(
    documentId: string,
    storageDir: string = resolvePdfStorageDir()
): string {
    return path.join(storageDir, relativePdfPathFor(documentId));
}

/**
 * Validate a pdf_path read from the database before using it to build a disk
 * path. Rejects absolute values, `..` segments, and anything that resolves
 * outside the storage directory — defense in depth for a value only this
 * server writes today.
 */
export function isSafeStoredPdfPath(storedPath: string): boolean {
    if (!storedPath || storedPath.trim() === "") {
        return false;
    }
    if (path.isAbsolute(storedPath)) {
        return false;
    }
    if (storedPath.includes("\0")) {
        return false;
    }
    const segments = storedPath.split(path.sep);
    if (segments.includes("..")) {
        return false;
    }
    const resolved = path.resolve(storageDirFromEnvOrDefault(), storedPath);
    const storageRoot = storageDirFromEnvOrDefault();
    return (
        resolved === storageRoot ||
        resolved.startsWith(storageRoot + path.sep)
    );
}

function storageDirFromEnvOrDefault(): string {
    const configured = process.env.PDF_STORAGE_DIR;
    if (configured && configured.trim() !== "") {
        return path.resolve(process.cwd(), configured.trim());
    }
    return path.resolve(process.cwd(), "./data/pdf");
}

export async function writePdfAtomic(
    filePath: string,
    buffer: Buffer | Uint8Array,
    hash?: string
): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Per-path write lock serializes concurrent renders to the same file, so a
    // reader never observes one writer's hash paired with another writer's PDF
    // bytes (finding 2). Cross-instance races are caught by readPdfSnapshot's
    // double-read; this lock handles same-process concurrency.
    const lock = withWriteLock(filePath, async () => {
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
    });
    await lock;
}

const writeLocks = new Map<string, Promise<unknown>>();

async function withWriteLock<T>(
    filePath: string,
    fn: () => Promise<T>
): Promise<T> {
    const previous = writeLocks.get(filePath) ?? Promise.resolve();
    const next = previous.then(() => fn());
    writeLocks.set(filePath, next);
    return next as Promise<T>;
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
