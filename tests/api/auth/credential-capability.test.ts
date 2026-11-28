import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const database = process.env.ASR_TEST_DATABASE_URL;
const origin = "http://localhost:3010";
const fixtures = [
    { id: randomUUID(), providers: ["credential"], status: "password" },
    { id: randomUUID(), providers: ["google"], status: "none" },
    {
        id: randomUUID(),
        providers: ["google", "credential"],
        status: "password",
    },
    { id: randomUUID(), providers: ["invalid-credential"], status: "unknown" },
    { id: randomUUID(), providers: [], status: "unknown" },
] as const;

describe.skipIf(!database)("owner-scoped credential capability", () => {
    let pool: Pool;
    let server: typeof import("@/lib/server/auth");
    const cookies = new Map<string, string>();
    const ip = "198.19." + randomInt(0, 256) + "." + randomInt(1, 255);
    const request = (cookie?: string, userId?: string) =>
        server.handleAuthRequest(
            new Request(
                origin +
                    "/api/auth/credential-capability" +
                    (userId ? "?userId=" + userId : ""),
                {
                    headers: {
                        "x-forwarded-for": ip,
                        ...(cookie ? { cookie } : {}),
                    },
                }
            )
        );

    beforeAll(async () => {
        vi.stubEnv("DATABASE_URL", database);
        vi.stubEnv("AUTH_TRUST_PROXY", "true");
        vi.stubEnv("BETTER_AUTH_URL", origin);
        vi.stubEnv(
            "BETTER_AUTH_SECRET",
            "ticket21-capability-secret-32-characters"
        );
        pool = new Pool({ connectionString: database });
        server = await import("@/lib/server/auth");
        const cookieName = (await server.auth.$context).authCookies.sessionToken
            .name;
        const hash = await (
            await server.auth.$context
        ).password.hash("Fixture-password-123!");
        for (const fixture of fixtures) {
            await pool.query(
                "insert into auth_user(id,email,name,email_verified) values($1,$2,'Capability fixture',true)",
                [fixture.id, fixture.id + "@example.test"]
            );
            for (const provider of fixture.providers) {
                await pool.query(
                    "insert into auth_account(id,account_id,provider_id,user_id,password) values($1,$2,$3,$4,$5)",
                    [
                        randomUUID(),
                        randomUUID(),
                        provider === "invalid-credential"
                            ? "credential"
                            : provider,
                        fixture.id,
                        provider === "credential" ? hash : null,
                    ]
                );
            }
            const token = randomBytes(32).toString("hex");
            await pool.query(
                "insert into auth_session(id,expires_at,token,user_id) values($1,now()+interval '10 minutes',$2,$3)",
                [randomUUID(), token, fixture.id]
            );
            cookies.set(
                fixture.id,
                cookieName +
                    "=" +
                    encodeURIComponent(
                        token +
                            "." +
                            createHmac("sha256", server.AUTH_SECRET)
                                .update(token)
                                .digest("base64")
                    )
            );
        }
    }, 60_000);

    afterAll(async () => {
        if (pool) {
            await pool.query("delete from auth_user where id=any($1::uuid[])", [
                fixtures.map((fixture) => fixture.id),
            ]);
            await pool.query("delete from auth_rate_limit where key=$1", [
                ip + "|/credential-capability",
            ]);
            await pool.end();
        }
        vi.unstubAllEnvs();
    }, 60_000);

    it("returns only the signed-in owner's capability, including linked and invalid credentials", async () => {
        expect((await request()).status).toBe(401);
        for (const fixture of fixtures) {
            const another = fixtures.find(
                (candidate) => candidate.id !== fixture.id
            )!;
            const res = await request(cookies.get(fixture.id), another.id);
            expect(res.status).toBe(200);
            expect(res.headers.get("cache-control")).toBe("private, no-store");
            expect(await res.json()).toEqual({ status: fixture.status });
        }
    }, 60_000);
});
