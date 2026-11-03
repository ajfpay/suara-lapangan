import { readFileSync } from "node:fs";
import path from "node:path";
import type { QuotationDocument } from "@/lib/server/guard/types";
import {
    QUOTATION_LABELS,
    formatDocDate,
    formatMoney,
    type QuotationLocale,
} from "@/app/components/templates/quotation-pdf/QuotationTemplate";
import idMessages from "@/i18n/locales/id.json";
import enMessages from "@/i18n/locales/en.json";

function esc(s: string | number): string {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function draftMarkerFor(locale: QuotationLocale): string {
    const messages = locale === "id" ? idMessages : enMessages;
    const marker = (messages as { dokumen?: { draftMarker?: unknown } }).dokumen
        ?.draftMarker;
    return typeof marker === "string" && marker.length > 0 ? marker : "DRAF";
}

let cachedFontCss: string | null = null;

/**
 * Build `@font-face` declarations for IBM Plex Sans from the bundled
 * `@fontsource` woff2 files, embedded as data URIs so headless Chromium
 * renders typography without falling back to system Arial or DejaVu.
 */
export function bundledFontCss(): string {
    if (cachedFontCss !== null) return cachedFontCss;
    const weights = ["400", "500", "600", "700"];
    const rules = weights.map((weight) => {
        const file = path.join(
            process.cwd(),
            "node_modules",
            "@fontsource",
            "ibm-plex-sans",
            "files",
            `ibm-plex-sans-latin-${weight}-normal.woff2`
        );
        const data = readFileSync(file).toString("base64");
        return `@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    });
    cachedFontCss = rules.join("");
    return cachedFontCss;
}

export function resetBundledFontCssForTesting(): void {
    cachedFontCss = null;
}

/**
 * Render a complete, print-ready HTML document for a quotation. The same
 * function feeds the browser preview route and the headless Chromium PDF
 * renderer, so typography, margins, table layout, and totals match by
 * construction. For drafts (`nomor` null) the document-number field shows
 * the draft marker from the page locale, never a hardcoded literal.
 */
export function renderQuotationHtml(doc: QuotationDocument): string {
    const locale: QuotationLocale = doc.locale === "id" ? "id" : "en";
    const L = QUOTATION_LABELS[locale];
    const docNo = doc.nomor ?? draftMarkerFor(locale);
    const rows = doc.pekerjaan
        .map(
            (p, i) => `<tr><td style="border:1px solid #9ca3af;padding:6px 8px">${i + 1}</td><td style="border:1px solid #9ca3af;padding:6px 8px">${esc(p.uraian)}</td><td style="border:1px solid #9ca3af;padding:6px 8px;text-align:right">${esc(p.volume)}</td><td style="border:1px solid #9ca3af;padding:6px 8px">${esc(p.satuan)}</td><td style="border:1px solid #9ca3af;padding:6px 8px;text-align:right">${esc(formatMoney(p.harga_satuan, locale, doc.mata_uang))}</td><td style="border:1px solid #9ca3af;padding:6px 8px;text-align:right">${esc(formatMoney(p.jumlah, locale, doc.mata_uang))}</td></tr>`
        )
        .join("");
    const terms = L.terms.map((t) => `<li>${esc(t)}</li>`).join("");
    const body = `<div style="font-family:'IBM Plex Sans',Arial,sans-serif;color:#111827;background:#fff;padding:48px 56px;max-width:794px"><header style="border-bottom:3px double #111827;padding-bottom:12px;margin-bottom:20px;text-align:center"><div style="font-size:22px;font-weight:700">SUARA LAPANGAN</div><div style="font-size:11px;color:#4b5563">${locale === "id" ? "Jasa Konstruksi &amp; Renovasi" : "Construction &amp; Renovation Services"}</div></header><div style="text-align:center;margin-bottom:16px"><div style="font-size:18px;font-weight:700;text-transform:uppercase">${esc(L.title)}</div><div style="font-size:12px;color:#4b5563">${esc(L.subtitle)}</div></div><table style="width:100%;font-size:12px;margin-bottom:16px"><tbody><tr><td style="width:130px;color:#4b5563">${esc(L.docNo)}</td><td>: ${esc(docNo)}</td><td style="width:90px;color:#4b5563">${esc(L.date)}</td><td>: ${esc(formatDocDate(doc.tanggal, locale))}</td></tr><tr><td style="color:#4b5563">${esc(L.project)}</td><td>: ${esc(doc.proyek.nama)}</td><td style="color:#4b5563">${esc(L.location)}</td><td>: ${esc(doc.proyek.lokasi)}</td></tr><tr><td style="color:#4b5563">${esc(L.client)}</td><td colspan="3">: ${esc(doc.proyek.klien)}</td></tr></tbody></table><table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px"><thead><tr style="background:#f3f4f6">${[L.colNo, L.colDesc, L.colVol, L.colUnit, L.colPrice, L.colAmount].map((h) => `<th style="border:1px solid #9ca3af;padding:6px 8px;text-align:left">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}<tr><td colspan="5" style="border:1px solid #9ca3af;padding:6px 8px;text-align:right;font-weight:700">${esc(L.total)}</td><td style="border:1px solid #9ca3af;padding:6px 8px;text-align:right;font-weight:700">${esc(formatMoney(doc.total_nominal, locale, doc.mata_uang))}</td></tr></tbody></table><p style="font-size:12px;font-style:italic;margin-bottom:16px">${esc(L.amountInWords)}: ${esc(doc.terbilang)}</p><div style="font-size:12px;margin-bottom:24px"><div style="font-weight:700;margin-bottom:4px">${esc(L.termsTitle)}</div><ol style="margin:0;padding-left:18px">${terms}</ol></div><div style="display:flex;gap:24px;font-size:12px"><div style="flex:1;text-align:center"><div>${esc(L.signLeft)}</div><div style="height:72px"></div><div>____________________</div><div style="color:#6b7280">(${esc(L.nameDate)})</div></div><div style="flex:1;text-align:center;border:1px dashed #9ca3af;padding:8px"><div>${esc(L.stamp)}</div><div style="height:56px"></div></div><div style="flex:1;text-align:center"><div>${esc(L.signRight)}</div><div style="height:72px"></div><div>____________________</div><div style="color:#6b7280">(${esc(L.nameDate)})</div></div></div></div>`;
    return `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"><style>${bundledFontCss()}@page{size:A4;margin:12mm}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0}table{page-break-inside:auto}tr{page-break-inside:avoid}</style></head><body>${body}</body></html>`;
}
