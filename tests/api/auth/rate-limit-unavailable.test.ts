import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it("returns a structured 503 when the rate limit database cannot be reached", async () => {
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
