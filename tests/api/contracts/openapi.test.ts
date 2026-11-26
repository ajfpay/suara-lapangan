import { describe, expect, it } from "vitest";
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
});
