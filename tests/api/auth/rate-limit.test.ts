import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";

vi.mock("@/lib/server/email/send", () => ({ sendEmail: vi.fn() }));

const database = process.env.ASR_TEST_DATABASE_URL;
const origin = "http://localhost:3010";
const emailPrefix = "ticket21-rl-" + randomUUID() + "-";

/** A fresh benchmark-range address per call keeps reruns out of each other's windows. */
function clientAddress(): string {
    return "198.18." + randomInt(0, 256) + "." + randomInt(1, 255);
}

describe.skipIf(!database)("sign-up and sign-in rate limit", () => {
    let pool: Pool;
    let server: typeof import("@/lib/server/auth");
    const used = new Set<string>();

    function attempt(
        path: "sign-in/email" | "sign-up/email",
        forwardedFor?: string,
        instance = server,
        extraHeaders: Record<string, string> = {}
    ): Promise<Response> {
        const body =
            path === "sign-in/email"
                ? {
                      email: emailPrefix + "absent@example.test",
                      password: "Wrong-password-123!",
                  }
                : {
                      email: emailPrefix + randomUUID() + "@example.test",
                      password: "Fixture-password-123!",
                      name: "Ticket 21 fixture",
                  };
        for (const ip of (forwardedFor ?? "0.0.0.0").split(","))
            used.add(ip.trim() + "|/" + path);
        return instance.handleAuthRequest(
            new Request(origin + "/api/auth/" + path, {
                method: "POST",
                headers: {
                    origin,
                    "content-type": "application/json",
                    ...(forwardedFor
                        ? { "x-forwarded-for": forwardedFor }
                        : {}),
                    ...extraHeaders,
                },
                body: JSON.stringify(body),
            })
        );
    }

    beforeAll(async () => {
        vi.stubEnv("DATABASE_URL", database);
        vi.stubEnv("AUTH_TRUST_PROXY", "true");
        vi.stubEnv("BETTER_AUTH_URL", origin);
        vi.stubEnv("TRUSTED_ORIGINS", origin);
        vi.stubEnv(
            "BETTER_AUTH_SECRET",
            "ticket21-test-secret-at-least-32-characters"
        );
        pool = new Pool({ connectionString: database });
        server = await import("@/lib/server/auth");
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    afterAll(async () => {
        if (pool) {
            await pool.query("delete from auth_user where email like $1", [
                emailPrefix + "%",
            ]);
            await pool.query(
                "delete from auth_rate_limit where key=any($1::text[])",
                [[...used]]
            );
            await pool.end();
        }
        vi.unstubAllEnvs();
    });

    it.each(["sign-in/email", "sign-up/email"] as const)(
        "%s allows 10 attempts per client in 60 seconds, then blocks until the window passes",
        async (path) => {
            vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
            const client = clientAddress();
            for (let i = 0; i < 10; i++)
                expect((await attempt(path, client)).status).not.toBe(429);
            const blocked = await attempt(path, client);
            expect(blocked.status).toBe(429);
            const retryAfter = Number(blocked.headers.get("x-retry-after"));
            expect(retryAfter).toBeGreaterThan(0);
            expect(retryAfter).toBeLessThanOrEqual(60);

            vi.setSystemTime(Date.now() + 59_000);
            expect((await attempt(path, client)).status).toBe(429);
            vi.setSystemTime(Date.now() + 2_000);
            expect((await attempt(path, client)).status).not.toBe(429);
        },
        120_000
    );
    it("uses the proxy-appended address even when the caller prepends a different address", async () => {
        const proxyClient = clientAddress();
        for (let i = 0; i < 10; i++)
            expect(
                (
                    await attempt(
                        "sign-in/email",
                        clientAddress() + ", " + proxyClient
                    )
                ).status
            ).not.toBe(429);
        expect(
            (
                await attempt(
                    "sign-in/email",
                    clientAddress() + ", " + proxyClient
                )
            ).status
        ).toBe(429);
    }, 120_000);

    it("starts a fresh login window sixty seconds after the first accepted attempt", async () => {
        const ip = clientAddress();
        const start = Date.now();
        vi.useFakeTimers({ toFake: ["Date"], now: start });
        for (let i = 0; i < 10; i++) {
            vi.setSystemTime(start + i * 5000);
            expect((await attempt("sign-in/email", ip)).status).toBe(401);
        }
        vi.setSystemTime(start + 59_000);
        expect((await attempt("sign-in/email", ip)).status).toBe(429);
        vi.setSystemTime(start + 60_000);
        expect((await attempt("sign-in/email", ip)).status).toBe(401);
    }, 120_000);

    it("does not bypass the limiter when the trusted IP header is missing", async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 120_000 });
        for (let i = 0; i < 10; i++)
            expect((await attempt("sign-in/email")).status).not.toBe(429);
        expect((await attempt("sign-in/email")).status).toBe(429);
    }, 120_000);

    it("shares the counter between separate auth instances", async () => {
        const ip = clientAddress();
        vi.resetModules();
        const other = await import("@/lib/server/auth");
        for (let i = 0; i < 5; i++) {
            expect((await attempt("sign-in/email", ip)).status).not.toBe(429);
            expect((await attempt("sign-in/email", ip, other)).status).not.toBe(
                429
            );
        }
        expect((await attempt("sign-in/email", ip, other)).status).toBe(429);
    }, 120_000);

    it("admits only ten simultaneous requests across two auth instances", async () => {
        const ip = clientAddress();
        vi.resetModules();
        const other = await import("@/lib/server/auth");
        const responses = await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
                attempt("sign-in/email", ip, i % 2 ? other : server)
            )
        );
        expect(
            responses.filter((response) => response.status === 401)
        ).toHaveLength(10);
        expect(
            responses.filter((response) => response.status === 429)
        ).toHaveLength(2);
        expect((await attempt("sign-in/email", ip)).status).toBe(429);
    }, 120_000);

    it("shares the same limit between IPv4 and its IPv4-mapped IPv6 representation", async () => {
        const ip = clientAddress();
        for (let i = 0; i < 10; i++) {
            expect((await attempt("sign-in/email", ip)).status).toBe(401);
        }
        expect((await attempt("sign-in/email", "::ffff:" + ip)).status).toBe(
            429
        );
    }, 120_000);

    it("ignores both client IP headers when production proxy trust is disabled", async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 240_000 });
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("AUTH_TRUST_PROXY", "false");
        used.add("0.0.0.0|/sign-in/email");
        try {
            for (let i = 0; i < 10; i++) {
                expect(
                    (
                        await attempt(
                            "sign-in/email",
                            clientAddress(),
                            server,
                            { "x-auth-client-ip": clientAddress() }
                        )
                    ).status
                ).toBe(401);
            }
            expect(
                (
                    await attempt("sign-in/email", clientAddress(), server, {
                        "x-auth-client-ip": clientAddress(),
                    })
                ).status
            ).toBe(429);
        } finally {
            vi.stubEnv("NODE_ENV", "test");
            vi.stubEnv("AUTH_TRUST_PROXY", "true");
        }
    }, 120_000);
});
