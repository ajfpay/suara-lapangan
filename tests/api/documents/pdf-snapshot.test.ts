import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as storage from "@/lib/server/pdf/storage";

let root: string;
afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
});

describe("official PDF snapshots", () => {
    it("concurrent writers publish the same byte-addressed immutable file; corruption fails closed", async () => {
        root = await mkdtemp(path.join(tmpdir(), "pdf-snapshot-"));
        const bytes = Buffer.from("%PDF-1.4\nexample\n%%EOF\n");
        const results = await Promise.all(
            Array.from({ length: 8 }, () =>
                storage.writeOfficialPdf(bytes, root)
            )
        );
        expect(new Set(results).size).toBe(1);
        const relative = results[0];
        expect(relative).toMatch(/^snapshots\/[a-f0-9]{64}\.pdf$/);
        expect(await readFile(path.join(root, relative))).toEqual(bytes);
        expect(await storage.readOfficialPdf(relative, root)).toEqual(bytes);
        await writeFile(path.join(root, relative), Buffer.from("corrupt"));
        await expect(storage.readOfficialPdf(relative, root)).rejects.toThrow();
        await expect(storage.writeOfficialPdf(bytes, root)).rejects.toThrow();
    });
});

it("recovers from failed writes and a leftover crash file, then publishes safely across processes", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { pathToFileURL } = await import("node:url");
    root = await mkdtemp(path.join(tmpdir(), "pdf-snapshot-cross-"));
    const blocking = path.join(root, "blocked");
    await writeFile(blocking, "not a directory");
    const bytes = Buffer.from("%PDF-1.4\nimmutable bytes\n%%EOF\n");
    await expect(storage.writeOfficialPdf(bytes, blocking)).rejects.toThrow();
    const dir = path.join(root, "snapshots");
    await mkdir(dir);
    await writeFile(path.join(dir, ".pdf-crashed.tmp"), "partial");
    const moduleUrl = pathToFileURL(
        path.resolve("lib/server/pdf/storage.ts")
    ).href;
    const script = `import { writeOfficialPdf } from ${JSON.stringify(moduleUrl)}; process.stdout.write(await writeOfficialPdf(Buffer.from(process.argv[1], 'base64'), process.argv[2]));`;
    const exec = promisify(execFile);
    const results = await Promise.all(
        Array.from({ length: 3 }, () =>
            exec(process.execPath, [
                "--experimental-strip-types",
                "--input-type=module",
                "-e",
                script,
                bytes.toString("base64"),
                root,
            ])
        )
    );
    expect(new Set(results.map((r) => r.stdout)).size).toBe(1);
    expect(await storage.readOfficialPdf(results[0].stdout, root)).toEqual(
        bytes
    );
}, 30000);
