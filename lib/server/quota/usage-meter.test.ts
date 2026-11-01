import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    assertQuotaAvailable,
    formatDay,
    getDailyCostCap,
    getUsage,
    getUsageStore,
    PostgresUsageStore,
    QuotaExceededError,
    recordUsage,
    resetMemoryUsageStore,
    setUsageStore,
} from "./usage-meter";

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

describe("usage-meter (in-memory)", () => {
    beforeEach(() => {
        setUsageStore(null);
        resetMemoryUsageStore();
    });

    it("returns zeroes and hardStop false for a new day", async () => {
        const usage = await getUsage("2026-10-29");
        expect(usage).toEqual({
            audioSeconds: 0,
            tokens: 0,
            estCost: 0,
            hardStop: false,
        });
    });

    it("accumulates audio seconds, tokens, and estimated cost", async () => {
        await recordUsage({
            date: "2026-10-29",
            audioSeconds: 60,
            tokens: 120,
            estCost: 0.05,
        });

        await recordUsage({
            date: "2026-10-29",
            audioSeconds: 40,
            tokens: 80,
            estCost: 0.03,
        });

        const usage = await getUsage("2026-10-29");
        expect(usage.audioSeconds).toBe(100);
        expect(usage.tokens).toBe(200);
        expect(usage.estCost).toBeCloseTo(0.08, 4);
        expect(usage.hardStop).toBe(false);
    });

    it("computes estimated cost from audio seconds when estCost is omitted", async () => {
        // 3600 seconds = 1 hour = $0.18
        await recordUsage({
            date: "2026-10-29",
            audioSeconds: 3600,
        });

        const usage = await getUsage("2026-10-29");
        expect(usage.audioSeconds).toBe(3600);
        expect(usage.estCost).toBeCloseTo(0.18, 4);
        expect(usage.hardStop).toBe(false);
    });

    it("triggers hardStop flag when cost reaches or exceeds the cap", async () => {
        const cap = getDailyCostCap(); // 5.0 default

        await recordUsage({
            date: "2026-10-29",
            estCost: cap - 0.1,
        });

        let usage = await getUsage("2026-10-29");
        expect(usage.hardStop).toBe(false);

        await recordUsage({
            date: "2026-10-29",
            estCost: 0.15,
        });

        usage = await getUsage("2026-10-29");
        expect(usage.hardStop).toBe(true);
        expect(usage.estCost).toBeGreaterThanOrEqual(cap);
    });

    it("assertQuotaAvailable allows sessions when under quota", async () => {
        await recordUsage({
            date: "2026-10-29",
            estCost: 1.0,
        });

        const usage = await assertQuotaAvailable({ day: "2026-10-29" });
        expect(usage.hardStop).toBe(false);
    });

    it("assertQuotaAvailable rejects new session with clear message when hard-stop is active", async () => {
        await recordUsage({
            date: "2026-10-29",
            estCost: 5.5,
        });

        // Indonesian locale
        await expect(
            assertQuotaAvailable({ day: "2026-10-29", locale: "id" })
        ).rejects.toThrowError(
            "Batas kuota harian tercapai. Sesi baru tidak dapat dimulai hari ini."
        );

        // English locale
        await expect(
            assertQuotaAvailable({ day: "2026-10-29", locale: "en" })
        ).rejects.toThrowError(
            "Daily quota limit reached. New sessions cannot be started today."
        );

        try {
            await assertQuotaAvailable({ day: "2026-10-29" });
        } catch (error) {
            expect(error).toBeInstanceOf(QuotaExceededError);
            if (error instanceof QuotaExceededError) {
                expect(error.code).toBe("quota_exceeded");
                expect(error.status).toBe(429);
                expect(error.usage.hardStop).toBe(true);
            }
        }
    });

    it("isolates usage per user and per day", async () => {
        await recordUsage({
            userId: "user-alpha",
            date: "2026-10-29",
            estCost: 1.5,
        });

        await recordUsage({
            userId: "user-beta",
            date: "2026-10-29",
            estCost: 2.5,
        });

        await recordUsage({
            userId: "user-alpha",
            date: "2026-10-30",
            estCost: 0.5,
        });

        const alpha29 = await getUsage("2026-10-29", "user-alpha");
        const beta29 = await getUsage("2026-10-29", "user-beta");
        const alpha30 = await getUsage("2026-10-30", "user-alpha");

        expect(alpha29.estCost).toBeCloseTo(1.5, 4);
        expect(beta29.estCost).toBeCloseTo(2.5, 4);
        expect(alpha30.estCost).toBeCloseTo(0.5, 4);
    });

    it("normalizes day format consistently", () => {
        expect(formatDay("2026-10-29")).toBe("2026-10-29");
        expect(formatDay("2026-10-29T14:30:00Z")).toBe("2026-10-29");
        expect(formatDay(new Date("2026-10-29T14:30:00Z"))).toBe("2026-10-29");
        expect(formatDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("caches PostgresUsageStore instance when DATABASE_URL is set", () => {
        const originalUrl = process.env.DATABASE_URL;
        try {
            process.env.DATABASE_URL = "postgres://dummy:5432/db";
            const store1 = getUsageStore();
            const store2 = getUsageStore();
            expect(store1).toBe(store2);
            expect(store1).toBeInstanceOf(PostgresUsageStore);
        } finally {
            if (originalUrl !== undefined) {
                process.env.DATABASE_URL = originalUrl;
            } else {
                delete process.env.DATABASE_URL;
            }
        }
    });

    it("respects setUsageStore custom store hook and allows reset", () => {
        const mockStore = {
            recordUsage: vi.fn(),
            getUsage: vi.fn(),
        };
        setUsageStore(mockStore);
        expect(getUsageStore()).toBe(mockStore);
        setUsageStore(null);
        expect(getUsageStore()).not.toBe(mockStore);
    });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres usage store", () => {
    let pool: Pool;
    let postgresStore: PostgresUsageStore;

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        const migration2 = readFileSync(
            join(__dirname, "../../../db/migrations/0002_usage_meter.sql"),
            "utf8"
        );
        await pool.query(migration2);
        await pool.query(
            `insert into auth_user (id, email, email_verified, name, role)
             values
               ('00000000-0000-0000-0000-000000000001','test1@suara-lapangan.local',true,'Test User 1','user'),
               ('00000000-0000-0000-0000-000000000002','test2@suara-lapangan.local',true,'Test User 2','user')
             on conflict (id) do nothing`
        );
        postgresStore = new PostgresUsageStore(pool);
    });

    beforeEach(async () => {
        await pool.query("truncate usage_meter");
    });

    afterAll(async () => {
        await pool.end();
    });

    it("records and retrieves usage in postgres with atomic upsert", async () => {
        await postgresStore.recordUsage({
            userId: "00000000-0000-0000-0000-000000000001",
            date: "2026-10-29",
            audioSeconds: 120,
            tokens: 300,
            estCost: 0.25,
        });

        await postgresStore.recordUsage({
            userId: "00000000-0000-0000-0000-000000000001",
            date: "2026-10-29",
            audioSeconds: 80,
            tokens: 200,
            estCost: 0.15,
        });

        const usage = await postgresStore.getUsage("2026-10-29", "00000000-0000-0000-0000-000000000001");
        expect(usage.audioSeconds).toBe(200);
        expect(usage.tokens).toBe(500);
        expect(usage.estCost).toBeCloseTo(0.4, 4);
        expect(usage.hardStop).toBe(false);
    });

    it("activates hard_stop flag in postgres when cap is exceeded", async () => {
        await postgresStore.recordUsage({
            userId: "00000000-0000-0000-0000-000000000002",
            date: "2026-10-29",
            estCost: 5.5,
        });

        const usage = await postgresStore.getUsage("2026-10-29", "00000000-0000-0000-0000-000000000002");
        expect(usage.hardStop).toBe(true);
    });
});
