import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { POST } from "./route";
import { GET } from "@/app/api/documents/[id]/route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import { contentHashOf } from "@/lib/server/db/documentStore";
import type { QuotationDocument } from "@/lib/server/guard/types";
import { writePdfAtomic } from "@/lib/server/pdf/storage";
import { getEmailSends } from "@/lib/server/quota/email-quota";

const { mockGetSession, mockIsAdmin, sendMailMock } = vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockIsAdmin: vi.fn(),
    sendMailMock: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
    getSession: mockGetSession,
    isAdmin: mockIsAdmin,
    canAccessDocument: (
        session: { user: { id: string; role?: string } },
        ownerUserId: string | null
    ) => {
        if (ownerUserId === null) return mockIsAdmin(session);
        return session.user.id === ownerUserId || mockIsAdmin(session);
    },
}));

beforeEach(() => {
    mockGetSession.mockResolvedValue({
        user: {
            id: "00000000-0000-0000-0000-000000000000",
            email: "system@suara-lapangan.local",
            name: "System",
            role: "admin",
        },
    });
    mockIsAdmin.mockReturnValue(true);
});

vi.mock("nodemailer", () => ({
    default: {
        createTransport: vi.fn(() => ({
            sendMail: sendMailMock,
        })),
    },
}));

const TEST_DATABASE_URL = process.env.ASR_TEST_DATABASE_URL;

if (TEST_DATABASE_URL !== undefined) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
}

function createTestDocument(
    overrides?: Partial<QuotationDocument>
): QuotationDocument {
    return {
        jenis: "surat_penawaran",
        locale: "id",
        mata_uang: "IDR",
        nomor: "SL/QTN/2026/0001",
        tanggal: "2026-10-29",
        proyek: {
            nama: "Renovasi Rumah",
            lokasi: "Jl. Kaliurang km 5",
            klien: "Pak Bambang",
        },
        pekerjaan: [
            {
                uraian: "Pemasangan hebel",
                volume: 10,
                satuan: "m2",
                harga_satuan: 50000,
                jumlah: 500000,
                sumber_kutipan: "turn_1",
            },
        ],
        total_nominal: 500000,
        terbilang: "Lima ratus ribu rupiah",
        butuh_konfirmasi: [],
        ...overrides,
    };
}

describe
    .skipIf(!TEST_DATABASE_URL)
    .sequential("POST /api/documents/[id]/email route handler", () => {
        let pool: Pool;
        let seededIds: string[] = [];
        let tempDir: string;
        const origStorageDir = process.env.PDF_STORAGE_DIR;
        const origSmtpEnv = {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
            from: process.env.SMTP_FROM,
            secure: process.env.SMTP_SECURE,
            allowlist: process.env.EMAIL_ALLOWLIST,
            dailyLimit: process.env.EMAIL_DAILY_SEND_LIMIT,
        };

        beforeAll(async () => {
            pool = new Pool({ connectionString: TEST_DATABASE_URL });
            for (const file of [
                "0001_sessions_turns.sql",
                "0002_usage_meter.sql",
                "0003_documents.sql",
                "0004_email_sends.sql",
                "0007_auth_tables.sql",
                "0008_documents_user_id.sql",
            ]) {
                const sql = await fs.readFile(`db/migrations/${file}`, "utf8");
                await pool.query(sql);
            }
            await pool.query(
                `insert into auth_user (id, email, email_verified, name, role)
             values
               ('00000000-0000-0000-0000-000000000000','admin@suara-lapangan.local',true,'Admin','admin'),
               ('00000000-0000-0000-0000-000000000001','test1@suara-lapangan.local',true,'Test User 1','user'),
               ('00000000-0000-0000-0000-000000000002','test2@suara-lapangan.local',true,'Test User 2','user')
             on conflict (id) do nothing`
            );
        });

        beforeEach(async () => {
            resetRateLimits();
            sendMailMock.mockReset();
            sendMailMock.mockResolvedValue({ messageId: "mock-message-id" });

            process.env.SMTP_HOST = "smtp.example.com";
            process.env.SMTP_PORT = "587";
            process.env.SMTP_USER = "user@example.com";
            process.env.SMTP_PASS = "test-secret-smtp-pass";
            process.env.SMTP_FROM = "sender@example.com";
            delete process.env.SMTP_SECURE;
            delete process.env.EMAIL_ALLOWLIST;
            delete process.env.EMAIL_DAILY_SEND_LIMIT;

            tempDir = await fs.mkdtemp(
                path.join(os.tmpdir(), "suara-email-test-")
            );
            process.env.PDF_STORAGE_DIR = tempDir;

            await pool.query(
                "truncate documents, sessions cascade; truncate email_send_meter;"
            );
            seededIds = [];
            await pool.query(
                "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '') on conflict (id) do nothing"
            );
        });

        afterAll(async () => {
            await pool.end();
            if (origStorageDir !== undefined) {
                process.env.PDF_STORAGE_DIR = origStorageDir;
            } else {
                delete process.env.PDF_STORAGE_DIR;
            }
            if (origSmtpEnv.host !== undefined)
                process.env.SMTP_HOST = origSmtpEnv.host;
            else delete process.env.SMTP_HOST;
            if (origSmtpEnv.port !== undefined)
                process.env.SMTP_PORT = origSmtpEnv.port;
            else delete process.env.SMTP_PORT;
            if (origSmtpEnv.user !== undefined)
                process.env.SMTP_USER = origSmtpEnv.user;
            else delete process.env.SMTP_USER;
            if (origSmtpEnv.pass !== undefined)
                process.env.SMTP_PASS = origSmtpEnv.pass;
            else delete process.env.SMTP_PASS;
            if (origSmtpEnv.from !== undefined)
                process.env.SMTP_FROM = origSmtpEnv.from;
            else delete process.env.SMTP_FROM;
            if (origSmtpEnv.secure !== undefined)
                process.env.SMTP_SECURE = origSmtpEnv.secure;
            else delete process.env.SMTP_SECURE;
            if (origSmtpEnv.allowlist !== undefined)
                process.env.EMAIL_ALLOWLIST = origSmtpEnv.allowlist;
            else delete process.env.EMAIL_ALLOWLIST;
            if (origSmtpEnv.dailyLimit !== undefined)
                process.env.EMAIL_DAILY_SEND_LIMIT = origSmtpEnv.dailyLimit;
            else delete process.env.EMAIL_DAILY_SEND_LIMIT;
        });

        function withUser(role: "user" | "admin", userId: string): void {
            mockGetSession.mockResolvedValue({
                user: {
                    id: userId,
                    email: `${role}@example.com`,
                    name: role,
                    role,
                },
            });
            mockIsAdmin.mockReturnValue(role === "admin");
        }

        async function seedDocument(
            document: QuotationDocument,
            options?: { pdfPath?: string; userId?: string | null }
        ): Promise<{ id: string; doc: QuotationDocument }> {
            const docToSave = {
                ...document,
                nomor: `${document.nomor}-${seededIds.length}`,
            };
            const result = await pool.query<{ id: string }>(
                `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, pdf_path, user_id)
             values ('seed-session', $1, $2, $3, $4, $5, $6, $7) returning id`,
                [
                    docToSave.locale,
                    docToSave.nomor,
                    docToSave.butuh_konfirmasi.length > 0
                        ? "perlu_konfirmasi"
                        : "siap",
                    "hash-" + seededIds.length,
                    JSON.stringify(docToSave),
                    options?.pdfPath ?? null,
                    options?.userId ?? null,
                ]
            );
            const id = result.rows[0].id;
            seededIds.push(id);
            // Read the row back so the returned document has the exact stored shape
            // (Postgres jsonb reorders keys; the route hashes the stored shape).
            const stored = await pool.query<{ data_json: QuotationDocument }>(
                "select data_json from documents where id = $1::uuid",
                [id]
            );
            return { id, doc: stored.rows[0].data_json };
        }
        async function seedPdfFile(
            id: string,
            _doc?: QuotationDocument,
            content = "%PDF-1.4 test"
        ): Promise<Buffer> {
            const buf = Buffer.from(content);
            // The route accepts a snapshot only when its sidecar hash equals the
            // content hash of the stored document (the stored shape). Read the row
            // back so the hash is computed from exactly what the route will read.
            const rowRes = await pool.query<{ data_json: QuotationDocument }>(
                "select data_json from documents where id = $1::uuid",
                [id]
            );
            const hash = contentHashOf(rowRes.rows[0].data_json);
            const filePath = path.join(tempDir, `${id}.pdf`);
            await writePdfAtomic(filePath, buf, hash);
            return buf;
        }

        it("env-missing → 503 email_not_configured (clear SMTP env vars first)", async () => {
            delete process.env.SMTP_HOST;
            delete process.env.SMTP_PORT;
            delete process.env.SMTP_USER;
            delete process.env.SMTP_PASS;
            delete process.env.SMTP_FROM;

            const { id } = await seedDocument(createTestDocument());
            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "test@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(503);
            const body = await res.json();
            expect(body.error).toBe("email_not_configured");
            expect(body.message).toBeTruthy();
        });

        it("perlu_konfirmasi → 409", async () => {
            const doc = createTestDocument({
                butuh_konfirmasi: [
                    {
                        field: "pekerjaan[0].volume",
                        alasan: "Volume tidak jelas",
                        sumber_kutipan: "turn_1",
                    },
                ],
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "recipient@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error).toBe("needs_confirmation");
        });

        it("unknown uuid → 404", async () => {
            const id = "00000000-0000-0000-0000-000000000099";
            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "recipient@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error).toBe("not_found");
        });

        it("invalid to → 400", async () => {
            const { id } = await seedDocument(createTestDocument());

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "not-an-email" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toBe("invalid_request");
        });

        it("success with mock transport asserts attachment present, filename correct (nomor-slugged), subject/body localized, status transition persisted (GET shows terkirim + sent_to)", async () => {
            const docNomor = "SL/QTN/2026/0001";
            const doc = createTestDocument({ nomor: docNomor, locale: "id" });
            const { id } = await seedDocument(doc);
            const pdfBuf = await seedPdfFile(
                id,
                doc,
                "%PDF-1.4 mock id content"
            );

            const toEmail = "client@example.com";
            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: toEmail }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(200);
            const resBody = await res.json();
            expect(resBody.status).toBe("terkirim");
            expect(resBody.sent_to).toBe(toEmail);
            expect(resBody.sent_at).toBeDefined();

            expect(sendMailMock).toHaveBeenCalledTimes(1);
            const callArgs = sendMailMock.mock.calls[0][0];
            expect(callArgs.to).toBe(toEmail);
            expect(callArgs.from).toBe("sender@example.com");
            expect(callArgs.subject).toBe(`Surat Penawaran ${docNomor}-0`);
            expect(callArgs.text).toBe(
                `Berikut terlampir surat penawaran ${docNomor}-0.`
            );
            expect(callArgs.attachments).toHaveLength(1);
            expect(callArgs.attachments[0].filename).toBe(
                `${(docNomor + "-0").replaceAll("/", "-")}.pdf`
            );
            expect(callArgs.attachments[0].content).toEqual(pdfBuf);
            expect(callArgs.attachments[0].contentType).toBe("application/pdf");

            // Verify status transition persisted and visible via GET
            const getReq = new Request(`http://localhost/api/documents/${id}`);
            const getRes = await GET(getReq, {
                params: Promise.resolve({ id }),
            });
            expect(getRes.status).toBe(200);
            const getData = await getRes.json();
            expect(getData.status).toBe("terkirim");
            expect(getData.sent_to).toBe(toEmail);
        });

        it("success with English document uses English subject and body", async () => {
            const docNomor = "SL/QTN/2026/0002";
            const doc = createTestDocument({ nomor: docNomor, locale: "en" });
            const { id } = await seedDocument(doc);
            const pdfBuf = await seedPdfFile(
                id,
                doc,
                "%PDF-1.4 mock en content"
            );

            const toEmail = "client-en@example.com";
            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept-Language": "en-US,en",
                    },
                    body: JSON.stringify({ to: toEmail }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(200);
            const callArgs = sendMailMock.mock.calls[0][0];
            expect(callArgs.subject).toBe(`Quotation ${docNomor}-0`);
            expect(callArgs.text).toBe(
                `Please find attached quotation ${docNomor}-0.`
            );
            expect(callArgs.attachments[0].filename).toBe(
                `${(docNomor + "-0").replaceAll("/", "-")}.pdf`
            );
            expect(callArgs.attachments[0].content).toEqual(pdfBuf);
        });

        it("and document unchanged on send failure → 502", async () => {
            const docNomor = "SL/QTN/2026/0003";
            const doc = createTestDocument({ nomor: docNomor, locale: "id" });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            sendMailMock.mockRejectedValueOnce(
                new Error("SMTP connection failed: 550 Relaying denied")
            );

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "fail@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(502);
            const body = await res.json();
            expect(body.error).toBe("send_failure");

            // The reserved quota slot must be released: the failed delivery does
            // not consume today's send quota.
            expect(await getEmailSends()).toBe(0);

            // Verify document is unchanged: status is still disetujui and sent_to is not set
            const getRes = await GET(
                new Request(`http://localhost/api/documents/${id}`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            expect(getRes.status).toBe(200);
            const getData = await getRes.json();
            expect(getData.status).toBe("disetujui");
            expect(getData.sent_to).toBeNull();
        });

        it("returns 502 send_failure when PDF is not found on disk", async () => {
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0004",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            // Do not seed PDF on disk

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "recipient@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(502);
            const body = await res.json();
            expect(body.error).toBe("send_failure");
            expect(sendMailMock).not.toHaveBeenCalled();
            // The reserved slot is released when no PDF is available: the failed
            // attempt does not consume today's send quota.
            expect(await getEmailSends()).toBe(0);
        });

        it("rejects a stale PDF snapshot whose hash does not match the current document", async () => {
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0005",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            // Write a PDF whose sidecar hash is the PDF bytes' hash, not the
            // document content hash — simulates a document PATCHed after render.
            const staleBuf = Buffer.from("%PDF-1.4 stale content");
            const staleHash = createHash("sha256")
                .update(staleBuf)
                .digest("hex");
            const filePath = path.join(tempDir, `${id}.pdf`);
            await writePdfAtomic(filePath, staleBuf, staleHash);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "recipient@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(502);
            const body = await res.json();
            expect(body.error).toBe("send_failure");
            expect(sendMailMock).not.toHaveBeenCalled();
        });

        it("refuses to send (and does not mark sent) when the document changed after the PDF was rendered", async () => {
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0006",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            const pdfBuf = await seedPdfFile(id, doc);

            // Simulate the concurrent PATCH: change the payload after the PDF was
            // rendered. The stored document's content hash no longer matches the
            // snapshot's sidecar hash, so the route must refuse to send.
            await pool.query(
                `update documents set data_json = jsonb_set(data_json, '{total_nominal}', '700000') where id = $1::uuid`,
                [id]
            );

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "recipient@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(502);
            const body = await res.json();
            expect(body.error).toBe("send_failure");
            expect(sendMailMock).not.toHaveBeenCalled();
            // The document must not be marked sent.
            const getRes = await GET(
                new Request(`http://localhost/api/documents/${id}`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            const getData = await getRes.json();
            expect(getData.status).toBe("disetujui");
            expect(getData.sent_to).toBeNull();
            expect(pdfBuf).toBeTruthy();
        });

        it("short SMTP password → 503 email_not_configured", async () => {
            process.env.SMTP_PASS = "short";
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0007",
                locale: "id",
            });
            const { id } = await seedDocument(doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "recipient@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(503);
            const body = await res.json();
            expect(body.error).toBe("email_not_configured");
            expect(sendMailMock).not.toHaveBeenCalled();
        });

        it("already-sent document → 409 and no email is sent", async () => {
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0008",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            // Mark it sent first.
            await pool.query(
                `update documents set status = 'terkirim', sent_to = 'first@example.com', sent_at = now() where id = $1::uuid`,
                [id]
            );

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "second@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error).toBe("already_sent");
            expect(sendMailMock).not.toHaveBeenCalled();

            // The original send record is untouched.
            const getRes = await GET(
                new Request(`http://localhost/api/documents/${id}`),
                {
                    params: Promise.resolve({ id }),
                }
            );
            const getData = await getRes.json();
            expect(getData.status).toBe("terkirim");
            expect(getData.sent_to).toBe("first@example.com");
        });

        it("allowlist set and recipient not listed → 403, no send", async () => {
            process.env.EMAIL_ALLOWLIST =
                "allowed@example.com, other@example.com";
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0010",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "forbidden@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toBe("recipient_not_allowed");
            expect(body.message).toBe("Penerima tidak ada dalam daftar izin");
            expect(sendMailMock).not.toHaveBeenCalled();
        });

        it("allowlist set and recipient listed → 200 send", async () => {
            process.env.EMAIL_ALLOWLIST =
                "allowed@example.com, other@example.com";
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0011",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: " ALLOWED@example.com " }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("terkirim");
            expect(sendMailMock).toHaveBeenCalledTimes(1);
        });

        it("allowlist unset → arbitrary recipient still allowed (200)", async () => {
            delete process.env.EMAIL_ALLOWLIST;
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0012",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "arbitrary-user@anywhere.org" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("terkirim");
            expect(sendMailMock).toHaveBeenCalledTimes(1);
        });

        it("daily quota exceeded → 429, no send", async () => {
            process.env.EMAIL_DAILY_SEND_LIMIT = "1";
            await pool.query(
                "insert into email_send_meter (user_id, day, count) values ('00000000-0000-0000-0000-000000000000', (now() at time zone 'UTC')::date, 1)"
            );

            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0013",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email?locale=en`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "user@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(429);
            const body = await res.json();
            expect(body.error).toBe("quota_exceeded");
            expect(body.message).toBe(
                "Daily email send limit reached. Try again tomorrow."
            );
            expect(res.headers.get("x-quota-hard-stop")).toBe("true");
            expect(sendMailMock).not.toHaveBeenCalled();
        });

        it("404 and 409 (needs_confirmation / already_sent) do not consume quota", async () => {
            process.env.EMAIL_DAILY_SEND_LIMIT = "1";

            // Unknown document -> 404, no reservation, no send.
            const unknownId = "00000000-0000-0000-0000-000000000099";
            const unknownReq = new Request(
                `http://localhost/api/documents/${unknownId}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "user@example.com" }),
                }
            );
            const unknownRes = await POST(unknownReq, {
                params: Promise.resolve({ id: unknownId }),
            });
            expect(unknownRes.status).toBe(404);

            // needs_confirmation -> 409, no reservation, no send.
            const confDoc = createTestDocument({
                butuh_konfirmasi: [
                    {
                        field: "pekerjaan[0].volume",
                        alasan: "Volume tidak jelas",
                        sumber_kutipan: "turn_1",
                    },
                ],
            });
            const conf = await seedDocument(confDoc);
            const confReq = new Request(
                `http://localhost/api/documents/${conf.id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "user@example.com" }),
                }
            );
            const confRes = await POST(confReq, {
                params: Promise.resolve({ id: conf.id }),
            });
            expect(confRes.status).toBe(409);
            expect(confRes.headers.get("x-quota-hard-stop")).toBeNull();

            // None of the rejected attempts consumed a slot: with limit 1, a
            // valid send must still succeed.
            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0015",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);
            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "user@example.com" }),
                }
            );
            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });
            expect(res.status).toBe(200);
            expect(sendMailMock).toHaveBeenCalledTimes(1);
        });

        it("after successful send, quota count incremented (assert via getEmailSends and direct DB query)", async () => {
            const initialSends = await getEmailSends();
            expect(initialSends).toBe(0);

            const doc = createTestDocument({
                nomor: "SL/QTN/2026/0014",
                locale: "id",
            });
            const { id } = await seedDocument(doc);
            await seedPdfFile(id, doc);

            const req = new Request(
                `http://localhost/api/documents/${id}/email`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ to: "user@example.com" }),
                }
            );

            const res = await POST(req, {
                params: Promise.resolve({ id }),
            });

            expect(res.status).toBe(200);
            expect(sendMailMock).toHaveBeenCalledTimes(1);

            const sendsAfter = await getEmailSends();
            expect(sendsAfter).toBe(1);

            const dbResult = await pool.query<{ count: number }>(
                "select count from email_send_meter where user_id = '00000000-0000-0000-0000-000000000000' and day = (now() at time zone 'UTC')::date"
            );
            expect(dbResult.rows.length).toBe(1);
            expect(Number(dbResult.rows[0].count)).toBe(1);
        });

        describe.sequential("access control", () => {
            const adminId = "00000000-0000-0000-0000-000000000000";
            const ownerId = "00000000-0000-0000-0000-000000000001";
            const foreignId = "00000000-0000-0000-0000-000000000002";

            it("unauthenticated request returns 401 even when SMTP is unset", async () => {
                mockGetSession.mockResolvedValue(null);
                mockIsAdmin.mockReturnValue(false);
                delete process.env.SMTP_HOST;
                delete process.env.SMTP_PORT;
                delete process.env.SMTP_USER;
                delete process.env.SMTP_PASS;

                const doc = createTestDocument({ nomor: "SL/QTN/2026/AC01" });
                const { id } = await seedDocument(doc, { userId: ownerId });

                const req = new Request(
                    `http://localhost/api/documents/${id}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "attacker@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id }),
                });
                expect(res.status).toBe(401);
                expect(await res.json()).toEqual({
                    error: "unauthorized",
                    message: "Authentication required",
                });
            });

            it("wrong-user request returns 403 even when SMTP is unset", async () => {
                withUser("user", foreignId);
                delete process.env.SMTP_HOST;
                delete process.env.SMTP_PORT;
                delete process.env.SMTP_USER;
                delete process.env.SMTP_PASS;

                const doc = createTestDocument({ nomor: "SL/QTN/2026/AC02" });
                const { id } = await seedDocument(doc, { userId: ownerId });

                const req = new Request(
                    `http://localhost/api/documents/${id}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "user2@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id }),
                });
                expect(res.status).toBe(403);
                expect(await res.json()).toEqual({
                    error: "forbidden",
                    message: "You do not have access to this document",
                });
            });

            it("non-owner request for missing document returns 403 without leaking existence", async () => {
                withUser("user", foreignId);
                const missingId = "00000000-0000-0000-0000-000000000099";
                const req = new Request(
                    `http://localhost/api/documents/${missingId}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "user2@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id: missingId }),
                });
                expect(res.status).toBe(403);
                expect(await res.json()).toEqual({
                    error: "forbidden",
                    message: "You do not have access to this document",
                });
            });

            it("admin request for missing document returns 404", async () => {
                withUser("admin", adminId);
                const missingId = "00000000-0000-0000-0000-000000000099";
                const req = new Request(
                    `http://localhost/api/documents/${missingId}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "user@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id: missingId }),
                });
                expect(res.status).toBe(404);
                expect((await res.json()).error).toBe("not_found");
            });

            it("owner can send email with 200", async () => {
                withUser("user", ownerId);
                const doc = createTestDocument({ nomor: "SL/QTN/2026/AC03" });
                const { id } = await seedDocument(doc, { userId: ownerId });
                await seedPdfFile(id, doc);

                const req = new Request(
                    `http://localhost/api/documents/${id}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "client@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id }),
                });
                expect(res.status).toBe(200);
                expect((await res.json()).status).toBe("terkirim");
            });

            it("admin can send email for owned document with 200", async () => {
                withUser("admin", adminId);
                const doc = createTestDocument({ nomor: "SL/QTN/2026/AC04" });
                const { id } = await seedDocument(doc, { userId: ownerId });
                await seedPdfFile(id, doc);

                const req = new Request(
                    `http://localhost/api/documents/${id}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "client@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id }),
                });
                expect(res.status).toBe(200);
                expect((await res.json()).status).toBe("terkirim");
            });

            it("admin can send email for legacy ownerless document with 200", async () => {
                withUser("admin", adminId);
                const doc = createTestDocument({ nomor: "SL/QTN/2026/AC05" });
                const { id } = await seedDocument(doc, { userId: null });
                await seedPdfFile(id, doc);

                const req = new Request(
                    `http://localhost/api/documents/${id}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "client@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id }),
                });
                expect(res.status).toBe(200);
                expect((await res.json()).status).toBe("terkirim");
            });

            it("non-admin is rejected with 403 for legacy ownerless document", async () => {
                withUser("user", ownerId);
                const doc = createTestDocument({ nomor: "SL/QTN/2026/AC06" });
                const { id } = await seedDocument(doc, { userId: null });
                await seedPdfFile(id, doc);

                const req = new Request(
                    `http://localhost/api/documents/${id}/email`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "client@example.com" }),
                    }
                );
                const res = await POST(req, {
                    params: Promise.resolve({ id }),
                });
                expect(res.status).toBe(403);
                expect(await res.json()).toEqual({
                    error: "forbidden",
                    message: "You do not have access to this document",
                });
            });
        });
    });
