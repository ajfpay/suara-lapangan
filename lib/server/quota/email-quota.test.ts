import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_EMAIL_DAILY_SEND_LIMIT,
    EmailQuotaExceededError,
    formatDay,
    getEmailDailySendLimit,
    getEmailSends,
    getEmailSendQuotaStore,
    isRecipientAllowed,
    MemoryEmailSendQuotaStore,
    PostgresEmailSendQuotaStore,
    recordEmailSend,
    releaseEmailSend,
    reserveEmailSend,
    resetMemoryEmailSendQuotaStore,
    setEmailSendQuotaStore,
} from "./email-quota";

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

describe("email-quota (in-memory)", () => {
    const origEnv = {
        limit: process.env.EMAIL_DAILY_SEND_LIMIT,
        allowlist: process.env.EMAIL_ALLOWLIST,
        dbUrl: process.env.DATABASE_URL,
    };

    beforeEach(() => {
        setEmailSendQuotaStore(null);
        resetMemoryEmailSendQuotaStore();
        if (origEnv.limit !== undefined) {
            process.env.EMAIL_DAILY_SEND_LIMIT = origEnv.limit;
        } else {
            delete process.env.EMAIL_DAILY_SEND_LIMIT;
        }
        if (origEnv.allowlist !== undefined) {
            process.env.EMAIL_ALLOWLIST = origEnv.allowlist;
        } else {
            delete process.env.EMAIL_ALLOWLIST;
        }
        // This suite must exercise the in-memory store, so DATABASE_URL is
        // always cleared here; afterAll restores the original value.
        delete process.env.DATABASE_URL;
    });

    afterAll(() => {
        if (origEnv.limit !== undefined) {
            process.env.EMAIL_DAILY_SEND_LIMIT = origEnv.limit;
        } else {
            delete process.env.EMAIL_DAILY_SEND_LIMIT;
        }
        if (origEnv.allowlist !== undefined) {
            process.env.EMAIL_ALLOWLIST = origEnv.allowlist;
        } else {
            delete process.env.EMAIL_ALLOWLIST;
        }
        if (origEnv.dbUrl !== undefined) {
            process.env.DATABASE_URL = origEnv.dbUrl;
        } else {
            delete process.env.DATABASE_URL;
        }
    });

    it("returns zero for a new day", async () => {
        const sends = await getEmailSends("2026-11-01");
        expect(sends).toBe(0);
    });

    it("accumulates send counts across multiple recordEmailSend calls", async () => {
        await recordEmailSend({ day: "2026-11-01" });
        await recordEmailSend({ day: "2026-11-01" });
        await recordEmailSend({ day: "2026-11-01", count: 3 });

        const sends = await getEmailSends("2026-11-01");
        expect(sends).toBe(5);
    });

    it("isolates send counts per user and per day", async () => {
        await recordEmailSend({ day: "2026-11-01", userId: "user-alpha" });
        await recordEmailSend({ day: "2026-11-01", userId: "user-beta" });
        await recordEmailSend({ day: "2026-11-02", userId: "user-alpha" });

        expect(await getEmailSends("2026-11-01", "user-alpha")).toBe(1);
        expect(await getEmailSends("2026-11-01", "user-beta")).toBe(1);
        expect(await getEmailSends("2026-11-02", "user-alpha")).toBe(1);
        expect(await getEmailSends("2026-11-02", "user-beta")).toBe(0);
    });

    it("uses default cap of 100 when EMAIL_DAILY_SEND_LIMIT is unset or invalid", () => {
        expect(DEFAULT_EMAIL_DAILY_SEND_LIMIT).toBe(100);
        delete process.env.EMAIL_DAILY_SEND_LIMIT;
        expect(getEmailDailySendLimit()).toBe(100);

        process.env.EMAIL_DAILY_SEND_LIMIT = "";
        expect(getEmailDailySendLimit()).toBe(100);

        process.env.EMAIL_DAILY_SEND_LIMIT = "0";
        expect(getEmailDailySendLimit()).toBe(100);

        process.env.EMAIL_DAILY_SEND_LIMIT = "-10";
        expect(getEmailDailySendLimit()).toBe(100);

        process.env.EMAIL_DAILY_SEND_LIMIT = "abc";
        expect(getEmailDailySendLimit()).toBe(100);

        process.env.EMAIL_DAILY_SEND_LIMIT = "12.34";
        expect(getEmailDailySendLimit()).toBe(100);

        process.env.EMAIL_DAILY_SEND_LIMIT = "50abc";
        expect(getEmailDailySendLimit()).toBe(100);
    });

    it("formats dates and timestamps consistently", () => {
        expect(formatDay("2026-11-01")).toBe("2026-11-01");
        expect(formatDay(new Date("2026-11-01T12:00:00Z"))).toBe("2026-11-01");
    });

    it("uses env cap when EMAIL_DAILY_SEND_LIMIT is a positive integer", () => {
        process.env.EMAIL_DAILY_SEND_LIMIT = "25";
        expect(getEmailDailySendLimit()).toBe(25);

        process.env.EMAIL_DAILY_SEND_LIMIT = " 10 ";
        expect(getEmailDailySendLimit()).toBe(10);
    });

    it("reserveEmailSend reserves a slot when under quota", async () => {
        process.env.EMAIL_DAILY_SEND_LIMIT = "2";
        await recordEmailSend({ day: "2026-11-01" });

        const result = await reserveEmailSend({ day: "2026-11-01" });
        expect(result).toEqual({ ok: true, count: 2, limit: 2 });
    });

    it("reserveEmailSend throws EmailQuotaExceededError with locale messages when limit reached", async () => {
        process.env.EMAIL_DAILY_SEND_LIMIT = "2";
        await recordEmailSend({ day: "2026-11-01", count: 2 });

        // Indonesian message (default)
        await expect(
            reserveEmailSend({ day: "2026-11-01", locale: "id" })
        ).rejects.toThrowError(
            "Batas kirim email harian tercapai. Coba lagi besok."
        );

        // English message
        await expect(
            reserveEmailSend({ day: "2026-11-01", locale: "en" })
        ).rejects.toThrowError(
            "Daily email send limit reached. Try again tomorrow."
        );

        // Inspect error fields
        try {
            await reserveEmailSend({ day: "2026-11-01" });
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error).toBeInstanceOf(EmailQuotaExceededError);
            if (error instanceof EmailQuotaExceededError) {
                expect(error.code).toBe("email_quota_exceeded");
                expect(error.status).toBe(429);
                expect(error.count).toBe(2);
                expect(error.limit).toBe(2);
            }
        }
    });

    it("reserveEmailSend does not increment when the limit is reached", async () => {
        process.env.EMAIL_DAILY_SEND_LIMIT = "1";
        await recordEmailSend({ day: "2026-11-01" });

        await expect(
            reserveEmailSend({ day: "2026-11-01" })
        ).rejects.toThrowError(EmailQuotaExceededError);

        // The rejected reservation must not consume a slot.
        expect(await getEmailSends("2026-11-01")).toBe(1);
    });

    it("releaseEmailSend refunds a reservation", async () => {
        await reserveEmailSend({ day: "2026-11-01" });
        expect(await getEmailSends("2026-11-01")).toBe(1);

        await releaseEmailSend({ day: "2026-11-01" });
        expect(await getEmailSends("2026-11-01")).toBe(0);

        // Release never goes below zero.
        await releaseEmailSend({ day: "2026-11-01" });
        expect(await getEmailSends("2026-11-01")).toBe(0);
    });

    it("isRecipientAllowed allows all recipients when allowlist is unset or empty", () => {
        delete process.env.EMAIL_ALLOWLIST;
        expect(isRecipientAllowed("anyone@example.com")).toBe(true);

        process.env.EMAIL_ALLOWLIST = "";
        expect(isRecipientAllowed("anyone@example.com")).toBe(true);

        process.env.EMAIL_ALLOWLIST = "   ";
        expect(isRecipientAllowed("anyone@example.com")).toBe(true);

        process.env.EMAIL_ALLOWLIST = " , , ";
        expect(isRecipientAllowed("anyone@example.com")).toBe(true);
    });

    it("isRecipientAllowed enforces allowlist case-insensitively and with trimming", () => {
        process.env.EMAIL_ALLOWLIST =
            " Allowed@Example.COM , client@domain.co.id ";

        expect(isRecipientAllowed("allowed@example.com")).toBe(true);
        expect(isRecipientAllowed("ALLOWED@EXAMPLE.COM")).toBe(true);
        expect(isRecipientAllowed("  allowed@example.com  ")).toBe(true);
        expect(isRecipientAllowed("client@domain.co.id")).toBe(true);
        expect(isRecipientAllowed("CLIENT@domain.co.id")).toBe(true);

        expect(isRecipientAllowed("unauthorized@example.com")).toBe(false);
        expect(isRecipientAllowed("allowed@example.org")).toBe(false);
    });

    it("caches PostgresEmailSendQuotaStore instance when DATABASE_URL is set", () => {
        expect(getEmailSendQuotaStore()).toBeInstanceOf(MemoryEmailSendQuotaStore);
        const originalUrl = process.env.DATABASE_URL;
        try {
            process.env.DATABASE_URL = "postgres://dummy:5432/db";
            const store1 = getEmailSendQuotaStore();
            const store2 = getEmailSendQuotaStore();
            expect(store1).toBe(store2);
            expect(store1).toBeInstanceOf(PostgresEmailSendQuotaStore);
        } finally {
            if (originalUrl !== undefined) {
                process.env.DATABASE_URL = originalUrl;
            } else {
                delete process.env.DATABASE_URL;
            }
        }
    });

    it("respects setEmailSendQuotaStore custom store hook and allows reset", () => {
        const mockStore = {
            recordEmailSend: vi.fn(),
            getEmailSends: vi.fn(),
            reserveEmailSend: vi.fn(),
            releaseEmailSend: vi.fn(),
        };
        setEmailSendQuotaStore(mockStore);
        expect(getEmailSendQuotaStore()).toBe(mockStore);
        setEmailSendQuotaStore(null);
        expect(getEmailSendQuotaStore()).not.toBe(mockStore);
    });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres email quota store", () => {
    let pool: Pool;
    let postgresStore: PostgresEmailSendQuotaStore;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        const migration4 = readFileSync(
            join(__dirname, "../../../db/migrations/0004_email_sends.sql"),
            "utf8"
        );
        // Safe and idempotent to run migration
        await pool.query(migration4);
        postgresStore = new PostgresEmailSendQuotaStore(pool);
    });

    beforeEach(async () => {
        await pool.query("truncate email_send_meter");
    });

    afterAll(async () => {
        await pool.end();
    });

    it("is safe to execute 0004_email_sends.sql repeatedly (idempotence)", async () => {
        const migration4 = readFileSync(
            join(__dirname, "../../../db/migrations/0004_email_sends.sql"),
            "utf8"
        );
        await expect(pool.query(migration4)).resolves.toBeDefined();
    });

    it("records and retrieves email sends in postgres with atomic upsert", async () => {
        await postgresStore.recordEmailSend({
            userId: "user-pg",
            day: "2026-11-01",
            count: 1,
        });

        await postgresStore.recordEmailSend({
            userId: "user-pg",
            day: "2026-11-01",
            count: 2,
        });

        const sends = await postgresStore.getEmailSends("2026-11-01", "user-pg");
        expect(sends).toBe(3);
    });

    it("isolates send counts per user and day in postgres", async () => {
        await postgresStore.recordEmailSend({
            userId: "user-1",
            day: "2026-11-01",
        });
        await postgresStore.recordEmailSend({
            userId: "user-2",
            day: "2026-11-01",
        });
        await postgresStore.recordEmailSend({
            userId: "user-1",
            day: "2026-11-02",
        });

        expect(await postgresStore.getEmailSends("2026-11-01", "user-1")).toBe(1);
        expect(await postgresStore.getEmailSends("2026-11-01", "user-2")).toBe(1);
        expect(await postgresStore.getEmailSends("2026-11-02", "user-1")).toBe(1);
        expect(await postgresStore.getEmailSends("2026-11-02", "user-2")).toBe(0);
    });

    it("enforces reserveEmailSend when backed by postgres store", async () => {
        setEmailSendQuotaStore(postgresStore);
        process.env.EMAIL_DAILY_SEND_LIMIT = "1";

        try {
            await recordEmailSend({ day: "2026-11-01" });
            await expect(
                reserveEmailSend({ day: "2026-11-01", locale: "en" })
            ).rejects.toThrowError(
                "Daily email send limit reached. Try again tomorrow."
            );
        } finally {
            setEmailSendQuotaStore(null);
            delete process.env.EMAIL_DAILY_SEND_LIMIT;
        }
    });

    it("reserve/release round-trips atomically in postgres", async () => {
        const limit = 2;
        const first = await postgresStore.reserveEmailSend(limit, {
            userId: "user-atomic",
            day: "2026-11-01",
        });
        expect(first.ok).toBe(true);
        expect(first.count).toBe(1);

        const second = await postgresStore.reserveEmailSend(limit, {
            userId: "user-atomic",
            day: "2026-11-01",
        });
        expect(second.ok).toBe(true);
        expect(second.count).toBe(2);

        // Third reservation must fail without consuming a slot.
        const third = await postgresStore.reserveEmailSend(limit, {
            userId: "user-atomic",
            day: "2026-11-01",
        });
        expect(third.ok).toBe(false);
        expect(third.count).toBe(2);
        expect(await postgresStore.getEmailSends("2026-11-01", "user-atomic")).toBe(2);

        // Release refunds one slot.
        await postgresStore.releaseEmailSend({
            userId: "user-atomic",
            day: "2026-11-01",
        });
        expect(
            await postgresStore.getEmailSends("2026-11-01", "user-atomic")
        ).toBe(1);
    });
});
