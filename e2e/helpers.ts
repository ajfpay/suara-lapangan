import { expect, type Page } from "@playwright/test";

/**
 * Shared tripwires for the smoke suite.
 *
 * Ported from the invoify originals so the checks that are still meaningful —
 * "the page rendered", "nothing logged an error", "nothing overflows" — keep
 * the same strictness on the new screens.
 */

/**
 * Requests that legitimately fail outside a Vercel deployment.
 *
 * The analytics script is injected by @vercel/analytics and is only served by
 * Vercel's edge, so it 404s on any local or CI run. Allow-listing it by URL
 * keeps the assertion strict about everything else, rather than the easier and
 * much worse option of ignoring 404s in general.
 */
const EXPECTED_FAILING_REQUESTS = [/\/_vercel\/insights\//];

/**
 * Records console errors, page errors and failed requests into `problems`.
 *
 * A render loop would show up here as "Maximum update depth exceeded" while
 * the page still serves HTML, so an HTTP-level check on its own misses it.
 *
 * "Failed to load resource" console messages are dropped because the browser
 * reports them without a URL — the network listener below catches the same
 * failures and can say which request it was.
 */
export function collectProblems(page: Page, problems: string[]) {
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (text.includes("Failed to load resource")) return;
        problems.push(`console: ${text}`);
    });

    page.on("pageerror", (err) => problems.push(`pageerror: ${err}`));

    page.on("response", (res) => {
        if (res.status() < 400) return;
        const url = res.url();
        if (EXPECTED_FAILING_REQUESTS.some((re) => re.test(url))) return;
        problems.push(`http ${res.status()}: ${url}`);
    });
}

/**
 * Elements wider than the viewport, in document coordinates.
 *
 * Fixed and sticky elements are reported once rather than twice, and the
 * `html`/`body` pair is skipped because the viewport is what they measure.
 */
export async function horizontalOverflow(page: Page) {
    return page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const offenders: { tag: string; id: string; right: number }[] = [];

        for (const el of Array.from(document.querySelectorAll("body *"))) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            if (rect.right > width + 1) {
                offenders.push({
                    tag: el.tagName.toLowerCase(),
                    id: (el as HTMLElement).id || (el.textContent ?? "").slice(0, 40),
                    right: Math.round(rect.right),
                });
            }
        }

        // One report per overflowing subtree root, not per descendant.
        return offenders.filter(
            (o, i) => i === 0 || offenders[i - 1].right < o.right
        );
    });
}

/** Asserts the page fits the viewport horizontally. */
export async function expectNoOverflow(page: Page, label: string) {
    const offenders = await horizontalOverflow(page);
    expect(offenders, `${label} overflows: ${JSON.stringify(offenders, null, 2)}`).toEqual(
        []
    );
}

/** Reads the JSON-LD blocks a page emitted. */
export function jsonLdBlocks(html: string): Record<string, unknown>[] {
    return [
        ...html.matchAll(
            /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs
        ),
    ].map((m) => JSON.parse(m[1]));
}

/** Strips markup so prose length can be asserted. */
export function visibleText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script[^>]*>/gi, " ")
        .replace(/<style[\s\S]*?<\/style[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
