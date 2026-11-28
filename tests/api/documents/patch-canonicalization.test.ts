import { describe, expect, it } from "vitest";
import { patchDocumentBodySchema } from "@/lib/server/validation/document";

describe("document patch canonicalization", () => {
    it("passes the canonical citation and field to the mutation handler", () => {
        expect(patchDocumentBodySchema.parse({
            field: " pekerjaan[0].sumber_kutipan ",
            nilai: " turn_2 ",
        })).toEqual({ field: "pekerjaan[0].sumber_kutipan", nilai: "turn_2" });
    });
});
