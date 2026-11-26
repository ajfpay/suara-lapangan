import { describe, expect, it } from "vitest";
import {
    parseAndValidateSandboxUrl,
    validateDbIdentityResult,
} from "./dbGuard.mjs";

describe("sandbox database guard", () => {
    it("accepts a dedicated Lightvela sandbox database URL with sslmode=disable and redacts password", () => {
        const result = parseAndValidateSandboxUrl(
            "postgresql://suara_lapangan_test:s3cr3tPass@100.69.30.9:5432/suara_lapangan_test?sslmode=disable"
        );

        expect(result).toEqual({
            host: "100.69.30.9",
            port: 5432,
            database: "suara_lapangan_test",
            user: "suara_lapangan_test",
            sslmode: "disable",
        });
        expect(JSON.stringify(result)).not.toContain("s3cr3tPass");
    });

    it("rejects Go databases and the production Suara Lapangan database", () => {
        for (const forbidden of [
            "dev",
            "ticket01_test",
            "suara_lapangan",
            "postgres",
        ]) {
            expect(() =>
                parseAndValidateSandboxUrl(
                    `postgresql://suara_lapangan_test:pw@100.69.30.9:5432/${forbidden}?sslmode=disable`
                )
            ).toThrow(/forbidden/i);
        }
    });

    it("rejects non-Lightvela hosts and missing sslmode=disable", () => {
        expect(() =>
            parseAndValidateSandboxUrl(
                "postgresql://suara_lapangan_test:pw@127.0.0.1:5432/suara_lapangan_test?sslmode=disable"
            )
        ).toThrow(/100\.69\.30\.9/);

        expect(() =>
            parseAndValidateSandboxUrl(
                "postgresql://suara_lapangan_test:pw@100.69.30.9:5432/suara_lapangan_test"
            )
        ).toThrow(/sslmode=disable/i);
    });

    it.each([
        "postgresql://dev:pw@100.69.30.9/suara_lapangan_test?sslmode=disable",
        "postgresql://suara_lapangan_test:pw@100.69.30.9/suara_lapangan_test_other?sslmode=disable",
        "postgresql://suara_lapangan_test@100.69.30.9/suara_lapangan_test?sslmode=disable",
    ])("rejects unauthorized sandbox credentials or database: %s", (url) => {
        expect(() => parseAndValidateSandboxUrl(url)).toThrow();
    });

    it("does not accept caller-selected database or role as the source of truth", () => {
        expect(() =>
            validateDbIdentityResult({
                currentDatabase: "suara_lapangan_test_other",
                currentUser: "dev",
                ...{
                    expectedDatabase: "suara_lapangan_test_other",
                    expectedUser: "dev",
                },
                rolsuper: false,
                ...{
                    rolcreatedb: false,
                    rolcreaterole: false,
                    rolbypassrls: false,
                },
            })
        ).toThrow();
    });

    it.each(["rolcreatedb", "rolcreaterole", "rolbypassrls"])(
        "rejects privilege %s",
        (flag) => {
            expect(() =>
                validateDbIdentityResult({
                    currentDatabase: "suara_lapangan_test",
                    currentUser: "suara_lapangan_test",
                    rolsuper: false,
                    ...{
                        rolcreatedb: false,
                        rolcreaterole: false,
                        rolbypassrls: false,
                        [flag]: true,
                    },
                })
            ).toThrow();
        }
    );

    it("rejects query parameters that can override the validated connection identity", () => {
        for (const suffix of [
            "&host=localhost",
            "&user=other",
            "&sslmode=require",
            "&options=-c%20role=other",
        ]) {
            expect(() =>
                parseAndValidateSandboxUrl(
                    `postgresql://suara_lapangan_test:pw@100.69.30.9:5432/suara_lapangan_test?sslmode=disable${suffix}`
                )
            ).toThrow();
        }
    });

    it("rejects an actual role different from the validated username", () => {
        expect(() =>
            validateDbIdentityResult({
                currentDatabase: "suara_lapangan_test",
                currentUser: "other",
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
            })
        ).toThrow();
    });

    it("rejects superuser roles during live identity verification", () => {
        expect(() =>
            validateDbIdentityResult({
                currentDatabase: "suara_lapangan_test",
                currentUser: "dev",
                rolsuper: true,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
            })
        ).toThrow(/superuser/i);
    });

    it("accepts matching non-superuser sandbox identity", () => {
        expect(() =>
            validateDbIdentityResult({
                currentDatabase: "suara_lapangan_test",
                currentUser: "suara_lapangan_test",
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolbypassrls: false,
            })
        ).not.toThrow();
    });
});
