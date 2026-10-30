/**
 * WhatsApp share helpers (Decision 2).
 *
 * Pure functions kept separate so they are unit-testable under node.
 * No SDK, no dependency, no server call — the summary is built
 * client-side from the document already on the page.
 */

export interface ShareSummaryInput {
    nomor: string;
    total?: number | null;
    pendingCount: number;
    locale: string;
}

/** Format an amount as IDR, e.g. 1500000 → "Rp1.500.000". */
export function formatAmountIDR(amount: number): string {
    const rounded = Math.round(amount);
    return (
        "Rp" +
        rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    );
}

/** True when the share anchor must be locked (same lock as Unduh PDF). */
export function isShareBlocked(
    status: "siap" | "perlu_konfirmasi" | null,
    pendingCount: number
): boolean {
    return status === "perlu_konfirmasi" || pendingCount > 0;
}

export function buildShareSummary(input: ShareSummaryInput): string {
    const isIndo = input.locale === "id";
    const lines = isIndo
        ? [`Penawaran ${input.nomor}`]
        : [`Quotation ${input.nomor}`];
    if (input.total != null && Number.isFinite(input.total)) {
        lines.push(
            isIndo
                ? `Total: ${formatAmountIDR(input.total)}`
                : `Total: ${formatAmountIDR(input.total)}`
        );
    }
    lines.push(
        input.pendingCount > 0
            ? isIndo
                ? `${input.pendingCount} field perlu konfirmasi`
                : `${input.pendingCount} field(s) need confirmation`
            : isIndo
              ? "Dokumen siap"
              : "Document ready"
    );
    return lines.join("\n");
}

/** Build the wa.me share URL for an already-built summary. */
export function buildWhatsAppShareUrl(summary: string): string {
    return `https://wa.me/?text=${encodeURIComponent(summary)}`;
}
