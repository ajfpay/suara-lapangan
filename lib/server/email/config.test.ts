import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGmailConfig, getEmailConfig } from "./config";

const ENV_KEYS = [
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

    it("getEmailConfig returns the Gmail config when set", () => {
        setGmailBaseEnv();

        expect(getEmailConfig()?.kind).toBe("gmail");
    });

    it("getEmailConfig returns null when no Gmail config is set", () => {
        expect(getEmailConfig()).toBeNull();
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
