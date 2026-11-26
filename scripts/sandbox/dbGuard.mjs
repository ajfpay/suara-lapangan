const FORBIDDEN_DATABASES = new Set([
    "dev",
    "ticket01_test",
    "suara_lapangan",
    "postgres",
    "template0",
    "template1",
    "tooljet_db",
    "hindsight",
]);

const SANDBOX_DB_PATTERN = /^suara_lapangan_(test|dev|sandbox)(_[a-z0-9_]+)?$/;
const LIGHTVELA_HOST = "100.69.30.9";
const LIGHTVELA_PORT = 5432;

export function parseAndValidateSandboxUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
        throw new Error("DATABASE_URL is required");
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error("DATABASE_URL is not a valid URL");
    }

    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : 5432;
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const user = decodeURIComponent(parsed.username);
    const sslmode = parsed.searchParams.get("sslmode");
    if (parsed.searchParams.size !== 1 || sslmode !== "disable") {
        throw new Error(
            "Only ?sslmode=disable is permitted for the sandbox connection"
        );
    }

    if (FORBIDDEN_DATABASES.has(database)) {
        throw new Error(
            `Target database "${database}" is forbidden for sandbox use`
        );
    }

    if (!SANDBOX_DB_PATTERN.test(database)) {
        throw new Error(
            `Target database "${database}" does not match dedicated sandbox naming`
        );
    }

    if (host !== LIGHTVELA_HOST || port !== LIGHTVELA_PORT) {
        throw new Error(
            `Expected Lightvela Tailscale endpoint ${LIGHTVELA_HOST}:${LIGHTVELA_PORT}, got ${host}:${port}`
        );
    }

    if (!user) {
        throw new Error("Database username is required");
    }

    return {
        host,
        port,
        database,
        user,
        sslmode,
    };
}

export function validateDbIdentityResult({
    currentDatabase,
    currentUser,
    rolsuper,
    expectedDatabase,
    expectedUser,
}) {
    if (FORBIDDEN_DATABASES.has(currentDatabase)) {
        throw new Error(`Connected to forbidden database "${currentDatabase}"`);
    }

    if (currentDatabase !== expectedDatabase) {
        throw new Error(
            `Database mismatch: expected "${expectedDatabase}", got "${currentDatabase}"`
        );
    }

    if (rolsuper) {
        throw new Error(
            `Sandbox role "${currentUser}" must not have superuser privileges`
        );
    }

    if (currentUser !== expectedUser) {
        throw new Error(
            "Connected role does not match the configured sandbox role"
        );
    }
}
