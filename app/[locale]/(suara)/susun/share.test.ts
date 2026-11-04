import { describe, expect, it } from "vitest";

import {
    buildShareSummary,
    buildWhatsAppShareUrl,
    formatAmountIDR,
    isShareBlocked,
} from "@/app/[locale]/(suara)/susun/share";

describe("whatsapp share", () => {
    it("formats amounts as IDR", () => {
        expect(formatAmountIDR(1500000)).toBe("Rp1.500.000");
        expect(formatAmountIDR(50000)).toBe("Rp50.000");
    });

    it("builds an encoded wa.me URL", () => {
        const summary = buildShareSummary({
            nomor: "Q-001",
            total: 1500000,
            pendingCount: 0,
            locale: "id",
        });
        expect(summary).toContain("Rp1.500.000");
        const url = buildWhatsAppShareUrl(summary);
        expect(url.startsWith("https://wa.me/?text=")).toBe(true);
        expect(url).toBe(
            `https://wa.me/?text=${encodeURIComponent(summary)}`
        );
        // encoded: no raw spaces or newlines
        expect(url).not.toMatch(/[ \n]/);
    });

    it("locks share while draf or pending items exist (same lock as download)", () => {
        expect(isShareBlocked("draf", 0)).toBe(true);
        expect(isShareBlocked("disetujui", 0)).toBe(false);
        expect(isShareBlocked("disetujui", 1)).toBe(true);
        expect(isShareBlocked(null, 0)).toBe(false);
    });
});
