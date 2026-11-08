import { redactSecrets } from "@/lib/server/asr/log";

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

export type EmailConfig = GmailConfig;

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
    const clientSecret = nonEmpty(process.env.GMAIL_CLIENT_SECRET);
    const refreshToken = nonEmpty(process.env.GMAIL_REFRESH_TOKEN);
    // Optional: gmail.send cannot read users.getProfile, so when GMAIL_FROM is
    // unset the MIME message omits the From header and the API fills it with
    // the authenticated account (handoff requirement: From must match that
    // account; a guessed address would make Gmail rewrite or reject it).
    const from = nonEmpty(process.env.GMAIL_FROM);

    const missing: string[] = [];
    if (!clientId) missing.push("GMAIL_CLIENT_ID");
    if (!clientSecret) missing.push("GMAIL_CLIENT_SECRET");
    if (!refreshToken) missing.push("GMAIL_REFRESH_TOKEN");

    if (missing.length === 3) {
        return null;
    }

    if (missing.length > 0) {
        console.warn(
            redactSecrets(
                `[email] Gmail configuration is partial and cannot be used; missing: ${missing.join(", ")}`
            )
        );
        return null;
    }

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
 * Unified entry point for mail senders: the Gmail API path from GMAIL_*.
 * Returns null when GMAIL_* is not fully configured (callers answer 503
 * email_not_configured).
 */
export function getEmailConfig(): EmailConfig | null {
    return getGmailConfig();
}
