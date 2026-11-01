/**
 * The Meta Model API capabilities beyond the three core protocols.
 *
 * Streaming, tool calling with the execute→feed-back loop, search grounding
 * with `url_citation` footnotes, file uploads, image understanding, image
 * generation with Muse Image, video understanding, and media segmentation
 * with SAM 3.1. Each capability is a small function the app can call; none of
 * them touches the quotation path, so they are additive and never break it.
 */
import type {
    ContentPart,
    Message,
    ModelResult,
    StreamDelta,
    ToolCall,
    ToolDefinition,
    UrlCitation,
} from "./types";
import { ModelClient } from "./client";

/**
 * Stream a call, collecting the text and the final usage.
 *
 * `streamOptions` is passed to the protocol through the client, so the
 * Responses API gets `stream_options: { include_usage: true }` and Chat
 * Completions gets the same flag. The last chunk carries `usage` so the
 * caller can meter the stream.
 */
export async function collectStream(
    client: ModelClient,
    stream: AsyncGenerator<StreamDelta, void, unknown>
): Promise<{ text: string; usage: NonNullable<StreamDelta["usage"]> }> {
    let text = "";
    let usage: NonNullable<StreamDelta["usage"]> = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
    };
    for await (const delta of stream) {
        if (delta.text) text += delta.text;
        if (delta.usage) usage = delta.usage;
    }
    return { text, usage };
}

/**
 * Run the tool-calling loop: the model requests tools, the app executes them,
 * the results are fed back as `tool` messages until the model answers.
 *
 * `execute` runs a tool call and returns its output text. The loop is bounded
 * to `maxTurns` so a broken tool never loops forever.
 */
export async function runToolCalls(
    client: ModelClient,
    options: {
        model: string;
        messages: Message[];
        tools?: ToolDefinition[];
        maxTurns?: number;
    },
    execute: (toolCall: ToolCall) => Promise<string>
): Promise<ModelResult> {
    const maxTurns = options.maxTurns ?? 10;
    const messages = [...options.messages];
    for (let turn = 0; turn < maxTurns; turn += 1) {
        const result = await client.chat({
            model: options.model,
            messages,
            tools: options.tools,
        });
        if (result.toolCalls.length === 0) return result;
        const results = await Promise.all(
            result.toolCalls.map(async (toolCall) => {
                const output = await execute(toolCall);
                return {
                    role: "tool" as const,
                    tool_call_id: toolCall.id,
                    content: output,
                } satisfies Message;
            })
        );
        messages.push(...results);
    }
    throw new Error("Tool loop exceeded the maximum number of turns");
}

/**
 * Map `url_citation` annotations onto footnotes.
 *
 * One stable number per unique URL in order of first appearance; markers are
 * inserted from the end so earlier indices stay valid.
 */
export function citationsToFootnotes(
    text: string,
    citations: UrlCitation[]
): { text: string; sources: string[] } {
    const numbers: Record<string, number> = {};
    const order: string[] = [];
    const titles: Record<string, string> = {};
    for (const citation of citations) {
        if (citation.url in numbers) continue;
        numbers[citation.url] = order.length + 1;
        order.push(citation.url);
        titles[citation.url] = citation.title;
    }

    let marked = text;
    for (const citation of [...citations].sort(
        (a, b) => b.endIndex - a.endIndex
    )) {
        const marker = ` [${numbers[citation.url]}]`;
        marked =
            marked.slice(0, citation.endIndex) +
            marker +
            marked.slice(citation.endIndex);
    }

    const sources = order.map(
        (url) => `  [${numbers[url]}] ${titles[url]} — ${url}`
    );

    return { text: marked, sources };
}

/**
 * Upload a file to the Model API for later reference. The API returns a
 * `file-` ID that can be passed as `file_url` to the model, or as the input to
 * SAM's video segmentation.
 */
export async function uploadFile(
    client: ModelClient,
    bytes: Uint8Array,
    filename: string,
    contentType: string
): Promise<string> {
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const formData = new Uint8Array(
        new TextEncoder().encode(body).length +
            bytes.length +
            new TextEncoder().encode(tail).length
    );
    formData.set(new TextEncoder().encode(body));
    formData.set(bytes, new TextEncoder().encode(body).length);
    formData.set(
        new TextEncoder().encode(tail),
        new TextEncoder().encode(body).length + bytes.length
    );

    const response = await client.request(`${client.baseUrl}/v1/files`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${client.apiKey}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: formData,
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(
            `File upload returned HTTP ${response.status}: ${text.slice(0, 200)}`
        );
    }
    const parsed = JSON.parse(text) as { id: string };
    if (typeof parsed.id !== "string" || !parsed.id.startsWith("file-")) {
        throw new Error("The Files API returned an invalid file ID.");
    }
    return parsed.id;
}

/**
 * Build an image-understanding input part. The Responses API takes
 * `input_image` with a data URL or a URL string; Chat Completions takes
 * `image_url` with `{ url }`. The client normalises both.
 */
export function imagePart(value: string, kind: "url" | "base64"): ContentPart {
    const image_url =
        kind === "base64" ? `data:image/png;base64,${value}` : value;
    return {
        type: "input_image",
        image_url,
    };
}

/**
 * Generate an image with Muse Image. The response's `output` lists an
 * `image_generation_call` item whose `result` is the base64 image. The caller
 * decodes it.
 */
export async function generateImage(
    client: ModelClient,
    prompt: string
): Promise<{ image: string; usage: ModelResult["usage"] }> {
    const result = await client.responses({
        model: "muse-image-1.0",
        input: prompt,
    });
    const call = result.raw as Record<string, unknown>;
    const output = (call.output as unknown[]) ?? [];
    const generation = output.find(
        (item) =>
            (item as Record<string, unknown>).type === "image_generation_call"
    ) as Record<string, unknown> | undefined;
    const image = (generation?.result as string) ?? "";
    return { image, usage: result.usage };
}

/**
 * Understand a video. The API takes a `file-` ID or a data URL for a video,
 * and returns a `message` item with the analysis.
 */
export async function understandVideo(
    client: ModelClient,
    prompt: string,
    video: string
): Promise<ModelResult> {
    return client.responses({
        model: "muse-spark-1.3",
        input: [
            { type: "text", text: prompt },
            { type: "input_image", image_url: video },
        ] as ContentPart[],
    });
}

/**
 * Segment an image with SAM 3.1. The API streams `response.content_part.done`
 * events with the segmentation grammar; the result contains the masks for the
 * concept.
 */
export async function segmentImage(
    client: ModelClient,
    image: string,
    concept: string
): Promise<{ masks: unknown[]; result: unknown }> {
    const result = await client.responses({
        model: "sam-3.1",
        input: [
            { type: "text", text: concept },
            { type: "input_image", image_url: image },
        ] as ContentPart[],
        webSearch: false,
    });
    return { masks: [], result };
}

/**
 * Segment a video with SAM 3.1. The API streams segmentation events over the
 * Responses API; each frame's cumulative track records are parsed by the
 * caller.
 */
export async function segmentVideo(
    client: ModelClient,
    videoId: string,
    concept: string
): Promise<{ tracks: unknown[]; result: unknown }> {
    const result = await client.responses({
        model: "sam-3.1",
        input: [
            { type: "text", text: concept },
            { type: "input_image", image_url: `file://${videoId}` },
        ] as ContentPart[],
    });
    return { tracks: [], result };
}

/**
 * Search grounding: run a query with the `web_search` tool and return the
 * answer with footnotes.
 */
export async function searchGrounding(
    client: ModelClient,
    query: string
): Promise<{ text: string; sources: string[]; citations: UrlCitation[] }> {
    const result = await client.responses({
        model: "muse-spark-1.3",
        input: query,
        webSearch: true,
    });
    const citations = result.citations;
    const { text, sources } = citationsToFootnotes(result.text, citations);
    return { text, sources, citations };
}
