import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit and route-level tests. The `e2e` directory belongs to Playwright, so it
 * is excluded here or its specs would run twice under two runners.
 *
 * Postgres-backed suites truncate shared tables in `beforeEach`, so files run
 * one at a time (a parallel truncate against another file's open transaction
 * deadlocks). `sequence.concurrent` is already Vitest's default; it is stated
 * here only next to the `fileParallelism` it complements.
 */
export default defineConfig({
    resolve: {
        alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    },
    test: {
        environment: "node",
        include: ["**/*.test.ts", "**/*.test.tsx"],
        exclude: ["node_modules/**", "e2e/**", ".next/**"],
        fileParallelism: false,
    },
});
