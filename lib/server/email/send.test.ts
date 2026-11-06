import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GmailConfig } from "./config";
import {
    buildMimeMessage,
    GmailApiError,
    GMAIL_SEND_URL,
    GMAIL_TOKEN_URL,
    sendViaGmailApi,
    __resetGmailTokenCacheForTest,
    type SendEmailOptions,
} from "./send";

const FAKE_GMAIL_CONFIG: GmailConfig = {
    kind: "gmail",
    clientId: "fake-client-id-12345.apps.googleusercontent.com",
    clientSecret: "GOCSPX-fakeclientsecret123456789",
    refreshToken: "1//04fakeRefreshTokenAbcDefGhiJklMnoPqrStuVwxYz",
    from: "noreply@example.com",
};

const FAKE_EMAIL_OPTIONS: SendEmailOptions = {
    to: "customer@example.com",
    subject: "Quotation Q-2026-001",
    text: "Please find attached quotation Q-2026-001.",
    attachments: [],
};

describe("Gmail API send", () => {
    beforeEach(() => {
        __resetGmailTokenCacheForTest();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    // 1. Token refresh happy path: fetch returns 200 JSON { access_token, expires_in };
    // assert send is called with the Authorization Bearer header.
    it("refreshes access token and calls send with Authorization Bearer header", async () => {
        const fetchCalls: { url: string; init?: RequestInit }[] = [];

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                const url = typeof input === "string" ? input : input.toString();
                fetchCalls.push({ url, init });

                if (url === GMAIL_TOKEN_URL) {
                    return new Response(
                        JSON.stringify({
                            access_token: "ya29.initial-access-token",
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    return new Response(JSON.stringify({ id: "msg-001" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);

        const tokenCall = fetchCalls.find((c) => c.url === GMAIL_TOKEN_URL);
        expect(tokenCall).toBeDefined();

        const sendCall = fetchCalls.find((c) => c.url === GMAIL_SEND_URL);
        expect(sendCall).toBeDefined();
        const headers = (sendCall?.init?.headers ?? {}) as Record<string, string>;
        expect(headers["Authorization"]).toBe("Bearer ya29.initial-access-token");
    });

    // 2. Cache reuse within TTL: call twice; assert the token URL fetch is hit only once.
    it("reuses cached access token within TTL across multiple calls", async () => {
        let tokenFetchCount = 0;
        let sendFetchCount = 0;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    tokenFetchCount++;
                    return new Response(
                        JSON.stringify({
                            access_token: "ya29.cached-token",
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    sendFetchCount++;
                    return new Response(JSON.stringify({ id: "msg-ok" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);

        expect(tokenFetchCount).toBe(1);
        expect(sendFetchCount).toBe(2);
    });

    // 3. Cache expiry / re-fetch: advance time and assert a second token fetch occurs.
    it("re-fetches access token after cache expires", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));

        let tokenFetchCount = 0;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    tokenFetchCount++;
                    return new Response(
                        JSON.stringify({
                            access_token: `ya29.token-${tokenFetchCount}`,
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    return new Response(JSON.stringify({ id: "msg-ok" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        expect(tokenFetchCount).toBe(1);

        // Advance past TTL (3600s)
        vi.advanceTimersByTime(3600 * 1000);

        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        expect(tokenFetchCount).toBe(2);
    });

    it("re-fetches token when expires_in is tiny (immediate expiry window)", async () => {
        let tokenFetchCount = 0;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    tokenFetchCount++;
                    return new Response(
                        JSON.stringify({
                            access_token: `ya29.short-token-${tokenFetchCount}`,
                            expires_in: 1,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    return new Response(JSON.stringify({ id: "msg-ok" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        expect(tokenFetchCount).toBe(1);

        await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        expect(tokenFetchCount).toBe(2);
    });

    // 4. buildMimeMessage:
    // (a) with from set -> buffer contains "From: <from>";
    // (b) with from null -> buffer does NOT contain a "From:" header line;
    // (c) attachments present -> the buffer contains the attachment filename and Content-Disposition attachment.
    describe("buildMimeMessage", () => {
        it("(a) includes From header when from is set", async () => {
            const buf = await buildMimeMessage(
                "sender@example.com",
                FAKE_EMAIL_OPTIONS
            );
            const str = buf.toString("utf-8");
            expect(str).toContain("From: sender@example.com");
        });

        it("(b) omits From header entirely when from is null", async () => {
            const buf = await buildMimeMessage(null, FAKE_EMAIL_OPTIONS);
            const str = buf.toString("utf-8");
            expect(str).not.toMatch(/^From:/m);
            const lines = str.split("\n");
            expect(
                lines.some((line) => line.toLowerCase().startsWith("from:"))
            ).toBe(false);
        });

        it("(c) includes attachment filename and Content-Disposition attachment", async () => {
            const optionsWithAttachment: SendEmailOptions = {
                ...FAKE_EMAIL_OPTIONS,
                attachments: [
                    {
                        filename: "quotation-2026.pdf",
                        content: Buffer.from("dummy-pdf-stream"),
                        contentType: "application/pdf",
                    },
                ],
            };
            const buf = await buildMimeMessage(
                "sender@example.com",
                optionsWithAttachment
            );
            const str = buf.toString("utf-8");
            expect(str).toContain("quotation-2026.pdf");
            expect(str).toMatch(/Content-Disposition:\s*attachment/i);
        });
    });

    // 5. Successful send: fetch (send URL) returns 200; assert sendViaGmailApi resolves
    // and the send fetch was called with URL GMAIL_SEND_URL, method POST, body being the MIME buffer,
    // and Content-Type message/rfc822.
    it("successfully sends message with raw MIME buffer and message/rfc822 Content-Type", async () => {
        let sendCallInit: RequestInit | undefined;
        let sendCallUrl: string | undefined;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    return new Response(
                        JSON.stringify({
                            access_token: "ya29.send-token",
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    sendCallUrl = url;
                    sendCallInit = init;
                    return new Response(JSON.stringify({ id: "msg-12345" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        await expect(
            sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS)
        ).resolves.toBeUndefined();

        expect(sendCallUrl).toBe(GMAIL_SEND_URL);
        expect(sendCallInit?.method).toBe("POST");
        const headers = (sendCallInit?.headers ?? {}) as Record<string, string>;
        expect(headers["Content-Type"]).toBe("message/rfc822");
        expect(headers["Authorization"]).toBe("Bearer ya29.send-token");
        expect(Buffer.isBuffer(sendCallInit?.body)).toBe(true);
    });

    // 6. 401 then success (the #50 retry): first send fetch returns 401, then a token refresh (200)
    // then a second send fetch returns 200; assert sendViaGmailApi resolves and the send URL fetch was called twice.
    it("clears cached token on 401, re-acquires fresh token, and retries send once", async () => {
        let tokenFetchCount = 0;
        let sendFetchCount = 0;
        const sendAuthHeaders: string[] = [];

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    tokenFetchCount++;
                    const token =
                        tokenFetchCount === 1
                            ? "ya29.initial-stale-token"
                            : "ya29.refreshed-fresh-token";
                    return new Response(
                        JSON.stringify({
                            access_token: token,
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    sendFetchCount++;
                    const headers = (init?.headers ?? {}) as Record<string, string>;
                    sendAuthHeaders.push(headers["Authorization"] ?? "");

                    if (sendFetchCount === 1) {
                        return new Response(
                            JSON.stringify({
                                error: {
                                    code: 401,
                                    message: "Invalid Credentials",
                                    status: "UNAUTHENTICATED",
                                },
                            }),
                            {
                                status: 401,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }

                    return new Response(JSON.stringify({ id: "msg-retry-ok" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        await expect(
            sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS)
        ).resolves.toBeUndefined();

        expect(sendFetchCount).toBe(2);
        expect(tokenFetchCount).toBe(2);
        expect(sendAuthHeaders[0]).toBe("Bearer ya29.initial-stale-token");
        expect(sendAuthHeaders[1]).toBe("Bearer ya29.refreshed-fresh-token");
    });

    // 7. Error mapping: send fetch returns 403 with JSON { error: { code: 403, message: "forbidden" } };
    // assert GmailApiError is thrown with apiStatus 403 and apiErrorCode 403.
    it("maps Gmail send error JSON into GmailApiError with status and errorCode", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    return new Response(
                        JSON.stringify({
                            access_token: "ya29.token",
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    return new Response(
                        JSON.stringify({
                            error: {
                                code: 403,
                                message: "forbidden",
                            },
                        }),
                        {
                            status: 403,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        let thrownError: unknown;
        try {
            await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        } catch (err) {
            thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(GmailApiError);
        const apiError = thrownError as GmailApiError;
        expect(apiError.apiStatus).toBe(403);
        expect(apiError.apiErrorCode).toBe(403);
        expect(apiError.revoked).toBe(false);
        expect(apiError.message).toContain("403");
        expect(apiError.message).toContain("forbidden");
    });

    // 8. Revoked refresh: token fetch returns 400 with JSON { error: "invalid_grant" };
    // assert the thrown GmailApiError has revoked === true.
    it("flags GmailApiError with revoked: true on invalid_grant response", async () => {
        let sendFetchCalled = false;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    return new Response(
                        JSON.stringify({
                            error: "invalid_grant",
                            error_description: "Token has been expired or revoked.",
                        }),
                        {
                            status: 400,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    sendFetchCalled = true;
                    return new Response(JSON.stringify({ id: "msg" }), {
                        status: 200,
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        let thrownError: unknown;
        try {
            await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        } catch (err) {
            thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(GmailApiError);
        const apiError = thrownError as GmailApiError;
        expect(apiError.revoked).toBe(true);
        expect(apiError.apiStatus).toBe(400);
        expect(apiError.message).toContain("invalid_grant");
        expect(sendFetchCalled).toBe(false);
    });

    it("does not set revoked: true on 5xx or transient refresh errors", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    return new Response("Internal Server Error", {
                        status: 500,
                        headers: { "Content-Type": "text/plain" },
                    });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        let thrownError: unknown;
        try {
            await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        } catch (err) {
            thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(GmailApiError);
        const apiError = thrownError as GmailApiError;
        expect(apiError.revoked).toBe(false);
        expect(apiError.apiStatus).toBe(500);
    });

    it("does not retry send on 401 when token re-acquisition fails with revoked", async () => {
        let tokenFetchCount = 0;
        let sendFetchCount = 0;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    tokenFetchCount++;
                    if (tokenFetchCount === 1) {
                        return new Response(
                            JSON.stringify({
                                access_token: "ya29.initial-token",
                                expires_in: 3600,
                            }),
                            {
                                status: 200,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }
                    return new Response(
                        JSON.stringify({
                            error: "invalid_grant",
                            error_description: "Token has been revoked.",
                        }),
                        {
                            status: 400,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    sendFetchCount++;
                    return new Response("Unauthorized", { status: 401 });
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        let thrownError: unknown;
        try {
            await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        } catch (err) {
            thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(GmailApiError);
        const apiError = thrownError as GmailApiError;
        expect(apiError.revoked).toBe(true);
        expect(sendFetchCount).toBe(1);
        expect(tokenFetchCount).toBe(2);
    });

    it("throws on 401 retry failure without looping forever", async () => {
        let sendFetchCount = 0;

        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = typeof input === "string" ? input : input.toString();

                if (url === GMAIL_TOKEN_URL) {
                    return new Response(
                        JSON.stringify({
                            access_token: "ya29.token",
                            expires_in: 3600,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                if (url === GMAIL_SEND_URL) {
                    sendFetchCount++;
                    return new Response(
                        JSON.stringify({ error: { code: 401, message: "Invalid credentials" } }),
                        {
                            status: 401,
                            headers: { "Content-Type": "application/json" },
                        }
                    );
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            })
        );

        let thrownError: unknown;
        try {
            await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
        } catch (err) {
            thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(GmailApiError);
        const apiError = thrownError as GmailApiError;
        expect(apiError.apiStatus).toBe(401);
        expect(sendFetchCount).toBe(2);
    });

    // 9. Abort/timeout (#49): mock fetch to reject with a DOMException named "AbortError"
    // (or assert the fetch call received a signal); assert sendViaGmailApi rejects with a
    // GmailApiError whose apiStatus is 408 and message mentions the timeout.
    describe("AbortSignal and timeout handling (#49)", () => {
        it("passes an AbortSignal to both token refresh and send fetch calls", async () => {
            const capturedSignals: { url: string; signal: unknown }[] = [];

            vi.stubGlobal(
                "fetch",
                vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                    const url = typeof input === "string" ? input : input.toString();
                    capturedSignals.push({ url, signal: init?.signal });

                    if (url === GMAIL_TOKEN_URL) {
                        return new Response(
                            JSON.stringify({
                                access_token: "ya29.token",
                                expires_in: 3600,
                            }),
                            {
                                status: 200,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }

                    if (url === GMAIL_SEND_URL) {
                        return new Response(JSON.stringify({ id: "msg-123" }), {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    throw new Error(`Unexpected fetch URL: ${url}`);
                })
            );

            await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);

            const tokenSignal = capturedSignals.find((s) => s.url === GMAIL_TOKEN_URL)?.signal;
            const sendSignal = capturedSignals.find((s) => s.url === GMAIL_SEND_URL)?.signal;

            expect(tokenSignal).toBeInstanceOf(AbortSignal);
            expect(sendSignal).toBeInstanceOf(AbortSignal);
        });

        it("maps token refresh abort rejection into GmailApiError with status 408 and 10s timeout message", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async (input: string | URL | Request) => {
                    const url = typeof input === "string" ? input : input.toString();

                    if (url === GMAIL_TOKEN_URL) {
                        throw new DOMException("The operation was aborted", "AbortError");
                    }

                    throw new Error(`Unexpected fetch URL: ${url}`);
                })
            );

            let thrownError: unknown;
            try {
                await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(GmailApiError);
            const apiError = thrownError as GmailApiError;
            expect(apiError.apiStatus).toBe(408);
            expect(apiError.message).toContain("Gmail token refresh timed out after 10s");
        });

        it("maps send abort rejection into GmailApiError with status 408 and 30s timeout message", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async (input: string | URL | Request) => {
                    const url = typeof input === "string" ? input : input.toString();

                    if (url === GMAIL_TOKEN_URL) {
                        return new Response(
                            JSON.stringify({
                                access_token: "ya29.token",
                                expires_in: 3600,
                            }),
                            {
                                status: 200,
                                headers: { "Content-Type": "application/json" },
                            }
                        );
                    }

                    if (url === GMAIL_SEND_URL) {
                        throw new DOMException("The operation was aborted", "AbortError");
                    }

                    throw new Error(`Unexpected fetch URL: ${url}`);
                })
            );

            let thrownError: unknown;
            try {
                await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(GmailApiError);
            const apiError = thrownError as GmailApiError;
            expect(apiError.apiStatus).toBe(408);
            expect(apiError.message).toContain("Gmail send timed out after 30s");
        });

        it("maps TimeoutError rejection into GmailApiError with status 408", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn(async (input: string | URL | Request) => {
                    const url = typeof input === "string" ? input : input.toString();

                    if (url === GMAIL_TOKEN_URL) {
                        throw new DOMException(
                            "The operation was aborted due to timeout",
                            "TimeoutError"
                        );
                    }

                    throw new Error(`Unexpected fetch URL: ${url}`);
                })
            );

            let thrownError: unknown;
            try {
                await sendViaGmailApi(FAKE_GMAIL_CONFIG, FAKE_EMAIL_OPTIONS);
            } catch (err) {
                thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(GmailApiError);
            const apiError = thrownError as GmailApiError;
            expect(apiError.apiStatus).toBe(408);
            expect(apiError.message).toContain("Gmail token refresh timed out after 10s");
        });
    });
});
