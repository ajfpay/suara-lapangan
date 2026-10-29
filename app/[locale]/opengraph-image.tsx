import { ImageResponse } from "next/og";

import { getMessages } from "@/i18n/messages";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/variables";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Suara Lapangan — Rekam, Susun, Dokumen";

export function generateStaticParams() {
    return LOCALES.map(({ code }) => ({ locale: code }));
}

/**
 * The social card, generated rather than a hashed build asset: it cannot go
 * stale after a rebuild, and it speaks the language of the page it belongs to.
 */
export default async function OpengraphImage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const messages = (await getMessages(
        LOCALES.some(({ code }) => code === locale) ? locale : DEFAULT_LOCALE
    )) as Record<string, Record<string, string>>;
    const steps = messages.steps ?? {};
    const meta = messages.meta ?? {};

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    background: "#0f1722",
                    color: "#faf8f4",
                    padding: "72px 80px",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            borderRadius: 16,
                            background: "#b8330a",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 34,
                            fontWeight: 700,
                        }}
                    >
                        SL
                    </div>
                    <span style={{ fontSize: 34, fontWeight: 600 }}>
                        {messages.brand?.name ?? "Suara Lapangan"}
                    </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05 }}>
                        {meta.ogTitle ?? ""}
                    </span>
                    <span style={{ fontSize: 30, color: "#c9cdd3" }}>
                        {[steps.rekam, steps.susun, steps.dokumen]
                            .filter(Boolean)
                            .join("  →  ")}
                    </span>
                </div>
            </div>
        ),
        size
    );
}
