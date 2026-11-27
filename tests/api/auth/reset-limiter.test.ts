import { describe, expect, it } from "vitest";
import { createResetRequestLimiter } from "@/lib/server/reset-request-limiter";

describe("password recovery availability", () => {
    it("allows a new address even when all 10000 entries are occupied", () => {
        const allow = createResetRequestLimiter("fixture-secret");
        const now = 1000;
        for (let i = 0; i < 10000; i++)
            expect(allow("fixture-" + i + "@example.test", now)).toBe(true);
        for (let i = 0; i < 4; i++)
            expect(allow("fixture-9999@example.test", now)).toBe(true);
        expect(allow("fresh@example.test", now)).toBe(true);
        expect(allow("fixture-9999@example.test", now)).toBe(false);
        expect(allow("fixture-0@example.test", now)).toBe(true);
    });

    it("limits normalized addresses and renews only after expiry", () => {
        const allow = createResetRequestLimiter("fixture-secret");
        const now = 1000;
        for (let i = 0; i < 5; i++)
            expect(allow(" Person@EXAMPLE.TEST ", now + i)).toBe(true);
        expect(allow("person@example.test", now + 899999)).toBe(false);
        expect(allow("person@example.test", now + 900000)).toBe(true);
    });
});
