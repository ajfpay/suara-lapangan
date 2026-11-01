import { Pool } from "pg";
import { DEFAULT_USER_ID, formatDay } from "./usage-meter";

export { DEFAULT_USER_ID, formatDay };

export const DEFAULT_EMAIL_DAILY_SEND_LIMIT = 100;

export type RecordEmailSendParams = {
    day?: string | Date;
    date?: string | Date;
    userId?: string;
    count?: number;
};

export type ReservationResult = {
    ok: boolean;
    count: number;
    limit: number;
};

/**
 * Returns the daily send limit configured via EMAIL_DAILY_SEND_LIMIT.
 * Falls back to 100 if unset or invalid (must be a positive integer).
 */
export function getEmailDailySendLimit(): number {
    const raw = process.env.EMAIL_DAILY_SEND_LIMIT;
    if (raw) {
        const parsed = parseFloat(raw);
        if (
            !isNaN(parsed) &&
            parsed > 0 &&
            Number.isInteger(parsed) &&
            /^\s*\d+\s*$/.test(raw)
        ) {
            return parsed;
        }
    }
    return DEFAULT_EMAIL_DAILY_SEND_LIMIT;
}

/**
 * Checks whether the recipient address is permitted under EMAIL_ALLOWLIST.
 * When unset or empty, all recipients are allowed (default MVP behavior).
 * When set, both sides are normalized (trimmed, lowercased).
 */
export function isRecipientAllowed(recipient: string): boolean {
    const raw = process.env.EMAIL_ALLOWLIST;
    if (!raw || raw.trim() === "") {
        return true;
    }

    const allowed = raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);

    if (allowed.length === 0) {
        return true;
    }

    const normalized = recipient.trim().toLowerCase();
    return allowed.includes(normalized);
}

export class EmailQuotaExceededError extends Error {
    readonly code = "email_quota_exceeded" as const;
    readonly status = 429;
    readonly count: number;
    readonly limit: number;

    constructor(
        message: string,
        details: { count?: number; limit?: number } = {}
    ) {
        super(message);
        this.name = "EmailQuotaExceededError";
        this.count = details.count ?? 0;
        this.limit = details.limit ?? 0;
    }
}

export interface EmailSendQuotaStore {
    recordEmailSend(params?: RecordEmailSendParams): Promise<number>;
    getEmailSends(day?: string | Date, userId?: string): Promise<number>;
    reserveEmailSend(
        limit: number,
        params?: RecordEmailSendParams
    ): Promise<ReservationResult>;
    releaseEmailSend(params?: RecordEmailSendParams): Promise<number>;
    reset?(): Promise<void> | void;
}

export class MemoryEmailSendQuotaStore implements EmailSendQuotaStore {
    private records = new Map<string, number>();

    private key(userId: string, day: string): string {
        return `${userId}:${day}`;
    }

    async getEmailSends(
        day?: string | Date,
        userId: string = DEFAULT_USER_ID
    ): Promise<number> {
        const dayStr = formatDay(day);
        return this.records.get(this.key(userId, dayStr)) ?? 0;
    }

    async recordEmailSend(params?: RecordEmailSendParams): Promise<number> {
        const userId = params?.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params?.day ?? params?.date);
        const count =
            params?.count !== undefined ? Math.max(0, params.count) : 1;

        const current = await this.getEmailSends(dayStr, userId);
        const updated = current + count;
        this.records.set(this.key(userId, dayStr), updated);
        return updated;
    }

    async reserveEmailSend(
        limit: number,
        params?: RecordEmailSendParams
    ): Promise<ReservationResult> {
        const userId = params?.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params?.day ?? params?.date);
        const current = this.records.get(this.key(userId, dayStr)) ?? 0;

        if (current >= limit) {
            return { ok: false, count: current, limit };
        }

        const updated = current + 1;
        this.records.set(this.key(userId, dayStr), updated);
        return { ok: true, count: updated, limit };
    }

    async releaseEmailSend(params?: RecordEmailSendParams): Promise<number> {
        const userId = params?.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params?.day ?? params?.date);
        const current = this.records.get(this.key(userId, dayStr)) ?? 0;
        const updated = Math.max(0, current - 1);
        this.records.set(this.key(userId, dayStr), updated);
        return updated;
    }

    reset(): void {
        this.records.clear();
    }
}

export class PostgresEmailSendQuotaStore implements EmailSendQuotaStore {
    private pool: Pool;

    constructor(connectionStringOrPool: string | Pool) {
        if (typeof connectionStringOrPool === "string") {
            this.pool = new Pool({ connectionString: connectionStringOrPool });
        } else {
            this.pool = connectionStringOrPool;
        }
    }

    async getEmailSends(
        day?: string | Date,
        userId: string = DEFAULT_USER_ID
    ): Promise<number> {
        const dayStr = formatDay(day);
        const result = await this.pool.query<{ count: number | string }>(
            `select count
             from email_send_meter
             where user_id = $1 and day = $2`,
            [userId, dayStr]
        );

        if (result.rowCount === 0) {
            return 0;
        }

        return Number(result.rows[0].count);
    }

    async recordEmailSend(params?: RecordEmailSendParams): Promise<number> {
        const userId = params?.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params?.day ?? params?.date);
        const count =
            params?.count !== undefined ? Math.max(0, params.count) : 1;

        const result = await this.pool.query<{ count: number | string }>(
            `insert into email_send_meter (user_id, day, count, updated_at)
             values ($1, $2, $3, now())
             on conflict (user_id, day) do update set
                 count = email_send_meter.count + excluded.count,
                 updated_at = now()
             returning count`,
            [userId, dayStr, count]
        );

        return Number(result.rows[0].count);
    }

    /**
     * Atomically reserves one slot for today when the day's count is below
     * the limit. The upsert increments only while `count < limit`, so
     * concurrent requests cannot both reserve the last slot: the row is
     * locked by the conflict update and the `where` clause is re-checked
     * against the locked row.
     */
    async reserveEmailSend(
        limit: number,
        params?: RecordEmailSendParams
    ): Promise<ReservationResult> {
        const userId = params?.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params?.day ?? params?.date);

        const result = await this.pool.query<{ count: number | string }>(
            `insert into email_send_meter (user_id, day, count, updated_at)
             values ($1, $2, 1, now())
             on conflict (user_id, day) do update set
                 count = email_send_meter.count + 1,
                 updated_at = now()
             where email_send_meter.count < $3
             returning count`,
            [userId, dayStr, limit]
        );

        if (result.rowCount === 0) {
            const current = await this.getEmailSends(dayStr, userId);
            return { ok: false, count: current, limit };
        }

        return { ok: true, count: Number(result.rows[0].count), limit };
    }

    async releaseEmailSend(params?: RecordEmailSendParams): Promise<number> {
        const userId = params?.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params?.day ?? params?.date);

        const result = await this.pool.query<{ count: number | string }>(
            `update email_send_meter
             set count = greatest(count - 1, 0),
                 updated_at = now()
             where user_id = $1 and day = $2
             returning count`,
            [userId, dayStr]
        );

        return result.rowCount === 0 ? 0 : Number(result.rows[0].count);
    }

    async reset(): Promise<void> {
        await this.pool.query("truncate email_send_meter");
    }

    async end(): Promise<void> {
        await this.pool.end();
    }
}

const memoryStore = new MemoryEmailSendQuotaStore();
let customStore: EmailSendQuotaStore | null = null;
let shared: PostgresEmailSendQuotaStore | null = null;
let sharedConnectionString: string | null = null;

export function setEmailSendQuotaStore(
    store: EmailSendQuotaStore | null
): void {
    customStore = store;
}

export function getEmailSendQuotaStore(): EmailSendQuotaStore {
    if (customStore) return customStore;

    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
        if (!shared || sharedConnectionString !== connectionString) {
            shared = new PostgresEmailSendQuotaStore(connectionString);
            sharedConnectionString = connectionString;
        }
        return shared;
    }

    return memoryStore;
}

export async function recordEmailSend(
    params?: RecordEmailSendParams | string | Date,
    maybeUserId?: string
): Promise<number> {
    if (typeof params === "string" || params instanceof Date) {
        return getEmailSendQuotaStore().recordEmailSend({
            day: params,
            userId: maybeUserId,
            count: 1,
        });
    }
    return getEmailSendQuotaStore().recordEmailSend(params);
}

export async function getEmailSends(
    day?: string | Date,
    userId?: string
): Promise<number> {
    return getEmailSendQuotaStore().getEmailSends(day, userId);
}

/**
 * Atomically reserves one daily send slot. Returns `{ok: true}` when a
 * slot was available and reserved; `{ok: false}` (with current count and
 * limit) when the daily limit is reached. The reservation must be released
 * with `releaseEmailSend` if the delivery fails.
 */
export async function reserveEmailSend(options?: {
    day?: string | Date;
    userId?: string;
    locale?: "en" | "id";
}): Promise<ReservationResult> {
    const day = options?.day;
    const userId = options?.userId;
    const locale = options?.locale ?? "id";
    const limit = getEmailDailySendLimit();

    const result = await getEmailSendQuotaStore().reserveEmailSend(limit, {
        day,
        userId,
    });

    if (!result.ok) {
        const message =
            locale === "en"
                ? "Daily email send limit reached. Try again tomorrow."
                : "Batas kirim email harian tercapai. Coba lagi besok.";
        throw new EmailQuotaExceededError(message, {
            count: result.count,
            limit,
        });
    }

    return result;
}

export async function releaseEmailSend(options?: {
    day?: string | Date;
    userId?: string;
}): Promise<number> {
    return getEmailSendQuotaStore().releaseEmailSend({
        day: options?.day,
        userId: options?.userId,
    });
}

export function resetMemoryEmailSendQuotaStore(): void {
    memoryStore.reset();
}
