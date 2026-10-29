import type { Locale } from "./locale";

/**
 * Every way a transcription request can fail, and what the client is told.
 *
 * One table, because the three answers that must agree — our HTTP status, the
 * sentence the user reads, and the code the offline queue branches on — are one
 * decision per failure, not three scattered ones.
 */
export type AsrErrorCode =
    | "invalid_request"
    | "too_large"
    | "upstream_rejected"
    | "upstream_auth"
    | "rate_limited"
    | "upstream_failure"
    | "upstream_unreachable"
    | "not_configured"
    | "internal_error";

type Failure = {
    status: number;
    en: string;
    id: string;
};

const FAILURES: Record<AsrErrorCode, Failure> = {
    invalid_request: {
        status: 400,
        en: "The recording could not be read. Record again and try once more.",
        id: "Rekaman tidak bisa dibaca. Rekam ulang lalu coba lagi.",
    },
    too_large: {
        status: 413,
        en: "The recording is larger than the 32 MB limit. Record a shorter clip.",
        id: "Rekaman melebihi batas 32 MB. Rekam lebih pendek.",
    },
    upstream_rejected: {
        status: 400,
        en: "The recording was rejected: it may be longer than 10 minutes or damaged.",
        id: "Rekaman ditolak: mungkin lebih dari 10 menit atau rusak.",
    },
    // Meta refused our credential. That is our misconfiguration, not a failed
    // sign-in, so it must not travel to the browser as a 401.
    upstream_auth: {
        status: 502,
        en: "Transcription is not available right now. Your recording stays on this device.",
        id: "Transkripsi sedang tidak tersedia. Rekaman tetap tersimpan di perangkat ini.",
    },
    rate_limited: {
        status: 429,
        en: "Too many recordings at once. Wait a moment and try again.",
        id: "Terlalu banyak rekaman sekaligus. Tunggu sebentar lalu coba lagi.",
    },
    upstream_failure: {
        status: 502,
        en: "Transcription failed on our side. Try again in a moment.",
        id: "Transkripsi gagal di sisi kami. Coba lagi sebentar lagi.",
    },
    upstream_unreachable: {
        status: 504,
        en: "No connection to the transcription service. Your recording stays on this device.",
        id: "Tidak ada koneksi ke layanan transkripsi. Rekaman tetap tersimpan di perangkat ini.",
    },
    not_configured: {
        status: 500,
        en: "Transcription is not configured on this server.",
        id: "Transkripsi belum dikonfigurasi di server ini.",
    },
    internal_error: {
        status: 500,
        en: "Something went wrong on our side. Try again in a moment.",
        id: "Ada yang salah di sisi kami. Coba lagi sebentar lagi.",
    },
};

export class AsrError extends Error {
    readonly code: AsrErrorCode;
    readonly metaStatus?: number;
    readonly metaBody?: string;
    /** Server-side context for the log. Never sent to the client. */
    readonly detail?: string;

    constructor(
        code: AsrErrorCode,
        options: {
            metaStatus?: number;
            metaBody?: string;
            detail?: string;
            cause?: unknown;
        } = {}
    ) {
        // The message is the code, never upstream text: this error is logged and
        // caught far from where it is thrown.
        super(code, { cause: options.cause });
        this.name = "AsrError";
        this.code = code;
        this.metaStatus = options.metaStatus;
        this.metaBody = options.metaBody;
        this.detail = options.detail;
    }
}

export function upstreamError(status: number, body?: string): AsrError {
    const code: AsrErrorCode =
        status === 400
            ? "upstream_rejected"
            : status === 401 || status === 403
              ? "upstream_auth"
              : status === 413
                ? "too_large"
                : status === 429
                  ? "rate_limited"
                  : "upstream_failure";

    return new AsrError(code, { metaStatus: status, metaBody: body });
}

export function httpStatusFor(code: AsrErrorCode): number {
    return FAILURES[code].status;
}

export function userMessage(code: AsrErrorCode, locale: Locale): string {
    return FAILURES[code][locale];
}
