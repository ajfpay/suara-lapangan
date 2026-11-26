import { Pool } from "pg";

export type HealthResponse = {
    status: "ok" | "degraded";
    service: "suara-lapangan";
    database: {
        status: "ok" | "error";
        latencyMs: number;
    };
    timestamp: string;
};

const PROBE_INTERVAL_MS = 5000;

type HealthResult = { statusCode: 200 | 503; body: HealthResponse };
type ProbeState = {
    url: string;
    pool: Pool;
    result?: HealthResult;
    checkedAt: number;
    pending?: Promise<HealthResult>;
};

let state: ProbeState | undefined;

function getProbeState(url: string): ProbeState {
    if (state?.url === url) return state;
    const pool = new Pool({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        statement_timeout: 4000,
        idleTimeoutMillis: 10000,
    });
    pool.on("error", () => console.warn("[health] database pool error"));
    const previous = state;
    state = { url, pool, checkedAt: 0 };
    if (previous) {
        void previous.pool
            .end()
            .catch(() => console.warn("[health] database pool close failed"));
    }
    return state;
}

export async function checkHealth(
    probe: () => Promise<void>
): Promise<HealthResult> {
    const startedAt = Date.now();
    let ok = true;
    try {
        await probe();
    } catch {
        ok = false;
        console.warn("[health] database readiness probe failed");
    }

    return {
        statusCode: ok ? 200 : 503,
        body: {
            status: ok ? "ok" : "degraded",
            service: "suara-lapangan",
            database: {
                status: ok ? "ok" : "error",
                latencyMs: Math.max(0, Date.now() - startedAt),
            },
            timestamp: new Date().toISOString(),
        },
    };
}

export async function databaseReadiness(): Promise<HealthResult> {
    const url = process.env.DATABASE_URL;
    let current: ProbeState;
    try {
        if (!url) throw new Error("DATABASE_URL is not configured");
        current = getProbeState(url);
    } catch (error) {
        return checkHealth(async () => {
            throw error;
        });
    }

    if (current.pending) return current.pending;
    if (current.result && Date.now() - current.checkedAt < PROBE_INTERVAL_MS) {
        return current.result;
    }
    current.pending = checkHealth(async () => {
        await current.pool.query("SELECT 1");
    })
        .then((result) => {
            current.result = result;
            current.checkedAt = Date.now();
            return result;
        })
        .finally(() => {
            current.pending = undefined;
        });
    return current.pending;
}
