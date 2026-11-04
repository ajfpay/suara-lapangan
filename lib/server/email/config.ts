export type SmtpConfig = {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    secure: boolean;
    requireTls: boolean;
};

export function getSmtpConfig(): SmtpConfig | null {
    const host = process.env.SMTP_HOST?.trim();
    const portRaw = process.env.SMTP_PORT?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM?.trim();

    if (!host || !portRaw || !user || !pass || !from) {
        return null;
    }

    if (pass.trim() === "" || pass.trim().length < 8) {
        return null;
    }

    const port = parseInt(portRaw, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
        return null;
    }

    // Port 465 is the implicit-TLS port; only explicit SMTP_SECURE=true
    // elsewhere turns it on.
    const secure =
        process.env.SMTP_SECURE === "true" ||
        process.env.SMTP_SECURE === "1" ||
        port === 465;

    // When not using implicit TLS, the connection must still upgrade via
    // STARTTLS (requireTLS) rather than falling back to plaintext. Set
    // SMTP_REQUIRE_TLS=false only for local test relays that do not support
    // STARTTLS; real relays such as Gmail upgrade by default.
    const requireTls =
        process.env.SMTP_REQUIRE_TLS === "false" ||
        process.env.SMTP_REQUIRE_TLS === "0"
            ? false
            : !secure;

    return {
        host,
        port,
        user,
        pass,
        from,
        secure,
        requireTls,
    };
}
