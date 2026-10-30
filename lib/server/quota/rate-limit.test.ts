import { beforeEach, describe, expect, it } from "vitest";

import {
    DEFAULT_ROUTE_LIMITS,
    detectRequestLocale,
    getClientIdentifier,
    RateLimiter,
    resetRateLimits,
    withRateLimit,
} from "./rate-limit";
import {
    recordUsage,
    resetMemoryUsageStore,
    setUsageStore,
} from "./usage-meter";

describe("RateLimiter", () => {
    let limiter: RateLimiter;

    beforeEach(() => {
        limiter = new RateLimiter();
        resetRateLimits();
    });

    it("allows requests up to the limit and then blocks", () => {
        const key = "test-route:client-1";
        const limit = 3;
        const windowMs = 60_000;

        const res1 = limiter.check(key, limit, windowMs);
        expect(res1.allowed).toBe(true);
        expect(res1.remaining).toBe(2);

        const res2 = limiter.check(key, limit, windowMs);
        expect(res2.allowed).toBe(true);
        expect(res2.remaining).toBe(1);

        const res3 = limiter.check(key, limit, windowMs);
        expect(res3.allowed).toBe(true);
        expect(res3.remaining).toBe(0);

        const res4 = limiter.check(key, limit, windowMs);
        expect(res4.allowed).toBe(false);
        expect(res4.remaining).toBe(0);
        expect(res4.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("tracks different keys independently", () => {
        const limit = 2;
        const windowMs = 60_000;

        limiter.check("route-a:user-1", limit, windowMs);
        limiter.check("route-a:user-1", limit, windowMs);
        expect(limiter.check("route-a:user-1", limit, windowMs).allowed).toBe(
            false
        );

        // Different user on same route is not blocked
        expect(limiter.check("route-a:user-2", limit, windowMs).allowed).toBe(
            true
        );

        // Same user on different route is not blocked
        expect(limiter.check("route-b:user-1", limit, windowMs).allowed).toBe(
            true
        );
    });
});

describe("Client identifier & locale detection", () => {
    it("does not trust x-user-id header for client identification", () => {
        const req = new Request("http://localhost/api/asr/transcribe", {
            headers: {
                "x-user-id": "attacker-42",
                "x-forwarded-for": "203.0.113.195",
            },
        });
        expect(getClientIdentifier(req)).toBe("ip:203.0.113.195");
    });

    it("falls back to bounded client identifier when IP headers are absent", () => {
        const req = new Request("http://localhost/api/asr/transcribe", {
            headers: { "user-agent": "Mozilla/5.0 TestBrowser" },
        });
        expect(getClientIdentifier(req)).toBe(
            "client:ua:Mozilla/5.0 TestBrowser"
        );
    });

    it("identifies client by x-forwarded-for first IP", () => {
        const req = new Request("http://localhost/api/asr/transcribe", {
            headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
        });
        expect(getClientIdentifier(req)).toBe("ip:203.0.113.195");
    });

    it("identifies client by x-real-ip when forwarded-for is absent", () => {
        const req = new Request("http://localhost/api/asr/transcribe", {
            headers: { "x-real-ip": "198.51.100.1" },
        });
        expect(getClientIdentifier(req)).toBe("ip:198.51.100.1");
    });

    it("falls back to default identifier when no client headers are sent", () => {
        const req = new Request("http://localhost/api/asr/transcribe");
        expect(getClientIdentifier(req)).toBe("client:default");
    });

    it("detects locale from query param or accept-language header", () => {
        const req1 = new Request(
            "http://localhost/api/asr/transcribe?locale=en"
        );
        expect(detectRequestLocale(req1)).toBe("en");

        const req2 = new Request("http://localhost/api/asr/transcribe", {
            headers: { "accept-language": "en-US,en;q=0.9" },
        });
        expect(detectRequestLocale(req2)).toBe("en");

        const req3 = new Request("http://localhost/api/asr/transcribe", {
            headers: { "accept-language": "id-ID,id;q=0.9" },
        });
        expect(detectRequestLocale(req3)).toBe("id");
    });
});

describe("withRateLimit middleware wrapper", () => {
    beforeEach(() => {
        resetRateLimits();
        setUsageStore(null);
        resetMemoryUsageStore();
    });

    it("has defaults defined for all required MVP routes", () => {
        expect(DEFAULT_ROUTE_LIMITS["/api/asr/transcribe"]).toBeDefined();
        expect(DEFAULT_ROUTE_LIMITS["/api/documents"]).toBeDefined();
        expect(DEFAULT_ROUTE_LIMITS["/api/pdf"]).toBeDefined();
        expect(DEFAULT_ROUTE_LIMITS["/api/asr/transcribe"].limit).toBe(30);
    });
    it("passes through to handler and attaches rate-limit headers on success", async () => {
        const innerHandler = async () => {
            return Response.json({ success: true }, { status: 200 });
        };

        const wrapped = withRateLimit(innerHandler, {
            route: "/api/documents",
            limit: 5,
        });

        const req = new Request("http://localhost/api/documents");
        const res = await wrapped(req);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(res.headers.get("x-ratelimit-limit")).toBe("5");
        expect(res.headers.get("x-ratelimit-remaining")).toBe("4");
    });
    it("returns friendly 429 response when route limit is exceeded", async () => {
        const innerHandler = async () => {
            return Response.json({ ok: true });
        };

        const wrapped = withRateLimit(innerHandler, {
            route: "/api/pdf",
            limit: 2,
            windowMs: 60_000,
        });

        const req1 = new Request("http://localhost/api/pdf", {
            headers: { "x-forwarded-for": "198.51.100.50" },
        });
        const req2 = new Request("http://localhost/api/pdf", {
            headers: { "x-forwarded-for": "198.51.100.50" },
        });
        const req3 = new Request("http://localhost/api/pdf", {
            headers: { "x-forwarded-for": "198.51.100.50" },
        });

        const res1 = await wrapped(req1);
        const res2 = await wrapped(req2);
        const res3 = await wrapped(req3);

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);

        expect(res3.status).toBe(429);
        expect(res3.headers.get("retry-after")).toBeTruthy();
        expect(res3.headers.get("x-ratelimit-limit")).toBe("2");
        expect(res3.headers.get("x-ratelimit-remaining")).toBe("0");

        const body = await res3.json();
        expect(body).toEqual({
            error: {
                code: "rate_limited",
                message:
                    "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
            },
        });
    });

    it("returns English message when request locale is en", async () => {
        const innerHandler = async () => Response.json({ ok: true });
        const wrapped = withRateLimit(innerHandler, {
            route: "/api/asr/transcribe",
            limit: 1,
        });

        const req1 = new Request("http://localhost/api/asr/transcribe?locale=en");
        const req2 = new Request("http://localhost/api/asr/transcribe?locale=en");

        await wrapped(req1);
        const res2 = await wrapped(req2);

        expect(res2.status).toBe(429);
        const body = await res2.json();
        expect(body.error.code).toBe("rate_limited");
        expect(body.error.message).toBe(
            "Too many requests. Wait a moment and try again."
        );
    });

    it("rejects request with 429 when checkDailyQuota is enabled and cap is reached", async () => {
        // Exceed quota
        await recordUsage({
            date: "2026-10-29",
            estCost: 6.0,
        });

        const innerHandler = async () => Response.json({ ok: true });
        const wrapped = withRateLimit(innerHandler, {
            route: "/api/asr/transcribe",
            checkDailyQuota: true,
        });

        const req = new Request("http://localhost/api/asr/transcribe");
        const res = await wrapped(req);

        expect(res.status).toBe(429);
        expect(res.headers.get("x-quota-hard-stop")).toBe("true");

        const body = await res.json();
        expect(body.error.code).toBe("quota_exceeded");
        expect(body.error.message).toContain("Batas kuota harian tercapai");
    });
});
