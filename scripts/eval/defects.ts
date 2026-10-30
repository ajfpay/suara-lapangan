import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DefectiveFixtureInfo {
    id: string;
    locale: "en" | "id";
    defectCode: string;
    alasan: string;
    bukti: string;
    field: string;
    verdict: string;
}

export interface DefectSummary {
    total: number;
    byCode: Record<string, number>;
    byVerdict: Record<string, number>;
    byLocale: Record<string, number>;
    items: DefectiveFixtureInfo[];
}

/**
 * Loads all defective fixtures from `fixtures/defective/` and counts defect occurrences.
 */
export function countDefectiveFixtures(defectiveDir: string): DefectSummary {
    const files = readdirSync(defectiveDir)
        .filter((f) => f.endsWith(".json"))
        .sort();

    const byCode: Record<string, number> = {};
    const byVerdict: Record<string, number> = {};
    const byLocale: Record<string, number> = { en: 0, id: 0 };
    const items: DefectiveFixtureInfo[] = [];

    for (const file of files) {
        const filePath = join(defectiveDir, file);
        const data = JSON.parse(readFileSync(filePath, "utf8"));

        const defectCode = data.cacat?.code || "unknown";
        const verdict = data.expectation?.verdict || "unknown";
        const locale = data.locale === "id" ? "id" : "en";

        byCode[defectCode] = (byCode[defectCode] || 0) + 1;
        byVerdict[verdict] = (byVerdict[verdict] || 0) + 1;
        byLocale[locale] = (byLocale[locale] || 0) + 1;

        items.push({
            id: data.id || file.replace(/\.json$/, ""),
            locale,
            defectCode,
            alasan: data.cacat?.alasan || "",
            bukti: data.cacat?.bukti || "",
            field: data.expectation?.field || "",
            verdict,
        });
    }

    return {
        total: files.length,
        byCode,
        byVerdict,
        byLocale,
        items,
    };
}
