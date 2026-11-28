import { test, expect } from "@playwright/test";
import { seedSession, uniqueSessionId, deleteSession } from "./helpers";

test("draft edits use revisions in Susun and Dokumen, and stale edits reload", async ({
    page,
}) => {
    // The expanded scenario performs several serial HTTP round trips against remote PostgreSQL.
    test.setTimeout(90000);
    const sessionId = uniqueSessionId("e2e-draft");
    try {
        await seedSession(sessionId);
        await page.goto(`/en/susun?sessionId=${sessionId}`);
        await page.getByTestId("btn-buat-dokumen").click();
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
        const initial = await (await page.request.get(detail)).json();
        const id = initial.document.pekerjaan[0].id;
        expect(id).toBeTruthy();

        await editor.getByLabel("Quantity", { exact: true }).first().fill("2");
        await editor
            .getByRole("button", { name: "Save item", exact: true })
            .first()
            .click();
        await expect(editor.getByRole("heading")).toContainText("Revision 2");
        let response = await (await page.request.get(detail)).json();
        expect(response.document.pekerjaan[0].id).toBe(id);
        expect(response.document.pekerjaan[0].volume).toBe(2);

        await page.goto(`/en/dokumen?doc=${docId}`);
        await expect(editor).toBeVisible();
        await expect(editor.getByRole("heading")).toContainText("Revision 2");
        await editor
            .getByLabel("Payment terms (optional)")
            .fill("Payment within 14 days");
        await editor.getByRole("button", { name: "Save terms" }).click();
        await expect(editor.getByRole("heading")).toContainText("Revision 3");

        const external = await page.request.patch(detail, {
            headers: { "Idempotency-Key": "external-" + sessionId },
            data: { field: "masa_berlaku_hari", nilai: 14, draft_revision: 3 },
        });
        expect(external.status()).toBe(200);
        await editor
            .getByLabel("Payment terms (optional)")
            .fill("Payment within 30 days");
        await editor.getByRole("button", { name: "Save terms" }).click();
        await expect(
            page.getByRole("alert").filter({ hasText: "The draft changed" })
        ).toBeVisible();
        await expect(editor.getByRole("heading")).toContainText("Revision 4");
        await expect(editor.getByLabel("Payment terms (optional)")).toHaveValue(
            "Payment within 30 days"
        );
        response = await (await page.request.get(detail)).json();
        expect(response.document.syarat_pembayaran).toBe(
            "Payment within 14 days"
        );
        expect(response.document.masa_berlaku_hari).toBe(14);
        expect(response.draft_revision).toBe(4);
        await editor.getByRole("button", { name: "Save terms" }).click();
        await expect(editor.getByRole("heading")).toContainText("Revision 5");
        response = await (await page.request.get(detail)).json();
        expect(response.document.syarat_pembayaran).toBe(
            "Payment within 30 days"
        );
        expect(response.document.masa_berlaku_hari).toBe(14);
    } finally {
        await deleteSession(sessionId);
    }
});
