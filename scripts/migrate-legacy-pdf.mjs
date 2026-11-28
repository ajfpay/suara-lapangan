import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
    readOfficialPdf,
    writeOfficialPdf,
    resolvePdfStorageDir,
} from "../lib/server/pdf/storage.ts";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function migrateLegacyPdf(pool, root, entry, apply = false) {
    if (
        !idPattern.test(entry.id) ||
        !digestPattern.test(entry.sha256) ||
        !digestPattern.test(entry.document_sha256) ||
        typeof entry.legacy_path !== "string" ||
        path.isAbsolute(entry.legacy_path) ||
        entry.legacy_path.split("/").includes("..") ||
        !entry.legacy_path.endsWith(".pdf") ||
        entry.legacy_path.startsWith("snapshots/")
    )
        throw new Error("Invalid trusted manifest entry");
    const client = await pool.connect();
    try {
        await client.query("begin");
        const {
            rows: [row],
        } = await client.query(
            "select pdf_path, pdf_document_hash, data_json, status from documents where id=$1 for update",
            [entry.id]
        );
        if (
            !row ||
            !["siap", "disetujui", "terkirim"].includes(row.status) ||
            sha256(JSON.stringify(row.data_json)) !== entry.document_sha256
        )
            throw new Error("Manifest does not match an official document");
        const expected = `snapshots/${entry.sha256}.pdf`;
        if (
            row.pdf_path === expected &&
            row.pdf_document_hash === entry.document_sha256
        ) {
            await readOfficialPdf(expected, root);
            await client.query("commit");
            return "already_migrated";
        }
        if (row.pdf_path !== entry.legacy_path)
            throw new Error("Legacy path changed or missing");
        const realRoot = await realpath(root);
        const source = await realpath(path.join(realRoot, entry.legacy_path));
        if (!source.startsWith(realRoot + path.sep))
            throw new Error("Legacy path escapes PDF root");
        const bytes = await readFile(source);
        if (
            bytes.subarray(0, 5).toString() !== "%PDF-" ||
            sha256(bytes) !== entry.sha256
        )
            throw new Error("Legacy PDF byte digest mismatch");
        if (apply) {
            const published = await writeOfficialPdf(bytes, root);
            if (published !== expected)
                throw new Error("Snapshot digest mismatch");
            await client.query(
                "update documents set pdf_path=$2,pdf_document_hash=$3,updated_at=now() where id=$1",
                [entry.id, published, entry.document_sha256]
            );
        }
        await client.query("commit");
        return apply ? "migrated" : "verified";
    } catch (error) {
        await client.query("rollback");
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    const [manifestPath, ...flags] = process.argv.slice(2);
    if (
        !manifestPath ||
        flags.some((flag) => flag !== "--apply") ||
        flags.length > 1 ||
        !process.env.DATABASE_URL
    )
        throw new Error(
            "Usage: DATABASE_URL=... PDF_STORAGE_DIR=... node --experimental-strip-types scripts/migrate-legacy-pdf.mjs manifest.json [--apply]"
        );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest)) throw new Error("Manifest must be an array");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        for (const entry of manifest)
            console.log(
                `${entry.id}: ${await migrateLegacyPdf(pool, resolvePdfStorageDir(), entry, flags.includes("--apply"))}`
            );
    } finally {
        await pool.end();
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch(() => {
        console.error(
            "PDF migration failed; no mismatching entry was published. Verify the trusted manifest and storage."
        );
        process.exitCode = 1;
    });
}
