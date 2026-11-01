import { NextResponse } from "next/server";
import {
    getPostgresDocumentStore,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { redactSecrets } from "@/lib/server/asr/log";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { amountInWords, terbilang } from "@/lib/server/guard/words";
import {
    documentIdSchema,
    patchDocumentBodySchema,
    formatZodError,
} from "@/lib/server/validation/document";
import { withRateLimitFlat } from "@/lib/server/quota/rate-limit";
import type {
    CanonicalUnit,
    DocumentStatus,
} from "@/lib/server/guard/types";

function round(value: number, decimals = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

class PatchIndexError extends Error {
    readonly index: number;
    constructor(index: number) {
        super(`Pekerjaan at index ${index} not found in document`);
        this.index = index;
    }
}


type RouteContext = {
    params: Promise<{ id: string }>;
};

async function handlePatch(
    request: Request,
    context?: RouteContext
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "invalid_request", message: "Request body must be JSON" },
            { status: 400 }
        );
    }

    const parsedBody = patchDocumentBodySchema.safeParse(body);
    if (!parsedBody.success) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedBody.error),
            },
            { status: 400 }
        );
    }

    const parsedId = documentIdSchema.safeParse(
        (await context?.params)?.id
    );
    if (!parsedId.success) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedId.error),
            },
            { status: 400 }
        );
    }

    const id = parsedId.data;
    const { field, nilai } = parsedBody.data;
    const match = field.match(
        /^pekerjaan\[(\d+)\]\.(volume|harga_satuan|satuan|uraian)$/
    )!;

    let docStore: ReturnType<typeof getPostgresDocumentStore>;
    try {
        docStore = getPostgresDocumentStore();
    } catch {
        return NextResponse.json(
            {
                error: "not_configured",
                message: "DATABASE_URL is not set",
            },
            { status: 503 }
        );
    }
    const index = parseInt(match[1], 10);
    const subfield = match[2];

    let result: StoredDocument | null = null;
    let indexError: PatchIndexError | undefined;
    try {
        result = await docStore.update(id, (document) => {
            if (
                !Array.isArray(document.pekerjaan) ||
                index < 0 ||
                index >= document.pekerjaan.length
            ) {
                throw new PatchIndexError(index);
            }

            if (subfield === "volume" || subfield === "harga_satuan") {
                const num =
                    typeof nilai === "number" ? nilai : Number(nilai.trim());
                document.pekerjaan[index][subfield] = num;
            } else if (subfield === "satuan") {
                document.pekerjaan[index].satuan = String(
                    nilai
                ).trim() as CanonicalUnit;
            } else if (subfield === "uraian") {
                document.pekerjaan[index].uraian = String(nilai).trim();
            }

            // A PATCH of pekerjaan[i].<field> must also clear that exact field
            // string from document.butuh_konfirmasi.
            document.butuh_konfirmasi = (
                document.butuh_konfirmasi || []
            ).filter((item) => item.field !== field);

            // Recompute SERVER-SIDE after any patch:
            // each pekerjaan[].jumlah = round(volume * harga_satuan, 2);
            // total_nominal = sum(jumlah);
            // terbilang = locale === "en" ? amountInWords(total) : terbilang(total)
            let totalNominal = 0;
            for (const item of document.pekerjaan) {
                item.jumlah = round(item.volume * item.harga_satuan, 2);
                totalNominal += item.jumlah;
            }
            totalNominal = round(totalNominal, 2);
            document.total_nominal = totalNominal;

            document.terbilang =
                document.locale === "en"
                    ? amountInWords(totalNominal)
                    : terbilang(totalNominal);

            return document;
        });
    } catch (cause) {
        if (cause instanceof PatchIndexError) {
            indexError = cause;
        } else {
            console.error(
                redactSecrets(`[documents] patch failed: ${String(cause)}`)
            );
            return NextResponse.json(
                {
                    error: "store_failure",
                    message: "Failed to persist document",
                },
                { status: 500 }
            );
        }
    }
    if (indexError) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: `Pekerjaan at index ${indexError.index} not found in document`,
            },
            { status: 400 }
        );
    }
    if (!result) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `Document '${id}' not found`,
            },
            { status: 404 }
        );
    }

    // status = document.butuh_konfirmasi.length > 0 ? "perlu_konfirmasi" : "siap".
    // The document may only reach "siap" when butuh_konfirmasi is empty.
    const status: DocumentStatus =
        result.document.butuh_konfirmasi.length > 0
            ? "perlu_konfirmasi"
            : "siap";

    return NextResponse.json(
        {
            document: toResponseDocument({
                ...result.document,
                id: result.id,
            }),
            butuh_konfirmasi: result.document.butuh_konfirmasi,
            status,
        },
        { status: 200 }
    );

}

async function handleGet(
    _request: Request,
    context?: RouteContext
): Promise<Response> {
    const parsedId = documentIdSchema.safeParse(
        (await context?.params)?.id
    );
    if (!parsedId.success) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedId.error),
            },
            { status: 400 }
        );
    }

    const id = parsedId.data;
    let stored: StoredDocument | null;
    try {
        stored = await getPostgresDocumentStore().get(id);
    } catch {
        return NextResponse.json(
            {
                error: "store_failure",
                message: "Failed to access document database",
            },
            { status: 500 }
        );
    }
    if (!stored) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `Document '${id}' not found`,
            },
            { status: 404 }
        );
    }

    return NextResponse.json(
        {
            document: toResponseDocument({
                ...stored.document,
                id: stored.id,
            }),
            butuh_konfirmasi: stored.document.butuh_konfirmasi,
            status: stored.status,
            sent_to: stored.sentTo ?? null,
            sent_at: stored.sentAt ? stored.sentAt.toISOString() : null,
        },
        { status: 200 }
    );
}

export const PATCH = withRateLimitFlat(handlePatch, {
    route: "/api/documents",
}) as (request: Request, context: RouteContext) => Promise<Response>;
export const GET = withRateLimitFlat(handleGet, {
    route: "/api/documents",
}) as (request: Request, context: RouteContext) => Promise<Response>;
