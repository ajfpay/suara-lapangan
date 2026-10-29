import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callMuseSpark } from "./spark";
import type { Turn } from "./types";

describe("callMuseSpark", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.stubEnv("MODEL_API_KEY", "test-key");
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.unstubAllEnvs();
    });

    const mockTurns: Turn[] = [
        {
            turn_id: "turn_1",
            startMs: 0,
            endMs: 3000,
            transcript: "twenty square feet of drywall for 500 dollars",
            final: true,
        },
    ];

    it("extracts output_text from output[].content[] parts", async () => {
        const candidateDoc = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: "SL/QTN/2026-10-29/001",
            tanggal: "2026-10-29",
            proyek: { nama: "Drywall", lokasi: "Austin", klien: "Bob" },
            pekerjaan: [
                {
                    uraian: "Drywall",
                    volume: 20,
                    satuan: "sq_ft",
                    harga_satuan: 25,
                    jumlah: 500,
                    sumber_kutipan: "turn_1",
                },
            ],
            total_nominal: 500,
            terbilang: "Five hundred US dollars",
            butuh_konfirmasi: [],
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({
                    output: [
                        {
                            content: [
                                {
                                    type: "output_text",
                                    text: JSON.stringify(candidateDoc),
                                },
                            ],
                        },
                    ],
                }),
        });

        const res = await callMuseSpark({
            turns: mockTurns,
            locale: "en",
        });

        expect(res.jenis).toBe("surat_penawaran");
        expect((res.pekerjaan as Array<{ volume: number }>)[0].volume).toBe(20);
    });

    it("extracts output_text at the top level", async () => {
        const candidateDoc = {
            jenis: "surat_penawaran",
            locale: "en",
            mata_uang: "USD",
            nomor: "SL/QTN/2026-10-29/001",
            tanggal: "2026-10-29",
            proyek: { nama: "Drywall", lokasi: "Austin", klien: "Bob" },
            pekerjaan: [],
            total_nominal: 0,
            terbilang: "Zero US dollars",
            butuh_konfirmasi: [],
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({
                    output_text: JSON.stringify(candidateDoc),
                }),
        });

        const res = await callMuseSpark({
            turns: mockTurns,
            locale: "en",
        });

        expect(res.jenis).toBe("surat_penawaran");
    });

    it("throws invalid_response on missing output text", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ output: [] }),
        });

        await expect(
            callMuseSpark({ turns: mockTurns, locale: "en" })
        ).rejects.toMatchObject({
            name: "SparkError",
            code: "invalid_response",
            status: 502,
        });
    });

    it("throws invalid_response on non-JSON response body", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => "Bad gateway raw text",
        });

        await expect(
            callMuseSpark({ turns: mockTurns, locale: "en" })
        ).rejects.toMatchObject({
            name: "SparkError",
            code: "invalid_response",
            status: 502,
        });
    });
});
