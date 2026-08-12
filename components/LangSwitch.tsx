"use client";

import { useI18n, type Lang } from "@/lib/i18n";
import { cx } from "./ui";

/**
 * A segmented language switch rather than a single toggle.
 *
 * One label cannot say whether it names the language you are in or the
 * one you would move to, and users guess wrong about half the time. Two
 * options with the current one marked removes the question entirely.
 *
 * The option labels are the language names in their own scripts, so they
 * are identical in both interfaces and are not part of the dictionary.
 */
export function LangSwitch({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { t, lang, setLang } = useI18n();

  const options: { code: Lang; short: string; full: string }[] = [
    { code: "ar", short: "AR", full: "العربية" },
    { code: "en", short: "EN", full: "English" },
  ];

  return (
    <div
      role="group"
      aria-label={t.nav.langAria}
      className={cx(
        "border-ink/12 flex items-center rounded-full border",
        size === "lg" ? "gap-1 p-1" : "gap-0.5 p-0.5",
      )}
    >
      {options.map((o) => {
        const active = lang === o.code;
        return (
          <button
            key={o.code}
            type="button"
            lang={o.code}
            aria-pressed={active}
            onClick={() => setLang(o.code)}
            className={cx(
              "rounded-full font-medium transition-colors",
              size === "lg"
                ? "px-4 py-2 text-sm"
                : "px-2.5 py-1 text-[0.7rem] tracking-wide",
              active
                ? "bg-a-wash text-a"
                : "text-grey-400 hover:text-a hover:bg-a-wash/60",
            )}
          >
            {size === "lg" ? o.full : o.short}
          </button>
        );
      })}
    </div>
  );
}
