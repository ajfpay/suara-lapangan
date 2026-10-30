import { NextResponse } from "next/server";
import { renderQuotationHtml } from "@/lib/server/pdf/renderQuotation";
import { getDocumentStore } from "@/lib/server/guard/documentStore";
import { createHash } from "node:crypto";

type RouteContext = {
    params: Promise<{ id: string }>;
};

// Identical-content cache: key = document nomor + content hash.
const pdfCache = new Map<string, { hash: string; pdf: Buffer }>();

function hashDoc(doc: unknown): string {
    return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

function shell(html: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}body{margin:0}table{page-break-inside:auto}tr{page-break-inside:avoid}</style></head><body>${html}</body></html>`;
}

async function renderPdf(html: string): Promise<Buffer> {
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
        executablePath:
            process.env.CHROME_PATH ??
            "/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(shell(html), { waitUntil: "load" });
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
    const { id } = await context.params;
    if (!id || id.trim() === "") {
        return NextResponse.json(
            { error: "not_found", message: "Document id is required" },
            { status: 404 }
        );
    }
    const doc = getDocumentStore().get(id);
    if (!doc) {
        return NextResponse.json(
            { error: "not_found", message: `Document '${id}' not found` },
            { status: 404 }
        );
    }
    if (doc.butuh_konfirmasi.length > 0) {
        return NextResponse.json(
            {
                error: "needs_confirmation",
                message:
                    "Document requires confirmation before PDF can be generated. Resolve butuh_konfirmasi via PATCH /api/documents/{id} first.",
            },
            { status: 409 }
        );
    }
    const hash = hashDoc(doc);
    const cached = pdfCache.get(doc.nomor);
    if (cached && cached.hash === hash) {
        return new Response(new Uint8Array(cached.pdf), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${doc.nomor.replaceAll("/", "-")}.pdf"`,
                "X-PDF-Cache": "HIT",
            },
        });
    }
    const html = renderQuotationHtml(doc);
    let pdf: Buffer;
    try {
        pdf = await renderPdf(html);
    } catch {
        return NextResponse.json(
            { error: "pdf_failure", message: "Failed to render PDF" },
            { status: 500 }
        );
    }
    pdfCache.set(doc.nomor, { hash, pdf });
    return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${doc.nomor.replaceAll("/", "-")}.pdf"`,
            "X-PDF-Cache": "MISS",
        },
    });
}
