import type { CandidateDocument, QuotationDocument, Turn } from "./types";
import { extractNumbersWithContext } from "./words";

export function validPaymentTerms(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        Array.from(value.trim()).length <= 500 &&
        !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.trim())
    );
}
export function validValidity(value: unknown): boolean {
    return (
        (typeof value === "number" ||
            (typeof value === "string" && /^\d+$/.test(value.trim()))) &&
        Number.isInteger(Number(value)) &&
        Number(value) >= 1 &&
        Number(value) <= 365
    );
}

export function applyTermProposals(
    document: QuotationDocument,
    candidate: CandidateDocument,
    turns: Turn[]
): void {
    const normalize = (s: string) =>
        s.trim().replace(/\s+/g, " ").toLowerCase();
    const containsPhrase = (text: string, phrase: string) => {
        const source = normalize(text);
        const needle = normalize(phrase);
        let start = source.indexOf(needle);
        while (start !== -1) {
            const end = start + needle.length;
            if (
                !/[\p{L}\p{N}_]/u.test(source[start - 1] ?? "") &&
                !/[\p{L}\p{N}_]/u.test(source[end] ?? "")
            )
                return true;
            start = source.indexOf(needle, start + 1);
        }
        return false;
    };
    for (const field of ["syarat_pembayaran", "masa_berlaku_hari"] as const) {
        const raw = candidate[field];
        if (!raw || typeof raw !== "object") continue;
        const proposal = raw as Record<string, unknown>;
        const source =
            typeof proposal.sumber_kutipan === "string"
                ? proposal.sumber_kutipan.trim()
                : "";
        const turn = turns.find(
            (t) => t.final === true && t.turn_id === source
        );
        if (!turn || !/^turn_[1-9]\d*$/.test(source)) continue;
        const value = proposal.nilai;
        if (field === "syarat_pembayaran") {
            if (
                !validPaymentTerms(value) ||
                !containsPhrase(turn.transcript, value) ||
                !/\b(dp|uang muka|bayar|pembayaran|pelunasan|payment|deposit|installment|jatuh tempo|termin|net\s+\d+|due|tunai|cash)\b/i.test(
                    value
                )
            )
                continue;
            document.syarat_pembayaran = value.trim();
        } else {
            if (
                !validValidity(value) ||
                !/\b(berlaku|validity|valid|expires?)\b/i.test(turn.transcript)
            )
                continue;
            if (
                !extractNumbersWithContext(
                    turn.transcript,
                    document.locale
                ).some(
                    (n) =>
                        n.value === Number(value) &&
                        /(?:berlaku|validity|valid|expires?)(?:\s+(?:selama|for|in|is))?\s*$/i.test(
                            n.wordsBefore.join(" ")
                        ) &&
                        /^(hari|days?)\b/i.test(n.wordsAfter.join(" "))
                )
            )
                continue;
            document.masa_berlaku_hari = Number(value);
        }
        document.butuh_konfirmasi.push({
            field,
            alasan: "Usulan dari ucapan perlu dikonfirmasi",
            sumber_kutipan: source,
            kind: "source",
        });
    }
}
