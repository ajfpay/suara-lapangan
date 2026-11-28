import type { QuotationDocument } from "./types";
import type { FieldChange } from "@/lib/server/db/documentStore";

export function resolveDerivedConfirmations(
    document: QuotationDocument,
    actorId: string
): FieldChange[] {
    const pending = document.butuh_konfirmasi;
    const audit: FieldChange[] = [];
    document.butuh_konfirmasi = pending.filter((item) => {
        if (item.kind !== "derived") return true;
        const match = /^pekerjaan\[(\d+)\]\.jumlah$/.exec(item.field);
        const line = match ? document.pekerjaan[Number(match[1])] : undefined;
        const dependencies = pending.some(
            (other) =>
                other !== item &&
                other.kind !== "derived" &&
                (match
                    ? other.field.startsWith(`pekerjaan[${match[1]}].`)
                    : other.field.startsWith("pekerjaan"))
        );
        if (
            dependencies ||
            (line && line.jumlah_minor === null) ||
            (!match &&
                (document.pekerjaan.length === 0 ||
                    document.pekerjaan.some((p) => p.jumlah_minor === null)))
        )
            return true;
        const current = line
            ? line.jumlah
            : item.field === "total_nominal"
              ? document.total_nominal
              : undefined;
        if (current === undefined) return true;
        audit.push({
            field: item.field,
            item_id: line?.id,
            original: item.proposed_value ?? item.alasan,
            current,
            changed_by: actorId,
            changed_at: new Date().toISOString(),
            source_before: item.sumber_kutipan,
            source_after: item.sumber_kutipan,
            kind: "derived_confirmation",
        });
        return false;
    });
    return audit;
}
