import type { AsrError } from "./errors";

/**
 * The credential lives only in this process and in the header of one outgoing
 * request. Anything logged goes through here first, so a key that reaches a log
 * line by accident is scrubbed rather than shipped to a log collector.
 *
 * Scrubs MODEL_API_KEY value, Authorization header values, Bearer tokens,
 * and tracebacks containing credentials.
 */
export function redactSecrets(text: string): string {
    let scrubbed = text;
    const key = process.env.MODEL_API_KEY;
    if (key && key.length >= 8) {
        scrubbed = scrubbed.split(key).join("[redacted]");
    }
    const smtpPass = process.env.SMTP_PASS;
    // Same guard as MODEL_API_KEY: a very short value (e.g. "a") would match
    // inside ordinary words and corrupt every log line routed through here.
    if (smtpPass && smtpPass.length >= 8) {
        scrubbed = scrubbed.split(smtpPass).join("[redacted]");
    }

    // Scrub Bearer tokens: Bearer <secret>
    scrubbed = scrubbed.replace(
        /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/gi,
        "Bearer [redacted]"
    );

    // Scrub authorization headers in JSON or raw headers
    scrubbed = scrubbed.replace(
        /(["']?authorization["']?\s*:\s*["'])(?:Bearer\s+)?[^"',\s]+(["'])/gi,
        "$1[redacted]$2"
    );

    return scrubbed;
}

/**
 * A failed transcription, with the upstream's own words kept for the operator
 * and the credential removed from all fields including tracebacks.
 * The client never sees this line.
 */
export function logAsrFailure(
    error: AsrError,
    context: { sessionId: string }
): void {
    const entry: Record<string, unknown> = {
        sessionId: context.sessionId,
        code: error.code,
        detail: error.detail,
        metaStatus: error.metaStatus,
        metaBody: error.metaBody,
    };

    if (error.cause instanceof Error) {
        entry.cause = error.cause.message;
        if (error.cause.stack) {
            entry.causeStack = error.cause.stack;
        }
    } else if (error.cause) {
        entry.cause = String(error.cause);
    }

    if (error.stack) {
        entry.stack = error.stack;
    }

    console.error(redactSecrets(`[asr] ${JSON.stringify(entry)}`));
}
