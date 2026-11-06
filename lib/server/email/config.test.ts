import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGmailConfig, getEmailConfig, getSmtpConfig } from "./config";

const ENV_KEYS = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "SMTP_SECURE",
    "SMTP_REQUIRE_TLS",
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
    "GMAIL_FROM",
] as const;

function saveEnv(): Record<(typeof ENV_KEYS)[number], string | undefined> {
    const saved = {} as Record<(typeof ENV_KEYS)[number], string | undefined>;
    for (const key of ENV_KEYS) {
        saved[key] = process.env[key];
    }
    return saved;
}

function restoreEnv(
    saved: Record<(typeof ENV_KEYS)[number], string | undefined>
): void {
    for (const key of ENV_KEYS) {
        const value = saved[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

function setBaseEnv(): void {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "long-enough-password";
    process.env.SMTP_FROM = "sender@example.com";
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_REQUIRE_TLS;
}

describe("getSmtpConfig", () => {
    let saved: ReturnType<typeof saveEnv>;

    beforeEach(() => {
        saved = saveEnv();
        setBaseEnv();
    });

    afterEach(() => {
        restoreEnv(saved);
    });

    it("returns null when any required variable is missing", () => {
        delete process.env.SMTP_HOST;
        expect(getSmtpConfig()).toBeNull();

        setBaseEnv();
        delete process.env.SMTP_PORT;
        expect(getSmtpConfig()).toBeNull();

        setBaseEnv();
        delete process.env.SMTP_USER;
        expect(getSmtpConfig()).toBeNull();

        setBaseEnv();
        delete process.env.SMTP_PASS;
        expect(getSmtpConfig()).toBeNull();

        setBaseEnv();
        delete process.env.SMTP_FROM;
        expect(getSmtpConfig()).toBeNull();
    });

    it("returns null for a port outside 1-65535", () => {
        process.env.SMTP_PORT = "0";
        expect(getSmtpConfig()).toBeNull();

        process.env.SMTP_PORT = "70000";
        expect(getSmtpConfig()).toBeNull();

        process.env.SMTP_PORT = "not-a-number";
        expect(getSmtpConfig()).toBeNull();
    });

    it("requires a password of at least 8 characters", () => {
        process.env.SMTP_PASS = "short";
        expect(getSmtpConfig()).toBeNull();
    });

    it("defaults to non-secure with requireTLS on port 587", () => {
        const config = getSmtpConfig();
        expect(config).not.toBeNull();
        expect(config!.secure).toBe(false);
        expect(config!.requireTls).toBe(true);
    });

    it("infers implicit TLS on port 465", () => {
        process.env.SMTP_PORT = "465";
        const config = getSmtpConfig();
        expect(config).not.toBeNull();
        expect(config!.secure).toBe(true);
        expect(config!.requireTls).toBe(false);
    });

    it("SMTP_SECURE=true forces implicit TLS even on port 587", () => {
        process.env.SMTP_SECURE = "true";
        const config = getSmtpConfig();
        expect(config!.secure).toBe(true);
        expect(config!.requireTls).toBe(false);
    });

    it("SMTP_REQUIRE_TLS=false turns off the STARTTLS requirement", () => {
        process.env.SMTP_REQUIRE_TLS = "false";
        const config = getSmtpConfig();
        expect(config!.secure).toBe(false);
        expect(config!.requireTls).toBe(false);
    });
});

describe("getGmailConfig", () => {
    let saved: ReturnType<typeof saveEnv>;

    beforeEach(() => {
        saved = saveEnv();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreEnv(saved);
    });

    function setGmailBaseEnv(): void {
        process.env.GMAIL_CLIENT_ID = "test-client-id";
        process.env.GMAIL_CLIENT_SECRET = "test-gmail-client-secret";
        process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token";
        process.env.GMAIL_FROM = "noreply@suara-lapangan-test.local";
    }

    it("returns null when any required variable is missing", () => {
        expect(getGmailConfig()).toBeNull();

        setGmailBaseEnv();
        delete process.env.GMAIL_CLIENT_SECRET;
        expect(getGmailConfig()).toBeNull();

        setGmailBaseEnv();
        delete process.env.GMAIL_REFRESH_TOKEN;
        expect(getGmailConfig()).toBeNull();
    });

    it("treats GMAIL_FROM as optional (null -> omit From header)", () => {
        setGmailBaseEnv();
        delete process.env.GMAIL_FROM;
        const config = getGmailConfig();
        expect(config).not.toBeNull();
        expect(config!.from).toBeNull();
    });

    it("returns null for blank values", () => {
        setGmailBaseEnv();
        process.env.GMAIL_REFRESH_TOKEN = "   ";
        expect(getGmailConfig()).toBeNull();
    });

    it("returns the config when all variables are set", () => {
        setGmailBaseEnv();
        const config = getGmailConfig();
        expect(config).not.toBeNull();
        expect(config!.kind).toBe("gmail");
        expect(config!.from).toBe("noreply@suara-lapangan-test.local");
    });

    it("getEmailConfig prefers Gmail when both are configured", () => {
        setGmailBaseEnv();
        setBaseEnv();

        expect(getEmailConfig()?.kind).toBe("gmail");
    });

    it("getEmailConfig falls back to SMTP when Gmail is unset", () => {
        setBaseEnv();

        expect(getEmailConfig()?.kind).toBe("smtp");
    });

    it("warns when Gmail config is partial and names missing keys", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        process.env.GMAIL_CLIENT_ID = "test-client-id";
        delete process.env.GMAIL_CLIENT_SECRET;
        delete process.env.GMAIL_REFRESH_TOKEN;

        expect(getGmailConfig()).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        const warning = warnSpy.mock.calls[0]?.[0] as string;
        expect(warning).toContain("GMAIL_CLIENT_SECRET");
        expect(warning).toContain("GMAIL_REFRESH_TOKEN");
    });

    it("does not warn when all required Gmail variables are set", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        setGmailBaseEnv();

        expect(getGmailConfig()).not.toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when no Gmail variables are set", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        delete process.env.GMAIL_CLIENT_ID;
        delete process.env.GMAIL_CLIENT_SECRET;
        delete process.env.GMAIL_REFRESH_TOKEN;
        delete process.env.GMAIL_FROM;

        expect(getGmailConfig()).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not leak secret values in the partial config warning", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        process.env.GMAIL_CLIENT_ID = "test-client-id";
        process.env.GMAIL_CLIENT_SECRET = "super-secret-client-secret-12345";
        delete process.env.GMAIL_REFRESH_TOKEN;

        expect(getGmailConfig()).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        const warning = warnSpy.mock.calls[0]?.[0] as string;
        expect(warning).toContain("GMAIL_REFRESH_TOKEN");
        expect(warning).not.toContain("super-secret-client-secret-12345");
    });

    it("does not warn when only optional GMAIL_FROM is set", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        delete process.env.GMAIL_CLIENT_ID;
        delete process.env.GMAIL_CLIENT_SECRET;
        delete process.env.GMAIL_REFRESH_TOKEN;
        process.env.GMAIL_FROM = "sender@example.com";

        expect(getGmailConfig()).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
