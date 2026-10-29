import {
    assertQuotaAvailable,
    QuotaExceededError,
} from "./usage-meter";

export type RateLimitResult = {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetMs: number;
    retryAfterSeconds: number;
};

export const DEFAULT_ROUTE_LIMITS: Record<
    string,
    { limit: number; windowMs: number }
> = {
    "/api/asr/transcribe": { limit: 30, windowMs: 60_000 },
    "/api/documents": { limit: 30, windowMs: 60_000 },
    "/api/pdf": { limit: 30, windowMs: 60_000 },
};

export class RateLimiter {
    private requests = new Map<string, { count: number; resetAt: number }>();

    check(key: string, limit: number, windowMs: number): RateLimitResult {
        const now = Date.now();
        const entry = this.requests.get(key);

        if (!entry || now >= entry.resetAt) {
            const resetAt = now + windowMs;
            this.requests.set(key, { count: 1, resetAt });
            return {
                allowed: true,
                limit,
                remaining: Math.max(0, limit - 1),
                resetMs: windowMs,
                retryAfterSeconds: Math.ceil(windowMs / 1000),
            };
        }

        if (entry.count >= limit) {
            const resetMs = Math.max(0, entry.resetAt - now);
            return {
                allowed: false,
                limit,
                remaining: 0,
                resetMs,
                retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
            };
        }

        entry.count += 1;
        const resetMs = Math.max(0, entry.resetAt - now);
        return {
            allowed: true,
            limit,
            remaining: Math.max(0, limit - entry.count),
            resetMs,
            retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
        };
    }

    reset(): void {
        this.requests.clear();
    }
}

const globalLimiter = new RateLimiter();

export function getGlobalRateLimiter(): RateLimiter {
    return globalLimiter;
}

export function resetRateLimits(): void {
    globalLimiter.reset();
}

export function getClientIdentifier(request: Request): string {
    const userId = request.headers.get("x-user-id");
    if (userId) return `user:${userId.trim()}`;

    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const firstIp = forwarded.split(",")[0].trim();
        if (firstIp) return `ip:${firstIp}`;
    }

    const realIp = request.headers.get("x-real-ip");
    if (realIp) return `ip:${realIp.trim()}`;

    return "client:default";
}

export function detectRequestLocale(request: Request): "en" | "id" {
    try {
        const url = new URL(request.url, "http://localhost");
        const param = url.searchParams.get("locale");
        if (param === "en" || param === "id") return param;
    } catch {
        // Ignored
    }

    const accept = request.headers.get("accept-language");
    if (accept && accept.toLowerCase().includes("en")) {
        return "en";
    }

    return "id";
}

export type RouteHandler<TContext = unknown> = (
    request: Request,
    context?: TContext
) => Promise<Response> | Response;

export type RateLimitOptions = {
    route: string;
    limit?: number;
    windowMs?: number;
    limiter?: RateLimiter;
    getIdentifier?: (request: Request) => string;
    checkDailyQuota?: boolean;
};

export function withRateLimit<TContext = unknown>(
    handler: RouteHandler<TContext>,
    options: RateLimitOptions
): RouteHandler<TContext> {
    const defaultRouteConfig = DEFAULT_ROUTE_LIMITS[options.route] ?? {
        limit: 30,
        windowMs: 60_000,
    };

    const effectiveLimit = options.limit ?? defaultRouteConfig.limit;
    const effectiveWindowMs = options.windowMs ?? defaultRouteConfig.windowMs;
    const limiter = options.limiter ?? globalLimiter;
    const getIdentifier = options.getIdentifier ?? getClientIdentifier;

    return async (
        request: Request,
        context?: TContext
    ): Promise<Response> => {
        const identifier = getIdentifier(request);
        const rateLimitKey = `${options.route}:${identifier}`;

        const rateResult = limiter.check(
            rateLimitKey,
            effectiveLimit,
            effectiveWindowMs
        );

        if (!rateResult.allowed) {
            const locale = detectRequestLocale(request);
            const message =
                locale === "en"
                    ? "Too many requests. Wait a moment and try again."
                    : "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";

            return Response.json(
                {
                    error: {
                        code: "rate_limited",
                        message,
                    },
                },
                {
                    status: 429,
                    headers: {
                        "Retry-After": String(rateResult.retryAfterSeconds),
                        "X-RateLimit-Limit": String(rateResult.limit),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": String(
                            Math.ceil((Date.now() + rateResult.resetMs) / 1000)
                        ),
                    },
                }
            );
        }

        if (options.checkDailyQuota) {
            try {
                const locale = detectRequestLocale(request);
                await assertQuotaAvailable({ locale });
            } catch (error) {
                if (error instanceof QuotaExceededError) {
                    return Response.json(
                        {
                            error: {
                                code: error.code,
                                message: error.message,
                            },
                        },
                        {
                            status: 429,
                            headers: {
                                "X-Quota-Hard-Stop": "true",
                            },
                        }
                    );
                }
                throw error;
            }
        }

        const response = await handler(request, context);

        // Add rate-limit information to response headers
        try {
            response.headers.set(
                "X-RateLimit-Limit",
                String(rateResult.limit)
            );
            response.headers.set(
                "X-RateLimit-Remaining",
                String(rateResult.remaining)
            );
        } catch {
            // Immutable response headers can safely be left untouched
        }

        return response;
    };
}
