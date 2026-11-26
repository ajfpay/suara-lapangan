import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const testDatabaseUrl = process.env.ASR_TEST_DATABASE_URL;

describe("health with the real PostgreSQL driver", () => {
    afterEach(() => vi.unstubAllEnvs());

    it.skipIf(!testDatabaseUrl)(
        "reports readiness against the disposable test database",
        async () => {
            vi.stubEnv("DATABASE_URL", testDatabaseUrl!);
            const response = await GET();
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({
                database: { status: "ok" },
            });
        }
    );

    it("returns a sanitized 503 when the real driver cannot connect", async () => {
        vi.stubEnv(
            "DATABASE_URL",
            "postgresql://fake:fake-secret@127.0.0.1:1/health?sslmode=disable"
        );
        const response = await GET();
        expect(response.status).toBe(503);
        const body = await response.text();
        expect(JSON.parse(body)).toMatchObject({
            database: { status: "error" },
        });
        expect(body).not.toContain("fake-secret");
    });
});
