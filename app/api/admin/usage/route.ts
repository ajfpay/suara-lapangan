import { NextResponse } from "next/server";
import { auth } from "@/lib/server/auth";
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

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");

    const pool = getDbPool();
    try {
        let query = `
            select u.id as user_id, u.email, u.name,
                   coalesce(sum(m.audio_seconds), 0) as audio_seconds,
                   coalesce(sum(m.tokens), 0) as tokens,
                   coalesce(sum(m.est_cost), 0) as est_cost
            from auth_user u
            left join usage_meter m on u.id = m.user_id
        `;
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (startDate) {
            values.push(startDate);
            conditions.push(`m.day >= $${values.length}`);
        }
        if (endDate) {
            values.push(endDate);
            conditions.push(`m.day <= $${values.length}`);
        }
        if (conditions.length > 0) {
            query += ` and ${conditions.join(" and ")}`;
        }
        query += ` group by u.id, u.email, u.name order by est_cost desc, u.name asc`;

        const result = await pool.query(query, values);
        const usage = result.rows.map((r) => ({
            userId: r.user_id,
            email: r.email,
            name: r.name,
            audioSeconds: Number(r.audio_seconds),
            tokens: Number(r.tokens),
            estCost: Number(r.est_cost),
        }));

        return NextResponse.json({ usage });
    } finally {
        await pool.end();
    }
}
