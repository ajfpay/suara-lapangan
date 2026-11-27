import { describe, expect, it } from "vitest";
import { httpStatusFor, type AsrErrorCode } from "@/lib/server/asr/errors";
import { postDocumentBodySchema } from "@/lib/server/validation/document";
import { readFileSync } from "node:fs";

const contract = JSON.parse(
    readFileSync("contracts/openapi/openapi.json", "utf8")
);
describe("REST contract", () => {
    it("contains the mobile endpoints, unique operation IDs and resolved local refs", () => {
        const operations = Object.values(contract.paths).flatMap((path) =>
            Object.values(path as Record<string, { operationId: string }>)
        );
        expect(new Set(operations.map((op) => op.operationId)).size).toBe(
            operations.length
        );
        expect(
            contract.paths["/api/documents"].get.responses["401"]
        ).toBeDefined();
        expect(
            contract.paths["/api/documents/{id}/versions"].get.responses["404"]
        ).toBeDefined();
        const visit = (node: unknown) => {
            if (!node || typeof node !== "object") return;
            for (const [key, value] of Object.entries(node)) {
                if (key === "$ref") {
                    const parts = String(value).split("/");
                    expect(parts[0]).toBe("#");
                    let current = contract;
                    for (const part of parts.slice(1)) current = current[part];
                    expect(current).toBeDefined();
                } else visit(value);
            }
        };
        visit(contract);
    });
    it("documents ASR ownership and every current upstream failure status, not an invented conflict", () => {
        const codes: AsrErrorCode[] = [
            "invalid_request",
            "too_large",
            "upstream_rejected",
            "upstream_auth",
            "rate_limited",
            "upstream_failure",
            "upstream_unreachable",
            "not_configured",
            "internal_error",
        ];
        const responses = contract.paths["/api/asr/transcribe"].post.responses;
        expect(Object.keys(responses).map(Number).sort()).toEqual(
            [
                ...new Set([200, 401, 403, 404, ...codes.map(httpStatusFor)]),
            ].sort()
        );
    });
    it("allows a document request turn without final, as the actual request validator does", () => {
        const input = {
            sessionId: "example",
            turns: [
                {
                    turn_id: "turn_1",
                    startMs: 0,
                    endMs: 1,
                    transcript: "example",
                },
            ],
        };
        expect(postDocumentBodySchema.safeParse(input).success).toBe(true);
        const request =
            contract.paths["/api/documents"].post.requestBody.content[
                "application/json"
            ].schema;
        const schema =
            contract.components.schemas[
                request.properties.turns.items.$ref.split("/").at(-1)
            ];
        expect(schema.required).not.toContain("final");
        expect(contract.components.schemas.Turn.required).toContain("final");
    });
    it("represents delivered-but-not-marked email as success and normalized document statuses", () => {
        const email =
            contract.paths["/api/documents/{id}/email"].post.responses["200"]
                .content["application/json"].schema;
        expect(
            email.oneOf
                .map(
                    (s: { properties: { status: { enum: string[] } } }) =>
                        s.properties.status.enum[0]
                )
                .sort()
        ).toEqual(["not_marked", "terkirim"]);
        expect(
            email.oneOf.find(
                (s: { properties: { status: { enum: string[] } } }) =>
                    s.properties.status.enum[0] === "not_marked"
            ).required
        ).toContain("message");
        const get =
            contract.paths["/api/documents/{id}"].get.responses["200"].content[
                "application/json"
            ].schema;
        expect(
            contract.components.schemas[get.$ref.split("/").at(-1)].properties
                .status.enum
        ).toEqual(["draf", "disetujui", "terkirim"]);
    });
});
