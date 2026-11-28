"use client";

import React from "react";
const CANONICAL_UNITS = [
    "m2",
    "m3",
    "meter",
    "sq_ft",
    "lin_ft",
    "sak",
    "batang",
    "titik",
    "bag",
    "sheet",
    "bar",
    "point",
    "hour",
    "unit",
    "hari",
    "fixture",
] as const;
import type { DraftSnapshot } from "./draftClient";

type Props = {
    locale: string;
    snapshot: DraftSnapshot;
    mutate: (operation: Record<string, unknown>) => Promise<boolean>;
    busy: boolean;
};

export function DraftEditor({ locale, snapshot, mutate, busy }: Props) {
    const id = locale === "id";
    const doc = snapshot.document;
    const input =
        "min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-2";
    const button =
        "min-h-[44px] rounded-lg border border-input px-3 py-2 text-sm font-semibold disabled:opacity-50";
    return (
        <section
            aria-label={id ? "Editor draf" : "Draft editor"}
            data-testid="draft-editor"
            className="space-y-4 rounded-xl border border-border p-4"
        >
            <h3 className="font-bold">
                {id ? "Edit draf" : "Edit draft"} · {id ? "Revisi" : "Revision"}{" "}
                {snapshot.draft_revision}
            </h3>
            {typeof doc.total_nominal === "number" && (
                <p className="text-sm font-semibold">
                    {id ? "Total draf" : "Draft total"}:{" "}
                    {new Intl.NumberFormat(id ? "id-ID" : "en-US", {
                        style: "currency",
                        currency: doc.mata_uang ?? (id ? "IDR" : "USD"),
                    }).format(doc.total_nominal)}
                </p>
            )}
            {(doc.pekerjaan ?? []).map((line, index) => (
                <form
                    key={`${line.id}-${snapshot.draft_revision}`}
                    className="space-y-2 rounded-lg border border-border p-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const values = new FormData(event.currentTarget);
                        const price = String(values.get("price") ?? "").trim();
                        if (line.id)
                            void mutate({
                                op: "update_line",
                                item_id: line.id,
                                changes: {
                                    uraian: String(values.get("description")),
                                    volume: String(values.get("quantity")),
                                    satuan: String(values.get("unit")),
                                    harga_satuan: price === "" ? null : price,
                                },
                            });
                    }}
                >
                    <fieldset disabled={busy || !line.id} className="space-y-2">
                        <label className="block text-sm">
                            {id ? "Uraian" : "Description"}
                            <input
                                required
                                name="description"
                                defaultValue={line.uraian}
                                className={input}
                            />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-sm">
                                {id ? "Volume" : "Quantity"}
                                <input
                                    required
                                    name="quantity"
                                    type="number"
                                    min=".001"
                                    max="1000000"
                                    step=".001"
                                    defaultValue={line.volume}
                                    className={input}
                                />
                            </label>
                            <label className="text-sm">
                                {id ? "Satuan" : "Unit"}
                                <select
                                    name="unit"
                                    defaultValue={line.satuan}
                                    className={input}
                                >
                                    {CANONICAL_UNITS.map((unit) => (
                                        <option key={unit}>{unit}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="col-span-2 text-sm">
                                {id ? "Harga satuan" : "Unit price"} (
                                {doc.mata_uang})
                                <input
                                    name="price"
                                    type="number"
                                    min="0"
                                    step={doc.mata_uang === "USD" ? ".01" : "1"}
                                    defaultValue={
                                        line.harga_satuan_minor === null ||
                                        (line.harga_satuan_minor ===
                                            undefined &&
                                            line.harga_satuan === 0 &&
                                            doc.butuh_konfirmasi?.some(
                                                (c) =>
                                                    c.field ===
                                                    `pekerjaan[${index}].harga_satuan`
                                            ))
                                            ? ""
                                            : line.harga_satuan
                                    }
                                    className={input}
                                />
                            </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="submit" className={button}>
                                {id ? "Simpan item" : "Save item"}
                            </button>
                            <button
                                type="button"
                                className={button}
                                disabled={busy || index === 0}
                                onClick={() =>
                                    void mutate({
                                        op: "move_line",
                                        item_id: line.id,
                                        toIndex: index - 1,
                                    })
                                }
                            >
                                {id ? "Naik" : "Move up"}
                            </button>
                            <button
                                type="button"
                                className={button}
                                disabled={
                                    busy || index === doc.pekerjaan.length - 1
                                }
                                onClick={() =>
                                    void mutate({
                                        op: "move_line",
                                        item_id: line.id,
                                        toIndex: index + 1,
                                    })
                                }
                            >
                                {id ? "Turun" : "Move down"}
                            </button>
                            <button
                                type="button"
                                className={button}
                                onClick={() =>
                                    void mutate({
                                        op: "remove_line",
                                        item_id: line.id,
                                    })
                                }
                            >
                                {id ? "Hapus item" : "Remove item"}
                            </button>
                        </div>
                    </fieldset>
                </form>
            ))}
            <button
                className={button}
                disabled={busy}
                onClick={() =>
                    void mutate({
                        op: "add_line",
                        item: {
                            uraian: id ? "Pekerjaan baru" : "New item",
                            volume: 1,
                            satuan: "unit",
                            harga_satuan: null,
                        },
                    })
                }
            >
                {id ? "Tambah item" : "Add item"}
            </button>
            <form
                key={`payment-${snapshot.draft_revision}`}
                onSubmit={(event) => {
                    event.preventDefault();
                    const value = String(
                        new FormData(event.currentTarget).get("terms") ?? ""
                    ).trim();
                    void mutate({
                        field: "syarat_pembayaran",
                        nilai: value || null,
                    });
                }}
                className="space-y-2"
            >
                <label className="block text-sm">
                    {id
                        ? "Syarat pembayaran (opsional)"
                        : "Payment terms (optional)"}
                    <textarea
                        name="terms"
                        maxLength={500}
                        defaultValue={doc.syarat_pembayaran ?? ""}
                        className={input}
                    />
                </label>
                <button disabled={busy} className={button}>
                    {id ? "Simpan syarat" : "Save terms"}
                </button>
            </form>
            <form
                key={`validity-${snapshot.draft_revision}`}
                onSubmit={(event) => {
                    event.preventDefault();
                    const value = String(
                        new FormData(event.currentTarget).get("validity") ?? ""
                    ).trim();
                    void mutate({
                        field: "masa_berlaku_hari",
                        nilai: value === "" ? null : Number(value),
                    });
                }}
                className="space-y-2"
            >
                <label className="block text-sm">
                    {id
                        ? "Masa berlaku (hari, opsional)"
                        : "Validity (days, optional)"}
                    <input
                        name="validity"
                        type="number"
                        min="1"
                        max="365"
                        step="1"
                        defaultValue={doc.masa_berlaku_hari ?? ""}
                        className={input}
                    />
                </label>
                <button disabled={busy} className={button}>
                    {id ? "Simpan masa berlaku" : "Save validity"}
                </button>
            </form>
        </section>
    );
}
