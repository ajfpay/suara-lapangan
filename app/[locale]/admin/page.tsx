import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/server/auth";
import { getPostgresDocumentStore } from "@/lib/server/db/documentStore";
import { getDailyCostCap } from "@/lib/server/quota/usage-meter";
import { Pool } from "pg";
import { AdminDashboardClient, type AdminUserRow, type AdminUsageRow } from "./AdminDashboardClient";

interface PageProps {
    params: Promise<{ locale: string }>;
}

function getDbPool(): Pool {
    const connectionString =
        process.env.DATABASE_URL ||
        process.env.ASR_TEST_DATABASE_URL ||
        "postgres://suara:suara@localhost:5432/suara_test";
    return new Pool({ connectionString });
}

export default async function AdminPage({ params }: PageProps) {
    const { locale } = await params;
    const reqHeaders = await headers();
    const session = await auth.api.getSession({
        headers: reqHeaders,
    });

    if (!session?.user) {
        redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/admin`)}`);
    }

    if ((session.user as { role?: string }).role !== "admin") {
        return (
            <main className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
                <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
                        <ShieldAlert className="h-8 w-8" />
                    </div>
                    <h1 className="mt-4 text-xl font-bold text-foreground">
                        403 — Akses Ditolak
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Halaman ini hanya dapat diakses oleh pengguna dengan peran admin.
                    </p>
                    <div className="mt-6">
                        <Link
                            href={`/${locale}/dokumen/saya`}
                            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                            Kembali ke Dokumen Saya
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    const pool = getDbPool();
    const docStore = getPostgresDocumentStore();

    try {
        // 1. Fetch all users
        const usersRes = await pool.query<AdminUserRow>(
            `select id, email, name, role, banned, ban_reason, created_at
             from auth_user
             order by created_at desc`
        );

        // 2. Fetch all documents
        const documents = await docStore.listAll();

        // 3. Fetch aggregated usage
        const usageRes = await pool.query<{
            user_id: string;
            email: string;
            name: string;
            audio_seconds: string | number;
            tokens: string | number;
            est_cost: string | number;
        }>(
            `select u.id as user_id, u.email, u.name,
                    coalesce(sum(m.audio_seconds), 0) as audio_seconds,
                    coalesce(sum(m.tokens), 0) as tokens,
                    coalesce(sum(m.est_cost), 0) as est_cost
             from auth_user u
             left join usage_meter m on u.id = m.user_id
             group by u.id, u.email, u.name
             order by est_cost desc, u.name asc`
        );

        const usage: AdminUsageRow[] = usageRes.rows.map((r) => ({
            userId: r.user_id,
            email: r.email,
            name: r.name,
            audioSeconds: Number(r.audio_seconds),
            tokens: Number(r.tokens),
            estCost: Number(r.est_cost),
        }));

        // 4. Fetch cost limits
        const limitsRes = await pool.query<{ user_id: string; daily_cost_limit: string | number }>(
            `select user_id, daily_cost_limit from user_cost_limits`
        );
        const limits: Record<string, number> = {};
        for (const row of limitsRes.rows) {
            limits[row.user_id] = Number(row.daily_cost_limit);
        }

        const defaultEnvLimit = getDailyCostCap();

        return (
            <AdminDashboardClient
                locale={locale}
                initialUsers={usersRes.rows}
                documents={documents}
                initialUsage={usage}
                initialLimits={limits}
                defaultEnvLimit={defaultEnvLimit}
            />
        );
    } finally {
        await pool.end();
    }
}
