export type SmtpConfig = {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    secure: boolean;
};

export function getSmtpConfig(): SmtpConfig | null {
    const host = process.env.SMTP_HOST?.trim();
    const portRaw = process.env.SMTP_PORT?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM?.trim();

    if (!host || !portRaw || !user || !pass || !from) {
        return null;
    }

    if (pass.trim() === "") {
        return null;
    }

    const port = parseInt(portRaw, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
        return null;
    }

    const secure =
        process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1";

    return {
        host,
        port,
        user,
        pass,
        from,
        secure,
    };
}
