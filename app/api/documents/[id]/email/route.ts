import path from "node:path";
import { NextResponse } from "next/server";
import {
    getPostgresDocumentStore,
    contentHashOf,
    type StoredDocument,
} from "@/lib/server/db/documentStore";
import { redactSecrets } from "@/lib/server/asr/log";
import {
    documentIdSchema,
    formatZodError,
} from "@/lib/server/validation/document";
import {
    withRateLimitFlat,
    detectRequestLocale,
} from "@/lib/server/quota/rate-limit";
import {
    getSmtpConfig,
    sendEmail,
    buildDocumentEmail,
    sendEmailBodySchema,
} from "@/lib/server/email";
import {
    resolvePdfStorageDir,
    relativePdfPathFor,
    isSafeStoredPdfPath,
    readPdfSnapshot,
} from "@/lib/server/pdf/storage";
import {
    reserveEmailSend,
    releaseEmailSend,
    EmailQuotaExceededError,
    isRecipientAllowed,
} from "@/lib/server/quota/email-quota";
import { getSession, canAccessDocument } from "@/lib/server/auth";

type RouteContext = {
    params: Promise<{ id: string }>;
};

async function handlePost(
    request: Request,
    context?: RouteContext
): Promise<Response> {
    const reqLocale = detectRequestLocale(request);

    const parsedId = documentIdSchema.safeParse((await context?.params)?.id);
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
    const session = await getSession(request);
    if (!session) {
        return NextResponse.json(
            { error: "unauthorized", message: "Authentication required" },
            { status: 401 }
        );
    }
    const store = getPostgresDocumentStore();
    let stored: StoredDocument | null;
    try {
        stored = await store.get(id);
    } catch (cause) {
        console.error(
            redactSecrets(
                `[email] document store access failed: ${String(cause)}`
            )
        );
        return NextResponse.json(
            {
                error: "store_failure",
                message:
                    reqLocale === "en"
                        ? "Failed to access document database"
                        : "Gagal mengakses basis data dokumen",
            },
            { status: 500 }
        );
    }

    const ownerUserId = stored?.userId ?? null;
    if (!canAccessDocument(session, ownerUserId)) {
        return NextResponse.json(
            {
                error: "forbidden",
                message: "You do not have access to this document",
            },
            { status: 403 }
        );
    }

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        return NextResponse.json(
            {
                error: "invalid_request",
                message:
                    reqLocale === "en"
                        ? "Invalid JSON body"
                        : "Format JSON tidak valid",
            },
            { status: 400 }
        );
    }

    const parsedBody = sendEmailBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
        return NextResponse.json(
            {
                error: "invalid_request",
                message: formatZodError(parsedBody.error),
            },
            { status: 400 }
        );
    }

    const smtpConfig = getSmtpConfig();
    if (!smtpConfig) {
        return NextResponse.json(
            {
                error: "email_not_configured",
                message:
                    reqLocale === "en"
                        ? "Email service is not configured"
                        : "Layanan email belum dikonfigurasi",
            },
            { status: 503 }
        );
    }

    if (!isRecipientAllowed(parsedBody.data.to)) {
        return NextResponse.json(
            {
                error: "recipient_not_allowed",
                message:
                    reqLocale === "en"
                        ? "Recipient is not in the allowlist"
                        : "Penerima tidak ada dalam daftar izin",
            },
            { status: 403 }
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

    if (
        stored.status === "perlu_konfirmasi" ||
        stored.document.butuh_konfirmasi.length > 0
    ) {
        return NextResponse.json(
            {
                error: "needs_confirmation",
                message:
                    reqLocale === "en"
                        ? "Document requires confirmation before it can be sent. Resolve butuh_konfirmasi via PATCH /api/documents/{id} first."
                        : "Dokumen memerlukan konfirmasi sebelum dapat dikirim. Selesaikan butuh_konfirmasi melalui PATCH /api/documents/{id} terlebih dahulu.",
            },
            { status: 409 }
        );
    }

    // Resend policy: a document that is already `terkirim` cannot be sent
    // again. The owner edits it (PATCH) to return it to `siap`, which clears
    // the send record, before a fresh send is allowed. This prevents silently
    // overwriting sent_to/sent_at of an earlier delivery.
    if (stored.status === "terkirim") {
        return NextResponse.json(
            {
                error: "already_sent",
                message:
                    reqLocale === "en"
                        ? "This document has already been sent. Edit it first to send a new version."
                        : "Dokumen ini sudah terkirim. Ubah dokumen terlebih dahulu untuk mengirim versi baru.",
            },
            { status: 409 }
        );
    }

    // Reserve a quota slot only after the document exists and passes the
    // status checks, so a 404/409/500 does not consume a daily slot.
    let reservation: Awaited<ReturnType<typeof reserveEmailSend>> | null = null;
    try {
        reservation = await reserveEmailSend({ locale: reqLocale });
    } catch (cause) {
        if (cause instanceof EmailQuotaExceededError) {
            return NextResponse.json(
                {
                    error: cause.code,
                    message: cause.message,
                },
                {
                    status: 429,
                    headers: {
                        "X-Quota-Hard-Stop": "true",
                    },
                }
            );
        }
        throw cause;
    }

    const storageDir = resolvePdfStorageDir();
    const contentHash = contentHashOf(stored.document);
    let pdfBuffer: Buffer | null = null;

    /**
     * Reads a hash-verified PDF snapshot and accepts it only when the sidecar
     * hash matches the current document content. A snapshot whose hash differs
     * is stale (the document was PATCHed after the PDF was rendered) and must
     * not be emailed, mirroring the PDF route's stale-snapshot rejection.
     */
    const acceptSnapshot = (snapshot: { pdf: Buffer; hash: string }): void => {
        if (snapshot.hash !== contentHash) {
            console.warn(
                redactSecrets(
                    `[email] stale pdf snapshot for ${id}: hash mismatch`
                )
            );
            return;
        }
        pdfBuffer = snapshot.pdf;
    };

    if (stored.pdfPath && isSafeStoredPdfPath(stored.pdfPath)) {
        const diskPath = path.resolve(storageDir, stored.pdfPath);
        try {
            const snapshot = await readPdfSnapshot(diskPath);
            if (snapshot) {
                acceptSnapshot(snapshot);
            }
        } catch (cause) {
            console.error(
                redactSecrets(`[email] disk read failed: ${String(cause)}`)
            );
        }
    }

    if (!pdfBuffer) {
        const idPath = relativePdfPathFor(id);
        const idDiskPath = path.resolve(storageDir, idPath);
        try {
            const snapshot = await readPdfSnapshot(idDiskPath);
            if (snapshot) {
                acceptSnapshot(snapshot);
            }
        } catch (cause) {
            console.error(
                redactSecrets(`[email] disk read failed: ${String(cause)}`)
            );
        }
    }

    if (!pdfBuffer) {
        if (reservation) {
            await releaseEmailSend().catch((cause) => {
                console.error(
                    redactSecrets(
                        `[email] failed to release quota reservation: ${String(cause)}`
                    )
                );
            });
        }
        return NextResponse.json(
            {
                error: "send_failure",
                message:
                    reqLocale === "en"
                        ? "Document PDF is not available on disk"
                        : "PDF dokumen tidak ditemukan di penyimpanan",
            },
            { status: 502 }
        );
    }

    const docLocale = stored.document.locale === "en" ? "en" : "id";
    const emailContent = buildDocumentEmail(
        stored.document.nomor ?? "",
        docLocale
    );

    try {
        await sendEmail(smtpConfig, {
            to: parsedBody.data.to,
            subject: emailContent.subject,
            text: emailContent.text,
            attachments: [
                {
                    filename: emailContent.filename,
                    content: pdfBuffer,
                    contentType: "application/pdf",
                },
            ],
        });
    } catch (cause) {
        console.error(
            redactSecrets(`[email] delivery failed: ${String(cause)}`)
        );
        if (reservation) {
            await releaseEmailSend().catch((releaseCause) => {
                console.error(
                    redactSecrets(
                        `[email] failed to release quota reservation: ${String(releaseCause)}`
                    )
                );
            });
        }
        return NextResponse.json(
            {
                error: "send_failure",
                message:
                    reqLocale === "en"
                        ? "Failed to deliver email"
                        : "Gagal mengirim email",
            },
            { status: 502 }
        );
    }

    const sentAt = new Date();
    try {
        const result = await store.markSent(
            id,
            parsedBody.data.to,
            contentHash
        );
        if (!result.ok && result.reason === "not_found") {
            return NextResponse.json(
                {
                    error: "not_found",
                    message: `Document '${id}' not found`,
                },
                { status: 404 }
            );
        }
        if (!result.ok && result.reason === "changed") {
            // The email was already delivered for the version read above. A
            // concurrent PATCH changed the document while the send was in
            // flight, so the current version is not marked sent. This is not
            // an error the user should retry (that would send a duplicate);
            // report the delivery and leave the document as-is.
            return NextResponse.json(
                {
                    status: "not_marked",
                    sent_to: parsedBody.data.to,
                    sent_at: sentAt.toISOString(),
                    message:
                        reqLocale === "en"
                            ? "The email was sent for the version you viewed. The document changed while sending, so it was not marked as sent."
                            : "Email terkirim untuk versi yang Anda lihat. Dokumen berubah saat pengiriman, sehingga tidak ditandai sebagai terkirim.",
                },
                { status: 200 }
            );
        }
    } catch (cause) {
        console.error(
            redactSecrets(`[email] update store failed: ${String(cause)}`)
        );
        return NextResponse.json(
            {
                error: "store_failure",
                message:
                    reqLocale === "en"
                        ? "Failed to record sent status"
                        : "Gagal memperbarui status dokumen",
            },
            { status: 500 }
        );
    }

    return NextResponse.json(
        {
            status: "terkirim",
            sent_to: parsedBody.data.to,
            sent_at: sentAt.toISOString(),
        },
        { status: 200 }
    );
}

export const POST = withRateLimitFlat(handlePost, {
    route: "/api/documents/email",
    limit: 10,
    windowMs: 60_000,
}) as (request: Request, context: RouteContext) => Promise<Response>;
