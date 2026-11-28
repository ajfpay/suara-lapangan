import { randomUUID } from "node:crypto";
import type { FieldChange } from "@/lib/server/db/documentStore";
import type { PatchDocumentBody } from "@/lib/server/validation/document";
import type { PekerjaanItem, Proyek, QuotationDocument } from "./types";
import {
    DraftInputError,
    draftPrice,
    lineMoney,
    quantityMillis,
    priceMinor,
    recalculateDraft,
} from "./draftMoney";
import { resolveDerivedConfirmations } from "./draftConfirmations";

const indexPath = /^pekerjaan\[(\d+)\]\.(.+)$/;
const itemPath = (index: number, field: string) =>
    `pekerjaan[${index}].${field}`;

export function applyDraftMutation(
    document: QuotationDocument,
    previous: FieldChange[],
    patch: PatchDocumentBody,
    actorId: string,
    validCitation: (citation: string) => boolean
): {
    document: QuotationDocument;
    fieldChanges: FieldChange[];
    status: "draf";
} {
    const changes = previous.map((c) => {
        const match = indexPath.exec(c.field);
        return match && !c.item_id
            ? { ...c, item_id: document.pekerjaan[Number(match[1])]?.id }
            : { ...c };
    });
    const timestamp = new Date().toISOString();
    const sourceOf = (line: PekerjaanItem) =>
        changes.find(
            (c) =>
                c.item_id === line.id && c.original_source?.startsWith("turn_")
        )?.original_source ??
        changes.find(
            (c) => c.item_id === line.id && c.source_before?.startsWith("turn_")
        )?.source_before ??
        (line.sumber_kutipan.startsWith("turn_") ? line.sumber_kutipan : null);
    function record(
        field: string,
        original: unknown,
        current: unknown,
        line?: PekerjaanItem,
        after?: string,
        kind: FieldChange["kind"] = "edit"
    ) {
        changes.push({
            field,
            original,
            current,
            changed_by: actorId,
            changed_at: timestamp,
            kind,
            ...(line
                ? {
                      item_id: line.id,
                      original_source: sourceOf(line),
                      source_before: line.sumber_kutipan,
                      source_after: after ?? line.sumber_kutipan,
                  }
                : {}),
        });
    }
    function clear(field: string) {
        document.butuh_konfirmasi = document.butuh_konfirmasi.filter(
            (c) => c.field !== field
        );
    }
    function index(id?: string, legacy?: number): number {
        const i = id
            ? document.pekerjaan.findIndex((item) => item.id === id)
            : (legacy ?? -1);
        if (!Number.isInteger(i) || i < 0 || i >= document.pekerjaan.length)
            throw new DraftInputError("Item not found");
        return i;
    }
    function editLine(i: number, edits: Record<string, unknown>, explicitConfirmation = false) {
        const line = document.pekerjaan[i];
        const citation =
            typeof edits.sumber_kutipan === "string"
                ? edits.sumber_kutipan
                : line.sumber_kutipan;
        if (
            edits.sumber_kutipan !== undefined &&
            citation !== "manual" &&
            !validCitation(citation)
        )
            throw new DraftInputError(
                "Citation must reference a final turn of this session"
            );
        const oldPrice = draftPrice(document, i);
        const price = "harga_satuan" in edits ? edits.harga_satuan : oldPrice;
        const quantity = "volume" in edits ? edits.volume : line.volume;
        const nextMoney = lineMoney(quantity, price, document.mata_uang);
        for (const [field, value] of Object.entries(edits)) {
            const current =
                field === "harga_satuan"
                    ? price === null
                        ? null
                        : nextMoney.harga_satuan
                    : field === "volume"
                      ? nextMoney.volume
                      : value;
            const original =
                field === "harga_satuan"
                    ? oldPrice
                    : line[field as keyof PekerjaanItem];
            if (
                original !== current &&
                (sourceOf(line) ||
                    citation.startsWith("turn_") ||
                    field === "sumber_kutipan")
            ) {
                record(
                    itemPath(i, field),
                    original,
                    current,
                    line,
                    citation,
                    field === "sumber_kutipan" ? "source" : "edit"
                );
            }
            const path = itemPath(i, field);
            if (explicitConfirmation && original === current && document.butuh_konfirmasi.some(c => c.field === path)) {
                record(path, original, current, line, citation, "confirmation");
            }
            if (original !== current || explicitConfirmation) clear(path);
        }
        Object.assign(line, edits, nextMoney, { sumber_kutipan: citation });
    }
    // Only the positional compatibility field moves; identity and audit events remain.
    function remap(oldIds: (string | undefined)[]) {
        const currentIndex = new Map(
            document.pekerjaan.map((item, i) => [item.id, i])
        );
        document.butuh_konfirmasi = document.butuh_konfirmasi.flatMap((c) => {
            const match = indexPath.exec(c.field);
            if (!match) return [c];
            const next = currentIndex.get(oldIds[Number(match[1])]);
            return next === undefined
                ? []
                : [{ ...c, field: itemPath(next, match[2]) }];
        });
        for (const change of changes) {
            const match = indexPath.exec(change.field);
            if (!match || !change.item_id) continue;
            const next = currentIndex.get(change.item_id);
            change.field =
                next === undefined
                    ? `pekerjaan[${change.item_id}].${match[2]}`
                    : itemPath(next, match[2]);
        }
    }

    // Existing drafts predate minor units. Keep original evidence; never guess a billable price.
    document.pekerjaan.forEach((line, i) => {
        if (line.harga_satuan_minor !== undefined) return;
        const mark = (field: string, original: unknown, current: unknown) => {
            const path = itemPath(i, field);
            record(path, original, current, line, undefined, "edit");
            clear(path);
            document.butuh_konfirmasi.push({field:path, alasan:`Nilai lama (${original}) perlu dikonfirmasi ulang`, sumber_kutipan:line.sumber_kutipan || null, kind:"source"});
        };
        try { quantityMillis(line.volume); }
        catch (error) {
            if (!(error instanceof DraftInputError)) throw error;
            const original = line.volume;
            const rounded = Math.round(Number(original) * 1000) / 1000;
            line.volume = Number.isFinite(rounded) && rounded >= .001 && rounded <= 1000000 ? rounded : 1;
            mark("volume", original, line.volume);
        }
        const price = draftPrice(document, i);
        if (price !== null) {
            try { priceMinor(price, document.mata_uang); lineMoney(line.volume, price, document.mata_uang); }
            catch (error) {
                if (!(error instanceof DraftInputError)) throw error;
                mark("harga_satuan", price, null);
                Object.assign(line, lineMoney(line.volume, null, document.mata_uang));
            }
        }
    });
    if ("op" in patch) {
        switch (patch.op) {
            case "add_line":
                document.pekerjaan.push({
                    id: randomUUID(),
                    uraian: patch.item.uraian,
                    satuan: patch.item.satuan,
                    ...lineMoney(
                        patch.item.volume,
                        patch.item.harga_satuan,
                        document.mata_uang
                    ),
                    sumber_kutipan: "manual",
                });
                break;
            case "remove_line": {
                const i = index(patch.item_id, patch.index);
                const oldIds = document.pekerjaan.map((p) => p.id);
                const line = document.pekerjaan[i];
                if (sourceOf(line))
                    record(
                        itemPath(i, "item"),
                        { ...line },
                        null,
                        line,
                        undefined,
                        "remove"
                    );
                document.pekerjaan.splice(i, 1);
                remap(oldIds);
                break;
            }
            case "move_line": {
                const i = index(patch.item_id, patch.fromIndex);
                const target = index(undefined, patch.toIndex);
                const oldIds = document.pekerjaan.map((p) => p.id);
                const [line] = document.pekerjaan.splice(i, 1);
                document.pekerjaan.splice(target, 0, line);
                if (i !== target && sourceOf(line))
                    record(
                        itemPath(i, "position"),
                        i,
                        target,
                        line,
                        undefined,
                        "move"
                    );
                remap(oldIds);
                break;
            }
            case "update_line":
                editLine(index(patch.item_id), patch.changes);
                break;
            case "confirm_derived":
            case "confirm_source": {
                const pending = document.butuh_konfirmasi.find(
                    (c) => c.field === patch.field
                );
                if (!pending || (patch.op === "confirm_derived" ? pending.kind !== "derived" : pending.kind === "derived"))
                    throw new DraftInputError(
                        "No pending calculation confirmation"
                    );
                const match = indexPath.exec(patch.field);
                const line = match
                    ? document.pekerjaan[index(undefined, Number(match[1]))]
                    : undefined;

                if (
                    (line &&
                        draftPrice(document, Number(match![1])) === null) ||
                    (!line &&
                        document.pekerjaan.some(
                            (_, i) => draftPrice(document, i) === null
                        ))
                )
                    throw new DraftInputError(
                        "Complete missing prices before confirming the calculation"
                    );
                recalculateDraft(document);
                const value = match ? document.pekerjaan[Number(match[1])].jumlah : document.total_nominal;
                record(
                    patch.field,
                    pending.proposed_value ?? pending.alasan,
                    value,
                    line,
                    undefined,
                    "confirmation"
                );
                if (patch.op === "confirm_source") {
                    const event = changes[changes.length - 1];
                    event.source_before = pending.sumber_kutipan;
                    event.source_after = pending.sumber_kutipan;
                }
                clear(patch.field);
                break;
            }
        }
    } else {
        const { field, nilai } = patch;
        const match = indexPath.exec(field);
        if (match) {
            editLine(index(undefined, Number(match[1])), { [match[2]]: nilai }, true);
        } else if (field.startsWith("proyek.")) {
            const key = field.slice(7) as keyof Proyek;
            document.proyek[key] = String(nilai);
            clear(field);
        } else if (field === "tanggal") {
            document.tanggal = String(nilai);
            clear(field);
        } else if (
            field === "syarat_pembayaran" ||
            field === "masa_berlaku_hari"
        ) {
            const old = document[field] ?? null;
            const pending = document.butuh_konfirmasi.find(
                (c) => c.field === field
            );
            const next =
                nilai === null
                    ? null
                    : field === "syarat_pembayaran"
                      ? String(nilai)
                      : Number(nilai);
            if (old !== next || pending) changes.push({
                field,
                original: old,
                current: next,
                changed_by: actorId,
                changed_at: timestamp,
                kind: old === next ? "confirmation" : "edit",
                source_before: pending?.sumber_kutipan ?? null,
                source_after: "manual",
            });
            if (nilai === null) delete document[field];
            else if (field === "syarat_pembayaran")
                document.syarat_pembayaran = String(nilai);
            else document.masa_berlaku_hari = Number(nilai);
            clear(field);
        }
    }

    recalculateDraft(document);
    if (
        document.pekerjaan.length === 0 &&
        !document.butuh_konfirmasi.some((c) => c.field === "pekerjaan")
    ) {
        document.butuh_konfirmasi.push({
            field: "pekerjaan",
            alasan: "Daftar pekerjaan kosong, minimal harus ada satu pekerjaan",
            sumber_kutipan: null,
        });
    }
    if (document.pekerjaan.length > 0) clear("pekerjaan");
    changes.push(...resolveDerivedConfirmations(document, "server"));
    return { document, fieldChanges: changes, status: "draf" };
}
