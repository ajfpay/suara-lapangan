import { z } from "zod";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const documentIdSchema = z
    .string()
    .uuid("id must be a UUID");

const localeSchema = z.enum(["en", "id"]);

const projectSchema = z.object({
    nama: z.string().trim().min(1),
    lokasi: z.string().trim().min(1),
    klien: z.string().trim().min(1),
});

const turnSchema = z.object({
    turn_id: z.string().min(1),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().nonnegative(),
    transcript: z.string(),
    final: z.boolean().optional(),
});

export const postDocumentBodySchema = z.object({
    sessionId: z
        .string()
        .regex(
            SESSION_ID_PATTERN,
            "sessionId must match ^[A-Za-z0-9_-]{1,64}$"
        ),
    locale: localeSchema.optional(),
    project: projectSchema.optional(),
    turns: z.array(turnSchema).min(1).optional(),
});

export const patchDocumentBodySchema = z
    .object({
        field: z
            .string()
            .regex(
                /^pekerjaan\[(\d+)\]\.(volume|harga_satuan|satuan|uraian)$/,
                "field must match pekerjaan[<i>].<volume|harga_satuan|satuan|uraian>"
            ),
        nilai: z.union([z.number(), z.string()]),
    })
    .superRefine((val, ctx) => {
        const match = val.field.match(
            /^pekerjaan\[(\d+)\]\.(volume|harga_satuan|satuan|uraian)$/
        );
        if (!match) return;
        const subfield = match[2];

        if (subfield === "volume" || subfield === "harga_satuan") {
            let valid = false;
            if (typeof val.nilai === "number") {
                valid = Number.isFinite(val.nilai) && val.nilai >= 0;
            } else if (typeof val.nilai === "string") {
                const trimmed = val.nilai.trim();
                if (trimmed !== "") {
                    const num = Number(trimmed);
                    valid = !Number.isNaN(num) && Number.isFinite(num) && num >= 0;
                }
            }
            if (!valid) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["nilai"],
                    message: `Field '${val.field}' requires a valid non-negative number`,
                });
            }
        } else if (subfield === "satuan" || subfield === "uraian") {
            const valid = String(val.nilai).trim().length > 0;
            if (!valid) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["nilai"],
                    message: `Field '${val.field}' cannot be empty`,
                });
            }
        }
    });

export function formatZodError(error: z.ZodError): string {
    const first = error.issues[0];
    if (!first) return "Invalid input";
    return first.path.length > 0
        ? `${first.path.join(".")}: ${first.message}`
        : first.message;
}
