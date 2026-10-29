/**
 * Renders the app icons from the SVG mark.
 *
 * The SVG is the source of truth and the PNGs are exports of it, so changing
 * the mark is one edit plus `npm run icons`. Uses the Playwright Chromium that
 * the e2e suite already installs, so it needs no second browser download and
 * no puppeteer cache to be primed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(
    resolve(root, "public/assets/img/suara-lapangan-mark.svg"),
    "utf8"
);

const TARGETS = [
    { file: "public/assets/img/suara-lapangan-mark-512.png", size: 512 },
    { file: "public/assets/img/suara-lapangan-mark-192.png", size: 192 },
    { file: "public/assets/img/suara-lapangan-apple-touch.png", size: 180 },
];

const browser = await chromium.launch();

try {
    for (const { file, size } of TARGETS) {
        const page = await browser.newPage({
            viewport: { width: size, height: size },
            deviceScaleFactor: 1,
        });
        await page.setContent(
            `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
        );
        const png = await page.screenshot({
            omitBackground: true,
            clip: { x: 0, y: 0, width: size, height: size },
        });
        await writeFile(resolve(root, file), png);
        await page.close();
        console.log(`${file} ${size}x${size}`);
    }

    // A multi-resolution .ico. PNG payloads are legal in the container and
    // every browser that runs this app reads them.
    const sizes = [16, 32];
    const pngs = [];
    for (const size of sizes) {
        const page = await browser.newPage({
            viewport: { width: size, height: size },
            deviceScaleFactor: 1,
        });
        await page.setContent(
            `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
        );
        pngs.push(
            await page.screenshot({
                omitBackground: true,
                clip: { x: 0, y: 0, width: size, height: size },
            })
        );
        await page.close();
    }
    await writeFile(resolve(root, "app/favicon.ico"), buildIco(sizes, pngs));
    console.log(`app/favicon.ico ${sizes.join("+")}`);
} finally {
    await browser.close();
}

/** ICONDIR + one ICONDIRENTRY per image, with PNG payloads. */
function buildIco(sizes, pngs) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(sizes.length, 4);

    let offset = 6 + 16 * sizes.length;
    const entries = sizes.map((size, i) => {
        const entry = Buffer.alloc(16);
        entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
        entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
        entry.writeUInt8(0, 2); // palette
        entry.writeUInt8(0, 3); // reserved
        entry.writeUInt16LE(1, 4); // colour planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(pngs[i].length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += pngs[i].length;
        return entry;
    });

    return Buffer.concat([header, ...entries, ...pngs]);
}
