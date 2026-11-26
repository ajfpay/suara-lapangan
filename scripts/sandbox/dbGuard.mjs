const EXPECTED_DATABASE = "suara_lapangan_test";
const EXPECTED_USER = "suara_lapangan_test";
const LIGHTVELA_HOST = "100.69.30.9";
const LIGHTVELA_PORT = 5432;

export function parseAndValidateSandboxUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
        throw new Error("DATABASE_URL is required");
    }

    let parsed, database, user, password;
    try {
        parsed = new URL(rawUrl);
        database = decodeURIComponent(parsed.pathname.slice(1));
        user = decodeURIComponent(parsed.username);
        password = decodeURIComponent(parsed.password);
    } catch {
        throw new Error("DATABASE_URL is not a valid URL");
    }

    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        throw new Error("Unsupported database protocol");
    }

    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : 5432;
    const sslmode = parsed.searchParams.get("sslmode");
    if (
        parsed.searchParams.size !== 1 ||
        sslmode !== "disable" ||
        parsed.hash
    ) {
        throw new Error(
            "Only ?sslmode=disable is permitted for the sandbox connection"
        );
    }
    if (host !== LIGHTVELA_HOST || port !== LIGHTVELA_PORT) {
        throw new Error(
            `Expected Lightvela Tailscale endpoint ${LIGHTVELA_HOST}:${LIGHTVELA_PORT}`
        );
    }
    if (database !== EXPECTED_DATABASE) {
        throw new Error("Forbidden database: expected suara_lapangan_test");
    }
    if (user !== EXPECTED_USER || !password) {
        throw new Error(
            "Expected the dedicated sandbox role and a non-empty password"
        );
    }

    return { host, port, database, user, sslmode };
}

export function validateDbIdentityResult(identity) {
    if (identity.rolsuper !== false) {
        throw new Error("Sandbox role must not have superuser privileges");
    }
    if (
        identity.currentDatabase !== EXPECTED_DATABASE ||
        identity.currentUser !== EXPECTED_USER
    ) {
        throw new Error(
            "Connected database or role does not match the dedicated sandbox"
        );
    }
    if (
        identity.rolcreatedb !== false ||
        identity.rolcreaterole !== false ||
        identity.rolbypassrls !== false
    ) {
        throw new Error("Sandbox role has excessive or unverified privileges");
    }
}

export async function verifySandboxIdentity(pool) {
    const {
        rows: [row],
    } = await pool.query(
        "SELECT current_database() AS db, current_user AS usr, inet_server_port() AS server_port, version() AS pg_version, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    if (!row || row.server_port !== LIGHTVELA_PORT) {
        throw new Error("Sandbox server identity could not be verified");
    }
    validateDbIdentityResult({
        currentDatabase: row.db,
        currentUser: row.usr,
        rolsuper: row.rolsuper,
        rolcreatedb: row.rolcreatedb,
        rolcreaterole: row.rolcreaterole,
        rolbypassrls: row.rolbypassrls,
    });
    return row;
}
