import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e server and `e2e/auth-setup.ts` both sign the seeded session with
 * BETTER_AUTH_SECRET. In production the app refuses to fall back to a known
 * constant, so the two sides must be given the same value explicitly: resolve
 * it once here, hand it to the server below, and let the setup read it from the
 * environment. A shell value wins so a developer can reuse one secret.
 */
const E2E_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET ??
    "suara-lapangan-e2e-test-secret-minimum-32-chars";

process.env.BETTER_AUTH_SECRET = E2E_AUTH_SECRET;

/**
 * Smoke configuration.
 *
 * These tests are a tripwire, not coverage: the app still renders, no console
 * error is thrown, the three steps navigate, and both locales answer. It builds
 * and serves the production bundle rather than `next dev`, so what is tested is
 * what ships.
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: "./e2e",
    globalSetup: "./e2e/auth-setup.ts",
    // The suite is small; running it serially keeps one server sane and makes
    // failures readable.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",

    use: {
        baseURL: BASE_URL,
        trace: "on-first-retry",
        // A real signed session, seeded by `e2e/auth-setup.ts`. The protected
        // routes and the document API validate it against the database.
        storageState: "e2e/.auth/state.json",
    },

    projects: [
        {
            name: "desktop",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1440, height: 900 },
            },
        },
        {
            /*
             * The field user holds a phone. Chromium at 375x812 rather than an
             * iPhone preset: the presets run on WebKit, a second browser
             * download for everyone and for CI, and 375 is the width the
             * overflow check is specified against.
             */
            name: "mobile",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 375, height: 812 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2,
            },
        },
    ],

    webServer: {
        command: `npm run build && npm run start -- -p ${PORT}`,
        url: `${BASE_URL}/en`,
        reuseExistingServer: !process.env.CI,
        // Same secret the global setup signs the seeded session with.
        env: { BETTER_AUTH_SECRET: E2E_AUTH_SECRET },
        // A cold build is slow on a cold cache.
        timeout: 5 * 60 * 1000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
