import { describe, expect, it } from "vitest";
import { hasSecureSessionCookie, parseCurlResponse } from "./androidProof.mjs";

describe("Android HTTP proof", () => {
    it("parses multiline responses and preserves the body", () => {
        expect(parseCurlResponse('{"user":\n{"id":"test"}}\n200')).toEqual({
            status: 200,
            body: '{"user":\n{"id":"test"}}',
        });
        expect(parseCurlResponse("null\n503")).toEqual({
            status: 503,
            body: "null",
        });
    });
    it.each(["", "200", "body\n000", "body\n200bad"])(
        "rejects an invalid response",
        (raw) => {
            expect(() => parseCurlResponse(raw)).toThrow();
        }
    );
    const row =
        "#HttpOnly_host\tFALSE\t/\tTRUE\t0\t__Secure-better-auth.session_token\tfake";
    it("requires a nonempty secure HttpOnly Better Auth session cookie", () => {
        expect(hasSecureSessionCookie(row)).toBe(true);
        expect(hasSecureSessionCookie(row.replace("__Secure-", ""))).toBe(true);
        expect(hasSecureSessionCookie(row.replace("#HttpOnly_", ""))).toBe(
            false
        );
        expect(
            hasSecureSessionCookie(row.replace("\tTRUE\t", "\tFALSE\t"))
        ).toBe(false);
        expect(
            hasSecureSessionCookie(
                row.replace("better-auth.session_token", "fake_session_token")
            )
        ).toBe(false);
        expect(hasSecureSessionCookie(row.replace(/fake$/, ""))).toBe(false);
    });
});
