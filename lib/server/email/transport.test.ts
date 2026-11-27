import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getEmailConfig } from "./config";
import { sendEmail } from "./send";

afterEach(() => vi.unstubAllEnvs());

describe("development mail transport", () => {
    it("uses explicit Mailpit configuration outside production", () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("SMTP_HOST", "100.94.246.116");
        vi.stubEnv("SMTP_PORT", "1025");
        vi.stubEnv("SMTP_FROM", "sandbox@suara-lapangan.test");
        expect(getEmailConfig()).toEqual({
            kind: "smtp",
            host: "100.94.246.116",
            port: 1025,
            from: "sandbox@suara-lapangan.test",
        });
    });
    it("never selects SMTP in production, even with SMTP settings present", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SMTP_HOST", "100.94.246.116");
        vi.stubEnv("GMAIL_CLIENT_ID", "fixture");
        vi.stubEnv("GMAIL_CLIENT_SECRET", "fixture");
        vi.stubEnv("GMAIL_REFRESH_TOKEN", "fixture");
        expect(getEmailConfig()?.kind).toBe("gmail");
        vi.stubEnv("GMAIL_REFRESH_TOKEN", undefined);
        expect(getEmailConfig()).toBeNull();
    });
    it("uses default SMTP port for blank configuration", () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("SMTP_HOST", "mail.test");
        vi.stubEnv("SMTP_PORT", " ");
        expect(getEmailConfig()).toMatchObject({ kind: "smtp", port: 1025 });
    });
    it("fails closed on malformed configured SMTP ports", () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("SMTP_HOST", "100.94.246.116");
        vi.stubEnv("SMTP_PORT", "1025oops");
        expect(getEmailConfig()).toBeNull();
    });
    it.skipIf(process.env.AUTH_TEST_SMTP !== "1")(
        "delivers a synthetic message to the approved development Mailpit",
        async () => {
            vi.stubEnv("NODE_ENV", "development");
            vi.stubEnv("SMTP_HOST", "100.94.246.116");
            vi.stubEnv("SMTP_PORT", "1025");
            const to = "ticket04-" + randomUUID() + "@example.test";
            const subject = "Ticket 04 transport fixture";
            const config = getEmailConfig();
            expect(config?.kind).toBe("smtp");
            if (!config) throw new Error("Missing sandbox mail configuration");
            await sendEmail(config, {
                to,
                subject,
                text: "Synthetic transport proof; no credentials or account links.",
                attachments: [],
            });
            const query = new URLSearchParams({ query: "to:" + to });
            const result = await fetch(
                "http://100.94.246.116:8025/api/v1/search?" + query,
                { signal: AbortSignal.timeout(5000) }
            );
            expect(result.ok).toBe(true);
            const response = (await result.json()) as {
                messages?: { Subject: string }[];
            };
            expect(
                response.messages?.some(
                    (message) => message.Subject === subject
                )
            ).toBe(true);
        },
        25000
    );
});
