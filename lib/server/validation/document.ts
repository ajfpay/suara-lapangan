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

export const CANONICAL_UNITS = [
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

export const canonicalUnitSchema = z.enum(CANONICAL_UNITS);

export const addLineItemSchema = z.object({
    uraian: z.string().trim().min(1, "uraian cannot be empty"),
    volume: z
        .union([z.number(), z.string()])
        .refine((v) => {
            const num = typeof v === "number" ? v : Number(String(v).trim());
            return !Number.isNaN(num) && Number.isFinite(num) && num > 0;
        }, "volume must be a positive number")
        .transform((v) => (typeof v === "number" ? v : Number(String(v).trim()))),
    satuan: canonicalUnitSchema,
    harga_satuan: z
        .union([z.number(), z.string()])
        .refine((v) => {
            const num = typeof v === "number" ? v : Number(String(v).trim());
            return !Number.isNaN(num) && Number.isFinite(num) && num >= 0;
        }, "harga_satuan must be a non-negative number")
        .transform((v) => (typeof v === "number" ? v : Number(String(v).trim()))),
});

export const addLineOpSchema = z.object({
    op: z.literal("add_line"),
    item: addLineItemSchema,
});

export const removeLineOpSchema = z.object({
    op: z.literal("remove_line"),
    index: z.number().int().nonnegative("index must be a non-negative integer"),
});

export const moveLineOpSchema = z.object({
    op: z.literal("move_line"),
    fromIndex: z
        .number()
        .int()
        .nonnegative("fromIndex must be a non-negative integer"),
    toIndex: z
        .number()
        .int()
        .nonnegative("toIndex must be a non-negative integer"),
});

function isValidIsoDate(str: string): boolean {
    const match = str.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
    if (!match) return false;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const date = new Date(Date.UTC(year, month, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month &&
        date.getUTCDate() === day
    );
}

export const patchScalarBodySchema = z
    .object({
        field: z.string(),
        nilai: z.union([z.number(), z.string()]),
    })
    .superRefine((val, ctx) => {
        const field = val.field.trim();
        if (field === "mata_uang") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["field"],
                message: "Field 'mata_uang' is derived from locale and is not editable",
            });
            return;
        }

        if (
            field === "proyek.nama" ||
            field === "proyek.lokasi" ||
            field === "proyek.klien"
        ) {
            if (typeof val.nilai !== "string" || val.nilai.trim().length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["nilai"],
                    message: `Field '${field}' cannot be empty`,
                });
            }
            return;
        }

        if (field === "tanggal") {
            if (typeof val.nilai !== "string" || !isValidIsoDate(val.nilai.trim())) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["nilai"],
                    message: "Field 'tanggal' must be a valid ISO YYYY-MM-DD calendar date",
                });
            }
            return;
        }

        const match = field.match(
            /^pekerjaan\[(\d+)\]\.(volume|harga_satuan|satuan|uraian)$/
        );
        if (match) {
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
            } else if (subfield === "satuan") {
                const trimmed = String(val.nilai).trim();
                if (!(CANONICAL_UNITS as readonly string[]).includes(trimmed)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["nilai"],
                        message: `Field '${val.field}' must be a canonical unit (${CANONICAL_UNITS.join(", ")})`,
                    });
                }
            } else if (subfield === "uraian") {
                const valid = String(val.nilai).trim().length > 0;
                if (!valid) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["nilai"],
                        message: `Field '${val.field}' cannot be empty`,
                    });
                }
            }
            return;
        }

        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["field"],
            message: `Field '${val.field}' is not allowed for editing`,
        });
    });

export const patchDocumentBodySchema = z.union([
    addLineOpSchema,
    removeLineOpSchema,
    moveLineOpSchema,
    patchScalarBodySchema,
]);

export type PatchDocumentBody = z.infer<typeof patchDocumentBodySchema>;

export function formatZodError(error: z.ZodError): string {
    const first = error.issues[0];
    if (!first) return "Invalid input";
    return first.path.length > 0
        ? `${first.path.join(".")}: ${first.message}`
        : first.message;
}
