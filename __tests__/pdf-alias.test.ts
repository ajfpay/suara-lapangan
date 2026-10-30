import { describe, expect, it } from "vitest";
import { GET as pdfAliasGet } from "@/app/api/pdf/[id]/route";
import { GET as documentsPdfGet } from "@/app/api/documents/[id]/pdf/route";

describe("pdf route alias", () => {
    it("delegates to the single /api/pdf/[id] implementation", () => {
        expect(documentsPdfGet).toBe(pdfAliasGet);
    });
});
