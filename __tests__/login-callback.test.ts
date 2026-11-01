import { describe, it, expect } from "vitest";
import { sanitizeCallbackUrl } from "@/lib/client/sanitizeCallbackUrl";

describe("login callbackUrl sanitiser", () => {
    it("keeps a normal same-origin path", () => {
        expect(sanitizeCallbackUrl("/en/dokumen/saya", "en")).toBe("/en/dokumen/saya");
    });
    it("blocks an absolute URL", () => {
        expect(sanitizeCallbackUrl("https://evil.com", "en")).toBe("/en/dokumen/saya");
    });
    it("blocks protocol-relative //", () => {
        expect(sanitizeCallbackUrl("//evil.com", "en")).toBe("/en/dokumen/saya");
    });
    it("blocks backslash variant /\\evil.com", () => {
        expect(sanitizeCallbackUrl("/\\evil.com", "en")).toBe("/en/dokumen/saya");
    });
});
