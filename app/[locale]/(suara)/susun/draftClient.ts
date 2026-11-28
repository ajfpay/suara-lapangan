"use client";

import { useRef, useState } from "react";
import type { QuotationDocument } from "@/lib/server/guard/types";

export type DraftSnapshot = {
    document: QuotationDocument & { id: string };
    draft_revision: number;
    status: string;
    butuh_konfirmasi?: QuotationDocument["butuh_konfirmasi"];
};

export function isDraftSnapshot(value: unknown): value is DraftSnapshot {
    if (!value || typeof value !== "object") return false;
    const v = value as Partial<DraftSnapshot>;
    return (
        typeof v.document?.id === "string" &&
        Number.isInteger(v.draft_revision) &&
        Number(v.draft_revision) > 0
    );
}

export function useDraftPatch(
    locale: string,
    snapshot: DraftSnapshot | null,
    onChange: (snapshot: DraftSnapshot) => void
) {
    const inFlight = useRef(false);
    const retry = useRef<{ id: string; body: string; key: string } | null>(
        null
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const id = locale === "id";
    async function mutate(operation: Record<string, unknown>) {
        if (!snapshot || inFlight.current || snapshot.status !== "draf")
            return false;
        const body = JSON.stringify({
            ...operation,
            draft_revision: snapshot.draft_revision,
        });
        const url = `/api/documents/${encodeURIComponent(snapshot.document.id)}`;
        const previous = retry.current;
        const key =
            previous?.id === snapshot.document.id && previous.body === body
                ? previous.key
                : crypto.randomUUID();
        retry.current = { id: snapshot.document.id, body, key };
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(url, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": key,
                },
                body,
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status < 500) retry.current = null;
                if (res.status === 409 && data.error === "stale_revision") {
                    const latest = await fetch(url, { cache: "no-store" });
                    if (latest.ok) {
                        const fresh = await latest.json();
                        if (isDraftSnapshot(fresh)) onChange(fresh);
                    }
                    throw new Error(
                        id
                            ? "Draf sudah berubah. Tinjau revisi terbaru sebelum menyimpan kembali."
                            : "The draft changed. Review the latest revision before saving again."
                    );
                }
                throw new Error(
                    data.message ||
                        (id ? "Gagal menyimpan draf" : "Failed to save draft")
                );
            }
            if (!isDraftSnapshot(data))
                throw new Error(
                    id ? "Respons draf tidak valid" : "Invalid draft response"
                );
            retry.current = null;
            onChange(data);
            return true;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            return false;
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }
    return { mutate, busy, error };
}
