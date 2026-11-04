#!/usr/bin/env node
/**
 * Applies every `db/migrations/*.sql` in filename order.
 *
 * The migrations are idempotent, so this is safe to run on every start and on a
 * database that already has the tables. Usage:
 *
 *   DATABASE_URL=postgres://... node db/migrate.mjs
 */
import { readdir, readFile } from "node:fs/promises";

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
}

const directory = new URL("./migrations/", import.meta.url);
const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
const pool = new pg.Pool({ connectionString });

try {
    await pool.query(`
        create table if not exists schema_migrations (
            version text primary key,
            applied_at timestamptz not null default now()
        )
    `);
    const { rows } = await pool.query("select version from schema_migrations");
    const applied = new Set(rows.map((r) => r.version));

    for (const file of files) {
        if (applied.has(file)) {
            continue;
        }
        await pool.query("begin");
        try {
            await pool.query(await readFile(new URL(file, directory), "utf8"));
            await pool.query(
                "insert into schema_migrations (version) values ($1)",
                [file]
            );
            await pool.query("commit");
            console.log(`applied ${file}`);
        } catch (err) {
            await pool.query("rollback");
            throw err;
        }
    }
} finally {
    await pool.end();
}
