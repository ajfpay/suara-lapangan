import { NextResponse } from "next/server";
import { auth } from "@/lib/server/auth";
import { getDailyCostCap } from "@/lib/server/quota/usage-meter";
import { Pool } from "pg";

function getDbPool(): Pool {
    const connectionString =
        process.env.DATABASE_URL ||
        process.env.ASR_TEST_DATABASE_URL ||
        "postgres://suara:suara@localhost:5432/suara_test";
    return new Pool({ connectionString });
}

export async function GET(request: Request) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || (session.user as { role?: string }).role !== "admin") {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const defaultLimit = getDailyCostCap();
    const pool = getDbPool();
    try {
        const result = await pool.query(
            `select user_id, daily_cost_limit from user_cost_limits`
        );
        const limits: Record<string, number> = {};
        for (const row of result.rows) {
            limits[row.user_id] = Number(row.daily_cost_limit);
        }
        return NextResponse.json({ defaultLimit, limits });
    } finally {
        await pool.end();
    }
}

export async function POST(request: Request) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || (session.user as { role?: string }).role !== "admin") {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (
        !body ||
        typeof body.userId !== "string" ||
        typeof body.limit !== "number" ||
        isNaN(body.limit) ||
        body.limit < 0 ||
        body.limit > 999999.9999
    ) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const { userId, limit } = body;
    const pool = getDbPool();
    try {
        await pool.query(
            `insert into user_cost_limits (user_id, daily_cost_limit, updated_at)
             values ($1, $2, now())
             on conflict (user_id) do update
             set daily_cost_limit = excluded.daily_cost_limit,
                 updated_at = now()`,
            [userId, limit]
        );
        return NextResponse.json({ ok: true });
    } finally {
        await pool.end();
    }
}
