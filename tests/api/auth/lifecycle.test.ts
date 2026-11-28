import { createHash, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthTables } from "@better-auth/core/db";

const mail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/email/send", () => ({ sendEmail: mail }));

const database = process.env.ASR_TEST_DATABASE_URL;
describe.skipIf(!database)("authentication lifecycle", () => {
    let pool: Pool;
    let server: typeof import("@/lib/server/auth");
    const email = "ticket04-" + randomUUID() + "@example.test";
    const googleEmail = "ticket04-" + randomUUID() + "@example.test";
    const unknownEmail = "ticket04-" + randomUUID() + "@example.test";
    const googleId = randomUUID();
    const original = "Test-password-123!";
    const changed = "Test-password-456!";
    const final = "Test-password-789!";
    const origin = "http://localhost:3010";
    let ownerId: string;
    let source = 0;
    const prefix = "198.19." + randomInt(0, 256) + ".";
    const usedRateKeys = new Set<string>();

    function request(
        path: string,
        body?: object,
        cookie?: string,
        extra?: Record<string, string>
    ) {
        const headers = new Headers({
            origin,
            "x-forwarded-for": prefix + ((++source % 250) + 1),
            ...extra,
        });
        if (extra?.["expo-origin"]) headers.delete("origin");
        if (body) headers.set("content-type", "application/json");
        if (cookie) headers.set("cookie", cookie);
        usedRateKeys.add(headers.get("x-forwarded-for") + "|/" + path);
        return server.handleAuthRequest(
            new Request(origin + "/api/auth/" + path, {
                method: body ? "POST" : "GET",
                headers,
                body: body ? JSON.stringify(body) : undefined,
            })
        );
    }

    function cookieOf(response: Response): string {
        const header = response.headers
            .getSetCookie()
            .find((s) => s.includes("better-auth.session_token="));
        expect(header).toBeTruthy();
        expect(header).toMatch(/HttpOnly/i);
        return header!.split(";")[0];
    }
    function mailLink(): URL {
        const text = mail.mock.calls.at(-1)?.[1]?.text as string;
        const match = text?.match(/https?:\/\/[^\s]+/);
        if (!match) throw new Error("Expected a mail link");
        return new URL(match[0]);
    }
    beforeAll(async () => {
        vi.stubEnv("DATABASE_URL", database);
        vi.stubEnv("BETTER_AUTH_URL", origin);
        vi.stubEnv("TRUSTED_ORIGINS", origin);
        vi.stubEnv("NATIVE_AUTH_ORIGINS", "suara-lapangan://");
        vi.stubEnv(
            "BETTER_AUTH_SECRET",
            "ticket04-test-secret-at-least-32-characters"
        );
        vi.stubEnv("SMTP_HOST", "100.94.246.116");
        pool = new Pool({ connectionString: database });
        server = await import("@/lib/server/auth");
        await pool.query(
            "insert into auth_user(id,email,name,email_verified) values($1,$2,'Google fixture',true)",
            [googleId, googleEmail]
        );
        await pool.query(
            "insert into auth_account(id,account_id,provider_id,user_id) values($1,$2,'google',$3)",
            [randomUUID(), randomUUID(), googleId]
        );
    });
    afterAll(async () => {
        if (pool) {
            await pool.query(
                "delete from auth_verification where value=any($1::text[])",
                [[ownerId, googleId].filter(Boolean)]
            );
            await pool.query(
                "delete from auth_user where email=any($1::text[])",
                [[email, googleEmail]]
            );
            await pool.query(
                "delete from auth_rate_limit where key=any($1::text[])",
                [[...usedRateKeys]]
            );
            await pool.end();
        }
        vi.unstubAllEnvs();
    });

    it("matches existing auth database columns", async () => {
        const tables = getAuthTables(server.auth.options);
        for (const table of Object.values(tables)) {
            const { rows } = await pool.query(
                "select column_name from information_schema.columns where table_schema='public' and table_name=$1",
                [table.modelName]
            );
            const columns = new Set(rows.map((r) => r.column_name));
            expect(columns.has("id")).toBe(true);
            for (const [name, field] of Object.entries(table.fields))
                expect(
                    columns.has(field.fieldName ?? name),
                    table.modelName + "." + name
                ).toBe(true);
        }
    });
    it("supports verified registration, profile and password changes, reset and session revocation", async () => {
        const register = await request("sign-up/email", {
            email,
            password: original,
            name: "Ticket 04 fixture",
            callbackURL: "/en/login",
        });
        expect(register.status).toBe(200);
        const user = (await register.json()).user;
        ownerId = user.id;
        expect(user.emailVerified).toBe(false);
        expect(
            (await request("sign-in/email", { email, password: original }))
                .status
        ).toBe(403);
        const verify = await server.handleAuthRequest(
            new Request(mailLink(), { headers: { origin } })
        );
        expect([200, 302]).toContain(verify.status);
        const login = await request("sign-in/email", {
            email,
            password: original,
        });
        expect(login.status).toBe(200);
        const cookie = cookieOf(login);
        expect(
            (await (await request("get-session", undefined, cookie)).json())
                .user.id
        ).toBe(ownerId);
        expect(
            (await request("update-user", { name: "Updated fixture" }, cookie))
                .status
        ).toBe(200);
        expect(
            (await (await request("get-session", undefined, cookie)).json())
                .user.name
        ).toBe("Updated fixture");
        expect(
            (
                await request(
                    "change-password",
                    { currentPassword: "wrong-password", newPassword: changed },
                    cookie
                )
            ).status
        ).not.toBe(200);
        expect(
            (
                await request(
                    "change-password",
                    {
                        currentPassword: original,
                        newPassword: changed,
                        revokeOtherSessions: true,
                    },
                    cookie
                )
            ).status
        ).toBe(200);
        expect(
            (await request("sign-in/email", { email, password: original }))
                .status
        ).not.toBe(200);
        const current = cookieOf(
            await request("sign-in/email", { email, password: changed })
        );
        const second = cookieOf(
            await request("sign-in/email", { email, password: changed })
        );
        expect(
            (
                await request("request-password-reset", {
                    email,
                    redirectTo: "/en/reset-password",
                })
            ).status
        ).toBe(200);
        const reset = mailLink();
        expect(reset.pathname).toBe("/en/reset-password");
        const token = new URLSearchParams(reset.hash.slice(1)).get("token");
        expect(token).toBeTruthy();
        const { rows } = await pool.query(
            "select identifier,extract(epoch from expires_at-now()) as ttl from auth_verification where value=$1",
            [ownerId]
        );
        expect(
            rows.some(
                (r) =>
                    Number(r.ttl) > 1700 &&
                    Number(r.ttl) <= 1800 &&
                    !r.identifier.includes(token)
            )
        ).toBe(true);
        const lockClient = await pool.connect();
        try {
            await lockClient.query("begin");
            const key = createHash("sha256")
                .update("password-reset:" + token)
                .digest()
                .readBigInt64BE()
                .toString();
            await lockClient.query("select pg_advisory_xact_lock($1::bigint)", [
                key,
            ]);
            const busy = await request("reset-password", {
                token,
                newPassword: final,
            });
            expect(busy.status).toBe(409);
            expect(await busy.json()).toMatchObject({
                code: "RESET_IN_PROGRESS",
            });
        } finally {
            try {
                await lockClient.query("rollback");
                lockClient.release();
            } catch {
                lockClient.release(true);
            }
        }

        const outcomes = await Promise.all([
            request("reset-password", { token, newPassword: final }),
            request("reset-password", { token, newPassword: final }),
        ]);
        expect(outcomes.filter((r) => r.status === 200)).toHaveLength(1);
        const rejected = outcomes.find((r) => r.status !== 200)!;
        expect([400, 409]).toContain(rejected.status);
        expect(await rejected.json()).toMatchObject({
            code:
                rejected.status === 409 ? "RESET_IN_PROGRESS" : "INVALID_TOKEN",
        });
        expect(
            (await request("reset-password", { token, newPassword: final }))
                .status
        ).toBe(400);
        for (const old of [cookie, current, second])
            expect(
                await (await request("get-session", undefined, old)).json()
            ).toBeNull();
        expect(
            (await request("sign-in/email", { email, password: changed }))
                .status
        ).not.toBe(200);
        const fresh = cookieOf(
            await request("sign-in/email", { email, password: final })
        );
        expect((await request("sign-out", {}, fresh)).status).toBe(200);
        expect(
            await (await request("get-session", undefined, fresh)).json()
        ).toBeNull();
        expect(
            (
                await request("request-password-reset", {
                    email,
                    redirectTo: "/en/reset-password",
                })
            ).status
        ).toBe(200);
        const expired = new URLSearchParams(mailLink().hash.slice(1)).get(
            "token"
        );
        const identifier = createHash("sha256")
            .update("reset-password:" + expired)
            .digest("base64url");
        await pool.query(
            "update auth_verification set expires_at=now()-interval '1 minute' where identifier=$1",
            [identifier]
        );
        expect(
            (
                await request("reset-password", {
                    token: expired,
                    newPassword: original,
                })
            ).status
        ).toBe(400);
    });
    it("gives unknown and Google-only accounts the same response without mail", async () => {
        const before = mail.mock.calls.length;
        const unknown = await request("request-password-reset", {
            email: unknownEmail,
            redirectTo: "/id/reset-password",
        });
        const google = await request("request-password-reset", {
            email: googleEmail,
            redirectTo: "/id/reset-password",
        });
        expect(unknown.status).toBe(200);
        expect(google.status).toBe(200);
        expect(await unknown.json()).toEqual(await google.json());
        expect(mail.mock.calls.length).toBe(before);
        expect(
            (
                await pool.query(
                    "select 1 from auth_verification where value=$1",
                    [googleId]
                )
            ).rowCount
        ).toBe(0);
    });
    it("rejects untrusted callbacks and anonymous profile writes", async () => {
        expect(
            (await request("update-user", { name: "no session" })).status
        ).toBe(401);
        expect(
            (
                await request("request-password-reset", {
                    email: unknownEmail,
                    redirectTo: "evil://reset-password",
                })
            ).status
        ).toBe(403);
        expect(
            (
                await request(
                    "request-password-reset",
                    {
                        email: unknownEmail,
                        redirectTo: "suara-lapangan://reset-password",
                    },
                    undefined,
                    { "expo-origin": "suara-lapangan://" }
                )
            ).status
        ).toBe(200);
    });
    it("limits reset requests for the same normalized email across different network addresses", async () => {
        const address = "ticket04-limit-" + randomUUID() + "@example.test";
        for (let i = 0; i < 5; i++) {
            expect(
                (
                    await request("request-password-reset", {
                        email: i % 2 ? address.toUpperCase() : address,
                        redirectTo: "/id/reset-password",
                    })
                ).status
            ).toBe(200);
        }
        expect(
            (
                await request("request-password-reset", {
                    email: address,
                    redirectTo: "/id/reset-password",
                })
            ).status
        ).toBe(429);
    });
    it("keeps the recovery response generic if the email transport fails", async () => {
        const callsBefore = mail.mock.calls.length;
        mail.mockRejectedValueOnce(new Error("Synthetic transport failure"));
        const known = await request("request-password-reset", {
            email,
            redirectTo: "/id/reset-password",
        });
        const unknown = await request("request-password-reset", {
            email: "ticket04-" + randomUUID() + "@example.test",
            redirectTo: "/id/reset-password",
        });
        expect(known.status).toBe(200);
        expect(await known.json()).toEqual(await unknown.json());
        expect(mail.mock.calls.length).toBe(callsBefore + 1);
    });
});
