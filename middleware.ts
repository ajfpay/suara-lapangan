import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

/**
 * Locale resolution only.
 *
 * Unknown routes are not handled here: `app/[locale]/[...rest]/page.tsx`
 * calls `notFound()` for them, which keeps the URL, answers 404, and renders
 * the page inside the locale layout (see next-intl's error-files guide).
 */
export default createMiddleware(routing);

export const config = {
    /*
     * Skip /api, Next internals, and static files. The dot rule covers
     * /THIRD-PARTY.md and the assets; `LICENSE` has no extension and is served
     * from public/, so it is named explicitly — without it the middleware
     * rewrites /LICENSE to /en/LICENSE and the licence 404s.
     */
    matcher: ["/((?!api|_next|_vercel|LICENSE|.*\\..*).*)"],
};
