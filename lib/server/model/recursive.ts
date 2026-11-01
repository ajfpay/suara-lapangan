/**
 * Detect recursive JSON schemas before a call goes out.
 *
 * The Meta Responses API rejects recursive schemas with a 400. Sending one
 * wastes a request and fails the call, so the client validates the schema the
 * caller hands in. Two kinds of recursion matter:
 *
 * 1. A `$ref` that points back to the root (`"#"`) or to an ancestor
 *    definition, which is how hand-written schemas express recursion.
 * 2. An object that contains itself by reference, which is how a schema built
 *    in code by mistake expresses recursion.
 *
 * The walk tracks the `$ref` path and the object identity path, so both are
 * caught.
 */
import type { JsonSchema } from "./types";

/**
 * Walk a schema and return the first path that repeats a name — the cycle.
 * An empty path means the schema is safe.
 */
export function findRecursivePath(
    schema: JsonSchema,
    seen: Set<JsonSchema> = new Set(),
    refs: Set<string> = new Set(),
    root: JsonSchema = schema
): string[] {
    if (!schema || typeof schema !== "object") return [];

    const ref = schema.$ref as string | undefined;
    if (typeof ref === "string") {
        // A `$ref` to the root or to an ancestor is recursion.
        if (ref === "#" || ref === "#/" || refs.has(ref)) return ["$ref"];
        refs.add(ref);
    }

    if (seen.has(schema)) return [];

    seen.add(schema);

    const properties = schema.properties as
        | Record<string, JsonSchema>
        | undefined;
    if (properties) {
        for (const [name, child] of Object.entries(properties)) {
            const path = findRecursivePath(child, seen, refs, root);
            if (path.length > 0) return [name, ...path];
        }
    }

    const items = schema.items as JsonSchema | undefined;
    if (items) {
        const path = findRecursivePath(items, seen, refs, root);
        if (path.length > 0) return ["items", ...path];
    }

    const additionalProperties = schema.additionalProperties as
        | JsonSchema
        | boolean
        | undefined;
    if (additionalProperties && typeof additionalProperties === "object") {
        const path = findRecursivePath(additionalProperties, seen, refs, root);
        if (path.length > 0) return ["additionalProperties", ...path];
    }

    const definitions = schema.$defs as Record<string, JsonSchema> | undefined;
    if (definitions) {
        for (const [name, child] of Object.entries(definitions)) {
            const path = findRecursivePath(child, seen, refs, root);
            if (path.length > 0) return [name, ...path];
        }
    }

    return [];
}

/**
 * A schema is recursive when it references itself, directly or through a
 * property, an array item, `additionalProperties`, or `$defs`.
 */
export function isRecursiveSchema(schema: JsonSchema): boolean {
    return findRecursivePath(schema).length > 0;
}

/**
 * Validate a structured-output format before it leaves the client.
 *
 * Returns the first error message found, or undefined when the format is safe
 * to send. The message names the cycle so the caller can fix the schema.
 */
export function validateSchema(
    format: { name?: string; schema?: JsonSchema } | undefined
): string | undefined {
    if (!format?.schema) return undefined;
    const path = findRecursivePath(format.schema);
    if (path.length === 0) return undefined;
    return `recursive schema rejected: ${path.join(" > ")}`;
}
