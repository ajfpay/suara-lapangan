import { NextResponse } from "next/server";
import {
    getPostgresDocumentStore,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { redactSecrets } from "@/lib/server/asr/log";
import { toResponseDocument } from "@/lib/server/guard/sparkPath";
import { amountInWords, terbilang } from "@/lib/server/guard/words";
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

class PatchValueError extends Error {}

type PatchBody = {
    field?: unknown;
    nilai?: unknown;
};

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function PATCH(
    request: Request,
    context: RouteContext
): Promise<Response> {
    let body: PatchBody;
    try {
        body = (await request.json()) as PatchBody;
    } catch {
        return NextResponse.json(
            { error: "invalid_request", message: "Request body must be JSON" },
            { status: 400 }
        );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: "Request body must be a JSON object",
            },
            { status: 400 }
        );
    }

    const { field, nilai } = body;
    if (typeof field !== "string" || field.trim() === "") {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: "field is required and must be a non-empty string",
            },
            { status: 400 }
        );
    }

    const match = field.match(
        /^pekerjaan\[(\d+)\]\.(volume|harga_satuan|satuan|uraian)$/
    );
    if (!match) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: `Field '${field}' is not supported for patching. Must match pekerjaan[<i>].<volume|harga_satuan|satuan|uraian>`,
            },
            { status: 400 }
        );
    }

    const { id } = await context.params;
    if (!id || typeof id !== "string" || id.trim() === "") {
        return NextResponse.json(
            {
                error: "not_found",
                message: "Document id is required",
            },
            { status: 404 }
        );
    }

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
                if (
                    (typeof nilai !== "number" && typeof nilai !== "string") ||
                    (typeof nilai === "string" && nilai.trim() === "")
                ) {
                    throw new PatchValueError(
                        `Field '${field}' requires a valid numeric value`
                    );
                }
                const num = typeof nilai === "number" ? nilai : Number(nilai.trim());
                if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
                    throw new PatchValueError(
                        `Field '${field}' requires a valid non-negative number`
                    );
                }
                document.pekerjaan[index][subfield] = num;
            } else if (subfield === "satuan") {
                if (typeof nilai !== "string" && typeof nilai !== "number") {
                    throw new PatchValueError(
                        `Field '${field}' requires a string value`
                    );
                }
                const str = String(nilai).trim();
                if (str === "") {
                    throw new PatchValueError(
                        `Field '${field}' cannot be empty`
                    );
                }
                document.pekerjaan[index].satuan = str as CanonicalUnit;
            } else if (subfield === "uraian") {
                if (typeof nilai !== "string" && typeof nilai !== "number") {
                    throw new PatchValueError(
                        `Field '${field}' requires a string value`
                    );
                }
                const str = String(nilai).trim();
                if (str === "") {
                    throw new PatchValueError(
                        `Field '${field}' cannot be empty`
                    );
                }
                document.pekerjaan[index].uraian = str;
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
        } else if (cause instanceof PatchValueError) {
            return NextResponse.json(
                {
                    error: "invalid_request",
                    message: cause.message,
                },
                { status: 400 }
            );
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

export async function GET(
    _request: Request,
    context: RouteContext
): Promise<Response> {
    const { id } = await context.params;
    if (!id || typeof id !== "string" || id.trim() === "") {
        return NextResponse.json(
            {
                error: "not_found",
                message: "Document id is required",
            },
            { status: 404 }
        );
    }

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
        },
        { status: 200 }
    );
}
