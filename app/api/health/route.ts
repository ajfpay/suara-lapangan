import { NextResponse } from "next/server";
import { checkHealth, probeDatabase } from "./healthCheck";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
    const result = await checkHealth(probeDatabase);
    return NextResponse.json(result.body, {
        status: result.statusCode,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}
