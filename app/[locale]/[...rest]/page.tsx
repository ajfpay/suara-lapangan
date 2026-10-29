import { notFound } from "next/navigation";

/**
 * Anything under a locale that is not one of the three steps.
 *
 * A catch-all rather than a 404 in middleware (next-intl's error-files guide):
 * the URL is preserved, the response is a real 404, and — because this page
 * sits inside `[locale]` — `notFound()` renders `app/[locale]/not-found.tsx`
 * with the site chrome, in the reader's language.
 *
 * Deliberately dynamic: with `dynamicParams = false` the route never matches at
 * request time, so Next would answer from the root `not-found.tsx` instead — a
 * bare page outside the locale layout.
 */
export default function CatchAllPage() {
    notFound();
}
