export function sanitizeCallbackUrl(raw: string, locale: string): string {
    const fallback = `/${locale}/dokumen/saya`;
    if (
        !raw.startsWith("/") ||
        raw.startsWith("//") ||
        raw.includes("\\")
    ) {
        return fallback;
    }
    return raw;
}
