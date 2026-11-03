/** @type {import("next").NextConfig} */
const withNextIntl = require("next-intl/plugin")("./i18n/request.ts");

const nextConfig = {
    /**
     * `puppeteer` and `puppeteer-core` are kept out of the server bundle and
     * loaded at runtime by the PDF service (ticket 08). Bundling them breaks
     * the browser binary's path resolution.
     */
    serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
    /**
     * The dev preview binds 127.0.0.1 and sits behind a tailscale proxy.
     * Without this flag Next builds the middleware request URL from
     * fetchHostname ("localhost") while the router's init URL uses the raw
     * bind hostname (127.0.0.1); the origin mismatch makes absolute
     * middleware redirects proxy the request (TLS to plain HTTP -> EPROTO),
     * so /en/login and /en/register 500 through the public URL. With this
     * flag the middleware sees the init URL directly and redirects stay
     * same-origin. Scoped to development only: production middleware keeps
     * the default URL normalization for auth redirects and i18n routing.
     */
    ...(process.env.NODE_ENV === "development" ? { skipMiddlewareUrlNormalize: true } : {}),
};

module.exports = withNextIntl(nextConfig);
