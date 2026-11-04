import { createHash } from "node:crypto";

import { AsrError, httpStatusFor, userMessage } from "@/lib/server/asr/errors";
import {
    DEFAULT_ASR_LOCALE,
    parseLocale,
    type Locale,
} from "@/lib/server/asr/locale";
import { logAsrFailure } from "@/lib/server/asr/log";
import { MAX_AUDIO_BYTES, type AsrMode } from "@/lib/server/asr/meta";
import {
    SessionOwnershipError,
    transcribeSession,
} from "@/lib/server/asr/transcribe";
import { withRateLimit } from "@/lib/server/quota/rate-limit";
import {
    QuotaExceededError,
    releaseQuota,
    reserveQuota,
} from "@/lib/server/quota/usage-meter";
import { getSession, isAdmin } from "@/lib/server/auth";
import { getTurnsStore } from "@/lib/server/db/store";

/**
 * Client-generated, so it must not be able to escape a query parameter or a log
 * line, and it must be stable enough to be the idempotency key.
 */
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const VALID_MODES = ["ENDPOINTING", "DIARIZATION"] as const;

type Upload = {
    sessionId: string;
    locale: Locale;
    audio: Uint8Array;
    mode: AsrMode;
};
async function parseUpload(request: Request): Promise<Upload> {
    let form: FormData;
    try {
        form = await request.formData();
    } catch (cause) {
        throw new AsrError("invalid_request", {
            detail: "body is not multipart",
            cause,
        });
    }

    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
        throw new AsrError("invalid_request", {
            detail: "audio part is missing or empty",
        });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
        throw new AsrError("too_large", {
            detail: `audio is ${audio.size} bytes`,
        });
    }

    const sessionId = String(form.get("sessionId") ?? "");
    if (!SESSION_ID.test(sessionId)) {
        throw new AsrError("invalid_request", {
            detail: "sessionId is missing or malformed",
        });
    }

    const locale = parseLocale(form.get("locale"));
    if (!locale) {
        throw new AsrError("invalid_request", {
            detail: "locale is not one of the shipped locales",
        });
    }
    const modeRaw = form.get("mode");
    let mode: AsrMode = "ENDPOINTING";
    if (modeRaw !== null && modeRaw !== undefined && modeRaw !== "") {
        const modeStr = String(modeRaw);
        if (!VALID_MODES.includes(modeStr as AsrMode)) {
            throw new AsrError("invalid_request", {
                detail: `mode must be one of: ${VALID_MODES.join(", ")}`,
            });
        }
        mode = modeStr as AsrMode;
    }

    return {
        sessionId,
        locale,
        audio: new Uint8Array(await audio.arrayBuffer()),
        mode,
    };
}
/**
 * Uploads one recording, answers with the numbered turns Meta found in it.
 *
 * The client is told what it can act on and nothing about what failed inside:
 * the code and sentence come from one table, the upstream's own words stay in
 * the log.
 */
async function handlePost(request: Request): Promise<Response> {
    let sessionId = "";
    let locale: Locale = DEFAULT_ASR_LOCALE;

    try {
        const authSession = await getSession(request);
        if (!authSession) {
            return Response.json(
                {
                    error: {
                        code: "unauthenticated",
                        message: "Authentication required",
                    },
                },
                { status: 401 }
            );
        }

        const upload = await parseUpload(request);
        sessionId = upload.sessionId;
        locale = upload.locale;

        const store = getTurnsStore();
        const admin = isAdmin(authSession);
        // Reserve quota first: a denied caller must never adopt (or create)
        // a session row it cannot use. The reservation is atomic with the
        // cap check, so two concurrent callers cannot both pass on the last
        // remaining quota. The caller's own bucket is reserved, so one
        // heavy user cannot exhaust the shared daily cap for everyone.
        // The estimate is the same one transcribeSession reserves with
        // (bytes / 32000 s per byte at $0.18/h); it is released below when
        // the upload path does not reach transcription.
        const estimatedCost = (upload.audio.byteLength / 32000 / 3600) * 0.18;
        await reserveQuota({
            locale,
            userId: authSession.user.id,
            estCost: estimatedCost,
        });
        const deniedResponse = async (body: unknown, status: number) => {
            await releaseQuota({
                userId: authSession.user.id,
                estCost: estimatedCost,
            });
            return Response.json(body, { status });
        };
        // First-writer-wins claim BEFORE any transcription work: the loser
        // never pays for Meta or quota. The claim atomically inserts a
        // placeholder row when none exists (insert-or-claim keyed on
        // whether our insert landed), so two simultaneous first uploads on
        // an unseen session id converge: the winner proceeds, the loser
        // gets 404 without a paid transcription — even when both callers
        // share the same user id.
        if (store.claimSessionOwner) {
            const audioSha256 = createHash("sha256")
                .update(upload.audio)
                .digest("hex");
            const claim = await store.claimSessionOwner(
                sessionId,
                authSession.user.id,
                admin,
                {
                    locale,
                    audioSha256,
                    audioBytes: upload.audio.byteLength,
                }
            );
            if (claim === "foreign") {
                return deniedResponse(
                    {
                        error: {
                            code: "not_found",
                            message: "Session not found",
                        },
                    },
                    404
                );
            }
            if (claim === "orphan") {
                // Legacy ownerless row — only an admin may adopt it.
                return deniedResponse(
                    {
                        error: {
                            code: "forbidden",
                            message: "Session ownership cannot be proven",
                        },
                    },
                    403
                );
            }
            if (claim === "claimed") {
                const owned = await store.findSession(sessionId);
                if (
                    owned?.userId != null &&
                    owned.userId !== authSession.user.id
                ) {
                    return deniedResponse(
                        {
                            error: {
                                code: "not_found",
                                message: "Session not found",
                            },
                        },
                        404
                    );
                }
            }
        }

        let turns;
        try {
            turns = await transcribeSession({
                ...upload,
                userId: authSession.user.id,
                isAdmin: admin,
            });
        } catch (error) {
            // transcribeSession reserves the same estimate a second time
            // and reconciles it to the actual cost on success, so release
            // this route-level reservation on every path: success reconciles
            // it below, failure must not leave a phantom charge behind.
            await releaseQuota({
                userId: authSession.user.id,
                estCost: estimatedCost,
            });
            throw error;
        }
        // Success: transcribeSession reconciled its own reservation to the
        // actual cost. Release the route-level reservation so it is not
        // double-counted.
        await releaseQuota({
            userId: authSession.user.id,
            estCost: estimatedCost,
        });
        await store.setSessionOwner?.(sessionId, authSession.user.id);

        return Response.json({ sessionId, turns }, { status: 200 });
    } catch (error) {
        if (error instanceof SessionOwnershipError) {
            const code = error.status === 404 ? "not_found" : "forbidden";
            const message =
                error.status === 404
                    ? "Session not found"
                    : "Session ownership cannot be proven";
            return Response.json(
                { error: { code, message } },
                { status: error.status }
            );
        }
        if (error instanceof QuotaExceededError) {
            logAsrFailure(
                new AsrError("rate_limited", { detail: error.message }),
                { sessionId }
            );

            return Response.json(
                {
                    error: {
                        code: "quota_exceeded",
                        message: error.message,
                    },
                },
                {
                    status: 429,
                    headers: {
                        "X-Quota-Hard-Stop": "true",
                    },
                }
            );
        }

        const failure =
            error instanceof AsrError
                ? error
                : new AsrError("internal_error", { cause: error });
        logAsrFailure(failure, { sessionId });
        return Response.json(
            {
                error: {
                    code: failure.code,
                    message: userMessage(failure.code, locale),
                },
            },
            { status: httpStatusFor(failure.code) }
        );
    }
}

export const POST = withRateLimit(handlePost, {
    route: "/api/asr/transcribe",
});
