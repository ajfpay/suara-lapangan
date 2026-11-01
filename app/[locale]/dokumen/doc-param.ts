export function docIdFrom(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return docIdFrom(value[0]);
    }
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
