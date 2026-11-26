import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDatabaseReadiness } = vi.hoisted(() => ({
    mockDatabaseReadiness: vi.fn(),
}));

vi.mock("./healthCheck", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./healthCheck")>();
    return {
        ...actual,
        databaseReadiness: () => actual.checkHealth(mockDatabaseReadiness),
    };
});

import { GET } from "./route";

describe("GET /api/health", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 ok with database readiness and no-store caching", async () => {
        mockDatabaseReadiness.mockResolvedValueOnce(undefined);

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toMatchObject({
            status: "ok",
            service: "suara-lapangan",
            database: {
                status: "ok",
            },
        });
        expect(typeof body.database.latencyMs).toBe("number");
        expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
        expect(typeof body.timestamp).toBe("string");
    });

    it("returns 503 degraded when the database probe fails without leaking credentials", async () => {
        mockDatabaseReadiness.mockRejectedValueOnce(
            new Error(
                "connect failed for postgresql://suara_lapangan_test:super-secret-pass@100.69.30.9:5432/suara_lapangan_test"
            )
        );

        const response = await GET();
        const rawText = await response.text();
        const body = JSON.parse(rawText);

        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toMatchObject({
            status: "degraded",
            service: "suara-lapangan",
            database: {
                status: "error",
            },
        });
        expect(rawText).not.toContain("super-secret-pass");
        expect(rawText).not.toContain("postgresql://");
        expect(rawText).not.toContain("100.69.30.9");
    });
});
