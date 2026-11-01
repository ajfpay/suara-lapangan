import { describe, expect, it } from "vitest";

import { docIdFrom } from "./doc-param";

describe("docIdFrom", () => {
    it("returns null for absent value (undefined)", () => {
        expect(docIdFrom(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(docIdFrom("")).toBeNull();
    });

    it("returns null for whitespace-only strings", () => {
        expect(docIdFrom("   ")).toBeNull();
        expect(docIdFrom("\t\n ")).toBeNull();
    });

    it("extracts and trims the first element from an array", () => {
        expect(docIdFrom(["doc-123", "doc-456"])).toBe("doc-123");
        expect(docIdFrom(["  doc-789  ", "doc-000"])).toBe("doc-789");
        expect(docIdFrom(["   "])).toBeNull();
        expect(docIdFrom([])).toBeNull();
    });

    it("returns trimmed normal value", () => {
        expect(docIdFrom("doc-123")).toBe("doc-123");
        expect(docIdFrom("  doc-123  ")).toBe("doc-123");
    });

    it("returns null for non-string values", () => {
        expect(docIdFrom(null as unknown as undefined)).toBeNull();
        expect(docIdFrom(123 as unknown as string)).toBeNull();
        expect(docIdFrom({} as unknown as string)).toBeNull();
    });
});
