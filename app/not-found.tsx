/** Locale-independent 404. Always English: it renders outside the locale. */
export default function NotFound() {
    return (
        <html lang="en">
            <head>
                <title>Page not found | Suara Lapangan</title>
                <meta name="robots" content="noindex" />
            </head>
            <body
                style={{
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                    margin: 0,
                    minHeight: "100dvh",
                    display: "grid",
                    placeItems: "center",
                    background: "#f8f6f2",
                    color: "#0f1722",
                }}
            >
                <main style={{ padding: "2rem", maxWidth: "32rem" }}>
                    <p
                        style={{
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                            color: "#b8330a",
                        }}
                    >
                        404
                    </p>
                    <h1 style={{ fontSize: "2.5rem", margin: "0.5rem 0 0" }}>
                        Page not found
                    </h1>
                    <p style={{ lineHeight: 1.6, color: "#4a4f57" }}>
                        This address is not one of the three steps.
                    </p>
                    <p style={{ marginTop: "1.5rem" }}>
                        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- this page renders outside the Next app tree, so next/link has no router */}
                        <a
                            href="/en"
                            style={{
                                color: "#b8330a",
                                fontWeight: 600,
                                textDecoration: "underline",
                                textUnderlineOffset: "4px",
                            }}
                        >
                            Go to step 1 — Rekam
                        </a>
                    </p>
                </main>
            </body>
        </html>
    );
}
