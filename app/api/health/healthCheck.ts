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

let healthPool: Pool | null = null;
let healthPoolUrl: string | null = null;

function getHealthPool(connectionString: string): Pool {
    if (healthPool && healthPoolUrl === connectionString) {
        return healthPool;
    }
    if (healthPool) {
        void healthPool.end().catch(() => {});
    }
    healthPoolUrl = connectionString;
    healthPool = new Pool({
        connectionString,
        max: 2,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        idleTimeoutMillis: 10000,
    });
    healthPool.on("error", () => {});
    return healthPool;
}

export async function probeDatabase(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }
    const pool = getHealthPool(connectionString);
    await pool.query("SELECT 1");
}

export async function checkHealth(
    probe: () => Promise<void> = probeDatabase
): Promise<{ statusCode: 200 | 503; body: HealthResponse }> {
    const startedAt = Date.now();
    try {
        await probe();
        return {
            statusCode: 200,
            body: {
                status: "ok",
                service: "suara-lapangan",
                database: {
                    status: "ok",
                    latencyMs: Math.max(0, Date.now() - startedAt),
                },
                timestamp: new Date().toISOString(),
            },
        };
    } catch {
        return {
            statusCode: 503,
            body: {
                status: "degraded",
                service: "suara-lapangan",
                database: {
                    status: "error",
                    latencyMs: Math.max(0, Date.now() - startedAt),
                },
                timestamp: new Date().toISOString(),
            },
        };
    }
}
