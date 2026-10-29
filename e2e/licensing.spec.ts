import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { test, expect } from "@playwright/test";

/**
 * The invoice app's licence obligation, and the record of what the app ships.
 *
 * invoify is MIT: the copyright notice and permission text have to travel with
 * the fork, and be reachable from the running app rather than only from the
 * repository. THIRD-PARTY has to name every installed package, which the
 * e2e run checks independently of the npm script.
 */

const root = resolve(__dirname, "..");

test.describe("licensing", () => {
    test("the invoify MIT notice is retained and served", async ({
        request,
    }) => {
        const res = await request.get("/LICENSE");
        expect(res.status()).toBe(200);
        const text = await res.text();

        expect(text).toMatch(/MIT License/);
        expect(text).toContain("Copyright (c) 2023 Ali Abbasov");
        expect(text).toMatch(/Permission is hereby granted/);

        // The repository copy and the served copy are the same document.
        expect(text.trim()).toBe(
            readFileSync(resolve(root, "LICENSE"), "utf8").trim()
        );
    });

    test("THIRD-PARTY names every installed package at its version", async ({
        request,
    }) => {
        const res = await request.get("/THIRD-PARTY.md");
        expect(res.status()).toBe(200);
        const body = await res.text();

        const pkg = JSON.parse(
            readFileSync(resolve(root, "package.json"), "utf8")
        );

        for (const name of Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
        })) {
            // Table rows read `name@version`, so `zod` cannot be satisfied by a
            // longer name that merely starts the same way.
            expect(body, `${name} missing from THIRD-PARTY`).toMatch(
                new RegExp("`" + escapeRegExp(name) + "@[^`]+`")
            );
        }

        // The upstream licence claim itself is stated, not just implied.
        expect(body).toMatch(/invoify/);
        expect(body).toMatch(/MIT/);
    });

    test("the invoice app is gone from the shipped pages", async ({
        request,
    }) => {
        for (const path of [
            "/api/invoice/generate",
            "/api/invoice/send",
            "/api/invoice/export",
            "/api/invoice/warm",
        ]) {
            const res = await request.post(path, { data: {} });
            // Next answers 405 for a POST to an unmatched API path and 404 for
            // a GET; either way nothing is handling it.
            expect([404, 405], `${path} should not exist`).toContain(
                res.status()
            );
        }
    });
});

const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");