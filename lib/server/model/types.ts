/**
 * The Meta Model API surface this app depends on, as types.
 *
 * Three protocols share one vocabulary here so the rest of the app never
 * branches on which wire shape is in play. The protocol-specific request
 * builders live in `protocols.ts`; this file only describes what a caller
 * hands in and what comes back.
 */

/** The three wire protocols Meta exposes. */
export type Protocol = "responses" | "chat" | "messages";

/** Reasoning effort values Meta accepts. `none` and `max` are model-gated. */
export type ReasoningEffort =
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "max"
    | "none";

/** A JSON Schema object, as accepted by `text.format` / `response_format`. */
export type JsonSchema = {
    type?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
};

/** Structured-output request: a named schema plus the strictness flag. */
export type StructuredFormat = {
    name: string;
    schema: JsonSchema;
    strict?: boolean;
};

/** A single chat-style message. Content may be a string or content parts. */
export type Message = {
    role: "system" | "developer" | "user" | "assistant" | "tool";
    content: string | ContentPart[];
    tool_call_id?: string;
    tool_calls?: ToolCall[];
};

/** Content parts shared by Chat Completions and the Responses API. */
export type ContentPart =
    | { type: "text"; text: string }
    | { type: "input_text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
    | { type: "input_image"; image_url: string };

/** A function tool definition, in the OpenAI-compatible shape Meta accepts. */
export type ToolDefinition = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: JsonSchema;
    };
};

/** A tool call the model wants executed. */
export type ToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

/** Token usage, normalised across protocols. */
export type Usage = {
    inputTokens: number;
    outputTokens: number;
    /** Prefix tokens served from the prompt cache, 0 when the server reports none. */
    cachedTokens: number;
    reasoningTokens: number;
    totalTokens: number;
};

/** A citation the model attached to a span of its answer. */
export type UrlCitation = {
    url: string;
    title: string;
    startIndex: number;
    endIndex: number;
};

/** One completed model turn, normalised. */
export type ModelResult = {
    text: string;
    /** Parsed JSON when a structured format was requested, else undefined. */
    json?: unknown;
    toolCalls: ToolCall[];
    citations: UrlCitation[];
    usage: Usage;
    /** The provider response id, for chaining with `previousResponseId`. */
    responseId?: string;
    /** Raw provider payload, for callers that need a field this type omits. */
    raw: unknown;
};

/** One streamed delta: text plus, on the final chunk, usage. */
export type StreamDelta = {
    text: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cachedTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };
};

/** Options every protocol accepts. */
export type CallOptions = {
    model: string;
    /** Overrides the client's key; the client's key is used when omitted. */
    apiKey?: string;
    baseUrl?: string;
    signal?: AbortSignal;
    /** Reasoning effort; validated against the model's allowed values. */
    reasoningEffort?: ReasoningEffort;
    /** Structured output schema; serialised per protocol. */
    format?: StructuredFormat;
    /** Tools the model may call. */
    tools?: ToolDefinition[];
    /** Prompt-cache key, so repeat prefixes hit the cache deterministically. */
    promptCacheKey?: string;
    /** Maximum output tokens, when the caller wants a ceiling. */
    maxOutputTokens?: number;
    /** Temperature, passed through verbatim. */
    temperature?: number;
};

/** Options for the Responses protocol specifically. */
export type ResponsesOptions = CallOptions & {
    /** A string or a list of content parts (input_text, input_image, ...). */
    input: string | ContentPart[];
    /** Chain onto a prior response so the server carries conversation state. */
    previousResponseId?: string;
    /** Enable web search grounding. */
    webSearch?: boolean | { searchContextSize?: "low" | "medium" | "high" };
};

/** Options for the Chat Completions protocol. */
export type ChatOptions = CallOptions & {
    messages: Message[];
};

/** Options for the Anthropic-shaped Messages protocol. */
export type MessagesOptions = CallOptions & {
    messages: Message[];
    system?: string;
    maxTokens?: number;
};
