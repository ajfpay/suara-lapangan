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
    for (const file of files) {
        await pool.query(await readFile(new URL(file, directory), "utf8"));
        console.log(`applied ${file}`);
    }
} finally {
    await pool.end();
}
