import { NextResponse } from "next/server";
import { getTurnsStore, type TurnsStore } from "@/lib/server/db/store";
import { applyGuard } from "@/lib/server/guard/rules";
import { callMuseSpark, SparkError } from "@/lib/server/guard/spark";
import { documentFromTurns } from "@/lib/server/guard/documentFromTurns";
import {
    getPostgresDocumentStore,
    turnsHashOf,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import {
    allocateDocumentNumber,
    getDocumentNumberPool,
} from "@/lib/server/db/documentNumber";
import {
    sparkPathMarker,
    toResponseDocument,
} from "@/lib/server/guard/sparkPath";
import { redactSecrets } from "@/lib/server/asr/log";
import { withRateLimit } from "@/lib/server/quota/rate-limit";
import { recordUsage } from "@/lib/server/quota/usage-meter";
import {
    postDocumentBodySchema,
    formatZodError,
} from "@/lib/server/validation/document";
import type {
    DocumentStatus,
    Locale,
    QuotationDocument,
} from "@/lib/server/guard/types";
import type { Turn } from "@/lib/server/asr/turns";

async function handlePost(request: Request): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "invalid_request", message: "Request body must be JSON" },
            { status: 400 }
        );
    }

    const parsed = postDocumentBodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "invalid_request", message: formatZodError(parsed.error) },
            { status: 400 }
        );
    }

    const { sessionId, locale, project, turns } = parsed.data;
    // Idempotent reuse check: if document for same session exists, return it without calling the model
    // Catch store init and lookup failures, map to JSON status
    let session;
    let turnsStore: TurnsStore | undefined;
    if (turns && turns.length > 0) {
        session = {
            sessionId,
            locale: (locale ?? "id") as Locale,
            audioSha256: "inline",
            turns: turns.map((t) => ({
                ...t,
                final: t.final ?? true,
            })) as Turn[],
        };
    } else {
        try {
            turnsStore = getTurnsStore();
            session = await turnsStore.findSession(sessionId);
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

    // The inline-turns test branch never went through ASR, so the session row the
    // document's foreign key needs may not exist. Only a truly absent session is
    // persisted here; an existing row always wins, so a POST with inline turns can
    // never clobber what a real ASR upload stored. After the swap, locale and turns
    // follow the stored session; an explicit request locale still wins over it.
    if (!turnsStore) {
        try {
            turnsStore = getTurnsStore();
            const existingSession = await turnsStore.findSession(sessionId);
            if (existingSession) {
                session = existingSession;
            } else {
                await turnsStore.saveTranscription({
                    sessionId,
                    locale: session.locale,
                    audioSha256: session.audioSha256,
                    audioBytes: 1,
                    metaSessionId: null,
                    transcript: session.turns.map((t) => t.transcript).join(" "),
                    audioDurationMs: null,
                    turns: session.turns,
                });
            }
        } catch {
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to persist test session",
                },
                { status: 500 }
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

    // Idempotent reuse: an identical create (same session, same turns fingerprint,
    // same calendar day) returns the document it created instead of minting a second
    // one. Computed after the possible session swap, so the fingerprint always
    // describes the turns the document is actually built from.
    const fingerprint = turnsHashOf(session.turns, {
        locale: resolvedLocale,
        project,
    });
    let docStore: ReturnType<typeof getPostgresDocumentStore>;
    try {
        docStore = getPostgresDocumentStore();
    } catch {
        return NextResponse.json(
            { error: "not_configured", message: "DATABASE_URL is not set" },
            { status: 503 }
        );
    }
    let existing: StoredDocument | null = null;
    try {
        existing = await docStore.findByIdempotencyKey(sessionId, fingerprint);
    } catch {
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }
    if (existing) {
        const doc = existing.document;
        const matchesLocale = doc.locale === resolvedLocale;
        const matchesProject =
            !project ||
            (doc.proyek.nama === project.nama &&
                doc.proyek.lokasi === project.lokasi &&
                doc.proyek.klien === project.klien);

        if (matchesLocale && matchesProject) {
            return NextResponse.json(
                {
                    document: toResponseDocument({ ...doc, id: existing.id }),
                    butuh_konfirmasi: doc.butuh_konfirmasi ?? [],
                    status:
                        (doc.butuh_konfirmasi?.length ?? 0) > 0
                            ? "perlu_konfirmasi"
                            : "siap",
                    ...sparkPathMarker(doc._spark_path === true),
                },
                { status: 200 }
            );
        }
    }

    // One number per created document, allocated after the idempotency check so
    // a reuse hit never burns a number. The allocation commits independently of
    // the document insert, so a failed create burns its number (never reused);
    // the unique index on documents.nomor is the second line of defence.
    const year = new Date().getFullYear();
    let nomor: string;
    try {
        nomor = await allocateDocumentNumber(getDocumentNumberPool(), year);
    } catch (cause) {
        console.error(
            redactSecrets(`[documents] allocation failed: ${String(cause)}`)
        );
        return NextResponse.json(
            { error: "store_failure", message: "Failed to allocate document number" },
            { status: 500 }
        );
    }

    async function persistAndRespond(
        document: QuotationDocument,
        fromModel: boolean
    ): Promise<Response> {
        let stored: StoredDocument;
        try {
            stored = await docStore.create({
                sessionId,
                locale: document.locale,
                nomor: document.nomor,
                turnsHash: fingerprint,
                document,
            });
        } catch (cause) {
            console.error(
                redactSecrets(`[documents] persist failed: ${String(cause)}`)
            );
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to persist document",
                },
                { status: 500 }
            );
        }
        const documentWithId: QuotationDocument = {
            ...stored.document,
            id: stored.id,
        };
        // A concurrent identical create can make create() return the winner's row;
        // answer from the stored row so the envelope always matches what is stored.
        const butuhKonfirmasi = stored.document.butuh_konfirmasi ?? [];
        const status: DocumentStatus =
            butuhKonfirmasi.length > 0 ? "perlu_konfirmasi" : "siap";
        return NextResponse.json(
            {
                document: toResponseDocument(documentWithId),
                butuh_konfirmasi: butuhKonfirmasi,
                status,
                ...sparkPathMarker(stored.document._spark_path === true || fromModel),
            },
            { status: 200 }
        );
    }
    // Wire fallback to call documentFromTurns when MODEL_API_KEY missing
    if (!process.env.MODEL_API_KEY) {
        const result = documentFromTurns(
            session.turns,
            resolvedLocale,
            project,
            { sessionId, nomor }
        );
        return persistAndRespond(result.document, false);
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
                    { sessionId, nomor }
                );
                // Skip persisting on transient upstream error so subsequent requests can retry
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

    const usage = candidate._usage;
    if (usage && usage.totalTokens > 0) {
        try {
            await recordUsage({ tokens: usage.totalTokens });
        } catch (cause) {
            console.error(
                redactSecrets(
                    `[documents] usage record failed: ${String(cause)}`
                )
            );
        }
    }

    // Run Guard deterministically
    const result = applyGuard(candidate, session.turns, {
        locale: resolvedLocale,
        project,
        sessionId,
        nomor,
    });

    // Save document
    if (candidate._spark_path) {
        result.document._spark_path = true;
    }
    return persistAndRespond(result.document, candidate._spark_path === true);
}

export const POST = withRateLimit(handlePost, {
    route: "/api/documents",
    checkDailyQuota: true,
});
