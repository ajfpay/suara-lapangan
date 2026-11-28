"use client";

import React, { useState } from "react";
import { Volume2 } from "lucide-react";

import {
    citationOptions,
    fieldLabel,
    isCitationField,
    isNumericField,
    parseOptions,
} from "./konfirmasi";

export interface KonfirmasiItem {
    field: string;
    alasan: string;
    sumber_kutipan: string | null;
    kind?: "derived" | "source";
}

interface Props {
    item: KonfirmasiItem;
    locale: string;
    onPlayEvidence: (turnId: string) => void;
    mutate: (operation: Record<string, unknown>) => Promise<boolean>;
    busy?: boolean;
}

export function KonfirmasiCard({
    item,
    locale,
    onPlayEvidence,
    mutate,
    busy,
}: Props) {
    const isIndo = locale === "id";
    const isCitation = isCitationField(item.field);
    const options = isCitation
        ? citationOptions(item.sumber_kutipan)
        : parseOptions(item.alasan);
    const numeric = isNumericField(item.field);
    const [manual, setManual] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const derived =
        item.field === "total_nominal" || /\.jumlah$/.test(item.field);
    async function patch(nilai: string | number) {
        setSaving(true);
        setError(null);
        try {
            const operation = derived
                ? {
                      op:
                          item.kind === "derived"
                              ? "confirm_derived"
                              : "confirm_source",
                      field: item.field,
                  }
                : { field: item.field, nilai };
            await mutate(operation);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40"
            data-testid={`konfirmasi-${item.field}`}
        >
            <p className="font-bold text-amber-950 dark:text-amber-100">
                {fieldLabel(item.field, locale)}
            </p>
            <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
                {item.alasan}
            </p>
            {item.sumber_kutipan && (
                <button
                    type="button"
                    onClick={() => onPlayEvidence(item.sumber_kutipan!)}
                    className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"
                    aria-label={
                        isIndo ? "Dengar bukti suara" : "Play audio evidence"
                    }
                >
                    <Volume2 className="h-4 w-4" />
                    {isIndo ? "Dengar bukti" : "Play evidence"}
                </button>
            )}
            {item.field === "pekerjaan" && (
                <p>
                    {isIndo
                        ? "Tambah item melalui editor draf."
                        : "Add an item in the draft editor."}
                </p>
            )}
            {item.field !== "pekerjaan" && !derived && options.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {options.map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            disabled={saving || busy}
                            onClick={() => patch(opt)}
                            className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[44px] rounded-xl border border-amber-500 bg-white px-4 py-2 font-bold text-amber-950 disabled:opacity-50"
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
            {item.field === "pekerjaan" ? null : derived ? (
                <button
                    type="button"
                    disabled={saving || busy}
                    onClick={() => patch(0)}
                    className="mt-3 min-h-[44px] rounded-xl border border-input px-4 font-bold"
                >
                    {isIndo
                        ? item.kind === "derived"
                            ? "Konfirmasi hitungan server"
                            : "Setujui hitungan server setelah meninjau bukti suara"
                        : item.kind === "derived"
                          ? "Confirm calculated amount"
                          : "Accept calculated amount after reviewing audio evidence"}
                </button>
            ) : (
                <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const v = manual.trim();
                        if (!v) return;
                        patch(v);
                    }}
                >
                    <input
                        type={numeric ? "number" : "text"}
                        step={numeric ? "any" : undefined}
                        value={manual}
                        onChange={(e) => setManual(e.target.value)}
                        placeholder={
                            isIndo ? "Ketik koreksi…" : "Type correction…"
                        }
                        aria-label={
                            isIndo ? "Koreksi manual" : "Manual correction"
                        }
                        className="min-h-[44px] flex-1 rounded-xl border border-input bg-background px-3 text-foreground"
                    />
                    <button
                        type="submit"
                        disabled={saving || busy || !manual.trim()}
                        className="transition-transform duration-150 ease-out active:[transform:scale(0.97)] min-h-[44px] rounded-xl bg-secondary px-4 font-bold text-secondary-foreground disabled:opacity-50"
                    >
                        {isIndo ? "Simpan" : "Save"}
                    </button>
                </form>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
                {isIndo
                    ? "Rekam ulang satu kalimat: kembali ke Rekam, ucapkan ulang kalimat ini saja."
                    : "Re-record one sentence: go back to Record and re-speak just this sentence."}
            </p>
            {error && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
