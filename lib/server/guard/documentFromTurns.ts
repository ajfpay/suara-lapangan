import { extractCandidateFromTurns } from "./extractor";
import { applyGuard, type GuardContext } from "./rules";
import type {
    CandidateDocument,
    DocumentResult,
    Locale,
    Proyek,
    Turn,
} from "./types";

export type DocumentFromTurnsOptions = GuardContext & {
    candidate?: CandidateDocument;
};

/**
 * Pure server-side pipeline seam (contracts K2/K3/K4):
 * transforms turns into a structured quotation document and runs the 5 deterministic guard rules.
 *
 * (turns, locale, project, candidateOrOptions?) -> { document, butuh_konfirmasi, status }
 */
export function documentFromTurns(
    turns: Turn[],
    locale: Locale,
    project?: Proyek,
    candidateOrOptions?: CandidateDocument | DocumentFromTurnsOptions
): DocumentResult {
    let candidate: CandidateDocument | undefined;
    let mergedLocale: Locale = locale;
    let mergedProject: Proyek | undefined = project;
    let date: string | undefined;
    let nomor: string | undefined;
    let sessionId: string | undefined;

    if (candidateOrOptions && typeof candidateOrOptions === "object") {
        if ("pekerjaan" in candidateOrOptions) {
            candidate = candidateOrOptions as CandidateDocument;
        } else {
            const opts = candidateOrOptions as DocumentFromTurnsOptions;
            if (opts.candidate !== undefined) {
                candidate = opts.candidate;
            }
            if (opts.locale !== undefined) {
                mergedLocale = opts.locale;
            }
            if (opts.project !== undefined) {
                mergedProject = opts.project;
            }
            if (opts.date !== undefined) {
                date = opts.date;
            }
            if (opts.nomor !== undefined) {
                nomor = opts.nomor;
            }
            if (opts.sessionId !== undefined) {
                sessionId = opts.sessionId;
            }
        }
    }

    const context: GuardContext = {
        locale: mergedLocale,
        project: mergedProject,
        date,
        nomor,
        sessionId,
    };

    if (!candidate) {
        candidate = extractCandidateFromTurns(turns, mergedLocale, mergedProject);
    }

    return applyGuard(candidate, turns, context);
}
