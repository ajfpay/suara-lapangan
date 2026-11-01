/**
 * The Meta Model API client.
 *
 * One module, three protocols — Responses (the conversational API used by
 * Muse Spark and Muse Image), Chat Completions, and the Anthropic-shaped
 * Messages API. Structured output, reasoning effort, prompt caching, token
 * counting, streaming, tool calling, search grounding, images, video and
 * segmentation are all reachable through it, so the app never talks to Meta
 * except here.
 *
 * The client is protocol-agnostic: callers pass options, the client builds
 * the right request. The protocol is chosen by the provider row the caller
 * resolves — `lib/server/providers/` — and never hard-coded in the client.
 */
import type {
    CallOptions,
    ChatOptions,
    ContentPart,
    MessagesOptions,
    ModelResult,
    ReasoningEffort,
    ResponsesOptions,
    StreamDelta,
    ToolCall,
    ToolDefinition,
    Usage,
} from "./types";
import {
    chatBody,
    messagesBody,
    normalizeContentPart,
    responsesBody,
} from "./protocols";
import { validateSchema } from "./recursive";

/** Meta gate: `reasoning_effort` is model-dependent. */
const REASONING_EFFORT_BY_MODEL: Record<string, ReasoningEffort[]> = {
    "muse-spark-1.3": ["minimal", "low", "medium", "high"],
    "muse-spark-1.3-contributor": ["minimal", "low", "medium"],
    "muse-wonder-1.0": ["minimal", "low", "medium", "high", "max"],
    "muse-wonder-1.0-contributor": ["minimal", "low", "medium"],
};

/**
 * The cost meter counts tokens the server reports. Usage is reported at
 * different locations per protocol, so the client normalises it once.
 */
export function parseUsage(raw: unknown): Usage {
    const usage = (raw as Record<string, unknown>) ?? {};
    const details =
        (usage.input_tokens_details as Record<string, unknown>) ??
        (usage.prompt_tokens_details as Record<string, unknown>) ??
        {};
    return {
        inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? 0),
        cachedTokens: Number(details.cached_tokens ?? 0),
        reasoningTokens: Number(
            (
                usage.completion_tokens_details as
                    | Record<string, unknown>
                    | undefined
            )?.reasoning_tokens ??
                (
                    usage.output_tokens_details as
                        | Record<string, unknown>
                        | undefined
                )?.reasoning_tokens ??
                0
        ),
        totalTokens: Number(usage.total_tokens ?? 0),
    };
}

/**
 * The client sends requests and normalises the responses. `baseUrl` defaults
 * to the Meta Model API base URL; `apiKey` is required for every call.
 */
export type ModelClientOptions = {
    baseUrl: string;
    apiKey: string;
    /** Default model when the caller does not specify one. */
    model?: string;
    /** Default reasoning effort when the caller does not specify one. */
    reasoningEffort?: ReasoningEffort;
    /** Default structured-output format when the caller requests one. */
    format?: CallOptions["format"];
    /** Default tools when the caller wants tool calling. */
    tools?: ToolDefinition[];
    /** Timeout in milliseconds for a call that does not stream. */
    timeoutMs?: number;
};

/**
 * Validate the reasoning effort against the model's allowed values.
 * `none` is rejected by Muse Spark and Muse Wonder; `max` is unavailable on
 * the `-contributor` variants.
 */
export function validateReasoningEffort(
    model: string,
    effort: ReasoningEffort | undefined
): ReasoningEffort | undefined {
    if (effort === undefined) return undefined;
    const allowed = REASONING_EFFORT_BY_MODEL[model];
    if (!allowed) return effort;
    if (!allowed.includes(effort)) {
        throw new ModelError(
            "reasoning_effort_not_allowed",
            `Model ${model} does not accept reasoning_effort "${effort}". Allowed: ${allowed.join(", ")}`
        );
    }
    return effort;
}

/**
 * The client's public surface. Every method builds a request, sends it, and
 * returns a normalised result.
 */
export class ModelClient {
    private readonly options: {
        baseUrl: string;
        apiKey: string;
        model: string;
        reasoningEffort?: ReasoningEffort;
        format?: CallOptions["format"];
        tools?: ToolDefinition[];
        timeoutMs: number;
    };

    constructor(options: ModelClientOptions) {
        this.options = {
            baseUrl: options.baseUrl ?? "https://api.meta.ai/v1",
            apiKey: options.apiKey,
            model: options.model ?? "muse-spark-1.3",
            reasoningEffort: options.reasoningEffort,
            format: options.format,
            tools: options.tools,
            timeoutMs: options.timeoutMs ?? 60_000,
        };
    }

    /** The base URL the client posts to, for callers that build their own fetch. */
    get baseUrl(): string {
        return this.options.baseUrl;
    }

    /** The API key the client uses, for callers that build their own fetch. */
    get apiKey(): string {
        return this.options.apiKey;
    }

    /** Send a raw request through the client's error handling. */
    async request(url: string, init: RequestInit): Promise<Response> {
        return this.fetch(url, init);
    }

    /**
     * The Responses protocol — what Muse Spark and Muse Image use.
     * `input` is a string or a list of content parts.
     */
    async responses(options: ResponsesOptions): Promise<ModelResult> {
        const body = responsesBody({
            ...this.options,
            ...options,
            model: options.model ?? this.options.model,
            reasoningEffort:
                options.reasoningEffort ?? this.options.reasoningEffort,
            format: options.format ?? this.options.format,
            tools: options.tools ?? this.options.tools,
        });
        return this.call("responses", body, options);
    }

    /**
     * The Chat Completions protocol. `messages` is a list of role/content
     * pairs, with tool calls and tool results in the conversation.
     */
    async chat(options: ChatOptions): Promise<ModelResult> {
        const body = chatBody({
            ...this.options,
            ...options,
            model: options.model ?? this.options.model,
            reasoningEffort:
                options.reasoningEffort ?? this.options.reasoningEffort,
            format: options.format ?? this.options.format,
            tools: options.tools ?? this.options.tools,
        });
        return this.call("chat", body, options);
    }

    /**
     * The Anthropic-shaped Messages protocol. `system` is a top-level
     * instruction, `messages` is the conversation.
     */
    async messages(options: MessagesOptions): Promise<ModelResult> {
        const body = messagesBody({
            ...this.options,
            ...options,
            model: options.model ?? this.options.model,
            reasoningEffort:
                options.reasoningEffort ?? this.options.reasoningEffort,
            format: options.format ?? this.options.format,
            tools: options.tools ?? this.options.tools,
        });
        return this.call("messages", body, options);
    }

    /**
     * Count the input tokens before a call, so a prompt can be sized.
     *
     * `POST /v1/responses/input_tokens` is the documented Meta endpoint for
     * token counting. It takes the same `input` shape as the Responses API.
     */
    async countInputTokens(
        input: ResponsesOptions["input"],
        model?: string,
        apiKey?: string
    ): Promise<number> {
        const apiKeyUsed = apiKey ?? this.options.apiKey;
        const modelUsed = model ?? this.options.model;
        const response = await this.fetch(
            `${this.options.baseUrl}/responses/input_tokens`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKeyUsed}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ model: modelUsed, input }),
                signal: AbortSignal.timeout(this.options.timeoutMs),
            }
        );
        const text = await response.text();
        if (!response.ok) {
            throw new ModelError(
                "token_counting_failed",
                `Token counting returned HTTP ${response.status}: ${text.slice(0, 200)}`
            );
        }
        try {
            return Number(JSON.parse(text).input_tokens);
        } catch {
            throw new ModelError(
                "token_counting_failed",
                `Token counting returned an unreadable response: ${text.slice(0, 200)}`
            );
        }
    }

    /**
     * Stream a call, yielding incremental deltas as they arrive and a final
     * usage chunk when the server reports it.
     */
    async *streamResponses(
        options: ResponsesOptions
    ): AsyncGenerator<StreamDelta, void, unknown> {
        const body = responsesBody({
            ...this.options,
            ...options,
            model: options.model ?? this.options.model,
            reasoningEffort:
                options.reasoningEffort ?? this.options.reasoningEffort,
            format: options.format ?? this.options.format,
            tools: options.tools ?? this.options.tools,
        });
        yield* this.stream("responses", body);
    }

    async *streamChat(
        options: ChatOptions
    ): AsyncGenerator<StreamDelta, void, unknown> {
        const body = chatBody({
            ...this.options,
            ...options,
            model: options.model ?? this.options.model,
            reasoningEffort:
                options.reasoningEffort ?? this.options.reasoningEffort,
            format: options.format ?? this.options.format,
            tools: options.tools ?? this.options.tools,
        });
        yield* this.stream("chat", body);
    }

    async *streamMessages(
        options: MessagesOptions
    ): AsyncGenerator<StreamDelta, void, unknown> {
        const body = messagesBody({
            ...this.options,
            ...options,
            model: options.model ?? this.options.model,
            reasoningEffort:
                options.reasoningEffort ?? this.options.reasoningEffort,
            format: options.format ?? this.options.format,
            tools: options.tools ?? this.options.tools,
        });
        yield* this.stream("messages", body);
    }

    /**
     * The shared call path. Builds the request, sends it, normalises the
     * result. Every protocol goes through here.
     */
    private async call(
        protocol: string,
        body: Record<string, unknown>,
        options: CallOptions
    ): Promise<ModelResult> {
        const url = `${this.options.baseUrl}/v1/${protocol}`;
        const response = await this.fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.options.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        const text = await response.text();
        if (!response.ok) {
            throw new ModelError(
                "upstream_failure",
                `Model API returned HTTP ${response.status}: ${text.slice(0, 300)}`,
                { status: response.status, body: text.slice(0, 300) }
            );
        }

        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            throw new ModelError(
                "invalid_response",
                `Model API returned non-JSON: ${text.slice(0, 300)}`
            );
        }

        return this.parseResponse(protocol, data, options);
    }

    /**
     * The shared streaming path. Yields `text` deltas as they arrive and a
     * final chunk with `usage` when the stream ends.
     */
    private async *stream(
        protocol: string,
        body: Record<string, unknown>
    ): AsyncGenerator<StreamDelta, void, unknown> {
        const url = `${this.options.baseUrl}/v1/${protocol}`;
        const response = await this.fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.options.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        const text = await response.text();
        if (!response.ok) {
            throw new ModelError(
                "upstream_failure",
                `Model API returned HTTP ${response.status}: ${text.slice(0, 300)}`
            );
        }

        // The server sends a JSON stream. Split on newlines and parse each
        // line as an SSE event; the last line carries usage.
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            let payload: unknown;
            try {
                payload = JSON.parse(trimmed.slice(6));
            } catch {
                continue;
            }
            const delta = this.parseStreamDelta(payload);
            if (delta) yield delta;
        }
    }

    /**
     * Normalise one response into a ModelResult. The three protocols report
     * output at different locations, so the parser tries each.
     */
    private parseResponse(
        protocol: string,
        data: unknown,
        options: CallOptions
    ): ModelResult {
        const result: ModelResult = {
            text: "",
            toolCalls: [],
            citations: [],
            usage: parseUsage((data as Record<string, unknown>)?.usage),
            raw: data,
            responseId: (data as Record<string, unknown>)?.id as
                | string
                | undefined,
        };

        const output = (data as Record<string, unknown>)?.output as
            | unknown[]
            | undefined;
        if (Array.isArray(output)) {
            for (const item of output) {
                if (!item || typeof item !== "object") continue;
                const type = (item as Record<string, unknown>)?.type as
                    | string
                    | undefined;
                // Content arrays appear on `message` items, but a bare item
                // with `content` is also valid; read both.
                const content = (item as Record<string, unknown>)?.content as
                    | unknown[]
                    | undefined;
                if (Array.isArray(content)) {
                    for (const part of content) {
                        if (part && typeof part === "object") {
                            const partType = (part as Record<string, unknown>)
                                ?.type as string | undefined;
                            if (
                                partType === "output_text" ||
                                partType === "text"
                            ) {
                                const text = (part as Record<string, unknown>)
                                    .text as string | undefined;
                                if (
                                    typeof text === "string" &&
                                    text.trim().length > 0
                                ) {
                                    result.text = text;
                                }
                                const annotations = (
                                    part as Record<string, unknown>
                                )?.annotations as unknown[] | undefined;
                                if (Array.isArray(annotations)) {
                                    for (const ann of annotations) {
                                        if (
                                            ann &&
                                            typeof ann === "object" &&
                                            (ann as Record<string, unknown>)
                                                .type === "url_citation"
                                        ) {
                                            const a = ann as Record<
                                                string,
                                                unknown
                                            >;
                                            result.citations.push({
                                                url: String(a.url ?? ""),
                                                title: String(a.title ?? ""),
                                                startIndex: Number(
                                                    a.start_index ?? 0
                                                ),
                                                endIndex: Number(
                                                    a.end_index ?? 0
                                                ),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (type === "tool_calls") {
                    const calls = (item as Record<string, unknown>)
                        ?.tool_calls as unknown[] | undefined;
                    if (Array.isArray(calls)) {
                        for (const call of calls) {
                            if (call && typeof call === "object") {
                                const fn = (call as Record<string, unknown>)
                                    .function as
                                    | Record<string, unknown>
                                    | undefined;
                                result.toolCalls.push({
                                    id: (call as Record<string, unknown>)
                                        .id as string,
                                    type: "function",
                                    function: {
                                        name: (fn?.name as string) ?? "",
                                        arguments:
                                            (fn?.arguments as string) ?? "",
                                    },
                                });
                            }
                        }
                    }
                }
            }
        }

        // Chat Completions reports `choices[0].message.content`.
        const choices = (data as Record<string, unknown>)?.choices as
            | unknown[]
            | undefined;
        if (Array.isArray(choices) && choices.length > 0) {
            const choice = choices[0] as Record<string, unknown>;
            const message = choice?.message as
                | Record<string, unknown>
                | undefined;
            if (message) {
                const content = message.content as string | undefined;
                if (typeof content === "string") result.text += content;
                const toolCalls = message.tool_calls as unknown[] | undefined;
                if (Array.isArray(toolCalls)) {
                    for (const call of toolCalls) {
                        if (call && typeof call === "object") {
                            const fn = (call as Record<string, unknown>)
                                .function as
                                | Record<string, unknown>
                                | undefined;
                            result.toolCalls.push({
                                id: (call as Record<string, unknown>)
                                    .id as string,
                                type: "function",
                                function: {
                                    name: (fn?.name as string) ?? "",
                                    arguments: (fn?.arguments as string) ?? "",
                                },
                            });
                        }
                    }
                }
            }
        }

        // `output_text` is the flat Responses shape.
        const outputText = (data as Record<string, unknown>)?.output_text as
            | string
            | undefined;
        if (typeof outputText === "string") result.text = outputText;

        if (options.format) {
            try {
                result.json = JSON.parse(result.text);
            } catch {
                throw new ModelError(
                    "invalid_response",
                    `Model API returned non-JSON for a structured format: ${result.text.slice(0, 200)}`
                );
            }
        }

        return result;
    }

    /**
     * Normalise one stream event into a delta. Chat Completions sends
     * `content` deltas; the Responses API sends `output_text.delta` events.
     * The last event carries `usage`.
     */
    private parseStreamDelta(payload: unknown): StreamDelta | undefined {
        if (!payload || typeof payload !== "object") return undefined;
        const p = payload as Record<string, unknown>;
        const delta: StreamDelta = { text: "", usage: undefined };

        const usage = p.usage as Record<string, unknown> | undefined;
        if (usage) {
            delta.usage = {
                inputTokens: Number(usage.input_tokens ?? 0),
                outputTokens: Number(usage.output_tokens ?? 0),
                cachedTokens: Number(
                    (
                        usage.input_tokens_details as
                            | Record<string, unknown>
                            | undefined
                    )?.cached_tokens ??
                        (
                            usage.prompt_tokens_details as
                                | Record<string, unknown>
                                | undefined
                        )?.cached_tokens ??
                        0
                ),
                reasoningTokens: Number(
                    (
                        usage.completion_tokens_details as
                            | Record<string, unknown>
                            | undefined
                    )?.reasoning_tokens ?? 0
                ),
                totalTokens: Number(usage.total_tokens ?? 0),
            };
        }

        const choices = p.choices as unknown[] | undefined;
        if (Array.isArray(choices) && choices.length > 0) {
            const choice = choices[0] as Record<string, unknown>;
            const deltaContent = choice?.delta as
                | Record<string, unknown>
                | undefined;
            if (deltaContent) {
                const text = deltaContent.content as string | undefined;
                if (typeof text === "string") delta.text = text;
            }
        }

        const text = p.text as string | undefined;
        if (typeof text === "string") delta.text = text;

        // A delta with no text and no usage is a no-op event.
        if (delta.text === "" && !delta.usage) return undefined;
        return delta;
    }

    /**
     * Fetch with a timeout and a uniform error. The caller never sees raw
     * network failures: they are mapped to ModelError.
     */
    private async fetch(url: string, init: RequestInit): Promise<Response> {
        try {
            return await fetch(url, init);
        } catch (cause) {
            throw new ModelError(
                "upstream_unreachable",
                `Model API connection failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                { cause }
            );
        }
    }
}

/**
 * A failure from the model API. `code` is the app-level error, `status` is
 * the HTTP status when the server reported one, `body` is the raw response.
 */
export class ModelError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly body?: string;
    readonly cause?: unknown;

    constructor(
        code: string,
        message: string,
        options?: { status?: number; body?: string; cause?: unknown }
    ) {
        super(message, options);
        this.name = "ModelError";
        this.code = code;
        this.status = options?.status;
        this.body = options?.body;
        this.cause = options?.cause;
    }
}

/**
 * Validate a structured-output format before the call leaves the client.
 * The Responses API rejects recursive schemas with a 400, so the client
 * refuses to send them.
 */
export function validateFormat(
    format: CallOptions["format"]
): string | undefined {
    if (!format?.schema) return undefined;
    return validateSchema(format);
}

/**
 * Serialize a content part the way the Responses API expects. Images arrive
 * as `input_image` with a data URL; text arrives as `text`.
 */
export function normalizeResponseContentPart(part: ContentPart): ContentPart {
    return normalizeContentPart(part);
}

/**
 * Run the tool-calling loop: the model requests tools, the app executes them,
 * and the results are fed back until the model answers.
 *
 * The loop terminates when the model returns no tool calls, or when the
 * maximum number of turns is reached. Each tool result is a `tool` message
 * with the call id and the result text.
 */
export async function runToolLoop(
    client: ModelClient,
    options: ChatOptions | ResponsesOptions,
    executeTool: (toolCall: ToolCall) => Promise<string>
): Promise<ModelResult> {
    const maxTurns = 10;
    let turns = 0;
    let result: ModelResult | undefined;
    const messages = "messages" in options ? options.messages : undefined;

    while (turns < maxTurns) {
        turns += 1;
        result =
            "messages" in options
                ? await client.chat(options)
                : await client.responses(options);
        if (result.toolCalls.length === 0) break;

        const toolResults = await Promise.all(
            result.toolCalls.map(async (toolCall) => {
                const output = await executeTool(toolCall);
                return {
                    role: "tool" as const,
                    tool_call_id: toolCall.id,
                    content: output,
                };
            })
        );

        if (messages) {
            messages.push(result.raw as never);
            messages.push(...toolResults);
        }
    }

    if (!result) {
        throw new ModelError("no_response", "The model returned no response.");
    }
    return result;
}
