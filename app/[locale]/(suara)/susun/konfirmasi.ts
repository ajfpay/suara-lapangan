/**
 * Helpers for the confirmation (konfirmasi) cards.
 *
 * Pure functions kept separate so they are unit-testable under node.
 */

/**
 * Extract one-tap options from an `alasan` string.
 * Convention: options are written inside square brackets, e.g.
 * "delapan [ratus/puluh] ribu" → ["ratus", "puluh"].
 * Returns [] when no bracket group is present.
 */
export function parseOptions(alasan: string | undefined | null): string[] {
    if (!alasan) return [];
    const match = alasan.match(/\[([^\]]+)\]/);
    if (!match) return [];
    return match[1]
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * Human-friendly label for a patchable field path like
 * `pekerjaan[0].harga_satuan`.
 */
export function fieldLabel(field: string, locale: string): string {
    const isIndo = locale === "id";
    const m = field.match(/^pekerjaan\[(\d+)\]\.(.+)$/);
    if (!m) return field;
    const idx = Number(m[1]) + 1;
    const sub = m[2];
    const subLabel: Record<string, { id: string; en: string }> = {
        volume: { id: "Volume", en: "Quantity" },
        harga_satuan: { id: "Harga satuan", en: "Unit price" },
        satuan: { id: "Satuan", en: "Unit" },
        uraian: { id: "Uraian", en: "Description" },
        sumber_kutipan: { id: "Sumber kutipan", en: "Citation source" },
    };
    const subName =
        subLabel[sub]?.[isIndo ? "id" : "en"] ?? (isIndo ? sub : sub);
    return isIndo
        ? `Pekerjaan ${idx} — ${subName}`
        : `Item ${idx} — ${subName}`;
}

/** True for numeric subfields that accept a number value. */
export function isNumericField(field: string): boolean {
    return /pekerjaan\[\d+\]\.(volume|harga_satuan)$/.test(field);
}

/** True for citation subfields. */
export function isCitationField(field: string): boolean {
    return /pekerjaan\[\d+\]\.sumber_kutipan$/.test(field);
}

export function citationOptions(
    itemOrSource?: { sumber_kutipan?: string | null } | string | null
): string[] {
    const raw =
        typeof itemOrSource === "object" && itemOrSource !== null
            ? itemOrSource.sumber_kutipan
            : itemOrSource;
    const options = ["manual"];
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.length > 0 && trimmed !== "manual" && !options.includes(trimmed)) {
            options.push(trimmed);
        }
    }
    return options;
}
