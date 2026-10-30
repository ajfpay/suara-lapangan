import { NextResponse } from "next/server";
import { getTurnsStore } from "@/lib/server/db/store";
import { applyGuard } from "@/lib/server/guard/rules";
import { callMuseSpark, SparkError } from "@/lib/server/guard/spark";
import { documentFromTurns } from "@/lib/server/guard/documentFromTurns";
import { getDocumentStore } from "@/lib/server/guard/documentStore";
import {
    sparkPathMarker,
    toResponseDocument,
} from "@/lib/server/guard/sparkPath";
import type { Locale, Proyek } from "@/lib/server/guard/types";

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

type PostDocumentBody = {
    sessionId?: unknown;
    locale?: unknown;
    project?: unknown;
    turns?: unknown;
};

export async function POST(request: Request): Promise<Response> {
    let body: PostDocumentBody;
    try {
        body = (await request.json()) as PostDocumentBody;
    } catch {
        return NextResponse.json(
            { error: "invalid_request", message: "Request body must be JSON" },
            { status: 400 }
        );
    }

    const rawSessionId = body?.sessionId;
    if (typeof rawSessionId !== "string" || !SESSION_ID.test(rawSessionId)) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: "sessionId is required and must match ^[A-Za-z0-9_-]{1,64}$",
            },
            { status: 400 }
        );
    }

    const sessionId = rawSessionId;

    let locale: Locale | undefined;
    if (body.locale !== undefined) {
        if (body.locale !== "en" && body.locale !== "id") {
            return NextResponse.json(
                {
                    error: "invalid_request",
                    message: "locale must be 'en' or 'id'",
                },
                { status: 400 }
            );
        }
        locale = body.locale;
    }

    // Validate project fields as non-empty strings, ignore anything else
    let project: Proyek | undefined;
    if (body.project && typeof body.project === "object") {
        const rawProj = body.project as Record<string, unknown>;
        if (
            typeof rawProj.nama === "string" &&
            rawProj.nama.trim().length > 0 &&
            typeof rawProj.lokasi === "string" &&
            rawProj.lokasi.trim().length > 0 &&
            typeof rawProj.klien === "string" &&
            rawProj.klien.trim().length > 0
        ) {
            project = {
                nama: rawProj.nama.trim(),
                lokasi: rawProj.lokasi.trim(),
                klien: rawProj.klien.trim(),
            };
        }
    }

    // DEMO-ONLY: This endpoint is a hackathon prototype demonstration.
    // In production, enforce authentication, tenant rate limiting, and quota checks.
    // Idempotent reuse check: if document for same session exists, return it without calling the model
    // Catch store init and lookup failures, map to JSON status
    let session;
    if (Array.isArray(body.turns) && body.turns.length > 0) {
        session = {
            sessionId,
            locale: (locale ?? "id") as Locale,
            audioSha256: "inline",
            turns: body.turns as import("@/lib/server/asr/turns").Turn[],
        };
    } else {
        try {
            const store = getTurnsStore();
            session = await store.findSession(sessionId);
        } catch {
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to access session database",
                },
                { status: 500 }
            );
        }

        if (!session) {
            return NextResponse.json(
                { error: "session_not_found", message: `Session '${sessionId}' not found` },
                { status: 404 }
            );
        }
    }

    const resolvedLocale: Locale = locale ?? session.locale;

    if (!session.turns || session.turns.length === 0) {
        return NextResponse.json(
            { error: "empty_turns", message: "Session contains no speech turns" },
            { status: 400 }
        );
    }

    // Idempotent reuse check: if document for same session exists, return it if inputs match
    const docStore = getDocumentStore();
    if (docStore.has(sessionId)) {
        const existingDoc = docStore.get(sessionId)!;
        const matchesLocale = existingDoc.locale === resolvedLocale;
        const matchesProject =
            !project ||
            (existingDoc.proyek.nama === project.nama &&
                existingDoc.proyek.lokasi === project.lokasi &&
                existingDoc.proyek.klien === project.klien);

        if (matchesLocale && matchesProject) {
            return NextResponse.json(
                {
                    document: toResponseDocument(existingDoc),
                    butuh_konfirmasi: existingDoc.butuh_konfirmasi ?? [],
                    status:
                        (existingDoc.butuh_konfirmasi?.length ?? 0) > 0
                            ? "perlu_konfirmasi"
                            : "siap",
                    ...sparkPathMarker(existingDoc._spark_path === true),
                },
                { status: 200 }
            );
        }
    }
    // Wire fallback to call documentFromTurns when MODEL_API_KEY missing
    if (!process.env.MODEL_API_KEY) {
        const result = documentFromTurns(
            session.turns,
            resolvedLocale,
            project,
            { sessionId }
        );
        docStore.set(sessionId, result.document);
        return NextResponse.json(
            {
                document: result.document,
                butuh_konfirmasi: result.butuh_konfirmasi,
                status: result.status,
            },
            { status: 200 }
        );
    }

    // Call Muse Spark 1.3 inline with strict schema
    let candidate;
    try {
        candidate = await callMuseSpark({
            turns: session.turns,
            locale: resolvedLocale,
            apiKey: process.env.MODEL_API_KEY,
        });
    } catch (err) {
        if (err instanceof SparkError) {
            if (err.code === "upstream_unreachable" || err.code === "schema_rejected") {
                const result = documentFromTurns(
                    session.turns,
                    resolvedLocale,
                    project,
                    { sessionId }
                );
                // Skip permanent caching on transient upstream error so subsequent requests can retry
                return NextResponse.json(
                    {
                        document: result.document,
                        butuh_konfirmasi: result.butuh_konfirmasi,
                        status: result.status,
                    },
                    { status: 200 }
                );
            }
            return NextResponse.json(
                { error: err.code, message: err.message },
                { status: err.status }
            );
        }
        return NextResponse.json(
            { error: "upstream_failure", message: "Failed to call model" },
            { status: 502 }
        );
    }

    // Run Guard deterministically
    const result = applyGuard(candidate, session.turns, {
        locale: resolvedLocale,
        project,
        sessionId,
    });

    // Save document
    if (candidate._spark_path) {
        result.document._spark_path = true;
    }
    docStore.set(sessionId, result.document);
    return NextResponse.json(
        {
            document: toResponseDocument(result.document),
            butuh_konfirmasi: result.butuh_konfirmasi,
            status: result.status,
            ...sparkPathMarker(candidate._spark_path === true),
        },
        { status: 200 }
    );
}
