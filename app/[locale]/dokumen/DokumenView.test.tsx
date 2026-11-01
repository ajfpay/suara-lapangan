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
            <DokumenView
                locale="en"
                docId="not-a-uuid"
                copy={en.dokumen}
            />
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

    it("3. ready + siap → nomor visible, pdf-frame iframe whose title contains the nomor, btn-unduh is a button whose click fetches the PDF route for the download, btn-kirim disabled with the coming-soon text, and clicking btn-kirim adds no fetch call", async () => {
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
        expect(sendBtn.disabled).toBe(true);
        expect(sendBtn.title).toBe(en.dokumen.sendComingSoon);

        const fetchCount = fetchMock.mock.calls.length;
        fireEvent.click(sendBtn);
        expect(fetchMock.mock.calls.length).toBe(fetchCount);
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
            if (u === "/api/documents/doc-b") return envelope("doc-b", "SL/QTN/2026/0002");
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
            if (u === "/api/documents/doc-a") return envelope("doc-a", "SL/QTN/2026/0001");
            if (u === "/api/documents/doc-b") return envelope("doc-b", "SL/QTN/2026/0002");
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
            if (u === "/api/documents/doc-a") return envelope("doc-a", "SL/QTN/2026/0001");
            if (u === "/api/documents/doc-b") return envelope("doc-b", "SL/QTN/2026/0002");
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
});
