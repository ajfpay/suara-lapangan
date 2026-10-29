import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke configuration.
 *
 * These tests are a tripwire, not coverage: the app still renders, no console
 * error is thrown, the three steps navigate, and both locales answer. It builds
 * and serves the production bundle rather than `next dev`, so what is tested is
 * what ships.
 */
export default defineConfig({
    testDir: "./e2e",
    // The suite is small; running it serially keeps one server sane and makes
    // failures readable.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",

    use: {
        baseURL: "http://127.0.0.1:3000",
        trace: "on-first-retry",
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
        command: "npm run build && npm run start",
        url: "http://127.0.0.1:3000/en",
        reuseExistingServer: !process.env.CI,
        // A cold build is slow on a cold cache.
        timeout: 5 * 60 * 1000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
