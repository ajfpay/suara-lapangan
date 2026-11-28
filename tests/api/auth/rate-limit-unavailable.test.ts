import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
    vi.stubEnv(
        "DATABASE_URL",
        "postgres://fixture:fixture@127.0.0.1:1/fixture"
    );
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3010");
    vi.stubEnv("TRUSTED_ORIGINS", "http://localhost:3010");
    vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "unavailable-test-secret-minimum-32-chars"
    );
});

it("returns a structured 503 when the rate limit database cannot be reached", async () => {
    const { handleAuthRequest } = await import("@/lib/server/auth");
    const response = await handleAuthRequest(
        new Request("http://localhost:3010/api/auth/sign-in/email", {
            method: "POST",
            headers: {
                origin: "http://localhost:3010",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                email: "fixture@example.test",
                password: "Fixture-password",
            }),
        })
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
    });
});

it("accepts the proxied Next.js request and preserves its streamed JSON body", async () => {
    const { handleAuthRequest } = await import("@/lib/server/auth");
    const original = new NextRequest(
        "http://localhost:3010/api/auth/reset-password",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: "valid-format-fixture" }),
        }
    );
    // Next's App Router forwards property reads to the original receiver.
    const request = new Proxy(original, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const response = await handleAuthRequest(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
    });
});
