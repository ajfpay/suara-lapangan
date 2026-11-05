import { test, expect } from "@playwright/test";

import { collectProblems, jsonLdBlocks, visibleText } from "./helpers";

/**
 * Locale plumbing: English and Indonesian only, English by default.
 *
 * These are the invoify crawler and switcher tests narrowed to the two locales
 * this app ships. A third locale must not be reachable — the invoice app
 * registered eighteen.
 */
test.describe("locales", () => {
    test("each locale advertises itself correctly to crawlers", async ({
        request,
    }) => {
        const en = await request.get("/en");
        const id = await request.get("/id");
        expect(en.status()).toBe(200);
        expect(id.status()).toBe(200);

        const enHtml = await en.text();
        const idHtml = await id.text();

        const titleOf = (html: string) =>
            html.match(/<title>(.*?)<\/title>/i)?.[1] ?? "";
        const canonicalOf = (html: string) =>
            html.match(/rel="canonical"[^>]*href="([^"]+)"/i)?.[1] ?? "";
        const langOf = (html: string) =>
            html.match(/<html[^>]*lang="([^"]+)"/i)?.[1] ?? "";
        const descriptionOf = (html: string) =>
            html.match(/name="description"[^>]*content="([^"]*)"/i)?.[1] ??
            html.match(/content="([^"]*)"[^>]*name="description"/i)?.[1] ??
            "";

        // The public landing page has locale-specific title, description and canonical.
        expect(titleOf(enHtml)).toContain("Suara Lapangan");
        expect(descriptionOf(enHtml)).not.toBe(descriptionOf(idHtml));
        expect(canonicalOf(enHtml)).toMatch(/\/en\/?$/);
        expect(canonicalOf(idHtml)).toMatch(/\/id\/?$/);
        expect(langOf(enHtml)).toBe("en");
        expect(langOf(idHtml)).toBe("id");

        // hreflang: one per shipped locale plus x-default, and nothing else.
        const alternates = [
            ...enHtml.matchAll(/rel="alternate"[^>]*hreflang="([^"]+)"/gi),
        ].map((m) => m[1].toLowerCase());
        expect(new Set(alternates)).toEqual(new Set(["en", "id", "x-default"]));

        // Open Graph and Twitter.
        expect(enHtml).toMatch(/property="og:image"/i);
        expect(enHtml).toMatch(/name="twitter:card"/i);

        // Exactly one h1, naming the public landing page.
        expect((enHtml.match(/<h1/g) ?? []).length).toBe(1);
        expect(visibleText(enHtml)).toContain("From spoken work to a clear client quotation.");

        // Structured data: the app, and the rendered FAQ matching it.
        const types = jsonLdBlocks(enHtml).map((b) => b["@type"]);
        expect(types).toContain("WebApplication");
        expect(types).toContain("FAQPage");

        // There is prose on the page at all.
        expect(visibleText(enHtml).length).toBeGreaterThan(400);
    });

    test("sitemap, robots, manifest and social image are served", async ({
        request,
    }) => {
        const sitemap = await request.get("/sitemap.xml");
        expect(sitemap.status()).toBe(200);
        const xml = await sitemap.text();
        // Four paths per locale (landing + three steps), each carrying the full hreflang set.
        expect((xml.match(/<url>/g) ?? []).length).toBe(8);
        expect(xml).toContain("xhtml:link");
        // Every step is listed for every locale.
        for (const path of ["/", "/susun", "/dokumen"]) {
            for (const locale of ["en", "id"]) {
                expect(xml).toContain(`/${locale}${path}`.replace(/\/$/, "/"));
            }
        }

        const robots = await request.get("/robots.txt");
        expect(robots.status()).toBe(200);
        const txt = await robots.text();
        expect(txt).toMatch(/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/);
        expect(txt).toMatch(/Disallow:\s*\/api\//);

        const manifest = await request.get("/manifest.webmanifest");
        expect(manifest.status()).toBe(200);
        const body = await manifest.json();
        expect(body.icons.length).toBeGreaterThan(0);
        expect(body.name).toMatch(/Suara Lapangan/);

        const favicon = await request.get("/favicon.ico");
        expect(favicon.status()).toBe(200);

        const og = await request.get("/en/opengraph-image");
        expect(og.status()).toBe(200);
        expect(og.headers()["content-type"]).toContain("image/png");
    });

    test("the language switcher offers exactly English and Bahasa Indonesia", async ({
        page,
    }) => {
        const problems: string[] = [];
        collectProblems(page, problems);

        await page.goto("/en");

        const switcher = page.getByRole("group", { name: "Languages" });
        const labels = await switcher
            .locator("[data-locale-code]")
            .evaluateAll((els) =>
                els.map((el) => [
                    el.getAttribute("data-locale-code"),
                    // innerText, not textContent: the short label for narrow
                    // screens is display:none above sm and must not count.
                    (el as HTMLElement).innerText.trim(),
                ])
            );

        // Exactly two, in order, and each labelled with its own language —
        // the full name where there is room, the code on a phone.
        expect(labels.map(([code]) => code)).toEqual(["en", "id"]);
        // Case-insensitively: the narrow-screen code is uppercased in CSS,
        // which innerText reports.
        expect(labels[0][1]).toMatch(/^(en|english)$/i);
        expect(labels[1][1]).toMatch(/^(id|bahasa indonesia)$/i);
        await expect(
            switcher.locator('[data-locale-code="en"]')
        ).toHaveAttribute("aria-pressed", "true");

        expect(problems, `page problems:\n${problems.join("\n")}`).toEqual([]);
    });

    test("switching language keeps the step and translates it", async ({
        page,
    }) => {
        await page.goto("/en/dokumen");

        await page.locator('[data-locale-code="id"]').click();

        await expect(page).toHaveURL(/\/id\/dokumen$/);
        await expect(page.getByText("Langkah 3 dari 3")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            "Dokumen"
        );
    });

    test("Indonesian copy is complete, not English falling through", async ({
        page,
    }) => {
        await page.goto("/id");

        // English copy here would mean the id catalogue is missing the key.
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dari catatan suara menjadi penawaran yang rapi.");
        await expect(page.getByRole("banner")).toContainText("Suara Lapangan");
        await expect(page.getByRole("link", { name: "Buat akun" }).first()).toBeVisible();

        // Step 2 Susun: manual session input label must be translated, no English fallback
        await page.goto("/id/susun");
        await expect(
            page.getByText("Atau masukkan ID sesi secara manual:")
        ).toBeVisible();
        await expect(page.locator("body")).not.toContainText("Session ID");
        await expect(page.locator("body")).not.toContainText(
            "Or enter Session ID manually:"
        );
    });
});
