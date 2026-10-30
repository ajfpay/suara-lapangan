import type { Locale } from "@/lib/server/asr/locale";
import type { Turn } from "@/lib/server/asr/turns";

export type { Locale, Turn };

export type CanonicalUnit =
    | "m2"
    | "m3"
    | "meter"
    | "sq_ft"
    | "lin_ft"
    | "sak"
    | "batang"
    | "titik"
    | "bag"
    | "sheet"
    | "bar"
    | "point"
    | "hour"
    | "unit"
    | "hari"
    | "fixture";

export type Proyek = {
    nama: string;
    lokasi: string;
    klien: string;
};

export type PekerjaanItem = {
    uraian: string;
    volume: number;
    satuan: CanonicalUnit;
    harga_satuan: number;
    jumlah: number;
    sumber_kutipan: string;
};

export type ButuhKonfirmasiItem = {
    field: string;
    alasan: string;
    sumber_kutipan: string | null;
};

export type QuotationDocument = {
    jenis: "surat_penawaran";
    locale: Locale;
    mata_uang: "USD" | "IDR";
    nomor: string;
    tanggal: string;
    proyek: Proyek;
    pekerjaan: PekerjaanItem[];
    total_nominal: number;
    terbilang: string;
    butuh_konfirmasi: ButuhKonfirmasiItem[];
};

export type DocumentStatus = "siap" | "perlu_konfirmasi";

export type DocumentResult = {
    document: QuotationDocument;
    butuh_konfirmasi: ButuhKonfirmasiItem[];
    status: DocumentStatus;
};

export type CandidatePekerjaanItem = {
    uraian?: unknown;
    volume?: unknown;
    satuan?: unknown;
    harga_satuan?: unknown;
    jumlah?: unknown;
    sumber_kutipan?: unknown;
};

export type CandidateDocument = {
    jenis?: unknown;
    locale?: unknown;
    mata_uang?: unknown;
    nomor?: unknown;
    tanggal?: unknown;
    proyek?: unknown;
    pekerjaan?: unknown;
    total_nominal?: unknown;
    terbilang?: unknown;
    butuh_konfirmasi?: unknown;
};
