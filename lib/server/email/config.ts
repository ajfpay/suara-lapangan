export type SmtpConfig = {
    kind: "smtp";
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    secure: boolean;
    requireTls: boolean;
};

/**
 * Gmail API (send-only) configuration. The OAuth client is the gmail-send
 * client; the refresh token is for the gmail.send scope only and must never
 * carry a read/modify scope. Credentials come from environment variables only.
 */
export type GmailConfig = {
    kind: "gmail";
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    /** Optional: null omits the From header so Gmail sets the authenticated account. */
    from: string | null;
};

export type EmailConfig = SmtpConfig | GmailConfig;

function nonEmpty(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/**
 * Gmail credentials from GMAIL_* env vars. Kept deliberately separate from
 * GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, which belong to the login client.
 */
export function getGmailConfig(): GmailConfig | null {
    const clientId = nonEmpty(process.env.GMAIL_CLIENT_ID);
    const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
    // Optional: gmail.send cannot read users.getProfile, so when GMAIL_FROM is
    // unset the MIME message omits the From header and the API fills it with
    // the authenticated account (handoff requirement: From must match that
    // account; a guessed address would make Gmail rewrite or reject it).
    const from = nonEmpty(process.env.GMAIL_FROM);

    if (!clientId || !clientSecret || !refreshToken) {
        return null;
    }

    return {
        kind: "gmail",
        clientId,
        clientSecret,
        refreshToken,
        from: from ?? null,
    };
}

/**
 * Unified entry point for mail senders: Gmail API when GMAIL_* is configured,
 * otherwise the classic SMTP path from SMTP_*. Returns null when neither is
 * configured (callers answer 503 email_not_configured).
 */
export function getEmailConfig(): EmailConfig | null {
    return getGmailConfig() ?? getSmtpConfig();
}

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
    // STARTTLS (e.g. Mailpit).
    const requireTls =
        process.env.SMTP_REQUIRE_TLS === "false" ||
        process.env.SMTP_REQUIRE_TLS === "0"
            ? false
            : !secure;

    return {
        kind: "smtp",
        host,
        port,
        user,
        pass,
        from,
        secure,
        requireTls,
    };
}
