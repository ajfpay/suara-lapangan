import { Pool } from "pg";

export type UsageSummary = {
    audioSeconds: number;
    tokens: number;
    /** Prefix tokens served from the model prompt cache, counted distinctly. */
    cachedTokens: number;
    estCost: number;
    hardStop: boolean;
};

export type RecordUsageParams = {
    userId?: string;
    date?: string | Date;
    audioSeconds?: number;
    tokens?: number;
    cachedTokens?: number;
    estCost?: number;
};

export const DEFAULT_USER_ID = "default";
/**
 * Official transcription rate from docs/01-ARSITEKTUR.md:
 * $0.18 per hour of audio -> $0.00005 per second.
 */
export const ASR_COST_PER_SECOND = 0.00005;

/** Default daily cap ($5.00 per docs/01-ARSITEKTUR.md and docs/05-RISIKO.md) */
export const DEFAULT_DAILY_COST_CAP = 5.0;

export function getDailyCostCap(): number {
    const raw =
        process.env.DAILY_QUOTA_COST_LIMIT ?? process.env.DAILY_COST_CAP;
    if (raw) {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_DAILY_COST_CAP;
}

export function formatDay(day?: string | Date): string {
    if (!day) {
        return new Date().toISOString().slice(0, 10);
    }
    if (day instanceof Date) {
        return day.toISOString().slice(0, 10);
    }
    const trimmed = String(day).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        return trimmed.slice(0, 10);
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
}

export class QuotaExceededError extends Error {
    readonly code = "quota_exceeded" as const;
    readonly status = 429;
    readonly usage: UsageSummary;

    constructor(
        message: string,
        usage: UsageSummary = {
            audioSeconds: 0,
            tokens: 0,
            cachedTokens: 0,
            estCost: 0,
            hardStop: true,
        }
    ) {
        super(message);
        this.name = "QuotaExceededError";
        this.usage = usage;
    }
}

export interface UsageStore {
    recordUsage(params: RecordUsageParams): Promise<UsageSummary>;
    getUsage(day?: string | Date, userId?: string): Promise<UsageSummary>;
    reset?(): Promise<void> | void;
}

class MemoryUsageStore implements UsageStore {
    private records = new Map<string, UsageSummary>();

    private key(userId: string, day: string): string {
        return `${userId}:${day}`;
    }

    async getUsage(
        day?: string | Date,
        userId: string = DEFAULT_USER_ID
    ): Promise<UsageSummary> {
        const dayStr = formatDay(day);
        const stored = this.records.get(this.key(userId, dayStr));
        if (!stored) {
            return {
                audioSeconds: 0,
                tokens: 0,
                cachedTokens: 0,
                estCost: 0,
                hardStop: false,
            };
        }
        return { ...stored };
    }

    async recordUsage(params: RecordUsageParams): Promise<UsageSummary> {
        const userId = params.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params.date);
        const audioSeconds = Math.max(0, params.audioSeconds ?? 0);
        const tokens = Math.max(0, params.tokens ?? 0);
        const cachedTokens = Math.max(0, params.cachedTokens ?? 0);
        const estCost =
            params.estCost !== undefined
                ? Math.max(0, params.estCost)
                : audioSeconds * ASR_COST_PER_SECOND;

        const existing = await this.getUsage(dayStr, userId);
        const newAudioSeconds = Number(
            (existing.audioSeconds + audioSeconds).toFixed(2)
        );
        const newTokens = existing.tokens + tokens;
        const newCachedTokens = existing.cachedTokens + cachedTokens;
        const newEstCost = Number((existing.estCost + estCost).toFixed(4));
        const hardStop =
            existing.hardStop || newEstCost >= getDailyCostCap();

        const updated: UsageSummary = {
            audioSeconds: newAudioSeconds,
            tokens: newTokens,
            cachedTokens: newCachedTokens,
            estCost: newEstCost,
            hardStop,
        };

        this.records.set(this.key(userId, dayStr), updated);
        return updated;
    }

    reset(): void {
        this.records.clear();
    }
}

export class PostgresUsageStore implements UsageStore {
    private pool: Pool;

    constructor(connectionStringOrPool: string | Pool) {
        if (typeof connectionStringOrPool === "string") {
            this.pool = new Pool({ connectionString: connectionStringOrPool });
        } else {
            this.pool = connectionStringOrPool;
        }
    }

    async getUsage(
        day?: string | Date,
        userId: string = DEFAULT_USER_ID
    ): Promise<UsageSummary> {
        const dayStr = formatDay(day);
        const result = await this.pool.query<{
            audio_seconds: string | number;
            tokens: string | number;
            cached_tokens: string | number;
            est_cost: string | number;
            hard_stop: boolean;
        }>(
            `select audio_seconds, tokens, cached_tokens, est_cost, hard_stop
             from usage_meter
             where user_id = $1 and day = $2`,
            [userId, dayStr]
        );

        if (result.rowCount === 0) {
            return {
                audioSeconds: 0,
                tokens: 0,
                cachedTokens: 0,
                estCost: 0,
                hardStop: false,
            };
        }

        const row = result.rows[0];
        return {
            audioSeconds: Number(row.audio_seconds),
            tokens: Number(row.tokens),
            cachedTokens: Number(row.cached_tokens ?? 0),
            estCost: Number(row.est_cost),
            hardStop: Boolean(row.hard_stop),
        };
    }

    async recordUsage(params: RecordUsageParams): Promise<UsageSummary> {
        const userId = params.userId || DEFAULT_USER_ID;
        const dayStr = formatDay(params.date);
        const audioSeconds = Math.max(0, params.audioSeconds ?? 0);
        const tokens = Math.max(0, params.tokens ?? 0);
        const cachedTokens = Math.max(0, params.cachedTokens ?? 0);
        const estCost =
            params.estCost !== undefined
                ? Math.max(0, params.estCost)
                : audioSeconds * ASR_COST_PER_SECOND;
        const cap = getDailyCostCap();

        const result = await this.pool.query<{
            audio_seconds: string | number;
            tokens: string | number;
            cached_tokens: string | number;
            est_cost: string | number;
            hard_stop: boolean;
        }>(
            `insert into usage_meter (user_id, day, audio_seconds, tokens, cached_tokens, est_cost, hard_stop, updated_at)
             values ($1, $2, $3, $4, $5, $6, ($6::numeric >= $7::numeric), now())
             on conflict (user_id, day) do update set
                 audio_seconds = usage_meter.audio_seconds + excluded.audio_seconds,
                 tokens = usage_meter.tokens + excluded.tokens,
                 cached_tokens = usage_meter.cached_tokens + excluded.cached_tokens,
                 est_cost = usage_meter.est_cost + excluded.est_cost,
                 hard_stop = usage_meter.hard_stop or (usage_meter.est_cost + excluded.est_cost >= $7::numeric),
                 updated_at = now()
             returning audio_seconds, tokens, cached_tokens, est_cost, hard_stop`,
            [userId, dayStr, audioSeconds, tokens, cachedTokens, estCost, cap]
        );

        const row = result.rows[0];
        return {
            audioSeconds: Number(row.audio_seconds),
            tokens: Number(row.tokens),
            cachedTokens: Number(row.cached_tokens ?? 0),
            estCost: Number(row.est_cost),
            hardStop: Boolean(row.hard_stop),
        };
    }

    async reset(): Promise<void> {
        await this.pool.query("truncate usage_meter");
    }

    async end(): Promise<void> {
        await this.pool.end();
    }
}

const memoryStore = new MemoryUsageStore();
let customStore: UsageStore | null = null;
let shared: PostgresUsageStore | null = null;
let sharedConnectionString: string | null = null;

export function setUsageStore(store: UsageStore | null): void {
    customStore = store;
}

export function getUsageStore(): UsageStore {
    if (customStore) return customStore;

    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
        if (!shared || sharedConnectionString !== connectionString) {
            shared = new PostgresUsageStore(connectionString);
            sharedConnectionString = connectionString;
        }
        return shared;
    }

    return memoryStore;
}

export async function recordUsage(
    params: RecordUsageParams
): Promise<UsageSummary> {
    return getUsageStore().recordUsage(params);
}

export async function getUsage(
    day?: string | Date,
    userId?: string
): Promise<UsageSummary> {
    return getUsageStore().getUsage(day, userId);
}

export async function assertQuotaAvailable(options?: {
    day?: string | Date;
    userId?: string;
    locale?: "en" | "id";
}): Promise<UsageSummary> {
    const day = options?.day;
    const userId = options?.userId;
    const locale = options?.locale ?? "id";

    const usage = await getUsage(day, userId);
    if (usage.hardStop) {
        const message =
            locale === "en"
                ? "Daily quota limit reached. New sessions cannot be started today."
                : "Batas kuota harian tercapai. Sesi baru tidak dapat dimulai hari ini.";
        throw new QuotaExceededError(message, usage);
    }
    return usage;
}

export async function checkQuota(
    day?: string | Date,
    userId?: string
): Promise<{ allowed: boolean; usage: UsageSummary; message?: string }> {
    const usage = await getUsage(day, userId);
    if (usage.hardStop) {
        return {
            allowed: false,
            usage,
            message:
                "Batas kuota harian tercapai. Sesi baru tidak dapat dimulai hari ini.",
        };
    }
    return {
        allowed: true,
        usage,
    };
}

export function resetMemoryUsageStore(): void {
    memoryStore.reset();
}
