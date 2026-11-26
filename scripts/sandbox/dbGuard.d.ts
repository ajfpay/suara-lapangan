import type { Pool } from "pg";

export type ParsedSandboxDb = {
    host: string;
    port: number;
    database: string;
    user: string;
    sslmode: "disable";
};

export type SandboxIdentity = {
    currentDatabase: string;
    currentUser: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
};

export function parseAndValidateSandboxUrl(
    rawUrl: string | undefined
): ParsedSandboxDb;
export function validateDbIdentityResult(input: SandboxIdentity): void;
export function verifySandboxIdentity(pool: Pool): Promise<{
    db: string;
    usr: string;
    server_port: number;
    pg_version: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
}>;
