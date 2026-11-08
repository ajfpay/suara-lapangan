import nodemailer from "nodemailer";
import type { EmailConfig } from "./config";
import { redactSecrets } from "@/lib/server/asr/log";

export type EmailAttachment = {
    filename: string;
    content: Buffer;
    contentType?: string;
};

export type SendEmailOptions = {
    to: string;
    subject: string;
    text: string;
    attachments: EmailAttachment[];
};

/**
 * Gmail API error carrying the API's own error code and status. The route
 * logs it verbatim (redacted) so the exact code survives to the report.
 */
export class GmailApiError extends Error {
    readonly apiStatus: number;
    readonly apiErrorCode: string | number | undefined;
    readonly revoked: boolean;

    constructor(
        message: string,
        apiStatus: number,
        apiErrorCode?: string | number,
        revoked: boolean = false
    ) {
        super(message);
        this.name = "GmailApiError";
        this.apiStatus = apiStatus;
        this.apiErrorCode = apiErrorCode;
        this.revoked = revoked;
    }
}

// --- Gmail API (send-only) ---

export const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL =
    "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media";

type CachedToken = { accessToken: string; expiresAtMs: number };

// Module-scope cache of the access token minted from the refresh token. A
// per-request refresh would waste quota; expiry keeps it bounded.
let gmailTokenCache: CachedToken | null = null;

export function __resetGmailTokenCacheForTest(): void {
    gmailTokenCache = null;
}

function isAbortError(err: unknown): boolean {
    if (err && typeof err === "object") {
        const name = (err as { name?: unknown }).name;
        // Match only the names the platform and undici actually use for a
        // deadline firing; message substrings like "timeout" would relabel
        // unrelated errors as deadline failures.
        if (name === "AbortError" || name === "TimeoutError") {
            return true;
        }
        const message = (err as { message?: unknown }).message;
        if (typeof message === "string" && message.includes("aborted")) {
            return true;
        }
        const cause = (err as { cause?: { name?: unknown; message?: unknown } }).cause;
        if (cause && typeof cause === "object") {
            if (cause.name === "AbortError" || cause.name === "TimeoutError") {
                return true;
            }
            if (
                typeof cause.message === "string" &&
                cause.message.includes("aborted")
            ) {
                return true;
            }
        }
    }
    return false;
}

export async function getGmailAccessToken(config: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}): Promise<string> {
    const now = Date.now();
    if (gmailTokenCache && gmailTokenCache.expiresAtMs > now + 60_000) {
        return gmailTokenCache.accessToken;
    }

    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
    });

    let res: Response;
    try {
        res = await fetch(GMAIL_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            signal: AbortSignal.timeout(10_000),
        });
    } catch (err) {
        if (isAbortError(err)) {
            throw new GmailApiError(
                "Gmail token refresh timed out after 10s",
                408
            );
        }
        throw err;
    }

    if (!res.ok) {
        let detail: string;
        try {
            detail = await res.text();
        } catch (err) {
            if (isAbortError(err)) {
                throw new GmailApiError(
                    "Gmail token refresh timed out after 10s",
                    408
                );
            }
            detail = "";
        }
        let isRevoked = false;
        let errorCode: string | number | undefined;
        try {
            const parsed = JSON.parse(detail) as {
                error?: string | { code?: string | number };
            };
            if (typeof parsed?.error === "string") {
                errorCode = parsed.error;
                if (parsed.error === "invalid_grant") {
                    isRevoked = true;
                }
            } else if (parsed?.error && typeof parsed.error === "object") {
                errorCode = parsed.error.code;
            }
        } catch {
            // non-JSON body: keep the raw text in the message instead
        }
        if (
            !isRevoked &&
            (detail.includes("invalid_grant") ||
                detail.toLowerCase().includes("revoked"))
        ) {
            isRevoked = true;
        }
        if (isRevoked) {
            gmailTokenCache = null;
        }
        throw new GmailApiError(
            `Gmail token refresh failed: HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
            res.status,
            errorCode,
            isRevoked
        );
    }
    const json = (await res.json().catch((err: unknown) => {
        if (isAbortError(err)) {
            throw new GmailApiError(
                "Gmail token refresh timed out after 10s",
                408
            );
        }
        return {};
    })) as {
        access_token?: string;
        expires_in?: number;
    };
    if (!json.access_token) {
        throw new GmailApiError(
            "Gmail token refresh response has no access_token",
            res.status
        );
    }
    gmailTokenCache = {
        accessToken: json.access_token,
        expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
    };
    return gmailTokenCache.accessToken;
}

/**
 * Builds the RFC 822 message (text body + attachments) with nodemailer's
 * stream transport, which composes MIME without any SMTP connection. Only
 * used for the Gmail path; base64url of the result is the `raw` payload.
 */
export function buildMimeMessage(
    from: string | null,
    options: SendEmailOptions
): Promise<Buffer> {
    const composer = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: "unix",
    });
    const mail = {
        // from: null omits the header; Gmail API then fills it in with the
        // authenticated account (the only address this client may send as).
        ...(from ? { from } : {}),
        to: options.to,
        subject: options.subject,
        text: options.text,
        attachments: options.attachments,
    };
    return new Promise<Buffer>((resolve, reject) => {
        composer.sendMail(mail, (err, info) => {
            if (err) return reject(err);
            const message = (
                info as unknown as { message: Buffer | NodeJS.ReadableStream }
            ).message;
            // buffer: true makes nodemailer hand back the composed message
            // as a Buffer; keep the stream branch for older shapes.
            if (Buffer.isBuffer(message)) {
                resolve(message);
                return;
            }
            const chunks: Buffer[] = [];
            message.on("data", (chunk: Buffer) => chunks.push(chunk));
            message.on("end", () => resolve(Buffer.concat(chunks)));
            message.on("error", reject);
        });
    });
}

async function fetchSendWithTimeout(
    accessToken: string,
    raw: Buffer
): Promise<Response> {
    try {
        return await fetch(GMAIL_SEND_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "message/rfc822",
            },
            body: raw,
            signal: AbortSignal.timeout(30_000),
        });
    } catch (err) {
        if (isAbortError(err)) {
            throw new GmailApiError("Gmail send timed out after 30s", 408);
        }
        throw err;
    }
}

export async function sendViaGmailApi(
    config: Extract<EmailConfig, { kind: "gmail" }>,
    options: SendEmailOptions
): Promise<void> {
    let accessToken = await getGmailAccessToken(config);
    const raw = await buildMimeMessage(config.from, options);

    let res = await fetchSendWithTimeout(accessToken, raw);
    if (res.status === 401) {
        gmailTokenCache = null;
        accessToken = await getGmailAccessToken(config);
        res = await fetchSendWithTimeout(accessToken, raw);
        if (res.status === 401) {
            // The freshly acquired token was also rejected: do not let the
            // dead token stay cached until expiry (#50).
            gmailTokenCache = null;
        }
    }

    if (!res.ok) {
        let detail: string;
        try {
            detail = await res.text();
        } catch (err) {
            if (isAbortError(err)) {
                throw new GmailApiError("Gmail send timed out after 30s", 408);
            }
            detail = "";
        }
        let errorCode: string | number | undefined;
        try {
            errorCode = (
                JSON.parse(detail) as { error?: { code?: string | number } }
            ).error?.code;
        } catch {
            // non-JSON body: keep the raw text in the message instead
        }
        throw new GmailApiError(
            `Gmail send failed: HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
            res.status,
            errorCode
        );
    }
}

export function buildDocumentEmail(
    nomor: string,
    locale: "en" | "id"
): {
    subject: string;
    text: string;
    filename: string;
} {
    const isEn = locale === "en";
    const subject = isEn ? `Quotation ${nomor}` : `Surat Penawaran ${nomor}`;
    const text = isEn
        ? `Please find attached quotation ${nomor}.`
        : `Berikut terlampir surat penawaran ${nomor}.`;
    const filename = `${nomor.replaceAll("/", "-")}.pdf`;

    return {
        subject,
        text,
        filename,
    };
}

export async function sendEmail(
    config: EmailConfig,
    options: SendEmailOptions
): Promise<void> {
    try {
        await sendViaGmailApi(config, options);
    } catch (cause) {
        console.error(
            redactSecrets(`[email] delivery failed: ${String(cause)}`)
        );
        throw cause;
    }
}
