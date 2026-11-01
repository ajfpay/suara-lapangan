import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ModelClient,
    ModelError,
    parseUsage,
    runToolLoop,
    validateReasoningEffort,
} from "./client";
import { isRecursiveSchema } from "./recursive";
import {
    chatBody,
    messagesBody,
    responsesBody,
    responsesFormat,
} from "./protocols";

const BASE = "https://api.meta.ai/v1";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("parseUsage", () => {
    it("reads cached tokens from input_tokens_details (Responses)", () => {
        const usage = parseUsage({
            input_tokens: 100,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 60 },
            total_tokens: 120,
        });
        expect(usage.cachedTokens).toBe(60);
        expect(usage.inputTokens).toBe(100);
        expect(usage.totalTokens).toBe(120);
    });

    it("reads cached tokens from prompt_tokens_details (Chat Completions)", () => {
        const usage = parseUsage({
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 40 },
            total_tokens: 120,
        });
        expect(usage.cachedTokens).toBe(40);
        expect(usage.inputTokens).toBe(100);
    });

    it("reads reasoning tokens from completion_tokens_details", () => {
        const usage = parseUsage({
            completion_tokens_details: { reasoning_tokens: 15 },
        });
        expect(usage.reasoningTokens).toBe(15);
    });

    it("returns zeroes when no usage is present", () => {
        expect(parseUsage(undefined)).toEqual({
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
        });
    });
});

describe("validateReasoningEffort", () => {
    it("accepts an allowed effort", () => {
        expect(validateReasoningEffort("muse-spark-1.3", "high")).toBe("high");
    });

    it("rejects none on Muse Spark and Muse Wonder", () => {
        expect(() =>
            validateReasoningEffort("muse-spark-1.3", "none")
        ).toThrow(ModelError);
        expect(() =>
            validateReasoningEffort("muse-wonder-1.0", "none")
        ).toThrow(ModelError);
    });

    it("rejects max on contributor variants", () => {
        expect(() =>
            validateReasoningEffort("muse-spark-1.3-contributor", "max")
        ).toThrow(ModelError);
    });

    it("returns undefined when effort is undefined", () => {
        expect(validateReasoningEffort("muse-spark-1.3", undefined)).toBeUndefined();
    });
});

describe("isRecursiveSchema", () => {
    it("rejects a schema that references itself through a property", () => {
        const schema = {
            type: "object",
            properties: {
                child: {
                    type: "object",
                    properties: {
                        parent: { $ref: "#" },
                    },
                },
            },
        };
        expect(isRecursiveSchema(schema)).toBe(true);
    });

    it("rejects a schema that references itself through items", () => {
        const schema = {
            type: "array",
            items: { $ref: "#" },
        };
        expect(isRecursiveSchema(schema)).toBe(true);
    });

    it("accepts a flat schema", () => {
        const schema = {
            type: "object",
            properties: {
                name: { type: "string" },
                price: { type: "number" },
            },
            required: ["name", "price"],
        };
        expect(isRecursiveSchema(schema)).toBe(false);
    });
});

describe("responsesFormat", () => {
    it("serialises text.format with the schema envelope", () => {
        const format = responsesFormat({
            name: "quotation",
            schema: { type: "object" },
        });
        expect(format).toEqual({
            type: "json_schema",
            name: "quotation",
            strict: true,
            schema: { type: "object" },
        });
    });
});

describe("responsesBody", () => {
    it("builds the Responses request with text.format and reasoning.effort", () => {
        const body = responsesBody({
            model: "muse-spark-1.3",
            input: "hello",
            apiKey: "k",
            format: {
                name: "quotation",
                schema: { type: "object" },
            },
            reasoningEffort: "high",
        });
        expect(body.model).toBe("muse-spark-1.3");
        expect(body.input).toEqual([{ type: "text", text: "hello" }]);
        expect(body.text).toEqual({
            format: {
                type: "json_schema",
                name: "quotation",
                strict: true,
                schema: { type: "object" },
            },
        });
        expect(body.reasoning).toEqual({ effort: "high" });
    });

    it("adds a web_search tool when grounding is requested", () => {
        const body = responsesBody({
            model: "muse-spark-1.3",
            input: "what is the capital of France?",
            apiKey: "k",
            webSearch: { searchContextSize: "high" },
        });
        expect(body.tools).toContainEqual({
            type: "web_search",
            search_context_size: "high",
        });
    });

    it("chains turns with previous_response_id", () => {
        const body = responsesBody({
            model: "muse-spark-1.3",
            input: "why?",
            apiKey: "k",
            previousResponseId: "resp_123",
        });
        expect(body.previous_response_id).toBe("resp_123");
    });
});

describe("chatBody", () => {
    it("builds the Chat Completions request with response_format and reasoning_effort", () => {
        const body = chatBody({
            model: "muse-spark-1.3",
            messages: [{ role: "user", content: "hi" }],
            apiKey: "k",
            format: { name: "product", schema: { type: "object" } },
            reasoningEffort: "low",
        });
        expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
        expect(body.response_format).toEqual({
            type: "json_schema",
            name: "product",
            schema: { type: "object" },
            strict: true,
        });
        expect(body.reasoning_effort).toBe("low");
    });

    it("passes prompt_cache_key through", () => {
        const body = chatBody({
            model: "muse-spark-1.3",
            messages: [{ role: "user", content: "hi" }],
            apiKey: "k",
            promptCacheKey: "acme-support",
        });
        expect(body.prompt_cache_key).toBe("acme-support");
    });
});

describe("messagesBody", () => {
    it("builds the Messages request with system at the top level", () => {
        const body = messagesBody({
            model: "muse-spark-1.3",
            messages: [{ role: "user", content: "hi" }],
            apiKey: "k",
            system: "Be terse.",
        });
        expect(body.system).toBe("Be terse.");
        expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    });
});

describe("ModelClient", () => {
    const originalFetch = global.fetch;
    const client = new ModelClient({
        baseUrl: BASE,
        apiKey: "test-key",
    });

    beforeEach(() => {
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("posts to the Responses endpoint and normalises output_text", async () => {
        const mock = vi.fn().mockResolvedValue(
            jsonResponse({
                output_text: '{"ok":true}',
                usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    input_tokens_details: { cached_tokens: 8 },
                    total_tokens: 15,
                },
            })
        );
        global.fetch = mock as unknown as typeof fetch;

        const result = await client.responses({
            model: "muse-spark-1.3",
            input: "extract",
            format: { name: "quotation", schema: { type: "object" } },
        });

        expect(mock).toHaveBeenCalledTimes(1);
        const [url, init] = mock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${BASE}/v1/responses`);
        expect((init.headers as Record<string, string>).Authorization).toBe(
            "Bearer test-key"
        );
        expect(result.json).toEqual({ ok: true });
        expect(result.usage.cachedTokens).toBe(8);
    });

    it("parses Chat Completions choices[0].message.content", async () => {
        global.fetch = vi.fn().mockResolvedValue(
            jsonResponse({
                choices: [
                    {
                        message: { content: "hello world" },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 5,
                    completion_tokens: 3,
                    prompt_tokens_details: { cached_tokens: 2 },
                    total_tokens: 8,
                },
            })
        ) as unknown as typeof fetch;

        const result = await client.chat({
            model: "muse-spark-1.3",
            messages: [{ role: "user", content: "hi" }],
        });

        expect(result.text).toBe("hello world");
        expect(result.usage.cachedTokens).toBe(2);
    });

    it("parses tool_calls from a Chat Completions response", async () => {
        global.fetch = vi.fn().mockResolvedValue(
            jsonResponse({
                choices: [
                    {
                        message: {
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_1",
                                    type: "function",
                                    function: {
                                        name: "get_weather",
                                        arguments: '{"city":"Paris"}',
                                    },
                                },
                            ],
                        },
                    },
                ],
                usage: {},
            })
        ) as unknown as typeof fetch;

        const result = await client.chat({
            model: "muse-spark-1.3",
            messages: [{ role: "user", content: "weather in Paris?" }],
        });

        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].function.name).toBe("get_weather");
    });

    it("throws ModelError on a non-ok response", async () => {
        global.fetch = vi.fn().mockResolvedValue(
            jsonResponse({ error: "bad" }, 400)
        ) as unknown as typeof fetch;

        await expect(
            client.chat({
                model: "muse-spark-1.3",
                messages: [{ role: "user", content: "hi" }],
            })
        ).rejects.toMatchObject({
            name: "ModelError",
            code: "upstream_failure",
            status: 400,
        });
    });

    it("counts input tokens via POST /responses/input_tokens", async () => {
        global.fetch = vi.fn().mockResolvedValue(
            jsonResponse({ input_tokens: 42 })
        ) as unknown as typeof fetch;

        const count = await client.countInputTokens("hello", "muse-spark-1.3");
        expect(count).toBe(42);
        const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
            .calls[0] as [string, RequestInit];
        expect(url).toBe(`${BASE}/responses/input_tokens`);
        expect(JSON.parse(init.body as string)).toEqual({
            model: "muse-spark-1.3",
            input: "hello",
        });
    });

    it("streams deltas and a final usage chunk from Chat Completions", async () => {
        const lines = [
            'data: {"choices":[{"delta":{"content":"hel"}}]}',
            'data: {"choices":[{"delta":{"content":"lo"}}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
            "data: [DONE]",
        ].join("\n");
        global.fetch = vi.fn().mockResolvedValue(
            new Response(lines, { status: 200 })
        ) as unknown as typeof fetch;

        const deltas = [];
        for await (const delta of client.streamChat({
            model: "muse-spark-1.3",
            messages: [{ role: "user", content: "hi" }],
        })) {
            deltas.push(delta);
        }

        expect(deltas.map((d) => d.text).join("")).toBe("hello");
        expect(deltas[deltas.length - 1].usage?.totalTokens).toBe(7);
    });
});

describe("runToolLoop", () => {
    const originalFetch = global.fetch;
    const client = new ModelClient({
        baseUrl: BASE,
        apiKey: "test-key",
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("runs the execute -> feed-back loop until the model answers", async () => {
        const calls = [
            jsonResponse({
                choices: [
                    {
                        message: {
                            content: null,
                            tool_calls: [
                                {
                                    id: "call_1",
                                    type: "function",
                                    function: {
                                        name: "get_weather",
                                        arguments: '{"city":"Paris"}',
                                    },
                                },
                            ],
                        },
                    },
                ],
                usage: {},
            }),
            jsonResponse({
                choices: [{ message: { content: "18°C" } }],
                usage: {},
            }),
        ];
        global.fetch = vi
            .fn()
            .mockImplementation(async () => calls.shift() ?? jsonResponse({})) as unknown as typeof fetch;

        const executed: string[] = [];
        const result = await runToolLoop(
            client,
            {
                model: "muse-spark-1.3",
                messages: [{ role: "user", content: "weather in Paris?" }],
            },
            async (toolCall) => {
                executed.push(toolCall.function.name);
                return "18°C";
            }
        );

        expect(executed).toEqual(["get_weather"]);
        expect(result.text).toBe("18°C");
    });
});
