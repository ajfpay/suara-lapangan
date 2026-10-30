import React from "react";
import type { QuotationDocument } from "@/lib/server/guard/types";

export const QUOTATION_LABELS = {
    en: {
        title: "Quotation",
        subtitle: "Estimate",
        docNo: "Document No.",
        date: "Date",
        project: "Project",
        location: "Location",
        client: "Client",
        colNo: "No.",
        colDesc: "Description of Works",
        colVol: "Volume",
        colUnit: "Unit",
        colPrice: "Unit Price",
        colAmount: "Amount",
        total: "TOTAL",
        amountInWords: "In words",
        termsTitle: "Payment Terms",
        terms: [
            "50% down payment before work commences.",
            "Balance payable on completion of works.",
            "Prices valid for 30 days from the date above.",
        ],
        signLeft: "Approved by (Client)",
        signRight: "Proposed by (Contractor)",
        stamp: "Stamp",
        nameDate: "Name / Date",
    },
    id: {
        title: "Surat Penawaran",
        subtitle: "Penawaran Harga",
        docNo: "Nomor Dokumen",
        date: "Tanggal",
        project: "Proyek",
        location: "Lokasi",
        client: "Klien",
        colNo: "No.",
        colDesc: "Uraian Pekerjaan",
        colVol: "Volume",
        colUnit: "Satuan",
        colPrice: "Harga Satuan",
        colAmount: "Jumlah",
        total: "TOTAL",
        amountInWords: "Terbilang",
        termsTitle: "Syarat Pembayaran",
        terms: [
            "Uang muka 50% sebelum pekerjaan dimulai.",
            "Pelunasan setelah pekerjaan selesai.",
            "Harga berlaku 30 hari sejak tanggal di atas.",
        ],
        signLeft: "Disetujui (Klien)",
        signRight: "Diajukan oleh (Kontraktor)",
        stamp: "Stempel",
        nameDate: "Nama / Tanggal",
    },
} as const;

export type QuotationLocale = keyof typeof QUOTATION_LABELS;

export function formatMoney(n: number, locale: QuotationLocale, currency: string): string {
    const tag = locale === "id" ? "id-ID" : "en-US";
    return new Intl.NumberFormat(tag, {
        style: "currency",
        currency,
        minimumFractionDigits: currency === "IDR" ? 0 : 2,
        maximumFractionDigits: currency === "IDR" ? 0 : 2,
    }).format(n);
}

export function formatDocDate(iso: string, locale: QuotationLocale): string {
    const tag = locale === "id" ? "id-ID" : "en-US";
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(d);
}

export default function QuotationTemplate({ doc }: { doc: QuotationDocument }) {
    const locale: QuotationLocale = doc.locale === "id" ? "id" : "en";
    const L = QUOTATION_LABELS[locale];
    return (
        <div
            style={{
                fontFamily: "'IBM Plex Sans', Arial, sans-serif",
                color: "#111827",
                background: "#fff",
                padding: "48px 56px",
                maxWidth: "794px",
            }}
        >
            {/* Kop */}
            <header
                style={{
                    borderBottom: "3px double #111827",
                    paddingBottom: 12,
                    marginBottom: 20,
                    textAlign: "center",
                }}
            >
                <div style={{ fontSize: 22, fontWeight: 700 }}>SUARA LAPANGAN</div>
                <div style={{ fontSize: 11, color: "#4b5563" }}>
                    {locale === "id"
                        ? "Jasa Konstruksi & Renovasi"
                        : "Construction & Renovation Services"}
                </div>
            </header>

            <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 700, textTransform: "uppercase" }}>
                    {L.title}
                </div>
                <div style={{ fontSize: 12, color: "#4b5563" }}>{L.subtitle}</div>
            </div>

            {/* Meta: server-provided doc number + date + project */}
            <table style={{ width: "100%", fontSize: 12, marginBottom: 16 }}>
                <tbody>
                    <tr>
                        <td style={{ width: 130, color: "#4b5563" }}>{L.docNo}</td>
                        <td>: {doc.nomor}</td>
                        <td style={{ width: 90, color: "#4b5563" }}>{L.date}</td>
                        <td>: {formatDocDate(doc.tanggal, locale)}</td>
                    </tr>
                    <tr>
                        <td style={{ color: "#4b5563" }}>{L.project}</td>
                        <td>: {doc.proyek.nama}</td>
                        <td style={{ color: "#4b5563" }}>{L.location}</td>
                        <td>: {doc.proyek.lokasi}</td>
                    </tr>
                    <tr>
                        <td style={{ color: "#4b5563" }}>{L.client}</td>
                        <td colSpan={3}>: {doc.proyek.klien}</td>
                    </tr>
                </tbody>
            </table>

            {/* Items table */}
            <table
                style={{
                    width: "100%",
                    fontSize: 12,
                    borderCollapse: "collapse",
                    marginBottom: 12,
                }}
            >
                <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                        {[L.colNo, L.colDesc, L.colVol, L.colUnit, L.colPrice, L.colAmount].map(
                            (h) => (
                                <th
                                    key={h}
                                    style={{
                                        border: "1px solid #9ca3af",
                                        padding: "6px 8px",
                                        textAlign: "left",
                                    }}
                                >
                                    {h}
                                </th>
                            )
                        )}
                    </tr>
                </thead>
                <tbody>
                    {doc.pekerjaan.map((p, i) => (
                        <tr key={i}>
                            <td style={{ border: "1px solid #9ca3af", padding: "6px 8px" }}>
                                {i + 1}
                            </td>
                            <td style={{ border: "1px solid #9ca3af", padding: "6px 8px" }}>
                                {p.uraian}
                            </td>
                            <td
                                style={{
                                    border: "1px solid #9ca3af",
                                    padding: "6px 8px",
                                    textAlign: "right",
                                }}
                            >
                                {p.volume}
                            </td>
                            <td style={{ border: "1px solid #9ca3af", padding: "6px 8px" }}>
                                {p.satuan}
                            </td>
                            <td
                                style={{
                                    border: "1px solid #9ca3af",
                                    padding: "6px 8px",
                                    textAlign: "right",
                                }}
                            >
                                {formatMoney(p.harga_satuan, locale, doc.mata_uang)}
                            </td>
                            <td
                                style={{
                                    border: "1px solid #9ca3af",
                                    padding: "6px 8px",
                                    textAlign: "right",
                                }}
                            >
                                {formatMoney(p.jumlah, locale, doc.mata_uang)}
                            </td>
                        </tr>
                    ))}
                    <tr>
                        <td
                            colSpan={5}
                            style={{
                                border: "1px solid #9ca3af",
                                padding: "6px 8px",
                                textAlign: "right",
                                fontWeight: 700,
                            }}
                        >
                            {L.total}
                        </td>
                        <td
                            style={{
                                border: "1px solid #9ca3af",
                                padding: "6px 8px",
                                textAlign: "right",
                                fontWeight: 700,
                            }}
                        >
                            {formatMoney(doc.total_nominal, locale, doc.mata_uang)}
                        </td>
                    </tr>
                </tbody>
            </table>

            {/* Terbilang / amount in words */}
            <p style={{ fontSize: 12, fontStyle: "italic", marginBottom: 16 }}>
                {L.amountInWords}: {doc.terbilang}
            </p>

            {/* Payment terms */}
            <div style={{ fontSize: 12, marginBottom: 24 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{L.termsTitle}</div>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                    {L.terms.map((t) => (
                        <li key={t}>{t}</li>
                    ))}
                </ol>
            </div>

            {/* Signatures + stamp */}
            <div style={{ display: "flex", gap: 24, fontSize: 12 }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                    <div>{L.signLeft}</div>
                    <div style={{ height: 72 }} />
                    <div>____________________</div>
                    <div style={{ color: "#6b7280" }}>({L.nameDate})</div>
                </div>
                <div
                    style={{
                        flex: 1,
                        textAlign: "center",
                        border: "1px dashed #9ca3af",
                        padding: 8,
                    }}
                >
                    <div>{L.stamp}</div>
                    <div style={{ height: 56 }} />
                </div>
                <div style={{ flex: 1, textAlign: "center" }}>
                    <div>{L.signRight}</div>
                    <div style={{ height: 72 }} />
                    <div>____________________</div>
                    <div style={{ color: "#6b7280" }}>({L.nameDate})</div>
                </div>
            </div>
        </div>
    );
}
