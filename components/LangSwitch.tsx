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
        "border-ink/20 flex items-center border",
        size === "lg" ? "gap-1 p-1" : "gap-px p-px",
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
              "font-display transition-colors",
              size === "lg" ? "ui-nav px-5 py-2.5" : "ui-small px-2.5 py-1.5",
              active
                ? "bg-amber text-void"
                : "text-grey-400 hover:text-ink hover:bg-ink/8",
            )}
          >
            {size === "lg" ? o.full : o.short}
          </button>
        );
      })}
    </div>
  );
}
