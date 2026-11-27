import { createHmac } from "node:crypto";

export function createResetRequestLimiter(secret: string) {
    const entries = new Map<string, { count: number; expiresAt: number }>();
    return (email: string, now = Date.now()): boolean => {
        for (const [key, entry] of entries) {
            if (entry.expiresAt > now) break;
            entries.delete(key);
        }
        const key = createHmac("sha256", secret)
            .update(email.trim().toLowerCase())
            .digest("hex");
        const entry = entries.get(key);
        if (entry && entry.count >= 5) return false;
        if (!entry && entries.size >= 10000) {
            const oldest = entries.keys().next();
            if (!oldest.done) entries.delete(oldest.value);
        }
        entries.set(key, {
            count: (entry?.count ?? 0) + 1,
            expiresAt: entry?.expiresAt ?? now + 15 * 60_000,
        });
        return true;
    };
}
