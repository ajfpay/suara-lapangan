import { describe, expect, it } from "vitest";
import { documentIdSchema } from "@/lib/server/validation/document";

describe("legacy document identifier contract", () => {
    it.each([
        "00000000-0000-0000-0000-000000000099",
        "11111111-1111-1111-1111-111111111111",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "9e0d3bc6-d113-4acd-8870-c043f648b8b6",
    ])("accepts PostgreSQL UUID %s", (id) => {
        expect(documentIdSchema.safeParse(id).success).toBe(true);
    });
    it.each([
        "invalid",
        "00000000-0000-0000-0000-00000000009z",
        "00000000-0000-0000-0000-000000000099extra",
    ])("rejects malformed identifier %s", (id) => {
        expect(documentIdSchema.safeParse(id).success).toBe(false);
    });
});
