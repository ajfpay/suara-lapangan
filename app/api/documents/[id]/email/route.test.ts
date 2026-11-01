import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { GET } from "@/app/api/documents/[id]/route";
import { resetRateLimits } from "@/lib/server/quota/rate-limit";
import type { QuotationDocument } from "@/lib/server/guard/types";
import { writePdfAtomic } from "@/lib/server/pdf/storage";

const { sendMailMock } = vi.hoisted(() => ({
    sendMailMock: vi.fn(),
}));

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

describe.skipIf(!TEST_DATABASE_URL)("POST /api/documents/[id]/email route handler", () => {
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
    };

    beforeAll(async () => {
        pool = new Pool({ connectionString: TEST_DATABASE_URL });
        for (const file of [
            "0001_sessions_turns.sql",
            "0002_usage_meter.sql",
            "0003_documents.sql",
        ]) {
            const sql = await fs.readFile(`db/migrations/${file}`, "utf8");
            await pool.query(sql);
        }
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

        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "suara-email-test-"));
        process.env.PDF_STORAGE_DIR = tempDir;

        await pool.query("truncate documents, sessions cascade");
        seededIds = [];
        await pool.query(
            "insert into sessions (id, locale, audio_sha256, audio_bytes, transcript) values ('seed-session', 'id', 'sha', 1, '')"
        );
    });

    afterAll(async () => {
        await pool.end();
        if (origStorageDir !== undefined) {
            process.env.PDF_STORAGE_DIR = origStorageDir;
        } else {
            delete process.env.PDF_STORAGE_DIR;
        }
        if (origSmtpEnv.host !== undefined) process.env.SMTP_HOST = origSmtpEnv.host;
        else delete process.env.SMTP_HOST;
        if (origSmtpEnv.port !== undefined) process.env.SMTP_PORT = origSmtpEnv.port;
        else delete process.env.SMTP_PORT;
        if (origSmtpEnv.user !== undefined) process.env.SMTP_USER = origSmtpEnv.user;
        else delete process.env.SMTP_USER;
        if (origSmtpEnv.pass !== undefined) process.env.SMTP_PASS = origSmtpEnv.pass;
        else delete process.env.SMTP_PASS;
        if (origSmtpEnv.from !== undefined) process.env.SMTP_FROM = origSmtpEnv.from;
        else delete process.env.SMTP_FROM;
        if (origSmtpEnv.secure !== undefined) process.env.SMTP_SECURE = origSmtpEnv.secure;
        else delete process.env.SMTP_SECURE;
    });

    async function seedDocument(
        document: QuotationDocument,
        options?: { pdfPath?: string }
    ): Promise<string> {
        const docToSave = {
            ...document,
            nomor: `${document.nomor}-${seededIds.length}`,
        };
        const result = await pool.query<{ id: string }>(
            `insert into documents (session_id, locale, nomor, status, turns_hash, data_json, pdf_path)
             values ('seed-session', $1, $2, $3, $4, $5, $6) returning id`,
            [
                docToSave.locale,
                docToSave.nomor,
                docToSave.butuh_konfirmasi.length > 0
                    ? "perlu_konfirmasi"
                    : "siap",
                "hash-" + seededIds.length,
                JSON.stringify(docToSave),
                options?.pdfPath ?? null,
            ]
        );
        const id = result.rows[0].id;
        seededIds.push(id);
        return id;
    }
    async function seedPdfFile(id: string, content = "%PDF-1.4 test"): Promise<Buffer> {
        const buf = Buffer.from(content);
        const hash = createHash("sha256").update(buf).digest("hex");
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

        const id = "00000000-0000-0000-0000-000000000001";
        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: "test@example.com" }),
        });

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
        const id = await seedDocument(doc);
        await seedPdfFile(id);

        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: "recipient@example.com" }),
        });

        const res = await POST(req, {
            params: Promise.resolve({ id }),
        });

        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe("needs_confirmation");
    });

    it("unknown uuid → 404", async () => {
        const id = "00000000-0000-0000-0000-000000000099";
        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: "recipient@example.com" }),
        });

        const res = await POST(req, {
            params: Promise.resolve({ id }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("not_found");
    });

    it("invalid to → 400", async () => {
        const id = await seedDocument(createTestDocument());

        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: "not-an-email" }),
        });

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
        const id = await seedDocument(doc);
        const pdfBuf = await seedPdfFile(id, "%PDF-1.4 mock id content");

        const toEmail = "client@example.com";
        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: toEmail }),
        });

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
        expect(callArgs.text).toContain(`${docNomor}-0`);
        expect(callArgs.attachments).toHaveLength(1);
        expect(callArgs.attachments[0].filename).toBe(`${(docNomor + "-0").replaceAll("/", "-")}.pdf`);
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
        const id = await seedDocument(doc);
        const pdfBuf = await seedPdfFile(id, "%PDF-1.4 mock en content");

        const toEmail = "client-en@example.com";
        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept-Language": "en-US,en",
            },
            body: JSON.stringify({ to: toEmail }),
        });

        const res = await POST(req, {
            params: Promise.resolve({ id }),
        });

        expect(res.status).toBe(200);
        const callArgs = sendMailMock.mock.calls[0][0];
        expect(callArgs.subject).toBe(`Quotation ${docNomor}-0`);
        expect(callArgs.text).toContain(`${docNomor}-0`);
        expect(callArgs.attachments[0].filename).toBe(`${(docNomor + "-0").replaceAll("/", "-")}.pdf`);
        expect(callArgs.attachments[0].content).toEqual(pdfBuf);
    });

    it("and document unchanged on send failure → 502", async () => {
        const docNomor = "SL/QTN/2026/0003";
        const doc = createTestDocument({ nomor: docNomor, locale: "id" });
        const id = await seedDocument(doc);
        await seedPdfFile(id);

        sendMailMock.mockRejectedValueOnce(new Error("SMTP connection failed: 550 Relaying denied"));

        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: "fail@example.com" }),
        });

        const res = await POST(req, {
            params: Promise.resolve({ id }),
        });

        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe("send_failure");

        // Verify document is unchanged: status is still siap and sent_to is not set
        const getRes = await GET(new Request(`http://localhost/api/documents/${id}`), {
            params: Promise.resolve({ id }),
        });
        expect(getRes.status).toBe(200);
        const getData = await getRes.json();
        expect(getData.status).toBe("siap");
        expect(getData.sent_to).toBeNull();
    });

    it("returns 502 send_failure when PDF is not found on disk", async () => {
        const doc = createTestDocument({ nomor: "SL/QTN/2026/0004", locale: "id" });
        const id = await seedDocument(doc);
        // Do not seed PDF on disk

        const req = new Request(`http://localhost/api/documents/${id}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: "recipient@example.com" }),
        });

        const res = await POST(req, {
            params: Promise.resolve({ id }),
        });

        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe("send_failure");
        expect(sendMailMock).not.toHaveBeenCalled();
    });
});
