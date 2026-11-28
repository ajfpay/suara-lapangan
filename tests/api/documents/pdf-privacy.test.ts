import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as pdf } from "@/app/api/pdf/[id]/route";
import { GET as preview } from "@/app/api/pdf/[id]/preview/route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";

const { session, lookup } = vi.hoisted(() => ({
    session: vi.fn(),
    lookup: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
    getSession: session,
    canAccessDocument: (
        s: { user: { id: string; role: string } },
        owner: string
    ) => s.user.id === owner || s.user.role === "admin",
}));
vi.mock("@/lib/server/db/documentStore", () => ({
    getPostgresDocumentStore: () => ({ get: lookup }),
}));

const id = "550e8400-e29b-41d4-a716-446655440000";
for (const [name, route] of [
    ["PDF", pdf],
    ["preview", preview],
] as const) {
    describe(name + " access", () => {
        beforeEach(() => {
            vi.resetAllMocks();
            resetRateLimits();
        });
        it("returns private 401 before attempting document lookup", async () => {
            session.mockResolvedValue(null);
            lookup.mockRejectedValue(new Error("database unavailable"));
            const response = await route(
                new Request("http://localhost/api/pdf/" + id),
                { params: Promise.resolve({ id }) }
            );
            expect(response.status).toBe(401);
            expect(lookup).not.toHaveBeenCalled();
            expect(response.headers.get("cache-control")).toBe(
                "private, no-store"
            );
        });
    });
}

it("throttles repeated preview requests and preserves private no-store on 429", async () => {
    resetRateLimits();
    session.mockResolvedValue({ user: { id: "owner", role: "user" } });
    lookup.mockResolvedValue(null);
    for (let i = 0; i < 31; i++) {
        const response = await preview(
            new Request("http://localhost/api/pdf/" + id + "/preview"),
            { params: Promise.resolve({ id }) }
        );
        expect(response.status).toBe(i < 30 ? 404 : 429);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        if (i === 30)
            expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(
                0
            );
    }
});
