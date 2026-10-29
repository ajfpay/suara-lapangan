import { describe, expect, it } from "vitest";

import {
    AsrError,
    httpStatusFor,
    upstreamError,
    userMessage,
    type AsrErrorCode,
} from "./errors";

/**
 * What the client is told when a recording cannot be transcribed.
 *
 * The status code is ours, not Meta's: a rejected credential is our
 * misconfiguration, so it must not reach the browser as a 401 that would look
 * like the user failed to sign in.
 */

const ALL_CODES: AsrErrorCode[] = [
    "invalid_request",
    "too_large",
    "upstream_rejected",
    "upstream_auth",
    "rate_limited",
    "upstream_failure",
    "upstream_unreachable",
    "not_configured",
    "internal_error",
];

describe("upstreamError", () => {
    it.each([
        [400, "upstream_rejected"],
        [401, "upstream_auth"],
        [403, "upstream_auth"],
        [413, "too_large"],
        [429, "rate_limited"],
        [500, "upstream_failure"],
        [503, "upstream_failure"],
    ])("classifies a Meta %i as %s", (status, code) => {
        expect(upstreamError(status).code).toBe(code);
    });

    it("keeps the upstream body out of the message the client can see", () => {
        const error = upstreamError(500, '{"error":"upstream detail"}');

        expect(error).toBeInstanceOf(AsrError);
        expect(error.message).not.toContain("upstream detail");
    });
});

describe("httpStatusFor", () => {
    it.each([
        ["invalid_request", 400],
        ["too_large", 413],
        ["upstream_rejected", 400],
        ["upstream_auth", 502],
        ["rate_limited", 429],
        ["upstream_failure", 502],
        ["upstream_unreachable", 504],
        ["not_configured", 500],
        ["internal_error", 500],
    ] as const)("answers %s with %i", (code, status) => {
        expect(httpStatusFor(code)).toBe(status);
    });
});

describe("userMessage", () => {
    it.each(ALL_CODES)("has a sentence for %s in both locales", (code) => {
        const english = userMessage(code, "en");
        const indonesian = userMessage(code, "id");

        expect(english.length).toBeGreaterThan(20);
        expect(indonesian.length).toBeGreaterThan(20);
        expect(indonesian).not.toBe(english);
    });

    it("tells the user what to do about the two faults they can act on", () => {
        expect(userMessage("rate_limited", "id")).toMatch(/coba lagi|tunggu/i);
        expect(userMessage("too_large", "id")).toMatch(/32 MB/);
        expect(userMessage("too_large", "en")).toMatch(/32 MB/);
    });
});
