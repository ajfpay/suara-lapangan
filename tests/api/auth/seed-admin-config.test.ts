import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("admin seed configuration", () => {
    it("requires an explicit allowlist before opening a database connection", () => {
        const result = spawnSync(
            process.execPath,
            ["scripts/seed-admin.mjs", "--email=fixture@example.test"],
            {
                encoding: "utf8",
                env: {
                    PATH: process.env.PATH,
                    NODE_ENV: "test",
                    ADMIN_SEED_EMAIL_ALLOWLIST: "",
                },
                timeout: 5000,
            }
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("allowlist");
    });
});
