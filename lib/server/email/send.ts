import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "./config";
import { redactSecrets } from "@/lib/server/asr/log";

export type EmailAttachment = {
    filename: string;
    content: Buffer;
    contentType?: string;
};

export type SendEmailOptions = {
    to: string;
    subject: string;
    text: string;
    attachments: EmailAttachment[];
};

export function createEmailTransport(config: SmtpConfig): Transporter {
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTls,
        // Bounded timeouts so a hung SMTP peer cannot hold the send (and the
        // UI's "Sending…" state) open indefinitely.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
}

export function buildDocumentEmail(
    nomor: string,
    locale: "en" | "id"
): {
    subject: string;
    text: string;
    filename: string;
} {
    const isEn = locale === "en";
    const subject = isEn ? `Quotation ${nomor}` : `Surat Penawaran ${nomor}`;
    const text = isEn
        ? `Please find attached quotation ${nomor}.`
        : `Berikut terlampir surat penawaran ${nomor}.`;
    const filename = `${nomor.replaceAll("/", "-")}.pdf`;

    return {
        subject,
        text,
        filename,
    };
}

export async function sendEmail(
    config: SmtpConfig,
    options: SendEmailOptions
): Promise<void> {
    const transporter = createEmailTransport(config);
    try {
        await transporter.sendMail({
            from: config.from,
            to: options.to,
            subject: options.subject,
            text: options.text,
            attachments: options.attachments,
        });
    } catch (cause) {
        console.error(
            redactSecrets(`[email] delivery failed: ${String(cause)}`)
        );
        throw cause;
    }
}
