import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { transcribeWithMeta } from "./meta";

/**
 * The Meta request is a frozen contract: `ENDPOINTING` mode, `WAV` audio, the
 * credential in an `Authorization` header, and the parameters in a JSON part
 * named `request` rather than in form fields. The tests stub the network and
 * assert on what actually left the process.
 */

const FIXTURE_DIR = join(__dirname, "__fixtures__");
const audio = new Uint8Array(readFileSync(join(FIXTURE_DIR, "sample-16k.wav")));
const metaResponse = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "meta-transcribe.json"), "utf8")
);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

function stubFetch(handler: () => Promise<Response> | Response) {
    const mock = vi.fn<Fetch>(async () => handler());
    vi.stubGlobal("fetch", mock);
    return mock;
}

function okResponse(body: unknown = metaResponse) {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("transcribeWithMeta", () => {
    it("posts the frozen request to Meta and returns its JSON", async () => {
        const fetchMock = stubFetch(() => okResponse());

        const result = await transcribeWithMeta({
            audio,
            locale: "id",
            sessionId: "sess-abc",
            apiKey: "test-key",
        });

        expect(result).toEqual(metaResponse);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(
            "https://api.meta.ai/v1/asr/transcribe?sessionId=sess-abc"
        );
        expect(init.method).toBe("POST");

        const headers = new Headers(init.headers);
        expect(headers.get("authorization")).toBe("Bearer test-key");
        // Setting a content type by hand would drop the multipart boundary.
        expect(headers.get("content-type")).toBeNull();

        const sent = await new Request("http://meta.test", {
            method: "POST",
            body: init.body,
        }).formData();
        expect(JSON.parse(await (sent.get("request") as File).text())).toEqual({
            mode: "ENDPOINTING",
            model: "muse-voice-transcribe-1.0",
            audioEncoding: "WAV",
            languageBias: ["Indonesian"],
            keywords: [
                "cakar ayam",
                "sak",
                "batang",
                "titik",
                "m2",
                "borongan",
            ],
        });
        expect(
            new Uint8Array(await (sent.get("audio") as File).arrayBuffer())
        ).toEqual(audio);
    });

    it("biases an English session toward English", async () => {
        const fetchMock = stubFetch(() => okResponse());

        await transcribeWithMeta({
            audio,
            locale: "en",
            sessionId: "sess-en",
            apiKey: "test-key",
        });

        const [, init] = fetchMock.mock.calls[0];
        const sent = await new Request("http://meta.test", {
            method: "POST",
            body: init.body,
        }).formData();
        const request = JSON.parse(await (sent.get("request") as File).text());

        expect(request.languageBias).toEqual(["English"]);
        expect(request.keywords).toEqual([
            "drywall",
            "rebar",
            "sq ft",
            "lin ft",
            "bags",
            "bars",
        ]);
    });

    it("classifies a refused credential without echoing it anywhere", async () => {
        stubFetch(
            () => new Response('{"error":"invalid api key"}', { status: 401 })
        );

        const error = await transcribeWithMeta({
            audio,
            locale: "en",
            sessionId: "sess-401",
            apiKey: "sk-live-secret-value",
        }).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({ code: "upstream_auth", metaStatus: 401 });
        expect(String(error)).not.toContain("sk-live-secret-value");
        expect((error as Error).stack).not.toContain("sk-live-secret-value");
    });

    it.each([
        [400, "upstream_rejected"],
        [413, "too_large"],
        [429, "rate_limited"],
        [500, "upstream_failure"],
    ])(
        "classifies a Meta %i as %s and keeps the body for the log",
        async (status, code) => {
            stubFetch(() => new Response("upstream said no", { status }));

            const error = await transcribeWithMeta({
                audio,
                locale: "en",
                sessionId: "sess-fail",
                apiKey: "test-key",
            }).catch((thrown: unknown) => thrown);

            expect(error).toMatchObject({
                code,
                metaStatus: status,
                metaBody: "upstream said no",
            });
        }
    );

    it("treats an unreachable Meta as a timeout the user can retry", async () => {
        stubFetch(() => Promise.reject(new TypeError("fetch failed")));

        const error = await transcribeWithMeta({
            audio,
            locale: "en",
            sessionId: "sess-offline",
            apiKey: "test-key",
        }).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({ code: "upstream_unreachable" });
        expect((error as { cause?: unknown }).cause).toBeInstanceOf(TypeError);
    });

    it("treats a 200 that is not JSON as an upstream failure", async () => {
        stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));

        const error = await transcribeWithMeta({
            audio,
            locale: "en",
            sessionId: "sess-garbage",
            apiKey: "test-key",
        }).catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({
            code: "upstream_failure",
            metaStatus: 200,
        });
    });
});
