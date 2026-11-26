#!/usr/bin/env node
import pg from "pg";
import { readdir } from "node:fs/promises";
import {
    parseAndValidateSandboxUrl,
    verifySandboxIdentity,
} from "./dbGuard.mjs";
import { assertMigrationsReady } from "./migrationReadiness.mjs";

let pool;
try {
    const args = process.argv.slice(2);
    const identityOnly = args.length === 1 && args[0] === "--identity-only";
    if (args.length && !identityOnly)
        throw new Error("Unknown verification argument");
    const rawUrl = process.env.DATABASE_URL;
    const target = parseAndValidateSandboxUrl(rawUrl);
    pool = new pg.Pool({
        connectionString: rawUrl,
        connectionTimeoutMillis: 10000,
        query_timeout: 10000,
        max: 1,
    });
    const identity = await verifySandboxIdentity(pool);
    const result = {
        ok: true,
        mode: identityOnly ? "identity-only" : "readiness",
        host: target.host,
        port: target.port,
        database: identity.db,
        user: identity.usr,
        privileges: {
            rolsuper: identity.rolsuper,
            rolcreatedb: identity.rolcreatedb,
            rolcreaterole: identity.rolcreaterole,
            rolbypassrls: identity.rolbypassrls,
        },
        pgVersion: identity.pg_version,
    };
    if (!identityOnly) {
        const expected = (
            await readdir(new URL("../../db/migrations/", import.meta.url))
        )
            .filter((name) => name.endsWith(".sql"))
            .sort();
        const { rows } = await pool.query(
            "SELECT version FROM public.schema_migrations"
        );
        assertMigrationsReady(
            expected,
            rows.map((row) => row.version)
        );
        result.migrationsApplied = rows.length;
        result.requiredMigrations = expected.length;
    }
    console.log(JSON.stringify(result, null, 2));
} catch {
    console.error(
        "Sandbox database verification failed. Check the dedicated connection, role privileges, and migrations."
    );
    process.exitCode = 1;
} finally {
    if (pool) {
        try {
            await pool.end();
        } catch {
            console.error("Sandbox verification database close failed");
            process.exitCode = 1;
        }
    }
}
