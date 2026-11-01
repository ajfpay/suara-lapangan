import quotationSchema from "@/contracts/quotation.schema.json";
import type { CandidateDocument, Locale, Turn } from "./types";
import { ModelClient, ModelError, parseUsage } from "../model/client";
import { responsesFormat } from "../model/protocols";
import { isRecursiveSchema } from "../model/recursive";

export const META_RESPONSES_URL = "https://api.meta.ai/v1/responses";
export const META_SPARK_MODEL = "muse-spark-1.3";

export class SparkError extends Error {
    readonly code: string;
    readonly status: number;
    readonly body?: string;

    constructor(
        code: string,
        status: number,
        message: string,
        options?: { cause?: unknown; body?: string }
    ) {
        super(message, options);
        this.name = "SparkError";
        this.code = code;
        this.status = status;
        this.body = options?.body;
    }
}

export type CallSparkOptions = {
    turns: Turn[];
    locale: Locale;
    apiKey?: string;
    signal?: AbortSignal;
};

/**
 * Maps a ModelError onto the SparkError codes the document route already
 * understands. The route branches on these codes, so the mapping must cover
 * every failure the client can produce.
 */
function asSparkError(err: unknown): SparkError {
    if (err instanceof ModelError) {
        switch (err.code) {
            case "recursive_schema_rejected":
                return new SparkError("schema_rejected", 400, err.message, {
                    cause: err,
                });
            case "upstream_unreachable":
                return new SparkError("upstream_unreachable", 504, err.message, {
                    cause: err,
                });
            case "upstream_failure":
                // A 400 from Meta means the request (usually the schema) was
                // rejected; that is the route's fallback trigger.
                if (err.status === 400) {
                    return new SparkError("schema_rejected", 400, err.message, {
                        cause: err,
                        body: err.body,
                    });
                }
                if (err.status === 401 || err.status === 403) {
                    return new SparkError("upstream_auth", 502, err.message, {
                        cause: err,
                        body: err.body,
                    });
                }
                if (err.status === 429) {
                    return new SparkError("rate_limited", 429, err.message, {
                        cause: err,
                        body: err.body,
                    });
                }
                return new SparkError(
                    "upstream_failure",
                    502,
                    err.message,
                    { cause: err, body: err.body }
                );
            case "invalid_response":
                return new SparkError("invalid_response", 502, err.message, {
                    cause: err,
                });
            default:
                return new SparkError(
                    "upstream_failure",
                    502,
                    err.message,
                    { cause: err, body: err.body }
                );
        }
    }
    return new SparkError("upstream_failure", 502, "Failed to call model", {
        cause: err,
    });
}

/**
 * Calls Muse Spark 1.3 inline via Meta's Responses API using text.format with quotation schema.
 *
 * This is the client's Responses protocol with the quotation schema baked in.
 * The recursion guard, reasoning validation and cached-token parsing all run
 * in the client, so the behaviour of the route is unchanged.
 */
export async function callMuseSpark({
    turns,
    locale,
    apiKey = process.env.MODEL_API_KEY,
    signal,
}: CallSparkOptions): Promise<CandidateDocument> {
    if (!apiKey) {
        throw new SparkError(
            "not_configured",
            503,
            locale === "id"
                ? "Layanan model belum dikonfigurasi (MODEL_API_KEY tidak ditemukan)."
                : "The model service is not configured (MODEL_API_KEY is missing)."
        );
    }

    const turnsPrompt = turns
        .map(
            (t) =>
                `[${t.turn_id}] (start: ${t.startMs}ms, end: ${t.endMs}ms): "${t.transcript}"`
        )
        .join("\n");

    const developerInstruction =
        locale === "id"
            ? "Anda adalah asisten ekstraksi Surat Penawaran (Quotation) untuk Suara Lapangan. Ekstrak data proyek dan item pekerjaan dari giliran bicara (turns) berikut. Setiap baris pekerjaan WAJIB mencantumkan sumber_kutipan turn_id yang tepat. Format keluaran harus JSON murni sesuai skema."
            : "You are a Quotation extraction assistant for Suara Lapangan. Extract project information and priced work items from the following speech turns. Every work row MUST cite the exact turn_id it came from. The output format must be strict JSON matching the schema.";

    const input = `${developerInstruction}\n\nSpeech Turns:\n${turnsPrompt}`;

    const format = responsesFormat({
        name: "quotation",
        schema: quotationSchema as unknown as import("../model/types").JsonSchema,
        strict: true,
    });

    const client = new ModelClient({
        baseUrl: META_RESPONSES_URL.replace("/v1/responses", "/v1"),
        apiKey,
        model: META_SPARK_MODEL,
        format,
        timeoutMs: 60_000,
    });

    if (isRecursiveSchema(quotationSchema as unknown as import("../model/types").JsonSchema)) {
        throw new SparkError("schema_rejected", 400, "recursive schema rejected", {
            cause: new Error("recursive schema rejected"),
        });
    }

    let result: Awaited<ReturnType<typeof client.responses>>;
    try {
        result = await client.responses({
            model: META_SPARK_MODEL,
            input,
            format,
            signal,
        });
    } catch (cause) {
        throw asSparkError(cause);
    }

    if (!result.text) {
        throw new SparkError(
            "invalid_response",
            502,
            "No output text in Responses API response",
            { cause: new Error("No output text in Responses API response") }
        );
    }

    let candidate: CandidateDocument;
    try {
        candidate = JSON.parse(result.text) as CandidateDocument;
    } catch (cause) {
        throw new SparkError(
            "invalid_response",
            502,
            "Failed to parse structured JSON from model response",
            { cause }
        );
    }
    candidate._spark_path = true;
    return candidate;
}

/**
 * Extract the usage the cost meter needs from a Spark result.
 *
 * Cached tokens are reported at `usage.input_tokens_details.cached_tokens`
 * on the Responses API and at `usage.prompt_tokens_details.cached_tokens` on
 * Chat Completions, so both locations are read. The cost meter counts them
 * distinctly from the total input tokens.
 */
export function sparkUsage(result: { raw?: unknown }): {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
} {
    const usage = parseUsage(result.raw);
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        totalTokens: usage.totalTokens,
    };
}
