/**
 * Debug marker distinguishing the live Spark model path from the rule
 * fallback. Non-production only: a production response must not carry the
 * field at all (not `false`, not `undefined` as an own key). It is kept
 * outside production because both paths answer 200 with the same document
 * shape, so e2e needs the marker to prove the real Spark path ran.
 */
export function sparkPathMarker(fromModel: boolean): { _spark_path?: true } {
    if (fromModel && process.env.NODE_ENV !== "production") {
        return { _spark_path: true };
    }
    return {};
}

/**
 * The marker travels on the stored document, so gating the POST envelope
 * alone still leaks it: PATCH /api/documents/{id} returns that document as
 * it was stored. Every response body that carries a document goes through
 * here.
 */
export function toResponseDocument<T extends { _spark_path?: boolean }>(
    doc: T
): T {
    if (process.env.NODE_ENV !== "production" || !("_spark_path" in doc)) {
        return doc;
    }
    const rest = { ...doc };
    delete rest._spark_path;
    return rest;
}
