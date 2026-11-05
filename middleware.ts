import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware(routing);

function isProtectedPath(pathname: string): boolean {
    // Strip locale prefix (/en or /id)
    const stripped = pathname.replace(/^\/(?:en|id)/, "") || "/";

    // Exact segment match: a prefix check alone would also protect lookalike
    // routes like /rekaman or /administer, which should stay on the locale
    // catch-all 404 instead of redirecting to login.
    if (stripped === "/rekam" || stripped.startsWith("/rekam/")) return true;
    if (stripped === "/susun" || stripped.startsWith("/susun/")) return true;
    if (stripped === "/dokumen/saya" || stripped.startsWith("/dokumen/saya/")) return true;
    if (stripped === "/admin" || stripped.startsWith("/admin/")) return true;

    return false;
}

export default async function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;

    if (isProtectedPath(pathname)) {
        const sessionCookie = getSessionCookie(request);
        if (!sessionCookie) {
            const localeMatch = pathname.match(/^\/(en|id)(?:\/|$)/);
            const locale = localeMatch ? localeMatch[1] : routing.defaultLocale;
            const callbackUrl = encodeURIComponent(pathname + search);
            // Derive the public origin from inbound headers rather than
            // request.url. The app runs behind a reverse proxy/tunnel, and
            // under `next start` Next synthesizes request.url from its bind
            // hostname ("localhost") rather than the client-facing origin.
            const forwardedProto = request.headers
                .get("x-forwarded-proto")
                ?.split(",")[0]
                ?.trim()
                ?.replace(/:$/, "");
            const scheme =
                forwardedProto ||
                request.nextUrl.protocol.replace(/:$/, "") ||
                "https";
            const host =
                request.headers.get("host")?.trim() || request.nextUrl.host;

            const loginUrl = new URL(
                `/${locale}/login?callbackUrl=${callbackUrl}`,
                `${scheme}://${host}`
            );
            return NextResponse.redirect(loginUrl);
        }
    }

    return intlMiddleware(request);
}

export const config = {
    /*
     * Skip /api, Next internals, and static files. The dot rule covers
     * /THIRD-PARTY.md and the assets; `LICENSE` has no extension and is served
     * from public/, so it is named explicitly — without it the middleware
     * rewrites /LICENSE to /en/LICENSE and the licence 404s.
     */
    matcher: ["/((?!api|_next|_vercel|LICENSE|.*\\..*).*)"],
};
