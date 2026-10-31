// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KonfirmasiPanel } from "./KonfirmasiPanel";

describe("KonfirmasiPanel", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("empty: no sessionId renders nothing and no create button", () => {
        const { container } = render(
            <KonfirmasiPanel
                locale="id"
                sessionId={null}
                onPlayEvidence={vi.fn()}
            />
        );
        expect(container.firstChild).toBeNull();
        expect(
            screen.queryByRole("button", { name: /buat dokumen|create document/i })
        ).toBeNull();
    });

    it("empty: empty string sessionId renders nothing and no create button", () => {
        const { container } = render(
            <KonfirmasiPanel
                locale="id"
                sessionId=""
                onPlayEvidence={vi.fn()}
            />
        );
        expect(container.firstChild).toBeNull();
        expect(
            screen.queryByRole("button", { name: /buat dokumen|create document/i })
        ).toBeNull();
    });

    it("no GET fetch on mount: assert fetch is never called with ?sessionId= or GET before button press", async () => {
        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-no-mount-fetch"
                onPlayEvidence={vi.fn()}
            />
        );

        // Wait a short tick to confirm no mount effect triggers fetch
        await new Promise((r) => setTimeout(r, 50));
        expect(fetchMock).not.toHaveBeenCalled();

        for (const call of fetchMock.mock.calls) {
            const url = String(call[0]);
            expect(url).not.toContain("?sessionId=");
            const method = (call[1]?.method ?? "GET").toUpperCase();
            expect(method).not.toBe("GET");
        }
    });

    it("created: POST resolves 200 → shows nomor, a 'Lihat dokumen' link pointing at /{locale}/dokumen?doc=<id>, and NO navigation happened", async () => {
        const mockDoc = {
            id: "doc-uuid-created-1",
            nomor: "SL/QTN/2026/0001",
            status: "siap",
            total_nominal: 1250000,
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: mockDoc,
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        const initialHref = window.location.href;
        const pushStateSpy = vi.spyOn(window.history, "pushState");
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-created-test"
                onPlayEvidence={vi.fn()}
            />
        );

        const createButton = screen.getByRole("button", { name: "Buat dokumen" }) as HTMLButtonElement;
        expect(createButton.disabled).toBe(false);

        fireEvent.click(createButton);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "sess-created-test",
                locale: "id",
            }),
        });

        await waitFor(() => {
            const el = screen.getByTestId("document-nomor");
            expect(el.textContent).toContain("SL/QTN/2026/0001");
        });

        expect(screen.getByTestId("document-status").textContent).toContain("siap");
        expect(screen.getByText("Dokumen dibuat")).toBeTruthy();

        const link = screen.getByRole("link", { name: "Lihat dokumen" });
        expect(link.getAttribute("href")).toBe("/id/dokumen?doc=doc-uuid-created-1");

        // Assert NO navigation happened on pressing "Buat dokumen"
        expect(window.location.href).toBe(initialHref);
        expect(pushStateSpy).not.toHaveBeenCalled();
        expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it("error: POST resolves 500 {error: 'store_failure', message: '...'} → visible role='alert' error text; pressing 'Buat dokumen' again re-fires POST (retry works)", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({
                error: "store_failure",
                message: "Failed to access document database",
            }),
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-error-retry"
                onPlayEvidence={vi.fn()}
            />
        );

        const createButton = screen.getByRole("button", { name: "Buat dokumen" });
        fireEvent.click(createButton);

        const alert = await screen.findByRole("alert");
        expect(alert).toBeTruthy();
        expect(alert.textContent).toContain("store_failure");
        expect(alert.textContent).toContain("Failed to access document database");
        expect(alert.textContent).toContain("Gagal membuat dokumen");

        // Now setup mock for retry success
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: "doc-uuid-retry-success",
                    nomor: "SL/QTN/2026/0002",
                    status: "siap",
                    total_nominal: 800000,
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        // Pressing "Buat dokumen" again re-attempts (retry)
        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toContain("SL/QTN/2026/0002");
        });

        expect(screen.queryByRole("alert")).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("network error: fetch throw produces visible role='alert' error text and allows retry", async () => {
        fetchMock.mockRejectedValueOnce(new Error("Connection refused"));

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-network-fail"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        const alert = await screen.findByRole("alert");
        expect(alert).toBeTruthy();
        expect(alert.textContent).toContain("Connection refused");
        expect(alert.textContent).toContain("Gagal membuat dokumen");

        // Button is re-enabled for retry
        const btn = screen.getByRole("button", { name: "Buat dokumen" }) as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it("lock: created response with non-empty butuh_konfirmasi → 'Lihat dokumen' link present, Unduh/Kirim disabled with reason text visible", async () => {
        const mockLockedDoc = {
            id: "doc-uuid-locked-1",
            nomor: "SL/QTN/2026/0003",
            status: "perlu_konfirmasi",
            total_nominal: 2500000,
            butuh_konfirmasi: [
                {
                    field: "pekerjaan[0].volume",
                    alasan: "Volume tidak jelas [40/50] m2",
                    sumber_kutipan: "turn_1",
                },
            ],
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: mockLockedDoc,
                butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                status: "perlu_konfirmasi",
            }),
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-locked-doc"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toContain("SL/QTN/2026/0003");
        });

        // "Lihat dokumen" link present and pointing to the document id
        const link = screen.getByRole("link", { name: "Lihat dokumen" });
        expect(link).toBeTruthy();
        expect(link.getAttribute("href")).toBe("/id/dokumen?doc=doc-uuid-locked-1");

        // Unduh / Kirim controls disabled
        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(true);

        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(true);

        // Reason text visible
        const note = screen.getByRole("note");
        expect(note).toBeTruthy();
        expect(note.textContent).toContain("1 field yang perlu dikonfirmasi sebelum dokumen siap");
    });

    it("unlock: resolving the confirmation card PATCH clears the lock and flips status to siap", async () => {
        const mockLockedDoc = {
            id: "doc-uuid-resolve-flow",
            nomor: "SL/QTN/2026/0004",
            status: "perlu_konfirmasi",
            total_nominal: 1000000,
            butuh_konfirmasi: [
                {
                    field: "pekerjaan[0].volume",
                    alasan: "Volume tidak jelas [10/20] m2",
                    sumber_kutipan: "turn_1",
                },
            ],
        };

        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        document: {
                            ...mockLockedDoc,
                            butuh_konfirmasi: [],
                            status: "siap",
                        },
                        butuh_konfirmasi: [],
                        status: "siap",
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockLockedDoc,
                    butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                    status: "perlu_konfirmasi",
                }),
            };
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-resolve-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
            expect(btnUnduh.disabled).toBe(true);
        });

        // Click one of the parsed options on KonfirmasiCard (e.g. "20")
        const optionBtn = screen.getByRole("button", { name: "20" });
        fireEvent.click(optionBtn);

        // Check PATCH call went to real document.id
        await waitFor(() => {
            const patchCall = fetchMock.mock.calls.find(
                (call) => call[1]?.method === "PATCH"
            );
            expect(patchCall).toBeDefined();
            expect(patchCall?.[0]).toBe("/api/documents/doc-uuid-resolve-flow");
        });

        // When resolved, status flips to siap and buttons are unlocked
        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toContain("siap");
        });
        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(false);

        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(false);

        expect(screen.queryByRole("note")).toBeNull();
    });

    it("handles English locale labels and in-flight loading state", async () => {
        let resolvePromise: (val: unknown) => void;
        const pendingPromise = new Promise((resolve) => {
            resolvePromise = resolve;
        });

        fetchMock.mockReturnValueOnce(pendingPromise);

        render(
            <KonfirmasiPanel
                locale="en"
                sessionId="sess-en-locale"
                onPlayEvidence={vi.fn()}
            />
        );

        const createButton = screen.getByRole("button", { name: "Create document" }) as HTMLButtonElement;
        expect(createButton.disabled).toBe(false);

        fireEvent.click(createButton);

        // In flight: button becomes disabled and shows "Creating…"
        expect(createButton.disabled).toBe(true);
        expect(createButton.textContent).toContain("Creating…");

        // Resolve fetch with 200
        resolvePromise!({
            ok: true,
            status: 200,
            json: async () => ({
                document: {
                    id: "doc-uuid-en-1",
                    nomor: "SL/QTN/2026/0005",
                    status: "siap",
                    total_nominal: 500000,
                },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toContain("SL/QTN/2026/0005");
        });

        expect(screen.getByText("Document created")).toBeTruthy();
        const link = screen.getByRole("link", { name: "View document" });
        expect(link.getAttribute("href")).toBe("/en/dokumen?doc=doc-uuid-en-1");
    });

    it("idempotent create returns 200 with existing document and renders created state seamlessly", async () => {
        const existingDoc = {
            id: "doc-uuid-idempotent",
            nomor: "SL/QTN/2026/0099",
            status: "siap",
            total_nominal: 3000000,
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: existingDoc,
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-idempotent-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toContain("SL/QTN/2026/0099");
        });

        expect(screen.getByTestId("document-status").textContent).toContain("siap");
        const link = screen.getByRole("link", { name: "Lihat dokumen" });
        expect(link.getAttribute("href")).toBe("/id/dokumen?doc=doc-uuid-idempotent");
    });

    it("server-driven lock: PATCH 200 with status 'perlu_konfirmasi' must NOT unlock the panel", async () => {
        const mockLockedDoc = {
            id: "doc-uuid-server-locked",
            nomor: "SL/QTN/2026/0101",
            status: "perlu_konfirmasi",
            total_nominal: 750000,
            butuh_konfirmasi: [
                {
                    field: "pekerjaan[0].volume",
                    alasan: "Volume tidak jelas [10/20] m2",
                    sumber_kutipan: "turn_1",
                },
            ],
        };

        fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
            if (init?.method === "PATCH") {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        document: {
                            ...mockLockedDoc,
                            butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                            status: "perlu_konfirmasi",
                        },
                        butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                        status: "perlu_konfirmasi",
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockLockedDoc,
                    butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                    status: "perlu_konfirmasi",
                }),
            };
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-server-locked-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(
                screen.getByTestId("document-nomor").textContent
            ).toContain("SL/QTN/2026/0101");
        });

        const optionBtn = screen.getByRole("button", { name: "20" });
        fireEvent.click(optionBtn);

        await waitFor(() => {
            const patchCall = fetchMock.mock.calls.find(
                (call) => call[1]?.method === "PATCH"
            );
            expect(patchCall).toBeDefined();
        });

        // Server still reports perlu_konfirmasi → panel must stay locked.
        await waitFor(() => {
            expect(
                screen.getByTestId("document-status").textContent
            ).toContain("perlu_konfirmasi");
        });
        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(true);
        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(true);
        expect(screen.queryByRole("note")).not.toBeNull();
    });

    it("create: 200 with no document.id shows a visible retry error and does not render the created card", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: { nomor: "SL/QTN/2026/0102" },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-no-id-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("Gagal membuat dokumen");
        expect(alert.textContent).toContain("no_document_id");
        expect(alert.textContent).toContain("server mengembalikan 200 tanpa id dokumen");
        expect(screen.queryByTestId("document-nomor")).toBeNull();
        expect(
            screen.queryByRole("link", { name: "Lihat dokumen" })
        ).toBeNull();
    });

    it("create: 200 with no document.id shows the English-locale retry error", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: { nomor: "SL/QTN/2026/0103" },
                butuh_konfirmasi: [],
                status: "siap",
            }),
        });

        render(
            <KonfirmasiPanel
                locale="en"
                sessionId="sess-no-id-en-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Create document" }));

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("Failed to create document");
        expect(alert.textContent).toContain("no_document_id");
        expect(alert.textContent).toContain("server returned 200 without a document id");
        expect(screen.queryByTestId("document-nomor")).toBeNull();
    });
});
