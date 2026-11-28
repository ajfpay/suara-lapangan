import {
    test,
    expect,
    type APIResponse,
    type Page,
    type Response,
} from "@playwright/test";
import { seedSession, uniqueSessionId, deleteSession } from "./helpers";

async function expectHttp(response: Response | APIResponse, status: number) {
    const actual = response.status();
    const error =
        actual === status ? undefined : await response.json().catch(() => null);
    expect(
        actual,
        `HTTP status; error=${error?.error ?? "none"}; remaining=${response.headers()["x-ratelimit-remaining"] ?? "unknown"}`
    ).toBe(status);
}

async function submitAndCheck(
    page: Page,
    method: "POST" | "PATCH",
    path: string,
    submit: () => Promise<void>,
    status = 200
) {
    const [response] = await Promise.all([
        page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === path &&
                response.request().method() === method
        ),
        submit(),
    ]);
    await expectHttp(response, status);
}

test("draft edits use revisions in Susun and Dokumen, and stale edits reload", async ({
    page,
}) => {
    // The expanded scenario performs several serial HTTP round trips against remote PostgreSQL.
    test.setTimeout(90000);
    const sessionId = uniqueSessionId("e2e-draft");
    try {
        await seedSession(sessionId);
        await page.goto(`/en/susun?sessionId=${sessionId}`);
        await submitAndCheck(page, "POST", "/api/documents", () =>
            page.getByTestId("btn-buat-dokumen").click()
        );
        const editor = page.getByTestId("draft-editor");
        await expect(editor).toBeVisible();
        await expect(editor.getByRole("heading")).toContainText("Revision 1");
        const href = await page
            .getByTestId("link-lihat-dokumen")
            .getAttribute("href");
        const docId = new URL(href!, "http://localhost").searchParams.get(
            "doc"
        )!;
        const detail = `/api/documents/${docId}`;
        const initialResponse = await page.request.get(detail);
        await expectHttp(initialResponse, 200);
        const initial = await initialResponse.json();
        const id = initial.document.pekerjaan[0].id;
        expect(id).toBeTruthy();

        await editor.getByLabel("Quantity", { exact: true }).first().fill("2");
        await submitAndCheck(page, "PATCH", detail, () =>
            editor
                .getByRole("button", { name: "Save item", exact: true })
                .first()
                .click()
        );
        await expect(editor.getByRole("heading")).toContainText("Revision 2");
        const readDraft = async () => {
            const response = await page.request.get(detail);
            await expectHttp(response, 200);
            return response.json();
        };
        let response = await readDraft();
        expect(response.document.pekerjaan[0].id).toBe(id);
        expect(response.document.pekerjaan[0].volume).toBe(2);

        await page.goto(`/en/dokumen?doc=${docId}`);
        await expect(editor).toBeVisible();
        await expect(editor.getByRole("heading")).toContainText("Revision 2");
        await editor
            .getByLabel("Payment terms (optional)")
            .fill("Payment within 14 days");
        await submitAndCheck(page, "PATCH", detail, () =>
            editor.getByRole("button", { name: "Save terms" }).click()
        );
        await expect(editor.getByRole("heading")).toContainText("Revision 3");

        const external = await page.request.patch(detail, {
            headers: { "Idempotency-Key": "external-" + sessionId },
            data: { field: "masa_berlaku_hari", nilai: 14, draft_revision: 3 },
        });
        await expectHttp(external, 200);
        await editor
            .getByLabel("Payment terms (optional)")
            .fill("Payment within 30 days");
        await submitAndCheck(
            page,
            "PATCH",
            detail,
            () => editor.getByRole("button", { name: "Save terms" }).click(),
            409
        );
        await expect(
            page.getByRole("alert").filter({ hasText: "The draft changed" })
        ).toBeVisible();
        await expect(editor.getByRole("heading")).toContainText("Revision 4");
        await expect(editor.getByLabel("Payment terms (optional)")).toHaveValue(
            "Payment within 30 days"
        );
        response = await readDraft();
        expect(response.document.syarat_pembayaran).toBe(
            "Payment within 14 days"
        );
        expect(response.document.masa_berlaku_hari).toBe(14);
        expect(response.draft_revision).toBe(4);
        await submitAndCheck(page, "PATCH", detail, () =>
            editor.getByRole("button", { name: "Save terms" }).click()
        );
        await expect(editor.getByRole("heading")).toContainText("Revision 5");
        response = await readDraft();
        expect(response.document.syarat_pembayaran).toBe(
            "Payment within 30 days"
        );
        expect(response.document.masa_berlaku_hari).toBe(14);
    } finally {
        await deleteSession(sessionId);
    }
});
