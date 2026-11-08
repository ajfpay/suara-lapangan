import { test, expect } from "@playwright/test";

/**
 * Email and password registration and login flows.
 *
 * Asserts the full lifecycle of a new user registering via email and password:
 * 1. Fresh registration redirects to the verify-email notice and remains unauthenticated.
 * 2. Duplicate registration with the same email is rejected with a visible error.
 * 3. Login with an incorrect password is rejected with a visible error.
 * 4. Login with the correct password before email verification is rejected because
 *    email verification is required by server auth policy.
 */

const RUN = Date.now().toString(36);
const TEST_EMAIL = `e2e-reg-${RUN}@suara-lapangan.test`;
const TEST_PASSWORD = "reg-e2e-pass-9f3k2m";

test.describe("register and login email auth flows", () => {
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

        await page.goto("/en/register");
        await page.getByTestId("input-name").fill("E2E User");
        await page.getByTestId("input-email").fill(TEST_EMAIL);
        await page.getByTestId("input-password").fill(TEST_PASSWORD);
        await page.getByTestId("btn-submit-register").click();

        await expect(page).toHaveURL(/\/en\/verify-email\?email=/, {
            timeout: 20_000,
        });
        const url = new URL(page.url());
        const emailParam = decodeURIComponent(
            url.searchParams.get("email") ?? ""
        );
        expect(emailParam).toBe(TEST_EMAIL);

        await page.goto("/en/dokumen/saya");
        await expect(page).toHaveURL(
            /\/en\/login\?callbackUrl=%2Fen%2Fdokumen%2Fsaya$/,
            { timeout: 20_000 }
        );

        await context.close();
    });

    test("duplicate registration is rejected with a visible error", async ({
        browser,
    }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/register");
        await page.getByTestId("input-name").fill("E2E User");
        await page.getByTestId("input-email").fill(TEST_EMAIL);
        await page.getByTestId("input-password").fill(TEST_PASSWORD);
        await page.getByTestId("btn-submit-register").click();

        const error = page.getByTestId("register-error");
        await expect(error).toBeVisible({ timeout: 20_000 });
        await expect(error).not.toBeEmpty();

        await context.close();
    });

    test("login with a wrong password is rejected", async ({ browser }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/login");
        await page.getByTestId("input-email").fill(TEST_EMAIL);
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
        await page.getByTestId("input-email").fill(TEST_EMAIL);
        await page.getByTestId("input-password").fill(TEST_PASSWORD);
        await page.getByTestId("btn-submit-login").click();

        const error = page.getByTestId("login-error");
        await expect(error).toBeVisible({ timeout: 20_000 });

        await context.close();
    });
});
