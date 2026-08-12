"use client";

/**
 * Chrome for the sign-in and MFA screens: wordmark, the two per-device
 * preferences, and a centred card. No navigation — there is no session yet.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/console/providers";
import { LanguageToggle, ThemeToggle } from "./switchers";

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="bg-accent text-accent-fg flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs font-semibold">
            R
          </span>
          <span>
            <span className="text-fg block text-sm font-semibold">{t("app.name")}</span>
            <span className="text-fg-subtle block text-[0.65rem]">{t("app.console")}</span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="text-fg-subtle px-4 py-5 text-center text-xs sm:px-6">
        {t("app.subtitle")}
      </footer>
    </div>
  );
}
