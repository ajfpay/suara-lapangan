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

    const pool = getDbPool();
    try {
        const result = await pool.query(
            `select id, email, name, role, banned, ban_reason, created_at, updated_at
             from auth_user
             order by created_at desc`
        );
        return NextResponse.json({ users: result.rows });
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
        typeof body.banned !== "boolean"
    ) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const { userId, banned, banReason } = body;
    const pool = getDbPool();
    try {
        // Admins are never banned from the dashboard; excluding them here also
        // prevents disabling the last administrator even by a direct call.
        const result = await pool.query(
            `update auth_user
             set banned = $1,
                 ban_reason = $2,
                 updated_at = now()
             where id = $3 and role <> 'admin'`,
            [banned, banReason || null, userId]
        );
        if (result.rowCount === 0) {
            return NextResponse.json({ error: "not_found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
    } finally {
        await pool.end();
    }
}
