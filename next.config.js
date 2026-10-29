/** @type {import("next").NextConfig} */
const withNextIntl = require("next-intl/plugin")("./i18n/request.ts");

const nextConfig = {
    /**
     * `puppeteer` and `puppeteer-core` are kept out of the server bundle and
     * loaded at runtime by the PDF service (ticket 08). Bundling them breaks
     * the browser binary's path resolution.
     */
    serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

module.exports = withNextIntl(nextConfig);
