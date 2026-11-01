import { test, expect } from "@playwright/test";

test.describe("Ticket 11: Auth & Admin flows", () => {
    test("unauthenticated access to /dokumen/saya redirects to login with callbackUrl", async ({
        browser,
    }) => {
        // Create an unauthenticated context with no cookies
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/dokumen/saya");
        await expect(page).toHaveURL(/\/en\/login\?callbackUrl=%2Fen%2Fdokumen%2Fsaya$/);

        await context.close();
    });

    test("login page renders form with email, password, and google button", async ({
        page,
    }) => {
        await page.goto("/en/login");

        await expect(page.getByTestId("input-email")).toBeVisible();
        await expect(page.getByTestId("input-password")).toBeVisible();
        await expect(page.getByTestId("btn-submit-login")).toBeVisible();
        await expect(page.getByTestId("btn-google-login")).toBeVisible();
        await expect(page.getByTestId("link-to-register")).toBeVisible();
    });

    test("register page renders form with name, email, password, and google button", async ({
        page,
    }) => {
        await page.goto("/en/register");

        await expect(page.getByTestId("input-name")).toBeVisible();
        await expect(page.getByTestId("input-email")).toBeVisible();
        await expect(page.getByTestId("input-password")).toBeVisible();
        await expect(page.getByTestId("btn-submit-register")).toBeVisible();
        await expect(page.getByTestId("btn-google-register")).toBeVisible();
        await expect(page.getByTestId("link-to-login")).toBeVisible();
    });

    test("verify-email page renders check your inbox instructions", async ({
        page,
    }) => {
        await page.goto("/en/verify-email?email=tukang@example.com");

        await expect(page.getByText("tukang@example.com")).toBeVisible();
        await expect(page.getByRole("main").getByRole("link", { name: "Log in" })).toBeVisible();
    });

    test("unauthenticated site header shows Log in link", async ({ browser }) => {
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
        });
        const page = await context.newPage();

        await page.goto("/en/dokumen");
        await expect(page.getByTestId("link-login")).toBeVisible();

        await context.close();
    });
});
