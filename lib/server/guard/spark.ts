import quotationSchema from "@/contracts/quotation.schema.json";
import type { CandidateDocument, Locale, Turn } from "./types";

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
 * Calls Muse Spark 1.3 inline via Meta's Responses API using text.format with quotation schema.
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

    const requestBody = {
        model: META_SPARK_MODEL,
        input,
        text: {
            format: {
                type: "json_schema",
                name: "quotation",
                strict: true,
                schema: quotationSchema,
            },
        },
    };

    let response: Response;
    try {
        response = await fetch(META_RESPONSES_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: signal ?? AbortSignal.timeout(60_000),
        });
    } catch (cause) {
        throw new SparkError(
            "upstream_unreachable",
            504,
            "Failed to connect to Meta Model API",
            { cause }
        );
    }

    const text = await response.text();
    if (!response.ok) {
        if (response.status === 400) {
            throw new SparkError(
                "schema_rejected",
                400,
                "Model API rejected the request schema (HTTP 400)",
                { body: text.slice(0, 200) }
            );
        }
        if (response.status === 401 || response.status === 403) {
            throw new SparkError(
                "upstream_auth",
                502,
                "Model API authentication failed"
            );
        }
        if (response.status === 429) {
            throw new SparkError(
                "rate_limited",
                429,
                "Model API rate limit exceeded"
            );
        }
        const snippet = text.slice(0, 200);
        throw new SparkError(
            "upstream_failure",
            502,
            `Model API returned HTTP ${response.status}`,
            { body: snippet }
        );
    }

    try {
        const data = JSON.parse(text);
        let outputText: string =
            typeof data.output_text === "string" ? data.output_text : "";
        if (!outputText && Array.isArray(data.output)) {
            for (const item of data.output) {
                if (Array.isArray(item.content)) {
                    for (const part of item.content) {
                        if (
                            (part.type === "output_text" || part.type === "text") &&
                            typeof part.text === "string" &&
                            part.text.trim().length > 0
                        ) {
                            outputText = part.text;
                            break;
                        }
                    }
                }
                if (outputText) break;
                if (typeof item.text === "string") {
                    outputText = item.text;
                    break;
                }
            }
        }

        if (!outputText) {
            throw new Error("No output text in Responses API response");
        }

        const candidate = JSON.parse(outputText) as CandidateDocument;
        candidate._spark_path = true;
        return candidate;
    } catch (cause) {
        throw new SparkError(
            "invalid_response",
            502,
            "Failed to parse structured JSON from model response",
            { cause }
        );
    }
}
