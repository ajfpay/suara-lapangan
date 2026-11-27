import { test, expect } from "@playwright/test";

/**
 * Email and password registration and login flows.
 *
 * Asserts the full lifecycle of a new user registering via email and password:
 * 1. Fresh registration redirects to the verify-email notice and remains unauthenticated.
 * 2. Duplicate registration returns a neutral verification notice.
 * 3. Login with an incorrect password is rejected with a visible error.
 * 4. Login with the correct password before email verification is rejected with
 *    the "Email not verified" message required by server auth policy.
 *
 * A dedicated user is created once in beforeAll via the sign-up API and is
 * idempotent: re-registration with the same credentials is tolerated so CI
 * retries cannot fail on an already-registered email.
 */

const TEST_PASSWORD = "reg-e2e-pass-9f3k2m";

test.describe("register and login email auth flows", () => {
    let testEmail = "";

    test.beforeAll(async ({ request, baseURL }) => {
        // Unique per run; tolerates reruns by treating an existing email as set up.
        testEmail = `e2e-reg-${Date.now().toString(36)}@suara-lapangan.test`;
        const res = await request.post("/api/auth/sign-up/email", {
            headers: { Origin: new URL(baseURL!).origin },
            data: {
                name: "E2E User",
                email: testEmail,
                password: TEST_PASSWORD,
                callbackURL: "/en/dokumen/saya",
            },
        });
        // 200: fresh registration; 422: already registered from a previous retry.
        expect([200, 422]).toContain(res.status());
    });

    test.beforeEach(() => {
        test.setTimeout(60_000);
    });

    test("fresh registration lands on verify-email and stays unauthenticated", async ({
        browser,
    }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        // Fresh UI registration of its own unique user keeps this test independent.
        const email = `e2e-reg-${Date.now().toString(36)}@suara-lapangan.test`;
        await page.goto("/en/register");
        await page.getByTestId("input-name").fill("E2E User");
        await page.getByTestId("input-email").fill(email);
        await page.getByTestId("input-password").fill(TEST_PASSWORD);
        await page.getByTestId("btn-submit-register").click();

        await expect(page).toHaveURL(/\/en\/verify-email\?email=/, {
            timeout: 20_000,
        });
        const url = new URL(page.url());
        const emailParam = decodeURIComponent(
            url.searchParams.get("email") ?? ""
        );
        expect(emailParam).toBe(email);

        await page.goto("/en/dokumen/saya");
        await expect(page).toHaveURL(
            /\/en\/login\?callbackUrl=%2Fen%2Fdokumen%2Fsaya$/,
            { timeout: 20_000 }
        );

        await context.close();
    });

    test("duplicate registration uses a neutral verification notice", async ({
        browser,
    }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/register");
        await page.getByTestId("input-name").fill("E2E User");
        await page.getByTestId("input-email").fill(testEmail);
        await page.getByTestId("input-password").fill(TEST_PASSWORD);
        await page.getByTestId("btn-submit-register").click();

        await expect(page).toHaveURL(/\/en\/verify-email\?email=/, {
            timeout: 20_000,
        });
        await page.goto("/en/dokumen/saya");
        await expect(page).toHaveURL(/\/en\/login\?callbackUrl=/);

        await context.close();
    });

    test("login with a wrong password is rejected", async ({ browser }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/login");
        await page.getByTestId("input-email").fill(testEmail);
        await page.getByTestId("input-password").fill("wrong-password-9f3k2m");
        await page.getByTestId("btn-submit-login").click();

        const error = page.getByTestId("login-error");
        await expect(error).toBeVisible({ timeout: 20_000 });

        await context.close();
    });

    test("login with the correct password before verification is rejected", async ({
        browser,
    }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/login");
        await page.getByTestId("input-email").fill(testEmail);
        await page.getByTestId("input-password").fill(TEST_PASSWORD);
        await page.getByTestId("btn-submit-login").click();

        const error = page.getByTestId("login-error");
        await expect(error).toBeVisible({ timeout: 20_000 });
        await expect(error).toContainText("Email not verified");

        await context.close();
    });
});

test("web recovery shows a neutral response and rejects an invalid token", async ({
    browser,
}) => {
    const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
    });
    try {
        const page = await context.newPage();
        await page.goto("/en/login");
        await page.getByRole("link", { name: "Forgot password?" }).click();
        await expect(page).toHaveURL(/\/en\/forgot-password$/);
        await page
            .getByTestId("reset-email")
            .fill("e2e-reset-" + Date.now() + "@example.test");
        await page.getByRole("button", { name: "Send reset link" }).click();
        await expect(page.getByTestId("reset-message")).toContainText(
            "If this account"
        );
        await page.goto("/en/reset-password#token=fixture-invalid");
        await expect(page.getByTestId("reset-new-password")).toBeVisible();
        await expect(page).toHaveURL(/\/en\/reset-password$/);
        await page.getByTestId("reset-new-password").fill(TEST_PASSWORD);
        await page.locator("#confirm-password").fill(TEST_PASSWORD);
        await page.getByRole("button", { name: "Reset password" }).click();
        await expect(
            page.getByRole("status").filter({ hasText: "invalid or expired" })
        ).toBeVisible();
        await expect(page.getByTestId("reset-new-password")).toHaveCount(0);
        await expect(
            page.getByRole("link", { name: "Send reset link" })
        ).toHaveAttribute("href", "/en/forgot-password");
    } finally {
        await context.close();
    }
});

test("web recovery retains the reset form after a temporary server failure", async ({
    browser,
}) => {
    const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
    });
    try {
        const page = await context.newPage();
        await page.route("**/api/auth/reset-password", async (route) => {
            await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({
                    code: "SERVICE_UNAVAILABLE",
                    message: "Try again later",
                }),
            });
        });
        await page.goto("/en/reset-password#token=fixture-temporary");
        await expect(page.getByTestId("reset-new-password")).toBeVisible();
        await page.getByTestId("reset-new-password").fill(TEST_PASSWORD);
        await page.locator("#confirm-password").fill(TEST_PASSWORD);
        await page.getByRole("button", { name: "Reset password" }).click();
        await expect(
            page.getByRole("alert").filter({ hasText: "Try again later" })
        ).toBeVisible();
        await expect(page.getByTestId("reset-new-password")).toBeVisible();
        await expect(
            page.getByRole("link", { name: "Send reset link" })
        ).toHaveCount(0);
    } finally {
        await context.close();
    }
});
