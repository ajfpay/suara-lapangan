import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelClient } from "./client";
import {
    citationsToFootnotes,
    collectStream,
    imagePart,
    runToolCalls,
    searchGrounding,
} from "./capabilities";

const BASE = "https://api.meta.ai/v1";

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("citationsToFootnotes", () => {
    it("inserts one marker per unique URL and lists sources", () => {
        const text = "Meta announced a new model. It is fast.";
        const citations = [
            { url: "https://a.com", title: "A", startIndex: 0, endIndex: 27 },
            { url: "https://a.com", title: "A", startIndex: 28, endIndex: 39 },
        ];
        const { text: marked, sources } = citationsToFootnotes(text, citations);
        expect(marked).toContain("[1]");
        expect(sources).toHaveLength(1);
        expect(sources[0]).toContain("https://a.com");
    });
});

describe("imagePart", () => {
    it("builds a base64 data URL for base64 input", () => {
        const part = imagePart("aGVsbG8=", "base64");
        expect(part).toEqual({
            type: "input_image",
            image_url: "data:image/png;base64,aGVsbG8=",
        });
    });

    it("passes a URL through unchanged", () => {
        const part = imagePart("https://x.com/i.png", "url");
        if (part.type !== "input_image") {
            throw new Error("expected input_image");
        }
        expect(part.image_url).toBe("https://x.com/i.png");
    });
});

describe("collectStream", () => {
    it("concatenates deltas and keeps the final usage", async () => {
        async function* stream() {
            yield { text: "hel" };
            yield { text: "lo" };
            yield {
                text: "",
                usage: {
                    inputTokens: 5,
                    outputTokens: 2,
                    cachedTokens: 3,
                    reasoningTokens: 0,
                    totalTokens: 7,
                },
            };
        }
        const { text, usage } = await collectStream(
            new ModelClient({ baseUrl: BASE, apiKey: "k" }),
            stream()
        );
        expect(text).toBe("hello");
        expect(usage.totalTokens).toBe(7);
        expect(usage.cachedTokens).toBe(3);
    });
});

describe("runToolCalls", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("executes tools and feeds results back until the model answers", async () => {
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

        const client = new ModelClient({ baseUrl: BASE, apiKey: "k" });
        const executed: string[] = [];
        const result = await runToolCalls(
            client,
            {
                model: "muse-spark-1.3",
                messages: [{ role: "user", content: "weather in Paris?" }],
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "get_weather",
                            description: "Get temperature",
                            parameters: {
                                type: "object",
                                properties: { city: { type: "string" } },
                                required: ["city"],
                            },
                        },
                    },
                ],
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

describe("searchGrounding", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it("maps web_search citations to footnotes", async () => {
        global.fetch = vi.fn().mockResolvedValue(
            jsonResponse({
                output: [
                    {
                        type: "message",
                        content: [
                            {
                                type: "output_text",
                                text: "The capital is Paris.",
                                annotations: [
                                    {
                                        type: "url_citation",
                                        url: "https://example.com/capital",
                                        title: "Capital of France",
                                        start_index: 0,
                                        end_index: 19,
                                    },
                                ],
                            },
                        ],
                    },
                ],
                usage: {},
            })
        ) as unknown as typeof fetch;

        const client = new ModelClient({ baseUrl: BASE, apiKey: "k" });
        const { text, sources, citations } = await searchGrounding(client, "capital of France?");
        expect(text).toContain("[1]");
        expect(citations).toHaveLength(1);
        expect(sources[0]).toContain("example.com");
    });
});
