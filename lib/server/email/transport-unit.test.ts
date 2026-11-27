import { afterEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { sendEmail } from "./send";

const smtp = {
    kind: "smtp" as const,
    host: "mail.test",
    port: 1025,
    from: "sender@example.test",
};
const mail = {
    to: "recipient@example.test",
    subject: "Fixture",
    text: "Synthetic message",
    attachments: [],
};
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("SMTP delivery boundary", () => {
    it("uses configured development transport and sends the intended message", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const sendMail = vi.fn().mockResolvedValue({});
        const create = vi
            .spyOn(nodemailer, "createTransport")
            .mockReturnValue({ sendMail } as never);
        await sendEmail(smtp, mail);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                host: smtp.host,
                port: 1025,
                secure: false,
            })
        );
        expect(sendMail).toHaveBeenCalledWith({ ...mail, from: smtp.from });
    });
    it("rejects SMTP in production before contacting the transport", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const create = vi.spyOn(nodemailer, "createTransport");
        await expect(sendEmail(smtp, mail)).rejects.toThrow(
            "SMTP is disabled in production"
        );
        expect(create).not.toHaveBeenCalled();
    });
    it("logs safe SMTP diagnostics without exposing a recovery link or password", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const failure = Object.assign(
            new Error(
                "https://example.test/reset#token=private-fixture password=secret-fixture"
            ),
            { code: "ETIMEDOUT" }
        );
        vi.spyOn(nodemailer, "createTransport").mockReturnValue({
            sendMail: vi.fn().mockRejectedValue(failure),
        } as never);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(sendEmail(smtp, mail)).rejects.toBe(failure);
        const output = JSON.stringify(log.mock.calls);
        expect(output).toContain("ETIMEDOUT");
        expect(output).not.toContain("private-fixture");
        expect(output).not.toContain("secret-fixture");
    });
});
