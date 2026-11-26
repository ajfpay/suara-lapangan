import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, end, createPool } = vi.hoisted(() => ({
    query: vi.fn(),
    end: vi.fn(),
    createPool: vi.fn(),
}));
vi.mock("pg", () => ({
    Pool: class {
        query = query;
        end = end;
        on = vi.fn();
        constructor(config: unknown) {
            createPool(config);
        }
    },
}));

describe("health database boundary", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.stubEnv("DATABASE_URL", "postgresql://fake:fake@127.0.0.1/health");
        query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
        end.mockResolvedValue(undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });
    it("coalesces simultaneous health calls and reuses recent results", async () => {
        const { GET } = await import("./route");
        const responses = await Promise.all(
            Array.from({ length: 25 }, () => GET())
        );
        expect(responses.every((r) => r.status === 200)).toBe(true);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith("SELECT 1");
        expect((await GET()).status).toBe(200);
        expect(query).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(5001);
        expect((await GET()).status).toBe(200);
        expect(query).toHaveBeenCalledTimes(2);
    });
    it("returns 503 on database failure and retries after the short cache expires", async () => {
        const { GET } = await import("./route");
        query.mockRejectedValueOnce(new Error("secret connection failure"));
        expect((await GET()).status).toBe(503);
        expect((await GET()).status).toBe(503);
        expect(query).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(5001);
        expect((await GET()).status).toBe(200);
    });
    it("does not reuse readiness from a different database URL", async () => {
        const { GET } = await import("./route");
        expect((await GET()).status).toBe(200);
        vi.stubEnv("DATABASE_URL", "postgresql://fake:fake@127.0.0.1/other");
        query.mockRejectedValueOnce(new Error("unavailable"));
        expect((await GET()).status).toBe(503);
        expect(end).toHaveBeenCalledTimes(1);
        expect(createPool).toHaveBeenCalledTimes(2);
    });
    it("fails closed without a database URL", async () => {
        vi.stubEnv("DATABASE_URL", "");
        const { GET } = await import("./route");
        expect((await GET()).status).toBe(503);
        expect(query).not.toHaveBeenCalled();
    });
});
