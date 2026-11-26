import { describe, expect, it } from "vitest";
import { assertMigrationsReady } from "./migrationReadiness.mjs";

describe("sandbox migration readiness", () => {
    const expected = ["0001.sql", "0002.sql"];
    it("rejects an empty or partially migrated database", () => {
        expect(() => assertMigrationsReady(expected, [])).toThrow();
        expect(() => assertMigrationsReady(expected, ["0001.sql"])).toThrow();
        expect(() =>
            assertMigrationsReady(expected, ["0001.sql", "unexpected.sql"])
        ).toThrow();
    });
    it("accepts all required migration versions", () => {
        expect(() => assertMigrationsReady(expected, expected)).not.toThrow();
    });
    it("rejects a missing local migration inventory", () => {
        expect(() => assertMigrationsReady([], [])).toThrow();
    });
});
