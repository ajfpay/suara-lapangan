import type { AbstractIntlMessages } from "next-intl";

import enMessages from "@/i18n/locales/en.json";
import { DEFAULT_LOCALE } from "@/lib/variables";

/**
 * Loads a locale's messages.
 *
 * Every locale must be complete: next-intl renders an error for a missing key
 * rather than falling back, so a half-translated catalogue is a broken page,
 * not a cosmetic gap. `npm run check:i18n` enforces parity against `en.json`.
 */
export async function getMessages(
    locale: string
): Promise<AbstractIntlMessages> {
    if (locale === DEFAULT_LOCALE) {
        return enMessages as AbstractIntlMessages;
    }

    const localeMessages = (await import(`@/i18n/locales/${locale}.json`))
        .default as AbstractIntlMessages;

    return localeMessages;
}
