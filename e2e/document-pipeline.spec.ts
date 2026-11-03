import { test, expect, type Page } from "@playwright/test";

import {
    assertStoredDocument,
    deleteSession,
    seedSession,
    uniqueSessionId,
} from "./helpers";

/**
 * Full-chain ticket 07: rekam → susun → confirm → approve → dokumen → PDF
 * download.
 *
 * The one piece that cannot run in a browser is the microphone upload, so the
 * session is seeded in the database the same way `saveTranscription` in
 * `lib/server/db/store.ts` writes a real ASR upload. Everything after that is
 * the real product: the Susun screen renders the stored turns, "Buat dokumen"
 * POSTs to /api/documents and gets a draft with no number, the confirmation
 * card PATCHes the one defective field, approval issues the number and renders
 * the PDF, and the Dokumen screen loads it and saves it with the document
 * number as filename.
 *
 * Approval has no UI control yet, so it is driven over the page's own request
 * context: the real POST /api/documents/{id}/approve route, with the browser's
 * own cookies. That route is the product's gate — a draft must not be
 * downloadable — so the test exercises it rather than bypassing it.
 *
 * No microphone, no Meta API (`MODEL_API_KEY` unset → the guard's fallback),
 * no pre-seeded document rows: only the session row exists before the test,
 * and the document is created by the UI.
 */

test("full chain: seed session → susun → confirm → approve → dokumen → PDF download", async ({
    page,
}) => {
    const sessionId = uniqueSessionId("e2e-fullchain");

    try {
        // Seeding happens inside the try: a failure here (e.g. a half-applied
        // insert) is still cleaned up by the finally, so a red run never leaks
        // seeded rows.
        await seedSession(sessionId);
        await fullChain(page, sessionId);
    } finally {
        await deleteSession(sessionId);
    }
});

/**
 * One full pass: susun → buat dokumen → confirm → approve → lihat dokumen →
 * unduh. Returns the document number the server issued at approval.
 */
async function fullChain(page: Page, sessionId: string): Promise<string> {
    // ── Susun: turns render from the seeded session ──────────────────────────
    await page.goto(`/en/susun?sessionId=${sessionId}`);
    await expect(page.getByTestId("turn-card-1")).toBeVisible();
    await expect(page.getByTestId("turn-card-2")).toBeVisible();

    // ── Create the document (POST /api/documents) ────────────────────────────
    await page.getByTestId("btn-buat-dokumen").click();
    await expect(page.getByTestId("document-status")).toBeVisible();

    // A fresh created document is a draft: numbering is deferred to approval,
    // so the screen shows the draft status, no number, and no download.
    await expect(page.getByTestId("document-status")).toHaveText("draf");
    await expect(page.getByTestId("document-nomor")).toHaveText("");

    // The defective turn must have produced exactly one confirmation.
    await expect(
        page.getByTestId("konfirmasi-pekerjaan[1].volume")
    ).toBeVisible();
    await expect(page.getByTestId("btn-unduh")).toBeDisabled();

    const docId = await documentIdFromLink(page);

    // ── Confirm the field via PATCH (manual correction) ──────────────────────
    await page
        .getByTestId("konfirmasi-pekerjaan[1].volume")
        .getByLabel("Manual correction")
        .fill("16");
    await page
        .getByTestId("konfirmasi-pekerjaan[1].volume")
        .getByRole("button", { name: "Save" })
        .click();

    // The correction clears the confirmation, but resolving a field is not
    // approval: the document is still a draft and still has no number.
    await expect(
        page.getByTestId("konfirmasi-pekerjaan[1].volume")
    ).toHaveCount(0);
    await expect(page.getByTestId("document-status")).toHaveText("draf");
    await expect(page.getByTestId("document-nomor")).toHaveText("");

    // ── Dokumen screen: a draft is not viewable as a PDF ─────────────────────
    await page.getByTestId("link-lihat-dokumen").click();
    await expect(page.getByTestId("document-status")).toHaveText("Draft");
    await expect(page.getByTestId("document-nomor")).toHaveText(
        "Not yet assigned"
    );
    await expect(page.getByTestId("approval-pending")).toBeVisible();
    await expect(page.getByTestId("draft-helper")).toBeVisible();
    await expect(page.getByTestId("pdf-frame")).toHaveCount(0);
    await expect(page.getByTestId("btn-unduh")).toBeDisabled();

    // ── Approve: the number is issued here, and only here ────────────────────
    const nomor = await approveDocument(page, docId);

    // ── Dokumen screen: the approved document shows its number and PDF ───────
    await page.reload();
    await expect(page.getByTestId("document-status")).toHaveText("Approved");
    await expect(page.getByTestId("document-nomor")).toHaveText(nomor);
    await expect(page.getByTestId("pdf-frame")).toBeVisible();
    await expect(page.getByTestId("btn-unduh")).toBeEnabled();

    // ── Download: filename = document number, payload starts with %PDF ───────
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("btn-unduh").click();
    const download = await downloadPromise;

    const expectedFilename = nomor.replaceAll("/", "-") + ".pdf";
    expect(download.suggestedFilename()).toBe(expectedFilename);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");

    // Database-level validation (ticket 07 scope addition): the row the app
    // wrote must be complete, valid, and consistent with what the UI showed.
    // The PDF was downloaded, so pdf_path must be set and exist on disk, and
    // the confirmed document must have no open confirmations.
    const { row, data } = await assertStoredDocument(sessionId, {
        expectPdf: true,
        expectConfirmed: true,
    });
    expect(row.nomor).toBe(nomor);
    expect(row.status).toBe("disetujui");

    // The UI's manual correction must be what hit the database: the stored
    // document carries volume 16 for pekerjaan[1], not the defective "square
    // feet" text the ASR guard flagged.
    const pekerjaan = data.pekerjaan as { volume: number }[];
    expect(pekerjaan[1]?.volume).toBe(16);

    return nomor;
}

test("two document creations produce different numbers", async ({ page }) => {
    const firstId = uniqueSessionId("e2e-nomor");
    const secondId = uniqueSessionId("e2e-nomor");

    try {
        await seedSession(firstId);
        await seedSession(secondId);

        const firstNomor = await createDocumentNumber(page, firstId);
        const secondNomor = await createDocumentNumber(page, secondId);

        expect(firstNomor).not.toBe(secondNomor);

        // Both creations must have persisted complete, valid rows — and the
        // two numbers must also be distinct at the database level, not only in
        // the UI text.
        const first = await assertStoredDocument(firstId);
        const second = await assertStoredDocument(secondId);
        expect(first.row.nomor).toBe(firstNomor);
        expect(second.row.nomor).toBe(secondNomor);
        expect(first.row.nomor).not.toBe(second.row.nomor);

        // The yearly allocator must hand out increasing numbers: the second
        // document of the year is a later sequence than the first.
        const seqOf = (nomor: string) => Number(nomor.split("/")[3]);
        expect(seqOf(second.row.nomor)).toBeGreaterThan(seqOf(first.row.nomor));
    } finally {
        await deleteSession(firstId);
        await deleteSession(secondId);
    }
});

/**
 * Creates one document through the UI, resolves its single confirmation, and
 * approves it — the number only exists after approval — returning that number.
 */
async function createDocumentNumber(
    page: Page,
    sessionId: string
): Promise<string> {
    await page.goto(`/en/susun?sessionId=${sessionId}`);
    await page.getByTestId("btn-buat-dokumen").click();
    await expect(page.getByTestId("document-status")).toHaveText("draf");

    const docId = await documentIdFromLink(page);

    await page
        .getByTestId("konfirmasi-pekerjaan[1].volume")
        .getByLabel("Manual correction")
        .fill("16");
    await page
        .getByTestId("konfirmasi-pekerjaan[1].volume")
        .getByRole("button", { name: "Save" })
        .click();
    await expect(
        page.getByTestId("konfirmasi-pekerjaan[1].volume")
    ).toHaveCount(0);

    return approveDocument(page, docId);
}

/** The document id the Susun screen links to on its "Lihat dokumen" control. */
async function documentIdFromLink(page: Page): Promise<string> {
    const href = await page
        .getByTestId("link-lihat-dokumen")
        .getAttribute("href");
    expect(href, "Lihat dokumen must link to the created document").toBeTruthy();

    const docId = new URL(href!, "http://localhost").searchParams.get("doc");
    expect(docId, "the link must carry the document id").toBeTruthy();

    return docId!;
}

/**
 * Approves the document over the page's own request context — same cookies as
 * the browser, real route, real gate. Returns the server-issued number.
 */
async function approveDocument(page: Page, docId: string): Promise<string> {
    const response = await page.request.post(
        `/api/documents/${encodeURIComponent(docId)}/approve`
    );
    const text = await response.text();

    if (response.status() !== 200) {
        throw new Error(
            `approve failed: HTTP ${response.status()} ${text}`
        );
    }

    const body = JSON.parse(text) as {
        status: string;
        document: { nomor: string };
    };

    expect(body.status).toBe("disetujui");
    expect(body.document.nomor).toMatch(/^SL\/QTN\/\d{4}\/\d{4}$/);

    return body.document.nomor;
}
