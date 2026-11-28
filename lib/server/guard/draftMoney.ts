import type { QuotationDocument, PekerjaanItem } from "./types";
import { amountInWords, terbilang } from "./words";

export class DraftInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DraftInputError";
    }
}

type Currency = QuotationDocument["mata_uang"];
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function scaled(value: unknown, digits: number, field: string): bigint {
    const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match || (match[2]?.length ?? 0) > digits || raw.length > 32) {
        throw new DraftInputError(`${field}: invalid decimal precision`);
    }
    return BigInt(match[1]) * 10n ** BigInt(digits) + BigInt((match[2] ?? "").padEnd(digits, "0") || "0");
}

export function quantityMillis(value: unknown): bigint {
    const n = scaled(value, 3, "volume");
    if (n <= 0n || n > 1_000_000_000n) throw new DraftInputError("volume must be greater than zero and at most 1000000");
    return n;
}

export function priceMinor(value: unknown, currency: Currency): bigint {
    const n = scaled(value, currency === "USD" ? 2 : 0, "harga_satuan");
    if (n > MAX_SAFE || (currency === "IDR" && n > 1_000_000_000_000n)) {
        throw new DraftInputError("harga_satuan exceeds the supported limit");
    }
    return n;
}

function major(minor: bigint, currency: Currency): number {
    if (minor > MAX_SAFE) throw new DraftInputError("Amount cannot be represented safely");
    const digits = currency === "USD" ? 2 : 0;
    const value = Number(minor) / 10 ** digits;
    if (scaled(value, digits, "amount") !== minor) throw new DraftInputError("Amount cannot be represented safely");
    return value;
}

export function lineMoney(volume: unknown, price: unknown, currency: Currency) {
    const quantity = quantityMillis(volume);
    const minor = price === null || price === undefined ? null : priceMinor(price, currency);
    const amount = minor === null ? null : (quantity * minor + 500n) / 1000n;
    return {
        volume: Number(quantity) / 1000,
        harga_satuan: minor === null ? 0 : major(minor, currency),
        harga_satuan_minor: minor === null ? null : Number(minor),
        jumlah: amount === null ? 0 : major(amount, currency),
        jumlah_minor: amount === null ? null : Number(amount),
    };
}

export function recalculateDraft(document: QuotationDocument): void {
    let total = 0n;
    document.pekerjaan = document.pekerjaan.map((item: PekerjaanItem, index) => {
        const missing = item.harga_satuan_minor === null;
        const amounts = lineMoney(item.volume, missing ? null : item.harga_satuan, document.mata_uang);
        if (amounts.jumlah_minor !== null) total += BigInt(amounts.jumlah_minor);
        if (missing && !document.butuh_konfirmasi.some(c => c.field === `pekerjaan[${index}].harga_satuan`)) {
            document.butuh_konfirmasi.push({ field: `pekerjaan[${index}].harga_satuan`, alasan: "Harga satuan belum diisi", sumber_kutipan: item.sumber_kutipan || null });
        }
        return { ...item, ...amounts };
    });
    document.total_nominal = major(total, document.mata_uang);
    document.total_nominal_minor = Number(total);
    document.terbilang = document.locale === "en" ? amountInWords(document.total_nominal) : terbilang(document.total_nominal);
}
