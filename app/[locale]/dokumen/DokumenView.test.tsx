// @vitest-environment jsdom
import React from "react";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import idMessages from "@/i18n/locales/id.json";
import { DokumenView } from "./DokumenView";

describe("DokumenView", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let createObjectURLMock: ReturnType<typeof vi.fn>;
    let revokeObjectURLMock: ReturnType<typeof vi.fn>;
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        createObjectURLMock = vi.fn(
            () => "blob:http://localhost/mock-blob-uuid"
        );
        revokeObjectURLMock = vi.fn();
        URL.createObjectURL = createObjectURLMock;
        URL.revokeObjectURL = revokeObjectURLMock;
    });

    afterEach(() => {
        cleanup();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        vi.restoreAllMocks();
    });

    it("1. docId={null} → empty state, fetch never called", async () => {
        render(<DokumenView locale="en" docId={null} copy={en.dokumen} />);

        expect(fetchMock).not.toHaveBeenCalled();
        const emptyEl = screen.getByTestId("dokumen-empty");
        expect(emptyEl).toBeTruthy();
        expect(screen.getByText(en.dokumen.emptyTitle)).toBeTruthy();
        expect(screen.getByText(en.dokumen.emptyBody)).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("2. 404 → empty state with notFoundBody, no role='alert'", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ error: "not_found" }),
        });

        render(
            <DokumenView locale="en" docId="doc-not-found" copy={en.dokumen} />
        );

        await waitFor(() => {
            expect(screen.getByTestId("dokumen-empty")).toBeTruthy();
        });

        expect(screen.getByText(en.dokumen.emptyTitle)).toBeTruthy();
        expect(screen.getByText(en.dokumen.notFoundBody)).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("2b. 400 (malformed id) → empty state with notFoundBody, no role='alert'", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ error: "invalid_request" }),
        });

        render(
            <DokumenView locale="en" docId="not-a-uuid" copy={en.dokumen} />
        );

        await waitFor(() => {
            expect(screen.getByTestId("dokumen-empty")).toBeTruthy();
        });

        expect(screen.getByText(en.dokumen.notFoundBody)).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("2c. a network failure on the document read → error state with retry", async () => {
        fetchMock.mockRejectedValueOnce(new Error("network down"));

        render(
            <DokumenView locale="en" docId="doc-offline" copy={en.dokumen} />
        );

        await waitFor(() => {
            expect(screen.getByTestId("dokumen-error")).toBeTruthy();
        });
        expect(
            screen.getByRole("button", { name: en.dokumen.retry })
        ).toBeTruthy();
    });

    it("3. ready + siap → nomor visible, pdf-frame iframe whose title contains the nomor, btn-unduh downloads, btn-kirim enabled, send flow succeeds with message and refetch, and send failure shows error", async () => {
        const docId = "doc-ready-123";
        const docNomor = "SL/QTN/2026/0001";

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: docNomor,
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () =>
                new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }),
        });

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({
                "content-disposition":
                    'attachment; filename="SL-QTN-2026-0001.pdf"',
            }),
            blob: async () =>
                new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            const nomorEl = screen.getByTestId("document-nomor");
            expect(nomorEl.textContent).toBe(docNomor);
        });

        await waitFor(() => {
            const frame = screen.getByTestId("pdf-frame") as HTMLIFrameElement;
            expect(frame).toBeTruthy();
            expect(frame.title).toContain(docNomor);
            expect(frame.src).toBe("blob:http://localhost/mock-blob-uuid");
        });

        const downloadButton = screen.getByTestId("btn-unduh");
        expect(downloadButton.tagName.toLowerCase()).toBe("button");

        const pdfFetches = () =>
            fetchMock.mock.calls.filter((call) =>
                String(call[0]).includes("/pdf")
            );
        expect(pdfFetches().length).toBe(1);

        const createdAnchors: HTMLAnchorElement[] = [];
        const realCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(
            (tag: string) => {
                const el = realCreateElement(tag);
                if (tag === "a") createdAnchors.push(el as HTMLAnchorElement);
                return el;
            }
        );

        fireEvent.click(downloadButton);
        await waitFor(() => {
            expect(pdfFetches().length).toBe(2);
        });
        expect(createObjectURLMock).toHaveBeenCalledTimes(2);
        expect(createdAnchors.at(-1)?.download).toBe("SL-QTN-2026-0001.pdf");

        const sendBtn = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(sendBtn.disabled).toBe(false);
        expect(sendBtn.title).toBe("");

        const inputRecipient = screen.getByTestId(
            "input-recipient"
        ) as HTMLInputElement;
        expect(inputRecipient).toBeTruthy();

        // Send failure flow
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 502,
            json: async () => ({
                error: "send_failure",
                message: "Failed to send email",
            }),
        });

        // On send error the component refetches the document so the status
        // chip and button state match the server.
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: docNomor,
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        fireEvent.change(inputRecipient, {
            target: { value: "client@example.com" },
        });
        fireEvent.click(sendBtn);

        await waitFor(() => {
            expect(screen.getByTestId("send-error-message")).toBeTruthy();
        });
        expect(screen.getByTestId("send-error-message").textContent).toContain(
            "Failed to send email"
        );

        // Send success flow
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                status: "terkirim",
                sent_to: "client@example.com",
                sent_at: new Date().toISOString(),
            }),
        });

        // Refetch of document after send success
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: docNomor,
                    status: "terkirim",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "terkirim",
            }),
        });

        fireEvent.click(sendBtn);

        await waitFor(() => {
            expect(screen.getByTestId("send-success-message")).toBeTruthy();
        });
        expect(
            screen.getByTestId("send-success-message").textContent
        ).toContain(en.dokumen.sendSuccess);

        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toBe(
                en.dokumen.statusTerkirim
            );
        });

        const docFetches = fetchMock.mock.calls.filter(
            (call) => call[0] === `/api/documents/${docId}`
        );
        expect(docFetches.length).toBe(3);
    });

    it("3b. a superseded document response never replaces the document now shown", async () => {
        const envelope = (id: string, nomor: string) => ({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id,
                    nomor,
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        let resolveDocA!: (value: unknown) => void;
        const docAPending = new Promise((resolve) => {
            resolveDocA = resolve;
        });

        fetchMock.mockImplementation(async (url: unknown) => {
            const u = String(url);
            if (u === "/api/documents/doc-a") return docAPending;
            if (u === "/api/documents/doc-b")
                return envelope("doc-b", "SL/QTN/2026/0002");
            return {
                ok: true,
                status: 200,
                blob: async () =>
                    new Blob(["PDF-B"], { type: "application/pdf" }),
            };
        });

        const { rerender } = render(
            <DokumenView locale="en" docId="doc-a" copy={en.dokumen} />
        );
        expect(screen.queryByTestId("document-nomor")).toBeNull();

        rerender(<DokumenView locale="en" docId="doc-b" copy={en.dokumen} />);
        await waitFor(() =>
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                "SL/QTN/2026/0002"
            )
        );

        resolveDocA(envelope("doc-a", "SL/QTN/2026/0001"));
        await new Promise((r) => setTimeout(r, 50));

        expect(screen.getByTestId("document-nomor").textContent).toBe(
            "SL/QTN/2026/0002"
        );
    });

    it("3c. changing the document revokes the previous preview blob", async () => {
        const envelope = (id: string, nomor: string) => ({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id,
                    nomor,
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        fetchMock.mockImplementation(async (url: unknown) => {
            const u = String(url);
            if (u === "/api/documents/doc-a")
                return envelope("doc-a", "SL/QTN/2026/0001");
            if (u === "/api/documents/doc-b")
                return envelope("doc-b", "SL/QTN/2026/0002");
            return {
                ok: true,
                status: 200,
                blob: async () =>
                    new Blob(["PDF"], { type: "application/pdf" }),
            };
        });

        const { rerender } = render(
            <DokumenView locale="en" docId="doc-a" copy={en.dokumen} />
        );
        await waitFor(() => {
            expect(screen.getByTestId("pdf-frame")).toBeTruthy();
        });

        rerender(<DokumenView locale="en" docId="doc-b" copy={en.dokumen} />);
        await waitFor(() =>
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                "SL/QTN/2026/0002"
            )
        );

        expect(revokeObjectURLMock).toHaveBeenCalledWith(
            "blob:http://localhost/mock-blob-uuid"
        );
    });

    it("3d. a download error does not survive a document change", async () => {
        const envelope = (id: string, nomor: string) => ({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id,
                    nomor,
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });
        const pdf = {
            ok: true,
            status: 200,
            blob: async () => new Blob(["PDF"], { type: "application/pdf" }),
        };

        let docAFetches = 0;
        fetchMock.mockImplementation(async (url: unknown) => {
            const u = String(url);
            if (u === "/api/documents/doc-a")
                return envelope("doc-a", "SL/QTN/2026/0001");
            if (u === "/api/documents/doc-b")
                return envelope("doc-b", "SL/QTN/2026/0002");
            if (u === "/api/documents/doc-a/pdf") {
                docAFetches += 1;
                return docAFetches === 1 ? pdf : { ok: false, status: 500 };
            }
            return pdf;
        });

        const { rerender } = render(
            <DokumenView locale="en" docId="doc-a" copy={en.dokumen} />
        );
        await waitFor(() => {
            expect(screen.getByTestId("pdf-frame")).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId("btn-unduh"));
        await waitFor(() => {
            expect(screen.getByText(en.dokumen.downloadError)).toBeTruthy();
        });

        rerender(<DokumenView locale="en" docId="doc-b" copy={en.dokumen} />);
        await waitFor(() =>
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                "SL/QTN/2026/0002"
            )
        );

        expect(screen.queryByText(en.dokumen.downloadError)).toBeNull();
    });

    it("3e. ready + terkirim → Sent label and the PDF still loads", async () => {
        const docId = "doc-sent";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "SL/QTN/2026/0009",
                    status: "terkirim",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "terkirim",
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["PDF"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() =>
            expect(screen.getByTestId("document-status").textContent).toBe(
                en.dokumen.statusTerkirim
            )
        );
        await waitFor(() => {
            expect(screen.getByTestId("pdf-frame")).toBeTruthy();
        });
        expect(
            (screen.getByTestId("btn-unduh") as HTMLButtonElement).disabled
        ).toBe(false);
    });

    it("4. perlu_konfirmasi with two pending fields → lock reason visible, both controls disabled, no iframe, and exactly one fetch (the document read)", async () => {
        const docId = "doc-locked-456";
        const docNomor = "SL/QTN/2026/0002";

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: docNomor,
                    status: "perlu_konfirmasi",
                    butuh_konfirmasi: [
                        "pekerjaan[0].volume",
                        "pekerjaan[1].harga_satuan",
                    ],
                },
                butuh_konfirmasi: [
                    "pekerjaan[0].volume",
                    "pekerjaan[1].harga_satuan",
                ],
                status: "perlu_konfirmasi",
            }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            const nomorEl = screen.getByTestId("document-nomor");
            expect(nomorEl.textContent).toBe(docNomor);
        });

        const expectedNote = en.dokumen.lockedNote.replace("{count}", "2");
        expect(screen.getByText(expectedNote)).toBeTruthy();
        expect(screen.getByText(en.dokumen.pdfLocked)).toBeTruthy();

        const downloadBtn = screen.getByTestId(
            "btn-unduh"
        ) as HTMLButtonElement;
        expect(downloadBtn.tagName.toLowerCase()).toBe("button");
        expect(downloadBtn.disabled).toBe(true);
        expect(downloadBtn.title).toBe(en.dokumen.lockedReason);

        const sendBtn = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(sendBtn.disabled).toBe(true);
        expect(sendBtn.title).toBe(en.dokumen.lockedReason);

        expect(screen.queryByTestId("pdf-frame")).toBeNull();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            `/api/documents/${docId}`,
            expect.anything()
        );
    });

    it("5. 500 → alert with the code, and clicking retry refetches", async () => {
        const docId = "doc-error-789";

        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({
                error: "store_failure",
                message: "Database unreachable",
            }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            const alertEl = screen.getByRole("alert");
            expect(alertEl).toBeTruthy();
            expect(alertEl.getAttribute("data-testid")).toBe("dokumen-error");
        });

        expect(screen.getByText(en.dokumen.errorTitle)).toBeTruthy();
        expect(screen.getByText(/store_failure/)).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "SL/QTN/2026/0003",
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () =>
                new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }),
        });

        const retryBtn = screen.getByRole("button", {
            name: en.dokumen.retry,
        });
        fireEvent.click(retryBtn);

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor")).toBeTruthy();
        });

        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("6. 200 with no document.id → error state, no crash", async () => {
        const docId = "doc-invalid-shape";

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    nomor: "SL/QTN/2026/9999",
                },
            }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            const errorEl = screen.getByTestId("dokumen-error");
            expect(errorEl).toBeTruthy();
        });

        expect(screen.getByRole("alert")).toBeTruthy();
        expect(screen.getByText(/invalid_response/)).toBeTruthy();
    });

    it("handles PDF load error with retry button", async () => {
        const docId = "doc-pdf-fail";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "SL/QTN/2026/0004",
                    status: "siap",
                    butuh_konfirmasi: [],
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        // PDF fetch fails
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByText(en.dokumen.pdfUnavailable)).toBeTruthy();
        });

        // Clicking retry for PDF
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });

        const retryBtn = screen.getByRole("button", {
            name: en.dokumen.retry,
        });
        fireEvent.click(retryBtn);

        await waitFor(() => {
            expect(screen.getByTestId("pdf-frame")).toBeTruthy();
        });
    });

    it("download failure → destructive note with the downloadError copy", async () => {
        const docId = "doc-dl-fail";
        const envelope = {
            document: {
                id: docId,
                nomor: "SL/QTN/2026/0008",
                status: "siap",
                butuh_konfirmasi: [],
            },
            butuh_konfirmasi: [],
            status: "siap",
        };
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => envelope,
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () =>
                new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("pdf-frame")).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId("btn-unduh"));

        await waitFor(() => {
            expect(screen.getByText(en.dokumen.downloadError)).toBeTruthy();
        });
        expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("renders properly with Indonesian catalogue", async () => {
        render(
            <DokumenView locale="id" docId={null} copy={idMessages.dokumen} />
        );

        expect(screen.getByText(idMessages.dokumen.emptyTitle)).toBeTruthy();
        expect(screen.getByText(idMessages.dokumen.emptyBody)).toBeTruthy();
        expect(screen.getByText(idMessages.dokumen.emptyCta)).toBeTruthy();
    });

    it("safely parses drafts with nomor=null: shows sequence as Not yet assigned / Belum ditetapkan and status Draft / Draf", async () => {
        const docId = "draft-123";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: null,
                    status: "draf",
                    butuh_konfirmasi: [],
                },
                status: "draf",
                butuh_konfirmasi: [],
            }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            const nomorEl = screen.getByTestId("document-nomor");
            expect(nomorEl.textContent).toBe("Not yet assigned");
        });

        const statusEl = screen.getByTestId("document-status");
        expect(statusEl.textContent).toBe("Draft");
        expect(screen.queryByTestId("dokumen-error")).toBeNull();
    });

    it("drafts (status draf): Unduh PDF disabled with helper text, pdf-frame NOT rendered, approval-pending shown, no pdf fetch", async () => {
        const docId = "draft-456";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: null,
                    status: "draf",
                    butuh_konfirmasi: [],
                },
                status: "draf",
                butuh_konfirmasi: [],
            }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor")).toBeTruthy();
        });

        // Unduh PDF disabled
        const downloadButton = screen.getByTestId(
            "btn-unduh"
        ) as HTMLButtonElement;
        expect(downloadButton.disabled).toBe(true);

        // Helper text "Approve document first"
        expect(screen.getByText("Approve document first")).toBeTruthy();

        // Kirim disabled
        const sendButton = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(sendButton.disabled).toBe(true);

        // pdf-frame NOT rendered
        expect(screen.queryByTestId("pdf-frame")).toBeNull();

        // Approval pending state rendered
        expect(screen.getByTestId("approval-pending")).toBeTruthy();

        // PDF fetch was never called
        const pdfCalls = fetchMock.mock.calls.filter((call) =>
            String(call[0]).includes("/pdf")
        );
        expect(pdfCalls.length).toBe(0);
    });

    it("approved (disetujui): shows sequence number, enables Unduh PDF + Kirim, renders pdf-frame", async () => {
        const docId = "doc-appr-789";
        const docNomor = "2026/0042";

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: docNomor,
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                butuh_konfirmasi: [],
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () =>
                new Blob(["%PDF-1.4 mock"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                docNomor
            );
        });

        expect(screen.getByTestId("document-status").textContent).toBe(
            "Approved"
        );

        const downloadButton = screen.getByTestId(
            "btn-unduh"
        ) as HTMLButtonElement;
        expect(downloadButton.disabled).toBe(false);

        const sendButton = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(sendButton.disabled).toBe(false);

        await waitFor(() => {
            expect(screen.getByTestId("pdf-frame")).toBeTruthy();
        });
    });

    it("renders version selector for documents with lineage, allows selecting older version and downloading its PDF", async () => {
        const v2Id = "doc-v2";
        const v1Id = "doc-v1";

        // Initial fetch for v2 (draft)
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: v2Id,
                    nomor: null,
                    status: "draf",
                    butuh_konfirmasi: [],
                },
                status: "draf",
                version: 2,
                root_id: "root-abc",
                versions: [
                    {
                        id: v1Id,
                        version: 1,
                        nomor: "2026/0001",
                        status: "disetujui",
                        superseded_by: v2Id,
                    },
                    {
                        id: v2Id,
                        version: 2,
                        nomor: null,
                        status: "draf",
                        superseded_by: null,
                    },
                ],
            }),
        });

        // When switching to v1: fetch doc v1
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: v1Id,
                    nomor: "2026/0001",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: "root-abc",
                superseded_by: v2Id,
                versions: [
                    {
                        id: v1Id,
                        version: 1,
                        nomor: "2026/0001",
                        status: "disetujui",
                        superseded_by: v2Id,
                    },
                    {
                        id: v2Id,
                        version: 2,
                        nomor: null,
                        status: "draf",
                        superseded_by: null,
                    },
                ],
            }),
        });
        // PDF fetch for v1
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () =>
                new Blob(["%PDF mock v1"], { type: "application/pdf" }),
        });
        // Download fetch for v1
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({
                "content-disposition": 'attachment; filename="2026-0001.pdf"',
            }),
            blob: async () =>
                new Blob(["%PDF mock v1"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={v2Id} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("version-selector")).toBeTruthy();
        });

        const selector = screen.getByTestId(
            "version-selector"
        ) as HTMLSelectElement;
        expect(selector.options.length).toBe(2);

        // Switch to v1
        fireEvent.change(selector, { target: { value: v1Id } });

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                "2026/0001"
            );
        });
        expect(screen.getByTestId("document-status").textContent).toBe(
            "Approved"
        );

        // Download v1 PDF
        const downloadButton = screen.getByTestId("btn-unduh");
        expect((downloadButton as HTMLButtonElement).disabled).toBe(false);

        const createdAnchors: HTMLAnchorElement[] = [];
        const realCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(
            (tag: string) => {
                const el = realCreateElement(tag);
                if (tag === "a") createdAnchors.push(el as HTMLAnchorElement);
                return el;
            }
        );

        fireEvent.click(downloadButton);

        await waitFor(() => {
            expect(createdAnchors.length).toBe(1);
            expect(createdAnchors[0].download).toBe("2026-0001.pdf");
        });
    });

    it("visibly marks superseded version in selector and on its own preview", async () => {
        const docId = "doc-v1-old";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0010",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: "root-xyz",
                superseded_by: "doc-v2-new",
                versions: [
                    {
                        id: docId,
                        version: 1,
                        nomor: "2026/0010",
                        status: "disetujui",
                        superseded_by: "doc-v2-new",
                    },
                    {
                        id: "doc-v2-new",
                        version: 2,
                        nomor: "2026/0020",
                        status: "disetujui",
                        superseded_by: null,
                    },
                ],
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("superseded-badge")).toBeTruthy();
        });

        // Visible on its own preview
        expect(screen.getByTestId("superseded-badge").textContent).toContain(
            "Superseded"
        );
        expect(screen.getByTestId("superseded-banner")).toBeTruthy();

        // Visible in version selector
        const selector = screen.getByTestId(
            "version-selector"
        ) as HTMLSelectElement;
        const v1Option = selector.querySelector('option[value="doc-v1-old"]');
        expect(v1Option?.textContent).toContain("Superseded");
    });

    it("approved docs show 'Create new version' button: POST /api/documents/{id}/new-version and redirects to /susun", async () => {
        const docId = "doc-appr-999";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0099",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: "root-999",
                superseded_by: null,
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });

        // Mock new-version POST response
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                document: {
                    id: "new-draft-id",
                    nomor: null,
                    status: "draf",
                },
                status: "draf",
                version: 2,
            }),
        });

        // Track window.location.href changes
        let assignedHref = "";
        const originalLocation = window.location;
        delete (window as unknown as { location?: Location }).location;
        window.location = {
            ...originalLocation,
            pathname: "/en/dokumen",
            search: `?doc=${docId}`,
            set href(val: string) {
                assignedHref = val;
            },
            get href() {
                return (
                    assignedHref || "http://localhost/en/dokumen?doc=" + docId
                );
            },
        } as unknown as Location;

        try {
            render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

            await waitFor(() => {
                expect(screen.getByTestId("btn-new-version")).toBeTruthy();
            });

            fireEvent.click(screen.getByTestId("btn-new-version"));

            await waitFor(() => {
                expect(assignedHref).toBe("/en/susun?doc=new-draft-id");
            });

            const newVersionCalls = fetchMock.mock.calls.filter((call) =>
                String(call[0]).includes(`/api/documents/${docId}/new-version`)
            );
            expect(newVersionCalls.length).toBe(1);
            expect(newVersionCalls[0][1]?.method).toBe("POST");
        } finally {
            window.location = originalLocation;
        }
    });

    it("carries full page address including search query on 401 login redirect", async () => {
        const docId = "doc-unauth-1";
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({
                error: "unauthorized",
                message: "Authentication required",
            }),
        });

        let assignedHref = "";
        const originalLocation = window.location;
        delete (window as unknown as { location?: Location }).location;
        window.location = {
            ...originalLocation,
            pathname: "/en/dokumen",
            search: "?doc=doc-unauth-1&recording=rec_789",
            set href(val: string) {
                assignedHref = val;
            },
            get href() {
                return (
                    assignedHref ||
                    "http://localhost/en/dokumen?doc=doc-unauth-1&recording=rec_789"
                );
            },
        } as unknown as Location;

        try {
            render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

            await waitFor(() => {
                expect(assignedHref).toBe(
                    "/en/login?callbackUrl=" +
                        encodeURIComponent(
                            "/en/dokumen?doc=doc-unauth-1&recording=rec_789"
                        )
                );
            });
        } finally {
            window.location = originalLocation;
        }
    });

    it("renders draft and approved status and helper copy in Indonesian", async () => {
        const docId = "draft-id-test";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: null,
                    status: "draf",
                    butuh_konfirmasi: [],
                },
                status: "draf",
                butuh_konfirmasi: [],
            }),
        });

        render(
            <DokumenView locale="id" docId={docId} copy={idMessages.dokumen} />
        );

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                "Belum ditetapkan"
            );
        });
        expect(screen.getByTestId("document-status").textContent).toBe("Draf");
        expect(
            screen.getByText("Setujui dokumen terlebih dahulu")
        ).toBeTruthy();
    });

    it("does not render version selector when there is only a single version", async () => {
        const docId = "doc-single-1";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0001",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: docId,
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor")).toBeTruthy();
        });
        expect(screen.queryByTestId("version-selector")).toBeNull();
    });

    it("terkirim status enables download, kirim, and create new version", async () => {
        const docId = "doc-terkirim-1";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0077",
                    status: "terkirim",
                    butuh_konfirmasi: [],
                },
                status: "terkirim",
                version: 1,
                root_id: docId,
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toBe(
                "2026/0077"
            );
        });
        expect(screen.getByTestId("document-status").textContent).toBe("Sent");
        expect(
            (screen.getByTestId("btn-unduh") as HTMLButtonElement).disabled
        ).toBe(false);
        expect(
            (screen.getByTestId("btn-kirim") as HTMLButtonElement).disabled
        ).toBe(false);
        expect(
            (screen.getByTestId("btn-new-version") as HTMLButtonElement)
                .disabled
        ).toBe(false);
    });

    it("disables 'Create new version' on an already superseded version", async () => {
        const docId = "doc-superseded-btn";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0011",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: "root-btn",
                superseded_by: "doc-v2",
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("btn-new-version")).toBeTruthy();
        });
        expect(
            (screen.getByTestId("btn-new-version") as HTMLButtonElement)
                .disabled
        ).toBe(true);
    });

    it("handles 401 when creating a new version with full callbackUrl", async () => {
        const docId = "doc-401-new-version";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0099",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: docId,
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({
                error: "unauthorized",
            }),
        });

        let assignedHref = "";
        const originalLocation = window.location;
        delete (window as unknown as { location?: Location }).location;
        window.location = {
            ...originalLocation,
            pathname: "/en/dokumen",
            search: `?doc=${docId}&foo=bar`,
            set href(val: string) {
                assignedHref = val;
            },
            get href() {
                return (
                    assignedHref ||
                    `http://localhost/en/dokumen?doc=${docId}&foo=bar`
                );
            },
        } as unknown as Location;

        try {
            render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

            await waitFor(() => {
                expect(screen.getByTestId("btn-new-version")).toBeTruthy();
            });

            fireEvent.click(screen.getByTestId("btn-new-version"));

            await waitFor(() => {
                expect(assignedHref).toBe(
                    "/en/login?callbackUrl=" +
                        encodeURIComponent(`/en/dokumen?doc=${docId}&foo=bar`)
                );
            });
        } finally {
            window.location = originalLocation;
        }
    });

    it("shows error alert when new version creation fails", async () => {
        const docId = "doc-new-ver-fail";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: docId,
                    nomor: "2026/0088",
                    status: "disetujui",
                    butuh_konfirmasi: [],
                },
                status: "disetujui",
                version: 1,
                root_id: docId,
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 409,
            json: async () => ({
                error: "invalid_state",
                message: "Cannot create a new version in this state",
            }),
        });

        render(<DokumenView locale="en" docId={docId} copy={en.dokumen} />);

        await waitFor(() => {
            expect(screen.getByTestId("btn-new-version")).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId("btn-new-version"));

        await waitFor(() => {
            expect(screen.getByTestId("new-version-error")).toBeTruthy();
            expect(
                screen.getByTestId("new-version-error").textContent
            ).toContain("Cannot create a new version in this state");
        });
    });
});
