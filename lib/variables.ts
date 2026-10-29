/**
 * Environment
 */
export const ENV = process.env.NODE_ENV;

/**
 * Canonical origin, used for metadataBase, canonicals, hreflang, the sitemap,
 * robots and JSON-LD. Read from the environment so a preview or a future
 * domain does not need a code change, and so those deployments stop
 * advertising the production URL as their canonical. No trailing slash.
 */
export const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://suara-lapangan.vercel.app"
).replace(/\/$/, "");

export const APP_NAME = "Suara Lapangan";

/**
 * API endpoints
 */
export const GENERATE_PDF_API = "/api/invoice/generate";
export const WARM_BROWSER_API = "/api/invoice/warm";

/**
 * I18N
 *
 * Only the two locales this app ships. `DEFAULT_LOCALE` is English; the app
 * is built for both the Indonesian field user and the English-speaking
 * contractor, and English is the fallback every message key is written in.
 */
export const LOCALES = [
  { code: "en", name: "English" },
  { code: "id", name: "Bahasa Indonesia" },
] as const;

export const DEFAULT_LOCALE = "en";

/**
 * Writing direction per locale. Neither shipped locale is right-to-left, but
 * the direction is derived rather than assumed so the attribute never lies.
 */
export const RTL_LOCALES = new Set<string>([]);

export const dirForLocale = (locale: string): "rtl" | "ltr" =>
  RTL_LOCALES.has(locale) ? "rtl" : "ltr";
