import { test, expect } from "@playwright/test";

import { collectProblems, expectNoOverflow } from "./helpers";

/**
 * The three-step shell: Rekam → Susun → Dokumen.
 *
 * The screens are placeholders in this ticket; what is asserted is the part
 * later tickets build on — each step has its own address, Next and Previous
 * move between them, the locale survives the move, and the primary action is
 * inside the touch target the field use case requires.
 */

const STEPS = [
    { path: "", heading: "Rekam", next: "Next: Susun" },
    { path: "/susun", heading: "Susun", next: "Next: Dokumen" },
    { path: "/dokumen", heading: "Dokumen", next: null },
] as const;

test.describe("suara lapangan shell", () => {
    test("the default locale lands on step 1 of 3", async ({ page }) => {
        const problems: string[] = [];
        collectProblems(page, problems);

        await page.goto("/");

        await expect(page).toHaveURL(/\/en$/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            "Rekam"
        );
        await expect(page.getByText("Step 1 of 3")).toBeVisible();

        expect(problems, `page problems:\n${problems.join("\n")}`).toEqual([]);
    });

    test("every step has its own address and renders without problems", async ({
        page,
    }) => {
        const problems: string[] = [];
        collectProblems(page, problems);

        for (const [index, step] of STEPS.entries()) {
            await page.goto(`/en${step.path}`);

            await expect(page.getByRole("heading", { level: 1 })).toHaveText(
                step.heading
            );
            await expect(
                page.getByText(`Step ${index + 1} of 3`)
            ).toBeVisible();
        }

        expect(problems, `page problems:\n${problems.join("\n")}`).toEqual([]);
    });

    test("next and previous walk the three steps", async ({ page }) => {
        await page.goto("/en");

        await page.getByRole("link", { name: "Next: Susun" }).click();
        await expect(page).toHaveURL(/\/en\/susun$/);

        await page.getByRole("link", { name: "Next: Dokumen" }).click();
        await expect(page).toHaveURL(/\/en\/dokumen$/);

        // The last step has nowhere further to go.
        await expect(page.getByRole("link", { name: /^Next:/ })).toHaveCount(0);

        await page.getByRole("link", { name: "Previous: Susun" }).click();
        await expect(page).toHaveURL(/\/en\/susun$/);
    });

    test("the primary action is at least 96px tall", async ({ page }) => {
        await page.goto("/en");

        // The field user is wearing work gloves; the tap target is the design
        // requirement, not a detail.
        const box = await page
            .getByRole("link", { name: "Next: Susun" })
            .boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(96);
    });

    test("every step fits the viewport without horizontal overflow", async ({
        page,
    }) => {
        for (const step of STEPS) {
            await page.goto(`/en${step.path}`);
            await expectNoOverflow(page, `step ${step.path || "/"}`);
        }
    });

    test("the locale survives moving between steps", async ({ page }) => {
        await page.goto("/id");

        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            "Rekam"
        );
        await expect(page.getByText("Langkah 1 dari 3")).toBeVisible();

        await page.getByRole("link", { name: "Berikutnya: Susun" }).click();
        await expect(page).toHaveURL(/\/id\/susun$/);
        await expect(page.getByText("Langkah 2 dari 3")).toBeVisible();
    });

    test("the stepper marks the current step and links the others", async ({
        page,
    }) => {
        await page.goto("/en/susun");

        const stepper = page.getByRole("navigation", {
            name: "Recording, assembling, document",
        });
        await expect(stepper.getByRole("link", { name: /02/ })).toHaveAttribute(
            "aria-current",
            "step"
        );
        await expect(
            stepper.getByRole("link", { name: /01/ })
        ).not.toHaveAttribute("aria-current", "step");
    });

    test("no invoice flow is reachable", async ({ page }) => {
        await page.goto("/en");

        const header = page.getByRole("banner");
        await expect(header.getByText(/invoice/i)).toHaveCount(0);

        // The builder, the long-form guide and the other sixteen locales were
        // the invoice app's pages.
        for (const path of ["/en/guide", "/en/az", "/de"]) {
            const res = await page.request.get(path);
            expect(res.status(), `${path} should not exist`).toBe(404);
        }
    });
});