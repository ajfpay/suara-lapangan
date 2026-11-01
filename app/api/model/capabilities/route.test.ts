import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("POST /api/model/capabilities", () => {
    const originalFetch = global.fetch;
    const originalEnv = {
        MODEL_API_KEY: process.env.MODEL_API_KEY,
    };

    beforeEach(() => {
        process.env.MODEL_API_KEY = "test-key";
        global.fetch = vi.fn();
    });

    afterEach(() => {
        global.fetch = originalFetch;
        process.env.MODEL_API_KEY = originalEnv.MODEL_API_KEY;
        vi.restoreAllMocks();
    });

    it("answers 400 when capability is missing", async () => {
        const res = await POST(
            new Request("http://localhost/api/model/capabilities", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: "hello" }),
            })
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("invalid_request");
    });

    it("answers 503 when MODEL_API_KEY is missing", async () => {
        delete process.env.MODEL_API_KEY;
        const res = await POST(
            new Request("http://localhost/api/model/capabilities", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ capability: "stream" }),
            })
        );
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error).toBe("not_configured");
    });

    it("streams text and usage for the stream capability", async () => {
        const lines = [
            'data: {"choices":[{"delta":{"content":"hello"}}]}',
            'data: {"choices":[{"delta":{"content":" world"}}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
        ].join("\n");
        (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Response(lines, { status: 200 })
        );

        const res = await POST(
            new Request("http://localhost/api/model/capabilities", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ capability: "stream" }),
            })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.capability).toBe("stream");
        expect(body.text).toBe("hello world");
        expect(body.usage.totalTokens).toBe(7);
    });

    it("counts input tokens for the count capability", async () => {
        (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Response(JSON.stringify({ input_tokens: 42 }), { status: 200 })
        );

        const res = await POST(
            new Request("http://localhost/api/model/capabilities", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ capability: "count" }),
            })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.capability).toBe("count");
        expect(body.inputTokens).toBe(42);
    });

    it("answers 502 when the capability fails", async () => {
        (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error("connection failed")
        );

        const res = await POST(
            new Request("http://localhost/api/model/capabilities", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ capability: "stream" }),
            })
        );
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe("capability_failed");
    });
});
