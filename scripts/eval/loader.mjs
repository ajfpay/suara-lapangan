import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();

function tryAppendExt(filePath) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile())
        return filePath;
    for (const ext of [
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        "/index.ts",
        "/index.js",
    ]) {
        const candidate = filePath + ext;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
            return candidate;
    }
    return null;
}

export async function resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/server/db/store" && !process.env.DATABASE_URL) {
        const memStorePath = path.join(
            root,
            "scripts",
            "eval",
            "in-memory-store.ts"
        );
        return nextResolve(pathToFileURL(memStorePath).href, context);
    }

    if (specifier.startsWith("@/")) {
        const subpath = specifier.slice(2);
        const candidate = tryAppendExt(path.join(root, subpath));
        if (candidate) {
            return nextResolve(pathToFileURL(candidate).href, context);
        }
    } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        if (context.parentURL) {
            const parentDir = path.dirname(fileURLToPath(context.parentURL));
            const candidate = tryAppendExt(path.resolve(parentDir, specifier));
            if (candidate) {
                return nextResolve(pathToFileURL(candidate).href, context);
            }
        }
    }

    return nextResolve(specifier, context);
}
