import { test, expect, type Page } from "@playwright/test";

import {
    assertStoredDocument,
    deleteSession,
    seedSession,
    uniqueSessionId,
} from "./helpers";

/**
 * Full-chain ticket 07: rekam → susun → dokumen (create + view) → PDF
 * download.
 *
 * The one piece that cannot run in a browser is the microphone upload, so the
 * session is seeded in the database the same way `saveTranscription` in
 * `lib/server/db/store.ts` writes a real ASR upload. Everything after that is
 * the real product: the Susun screen renders the stored turns, "Buat dokumen"
 * POSTs to /api/documents, the confirmation card PATCHes the one defective
 * field, the Dokumen screen loads the real PDF, and the download button saves
 * it with the document number as filename.
 *
 * No microphone, no Meta API (`MODEL_API_KEY` unset → the guard's fallback),
 * no pre-seeded document rows: only the session row exists before the test,
 * and the document is created by the UI.
 */

test("full chain: seed session → susun → confirm → dokumen → PDF download", async ({
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
 * One full pass: susun → buat dokumen → confirm → lihat dokumen → unduh.
 * Returns the document number shown by the UI.
 */
async function fullChain(page: Page, sessionId: string): Promise<string> {
    // ── Susun: turns render from the seeded session ──────────────────────────
    await page.goto(`/en/susun?sessionId=${sessionId}`);
    await expect(page.getByTestId("turn-card-1")).toBeVisible();
    await expect(page.getByTestId("turn-card-2")).toBeVisible();

    // ── Create the document (POST /api/documents) ────────────────────────────
    await page.getByTestId("btn-buat-dokumen").click();
    await expect(page.getByTestId("document-nomor")).toBeVisible();

    const nomor = (await page.getByTestId("document-nomor").textContent())?.trim();
    expect(nomor).toBeTruthy();

    // The defective turn must have produced exactly one confirmation.
    await expect(
        page.getByTestId("konfirmasi-pekerjaan[1].volume")
    ).toBeVisible();

    // ── Confirm the field via PATCH (manual correction) ──────────────────────
    await page
        .getByTestId("konfirmasi-pekerjaan[1].volume")
        .getByLabel("Manual correction")
        .fill("16");
    await page
        .getByTestId("konfirmasi-pekerjaan[1].volume")
        .getByRole("button", { name: "Save" })
        .click();

    // After resolution the document is siap: the download button activates.
    await expect(page.getByTestId("btn-unduh")).toBeEnabled();

    // ── Dokumen screen: view the generated PDF ───────────────────────────────
    await page.getByTestId("link-lihat-dokumen").click();
    await expect(page.getByTestId("pdf-frame")).toBeVisible();
    await expect(page.getByTestId("document-nomor")).toHaveText(nomor!);

    // ── Download: filename = document number, payload starts with %PDF ───────
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("btn-unduh").click();
    const download = await downloadPromise;

    const expectedFilename = nomor!.replaceAll("/", "-") + ".pdf";
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
    expect(row.nomor).toBe(nomor!);
    expect(row.status).toBe("siap");

    // The UI's manual correction must be what hit the database: the stored
    // document carries volume 16 for pekerjaan[1], not the defective "square
    // feet" text the ASR guard flagged.
    const pekerjaan = data.pekerjaan as { volume: number }[];
    expect(pekerjaan[1]?.volume).toBe(16);

    return nomor!;
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

async function createDocumentNumber(
    page: Page,
    sessionId: string
): Promise<string> {
    await page.goto(`/en/susun?sessionId=${sessionId}`);
    await page.getByTestId("btn-buat-dokumen").click();
    await expect(page.getByTestId("document-nomor")).toBeVisible();
    const nomor = (
        await page.getByTestId("document-nomor").textContent()
    )?.trim();
    expect(nomor).toBeTruthy();
    return nomor!;
}
