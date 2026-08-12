/**
 * Translation catalogues.
 *
 * Arabic is not a translation of the English here — it is authored, and in
 * several places it is the shorter and clearer of the two. Both files carry
 * the same key set; `ConsoleKey` is derived from the English one, so a key
 * added to Arabic alone will not compile and a key added to English alone
 * falls back visibly rather than rendering a dotted identifier.
 *
 * Direction is not a property of the catalogue. It comes from the active
 * locale in `lib/console/providers.tsx` and is written onto both <html> and
 * the console's own wrapper, so logical properties resolve on first paint.
 */

import { consoleEn, type ConsoleKey } from "@/content/console/en";
import { consoleAr } from "@/content/console/ar";
import type { Locale } from "@/lib/console/types";

export { consoleAr, consoleEn };
export type { ConsoleKey };

export const LOCALES = ["en", "ar"] as const;

export const catalogues: Record<Locale, Record<string, string>> = {
  en: consoleEn,
  ar: consoleAr,
};

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
};

export const dirOf = (locale: Locale): "rtl" | "ltr" => (locale === "ar" ? "rtl" : "ltr");

/**
 * Keys present in one catalogue but not the other. Used by the test suite so
 * a missing Arabic string is a failing assertion rather than an English word
 * that quietly survives into production.
 */
export function missingKeys(): { missingAr: string[]; missingEn: string[] } {
  const enKeys = Object.keys(consoleEn);
  const arKeys = Object.keys(consoleAr);
  const arSet = new Set(arKeys);
  const enSet = new Set(enKeys);
  return {
    missingAr: enKeys.filter((k) => !arSet.has(k)),
    missingEn: arKeys.filter((k) => !enSet.has(k)),
  };
}
