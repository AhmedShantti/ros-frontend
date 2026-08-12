/**
 * Turns a schema's message key into a sentence in the active locale.
 *
 * Schemas emit keys (`validation.minLength:3`) rather than prose, so the same
 * schema can serve an Arabic form and an English one. Anything that is not a
 * recognised key is passed through untouched — a server-supplied message is
 * already a sentence and should not be mangled.
 */

import type { ConsoleKey } from "@/content/console/en";

export type Translate = (key: ConsoleKey) => string;

export function translateIssue(message: string | undefined, t: Translate): string {
  if (!message) return "";
  if (!message.startsWith("validation.")) return message;

  const [key, param] = message.split(":");
  const translated = t(key as ConsoleKey);

  // An unknown key comes back as the key itself; showing "validation.foo" to a
  // user is worse than showing the generic message.
  if (translated === key) return t("validation.invalid");

  return param === undefined ? translated : translated.replace("{n}", param);
}
