/**
 * Build the request body for each of the three wire protocols Meta exposes.
 *
 * One function per protocol. Each returns the exact JSON the server expects,
 * and nothing more: the caller does not need to know which protocol is running.
 * Structured output, reasoning effort, prompt cache and tool definitions are
 * all serialised here, so the client stays protocol-agnostic.
 */
import type {
    ChatOptions,
    ContentPart,
    MessagesOptions,
    ResponsesOptions,
    StructuredFormat,
    ToolDefinition,
} from "./types";

/**
 * Serialize a structured-output format the way the Responses API wants it.
 * `text.format` with `type: "json_schema"` is the only shape that returns
 * `output_text` the client can parse; the server rejects recursive schemas.
 */
export function responsesFormat(format: StructuredFormat) {
    return {
        type: "json_schema",
        name: format.name,
        strict: format.strict ?? true,
        schema: format.schema,
    };
}

/**
 * Serialize a structured-output format the way Chat Completions wants it.
 * `response_format` takes either a JSON-schema object or the
 * `{"type": "json_schema", ...}` envelope. The envelope is the documented
 * Meta shape and is what the cookbook recipes use.
 */
export function chatFormat(format: StructuredFormat) {
    return {
        type: "json_schema",
        name: format.name,
        schema: format.schema,
        strict: format.strict ?? true,
    };
}

/**
 * Serialize a structured-output format the way the Anthropic-shaped Messages
 * API wants it. It takes `{"type": "json_schema", ...}` too.
 */
export function messagesFormat(format: StructuredFormat) {
    return {
        type: "json_schema",
        name: format.name,
        schema: format.schema,
        strict: format.strict ?? true,
    };
}

/**
 * Map tool definitions onto the shape each protocol expects.
 *
 * Responses and Messages use the OpenAI-compatible `function` tool shape;
 * Chat Completions uses the same shape. No protocol-specific mapping is
 * needed — the Meta API is documented as drop-in compatible with OpenAI.
 */
export function normalizeTools(tools: ToolDefinition[] | undefined) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((tool) => ({
        type: tool.type,
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
        },
    }));
}

/**
 * Map a content part onto the shape each protocol expects.
 *
 * Chat Completions uses `image_url` with `{ url: string }`; the Responses API
 * uses `input_image` with a plain string. The server rejects image content in
 * a `developer` message, so the caller must keep images in user content.
 */
export function normalizeContentPart(part: ContentPart): ContentPart {
    if (part.type === "image_url") {
        return { type: "input_image", image_url: part.image_url.url };
    }
    if (part.type === "input_text") {
        return { type: "text", text: part.text };
    }
    return part;
}

/**
 * Build the Chat Completions request body. Every field is a documented Meta
 * option: `messages`, `model`, `response_format`, `tools`, `reasoning_effort`,
 * `prompt_cache_key`, `stream_options` and `max_tokens`.
 */
export function chatBody(options: ChatOptions) {
    const body: Record<string, unknown> = {
        model: options.model,
        messages: options.messages,
    };
    if (options.format) body.response_format = chatFormat(options.format);
    if (options.tools) body.tools = normalizeTools(options.tools);
    if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;
    if (options.promptCacheKey) body.prompt_cache_key = options.promptCacheKey;
    if (options.maxOutputTokens) body.max_tokens = options.maxOutputTokens;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    return body;
}

/**
 * Build the Anthropic-shaped Messages request body. `system` stays at the
 * top level, `messages` carry the conversation, `tools` and
 * `thinking`/`reasoning` follow the documented Meta shape.
 */
export function messagesBody(options: MessagesOptions) {
    const body: Record<string, unknown> = {
        model: options.model,
        messages: options.messages,
    };
    if (options.system) body.system = options.system;
    if (options.format) body.response_format = messagesFormat(options.format);
    if (options.tools) body.tools = normalizeTools(options.tools);
    if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;
    if (options.promptCacheKey) body.prompt_cache_key = options.promptCacheKey;
    if (options.maxOutputTokens) body.max_tokens = options.maxOutputTokens;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    return body;
}

/**
 * Build the Responses API request body. `input`, `model`, `text`, `tools`,
 * `reasoning`, `prompt_cache_key`, `stream` and `include` are the documented
 * options; `previous_response_id` chains turns.
 */
export function responsesBody(options: ResponsesOptions) {
    const body: Record<string, unknown> = {
        model: options.model,
        input:
            typeof options.input === "string"
                ? [{ type: "text", text: options.input }]
                : options.input,
    };
    if (options.format) body.text = { format: responsesFormat(options.format) };
    if (options.tools) body.tools = normalizeTools(options.tools);
    if (options.reasoningEffort) body.reasoning = { effort: options.reasoningEffort };
    if (options.promptCacheKey) body.prompt_cache_key = options.promptCacheKey;
    if (options.maxOutputTokens) body.max_tokens = options.maxOutputTokens;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.previousResponseId) body.previous_response_id = options.previousResponseId;
    if (options.webSearch) {
        body.tools = [
            ...((body.tools as unknown[]) ?? []),
            {
                type: "web_search",
                ...(typeof options.webSearch === "object"
                    ? { search_context_size: options.webSearch.searchContextSize }
                    : {}),
            },
        ];
    }
    return body;
}
