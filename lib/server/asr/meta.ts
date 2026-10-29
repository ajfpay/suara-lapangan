import { AsrError, upstreamError } from "./errors";
import type { Locale } from "./locale";
import type { MetaTranscription } from "./turns";

/**
 * The one-shot transcription endpoint. `ENDPOINTING` is the mode where the
 * model decides where one turn of speech ends and the next begins — the client
 * never cuts audio, so every quoted range is a boundary Meta chose.
 */
export const META_TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe";
export const META_ASR_MODEL = "muse-voice-transcribe-1.0";

/** Meta caps one request at 10 minutes of audio or 32 MB, whichever comes first. */
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

const LANGUAGE_BIAS: Record<Locale, string[]> = {
    en: ["English"],
    id: ["Indonesian"],
};

/**
 * Site jargon the model would otherwise mis-hear. This biases recognition, it
 * does not constrain it, so a wrong word here costs nothing but a missed hint.
 */
const KEYWORDS: Record<Locale, string[]> = {
    en: ["drywall", "rebar", "sq ft", "lin ft", "bags", "bars"],
    id: ["cakar ayam", "sak", "batang", "titik", "m2", "borongan"],
};

// The verified client waits 300 s: a 10-minute recording takes a while to decode.
const TIMEOUT_MS = 300_000;

export type TranscribeOptions = {
    audio: Uint8Array;
    locale: Locale;
    sessionId: string;
    apiKey: string;
};

export async function transcribeWithMeta({
    audio,
    locale,
    sessionId,
    apiKey,
}: TranscribeOptions): Promise<MetaTranscription> {
    const body = new FormData();
    body.set(
        "request",
        new Blob(
            [
                JSON.stringify({
                    mode: "ENDPOINTING",
                    model: META_ASR_MODEL,
                    audioEncoding: "WAV",
                    languageBias: LANGUAGE_BIAS[locale],
                    keywords: KEYWORDS[locale],
                }),
            ],
            { type: "application/json" }
        )
    );
    body.set(
        "audio",
        new File([audio], "recording.wav", { type: "audio/wav" })
    );

    let response: Response;
    try {
        response = await fetch(
            `${META_TRANSCRIBE_URL}?sessionId=${encodeURIComponent(sessionId)}`,
            {
                method: "POST",
                // No content type: fetch must add the multipart boundary itself.
                headers: { Authorization: `Bearer ${apiKey}` },
                body,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            }
        );
    } catch (cause) {
        throw new AsrError("upstream_unreachable", { cause });
    }

    const text = await response.text();
    if (!response.ok) throw upstreamError(response.status, text.slice(0, 300));

    try {
        return JSON.parse(text) as MetaTranscription;
    } catch (cause) {
        throw new AsrError("upstream_failure", {
            metaStatus: response.status,
            metaBody: text.slice(0, 300),
            cause,
        });
    }
}
