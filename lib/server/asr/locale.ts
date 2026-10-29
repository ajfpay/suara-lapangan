import { DEFAULT_LOCALE, LOCALES } from "@/lib/variables";

/** The session locales the ASR route accepts, taken from the app's own list. */
export type Locale = (typeof LOCALES)[number]["code"];

export const ASR_LOCALES: readonly Locale[] = LOCALES.map(({ code }) => code);

export const DEFAULT_ASR_LOCALE: Locale = DEFAULT_LOCALE;

/** Returns null for anything that is not a shipped locale, so callers must decide. */
export function parseLocale(value: unknown): Locale | null {
    return typeof value === "string" &&
        (ASR_LOCALES as readonly string[]).includes(value)
        ? (value as Locale)
        : null;
}
