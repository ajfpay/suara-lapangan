import { NextResponse } from "next/server";

import { ModelClient } from "@/lib/server/model/client";
import {
    collectStream,
    generateImage,
    searchGrounding,
} from "@/lib/server/model/capabilities";

/**
 * A minimal demo route that exercises the Meta Model API capabilities.
 *
 * Not on the quotation path. Each handler is a thin wrapper over the model
 * client, so the capabilities are reachable and verifiable without wiring
 * them into the app flow. The route returns the capability's output so a
 * caller can confirm it works.
 *
 * `MODEL_API_KEY` must be set; without it the route answers 503.
 */
function clientOr503(): ModelClient | NextResponse {
    const apiKey = process.env.MODEL_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            {
                error: "not_configured",
                message: "MODEL_API_KEY is not set",
            },
            { status: 503 }
        );
    }
    return new ModelClient({ baseUrl: "https://api.meta.ai/v1", apiKey });
}

type CapabilityBody = {
    capability?: unknown;
    prompt?: unknown;
    query?: unknown;
    image?: unknown;
    video?: unknown;
};

export async function POST(request: Request): Promise<Response> {
    let body: CapabilityBody;
    try {
        body = (await request.json()) as CapabilityBody;
    } catch {
        return NextResponse.json(
            { error: "invalid_request", message: "Request body must be JSON" },
            { status: 400 }
        );
    }

    const capability = body.capability;
    if (typeof capability !== "string") {
        return NextResponse.json(
            {
                error: "invalid_request",
                message:
                    "capability is required: one of stream, tools, ground, image, video, sam, count",
            },
            { status: 400 }
        );
    }

    const client = clientOr503();
    if (client instanceof NextResponse) return client;

    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const query = typeof body.query === "string" ? body.query : "";

    try {
        switch (capability) {
            case "stream": {
                const { text, usage } = await collectStream(
                    client,
                    client.streamChat({
                        model: "muse-spark-1.3",
                        messages: [
                            {
                                role: "user",
                                content:
                                    prompt ||
                                    "List three uses for a hash map, one line each.",
                            },
                        ],
                    })
                );
                return NextResponse.json({ capability, text, usage });
            }
            case "ground": {
                const { text, sources, citations } = await searchGrounding(
                    client,
                    query || "What is the capital of France?"
                );
                return NextResponse.json({ capability, text, sources, citations });
            }
            case "image": {
                const { image: generated, usage } = await generateImage(
                    client,
                    prompt || "a watercolor painting of a red fox in a snowy forest"
                );
                return NextResponse.json({
                    capability,
                    image: generated.slice(0, 64),
                    usage,
                });
            }
            case "count": {
                const count = await client.countInputTokens(
                    prompt || "hello",
                    "muse-spark-1.3"
                );
                return NextResponse.json({ capability, inputTokens: count });
            }
            default:
                return NextResponse.json(
                    {
                        error: "invalid_request",
                        message:
                            "capability must be one of stream, tools, ground, image, video, sam, count",
                    },
                    { status: 400 }
                );
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
            { error: "capability_failed", message },
            { status: 502 }
        );
    }
}
