import { NextResponse } from "next/server";
import { auth } from "@/lib/server/auth";
import { getUsageStore } from "@/lib/server/quota/usage-meter";

export async function GET(request: Request) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || (session.user as { role?: string }).role !== "admin") {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start") ?? undefined;
    const endDate = searchParams.get("end") ?? undefined;

    try {
        const store = getUsageStore();
        if (!("getAggregatedUsage" in store)) {
            return NextResponse.json({ error: "not_supported" }, { status: 503 });
        }
        const usage = await (
            store as {
                getAggregatedUsage(
                    startDate?: string,
                    endDate?: string
                ): Promise<
                    Array<{
                        userId: string;
                        email: string;
                        name: string;
                        audioSeconds: number;
                        tokens: number;
                        estCost: number;
                    }>
                >;
            }
        ).getAggregatedUsage(startDate, endDate);
        return NextResponse.json({ usage });
    } catch {
        return NextResponse.json({ error: "store_failure" }, { status: 500 });
    }
}
