/**
 * Keeps THIRD-PARTY.md in step with package.json.
 *
 * Two failures, both cheap to avoid and expensive to discover at submission:
 * a package installed but not listed (a licence claim nobody recorded), and a
 * package listed but no longer installed (a stale claim). `--write` rewrites
 * the table from the lockfile; the check runs in `npm run check:third-party`
 * and from the e2e suite, so a dependency cannot be added silently.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const file = resolve(root, "THIRD-PARTY.md");
const served = resolve(root, "public/THIRD-PARTY.md");
const current = readFileSync(file, "utf8");

const installed = { ...pkg.dependencies, ...pkg.devDependencies };

const meta = Object.entries(installed).map(([name, range]) => {
    const manifest = JSON.parse(
        readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8")
    );
    const license =
        typeof manifest.license === "string"
            ? manifest.license
            : Array.isArray(manifest.licenses)
              ? manifest.licenses.map((l) => l.type).join(", ")
              : "see package";
    return { name, version: manifest.version, range, license };
});

if (process.argv.includes("--write")) {
    const rows = meta
        .map(
            ({ name, version, license }) =>
                `| \`${name}@${version}\` | ${license} |`
        )
        .join("\n");

    const next = current.replace(
        /<!-- BEGIN DEPENDENCIES -->[\s\S]*<!-- END DEPENDENCIES -->/,
        [
            "<!-- BEGIN DEPENDENCIES -->",
            "| Package | Licence |",
            "| --- | --- |",
            rows,
            "<!-- END DEPENDENCIES -->",
        ].join("\n")
    );
    writeFileSync(file, next);
    // The same file has to be reachable from the app's footer, and Next only
    // serves what is under public/.
    copyFileSync(file, served);
    copyFileSync(resolve(root, "LICENSE"), resolve(root, "public/LICENSE"));
    console.log(`THIRD-PARTY.md: ${meta.length} packages`);
    process.exit(0);
}

const servedCopy = readFileSync(served, "utf8");
if (servedCopy !== current) {
    console.error("public/THIRD-PARTY.md is out of date; run with --write.");
    process.exit(1);
}

const missing = meta.filter(
    ({ name, version }) => !current.includes(`\`${name}@${version}\``)
);
const stale = [
    ...current.matchAll(/^\| `([^`@]+)@([^`]+)` \|/gm),
].filter(([, name]) => !(name in installed));

if (missing.length || stale.length) {
    for (const { name, version } of missing) {
        console.error(`missing from THIRD-PARTY.md: ${name}@${version}`);
    }
    for (const [, name] of stale) {
        console.error(`listed but not installed: ${name}`);
    }
    console.error("Run `npm run check:third-party -- --write`.");
    process.exit(1);
}

console.log(`THIRD-PARTY.md: ${meta.length} packages, all listed`);