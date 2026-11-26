export function assertMigrationsReady(expected, applied) {
    const missing = expected.filter((version) => !applied.includes(version));
    if (expected.length === 0 || missing.length > 0) {
        throw new Error("Sandbox migrations are incomplete");
    }
}
