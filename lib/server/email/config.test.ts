import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSmtpConfig } from "./config";

const ENV_KEYS = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "SMTP_SECURE",
    "SMTP_REQUIRE_TLS",
] as const;

function saveEnv(): Record<(typeof ENV_KEYS)[number], string | undefined> {
    const saved = {} as Record<(typeof ENV_KEYS)[number], string | undefined>;
    for (const key of ENV_KEYS) {
        saved[key] = process.env[key];
    }
    return saved;
}

function restoreEnv(saved: Record<(typeof ENV_KEYS)[number], string | undefined>): void {
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
