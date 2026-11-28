import type { Pool } from "pg";
export function migrateLegacyPdf(
    pool: Pool,
    root: string,
    entry: {
        id: string;
        legacy_path: string;
        sha256: string;
        document_sha256: string;
    },
    apply?: boolean
): Promise<"already_migrated" | "migrated" | "verified">;
