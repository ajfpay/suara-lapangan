export type ParsedSandboxDb = {
    host: string;
    port: number;
    database: string;
    user: string;
    sslmode: string;
};

export function parseAndValidateSandboxUrl(rawUrl: string): ParsedSandboxDb;

export function validateDbIdentityResult(input: {
    currentDatabase: string;
    currentUser: string;
    rolsuper: boolean;
    expectedDatabase: string;
    expectedUser: string;
}): void;
