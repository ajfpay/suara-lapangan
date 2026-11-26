#!/usr/bin/env node
import pg from "pg";
import {
    parseAndValidateSandboxUrl,
    validateDbIdentityResult,
} from "./dbGuard.mjs";

const rawUrl = process.env.DATABASE_URL;
const target = parseAndValidateSandboxUrl(rawUrl);

const pool = new pg.Pool({
    connectionString: rawUrl,
    connectionTimeoutMillis: 10000,
    max: 1,
});

try {
    const idResult = await pool.query(
        "SELECT current_database() AS db, current_user AS usr, inet_server_port() AS server_port, version() AS pg_version"
    );
    const privResult = await pool.query(
        "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    const migResult = await pool.query(
        "SELECT to_regclass('public.schema_migrations') AS mig_table"
    );

    const row = idResult.rows[0];
    const priv = privResult.rows[0];

    validateDbIdentityResult({
        currentDatabase: row.db,
        currentUser: row.usr,
        rolsuper: Boolean(priv?.rolsuper),
        expectedDatabase: target.database,
        expectedUser: target.user,
    });

    let migrationsApplied = 0;
    if (migResult.rows[0]?.mig_table) {
        const countResult = await pool.query(
            "SELECT count(*)::int AS total FROM schema_migrations"
        );
        migrationsApplied = countResult.rows[0].total;
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                host: target.host,
                port: target.port,
                database: row.db,
                user: row.usr,
                privileges: priv,
                migrationsApplied,
                pgVersion: row.pg_version,
            },
            null,
            2
        )
    );
} finally {
    await pool.end();
}
