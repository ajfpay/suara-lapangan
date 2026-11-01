import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware(routing);

function isProtectedPath(pathname: string): boolean {
    // Strip locale prefix (/en or /id)
    const stripped = pathname.replace(/^\/(?:en|id)/, "") || "/";

    if (stripped.startsWith("/rekam")) return true;
    if (stripped.startsWith("/susun")) return true;
    if (stripped.startsWith("/dokumen/saya")) return true;
    if (stripped.startsWith("/admin")) return true;

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
            const loginUrl = new URL(
                `/${locale}/login?callbackUrl=${callbackUrl}`,
                request.url
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
