// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KonfirmasiPanel } from "./KonfirmasiPanel";

describe("KonfirmasiPanel", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(
            () => "blob:http://localhost/mock-blob-uuid"
        );
        URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        cleanup();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
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
            status: "draf",
            total_nominal: 1250000,
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: mockDoc,
                butuh_konfirmasi: [],
                status: "draf",
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

        expect(screen.getByTestId("document-status").textContent).toContain("draf");
        expect(screen.getByText("Dokumen dibuat")).toBeTruthy();

        const link = screen.getByRole("link", { name: "Lihat dokumen" });
        expect(link.getAttribute("href")).toBe("/id/dokumen?doc=doc-uuid-created-1");

        // Approve button present and enabled (draf + no pending items)
        const btnSetujui = screen.getByTestId("btn-setujui") as HTMLButtonElement;
        expect(btnSetujui).toBeTruthy();
        expect(btnSetujui.disabled).toBe(false);

        // Unduh / Kirim controls disabled for drafts
        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(true);
        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(true);
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
                    status: "draf",
                    total_nominal: 800000,
                },
                butuh_konfirmasi: [],
                status: "draf",
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
            status: "draf",
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
                status: "draf",
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

        // btn-setujui present but disabled (draft + items)
        const btnSetujui = screen.getByTestId("btn-setujui") as HTMLButtonElement;
        expect(btnSetujui).toBeTruthy();
        expect(btnSetujui.disabled).toBe(true);

        // Reason text visible
        const note = screen.getByRole("note");
        expect(note).toBeTruthy();
        expect(note.textContent).toContain("1 field yang perlu dikonfirmasi sebelum dokumen disetujui");
    });

    it("unlock: resolving confirmation PATCH keeps buttons disabled until approve; approve unlocks them", async () => {
        const mockLockedDoc = {
            id: "doc-uuid-resolve-flow",
            nomor: "SL/QTN/2026/0004",
            status: "draf",
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
                            status: "draf",
                        },
                        butuh_konfirmasi: [],
                        status: "draf",
                    }),
                };
            }
            if (init?.method === "POST" && url.endsWith("/approve")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        document: {
                            ...mockLockedDoc,
                            butuh_konfirmasi: [],
                            status: "disetujui",
                        },
                        butuh_konfirmasi: [],
                        status: "disetujui",
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockLockedDoc,
                    butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                    status: "draf",
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

        // Setujui button present but disabled (draft + 1 item)
        const btnSetujuiBefore = screen.getByTestId("btn-setujui") as HTMLButtonElement;
        expect(btnSetujuiBefore).toBeTruthy();
        expect(btnSetujuiBefore.disabled).toBe(true);

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

        // When resolved, status is still draf and buttons remain disabled
        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toContain("draf");
        });
        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(true);
        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(true);

        // Setujui button is now enabled (draf + 0 items)
        const btnSetujui = screen.getByTestId("btn-setujui") as HTMLButtonElement;
        expect(btnSetujui.disabled).toBe(false);

        // Click Setujui button
        fireEvent.click(btnSetujui);

        await waitFor(() => {
            const approveCall = fetchMock.mock.calls.find(
                (call) => call[0] === "/api/documents/doc-uuid-resolve-flow/approve"
            );
            expect(approveCall).toBeDefined();
            expect(approveCall?.[1]?.method).toBe("POST");
        });

        // After approval: status is disetujui, buttons enabled, approve button gone, note gone
        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toContain("disetujui");
        });
        expect(btnUnduh.disabled).toBe(false);
        expect(btnKirim.disabled).toBe(false);
        expect(screen.queryByTestId("btn-setujui")).toBeNull();
        expect(screen.queryByRole("note")).toBeNull();
    });

    it("approve: draft with no items can be approved; on 200 flips to disetujui; on 409 shows error", async () => {
        const mockDraftDoc = {
            id: "doc-uuid-approve-flow",
            nomor: "SL/QTN/2026/0077",
            status: "draf",
            total_nominal: 1200000,
        };

        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method === "POST" && url.endsWith("/approve")) {
                return {
                    ok: false,
                    status: 409,
                    json: async () => ({
                        error: "conflict",
                        message: "Document already approved or in invalid state",
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockDraftDoc,
                    butuh_konfirmasi: [],
                    status: "draf",
                }),
            };
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-approve-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toContain("SL/QTN/2026/0077");
        });

        const btnSetujui = screen.getByTestId("btn-setujui") as HTMLButtonElement;
        expect(btnSetujui).toBeTruthy();
        expect(btnSetujui.disabled).toBe(false);

        // Click approve -> 409 returns error
        fireEvent.click(btnSetujui);

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("conflict");
        expect(alert.textContent).toContain("Document already approved or in invalid state");

        // Now mock 200 for retry
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method === "POST" && url.endsWith("/approve")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        document: {
                            ...mockDraftDoc,
                            status: "disetujui",
                        },
                        status: "disetujui",
                        butuh_konfirmasi: [],
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockDraftDoc,
                    butuh_konfirmasi: [],
                    status: "draf",
                }),
            };
        });

        // Click approve again
        fireEvent.click(btnSetujui);

        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toContain("disetujui");
        });

        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(false);
        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(false);
        expect(screen.queryByTestId("btn-setujui")).toBeNull();
    });

    it("download: approved document enables Unduh button; clicking triggers GET /api/pdf/{id} and download anchor", async () => {
        const mockApprovedDoc = {
            id: "doc-uuid-download-flow",
            nomor: "SL/QTN/2026/0088",
            status: "disetujui",
            total_nominal: 1500000,
        };

        fetchMock.mockImplementation(async (url: string) => {
            if (url.startsWith("/api/pdf/")) {
                return new Response("pdf data", {
                    status: 200,
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": 'attachment; filename="SL-QTN-2026-0088.pdf"',
                    },
                });
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockApprovedDoc,
                    butuh_konfirmasi: [],
                    status: "disetujui",
                }),
            };
        });

        let capturedBlobAnchor: HTMLAnchorElement | null = null;
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
            const inDom = document.body.querySelector("a[href^='blob:']") as HTMLAnchorElement | null;
            if (inDom) {
                capturedBlobAnchor = inDom;
            }
        });

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-download-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toContain("disetujui");
        });

        const btnUnduh = screen.getByTestId("btn-unduh") as HTMLButtonElement;
        expect(btnUnduh.disabled).toBe(false);

        fireEvent.click(btnUnduh);

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith("/api/pdf/doc-uuid-download-flow");
            expect(capturedBlobAnchor).toBeTruthy();
        });

        const anchor = capturedBlobAnchor as HTMLAnchorElement | null;
        expect(anchor).not.toBeNull();
        expect(anchor?.href).toContain("blob:");
        expect(anchor?.download).toBe("SL-QTN-2026-0088.pdf");
    });

    it("share: approved document enables Kirim button; clicking opens WhatsApp share URL", async () => {
        const mockApprovedDoc = {
            id: "doc-uuid-share-flow",
            nomor: "SL/QTN/2026/0099",
            status: "disetujui",
            total_nominal: 2000000,
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: mockApprovedDoc,
                butuh_konfirmasi: [],
                status: "disetujui",
            }),
        });

        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

        render(
            <KonfirmasiPanel
                locale="id"
                sessionId="sess-share-test"
                onPlayEvidence={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Buat dokumen" }));

        await waitFor(() => {
            expect(screen.getByTestId("document-status").textContent).toContain("disetujui");
        });

        const btnKirim = screen.getByTestId("btn-kirim") as HTMLButtonElement;
        expect(btnKirim.disabled).toBe(false);

        fireEvent.click(btnKirim);

        expect(openSpy).toHaveBeenCalledWith(
            expect.stringContaining("https://wa.me/?text="),
            "_blank",
            "noopener"
        );
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
                    status: "draf",
                    total_nominal: 500000,
                },
                butuh_konfirmasi: [],
                status: "draf",
            }),
        });

        await waitFor(() => {
            expect(screen.getByTestId("document-nomor").textContent).toContain("SL/QTN/2026/0005");
        });

        expect(screen.getByText("Document created")).toBeTruthy();
        const link = screen.getByRole("link", { name: "View document" });
        expect(link.getAttribute("href")).toBe("/en/dokumen?doc=doc-uuid-en-1");
        expect(screen.getByTestId("document-status").textContent).toContain("draf");
        expect(screen.getByTestId("btn-setujui").textContent).toContain("Approve document");
    });

    it("idempotent create returns 200 with existing document and renders created state seamlessly", async () => {
        const existingDoc = {
            id: "doc-uuid-idempotent",
            nomor: "SL/QTN/2026/0099",
            status: "draf",
            total_nominal: 3000000,
        };

        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({
                document: existingDoc,
                butuh_konfirmasi: [],
                status: "draf",
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

        expect(screen.getByTestId("document-status").textContent).toContain("draf");
        const link = screen.getByRole("link", { name: "Lihat dokumen" });
        expect(link.getAttribute("href")).toBe("/id/dokumen?doc=doc-uuid-idempotent");
    });

    it("server-driven lock: PATCH 200 with status 'draf' and remaining items must NOT unlock the panel", async () => {
        const mockLockedDoc = {
            id: "doc-uuid-server-locked",
            nomor: "SL/QTN/2026/0101",
            status: "draf",
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
                            status: "draf",
                        },
                        butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                        status: "draf",
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    document: mockLockedDoc,
                    butuh_konfirmasi: mockLockedDoc.butuh_konfirmasi,
                    status: "draf",
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
            ).toContain("draf");
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
                status: "draf",
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
                status: "draf",
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
