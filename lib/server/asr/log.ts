import type { AsrError } from "./errors";

/**
 * The credential lives only in this process and in the header of one outgoing
 * request. Anything logged goes through here first, so a key that reaches a log
 * line by accident is scrubbed rather than shipped to a log collector.
 */
export function redactSecrets(text: string): string {
    const key = process.env.MODEL_API_KEY;
    return key && key.length >= 8 ? text.split(key).join("[redacted]") : text;
}

/**
 * A failed transcription, with the upstream's own words kept for the operator
 * and the credential removed. The client never sees this line.
 */
export function logAsrFailure(
    error: AsrError,
    context: { sessionId: string }
): void {
    const entry = {
        sessionId: context.sessionId,
        code: error.code,
        detail: error.detail,
        metaStatus: error.metaStatus,
        metaBody: error.metaBody,
    };

    console.error(redactSecrets(`[asr] ${JSON.stringify(entry)}`));
}
