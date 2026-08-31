"use client";

/**
 * Chrome for the sign-in and MFA screens.
 *
 * Split-screen: the brand panel states what the product is, the right-hand
 * column holds the form. No navigation — there is no session yet, so the only
 * things offered are the two preferences that are per-device rather than
 * per-account (language and theme), and a way back to the public site.
 *
 * The brand panel collapses below `lg` rather than stacking above the form.
 * On a phone the form is the entire job, and pushing it below a full screen
 * of marketing is how a sign-in becomes a scroll.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ShieldCheck, WifiOff, Languages } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { LanguageToggle, ThemeToggle } from "./switchers";

/** Three claims, each one a requirement rather than a slogan. */
const POINTS = [
  { icon: WifiOff, key: "auth.pointOffline" },
  { icon: Languages, key: "auth.pointArabic" },
  { icon: ShieldCheck, key: "auth.pointAudit" },
] as const;

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  /*
   * Sign-in is four controls; signing up is eleven. Pouring the second into
   * a 28rem column makes a form that is mostly scrolling — so that one page
   * gets a wider column and lays its fields out two at a time, and the brand
   * panel gives up the space rather than the form.
   *
   * The route decides rather than a prop, because the layout renders this
   * shell for every auth page and has no idea which one it is holding.
   */
  const wide = pathname === "/signup";

  return (
    <div
      className={
        wide
          ? "lg:grid lg:min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,48rem)]"
          : "lg:grid lg:min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]"
      }
    >
      {/* ------------------------- Brand panel ------------------------- */}
      <aside className="bg-sunken border-line relative hidden overflow-hidden border-e lg:flex lg:flex-col lg:justify-between lg:p-10">
        {/* Two soft washes, so the panel is not a flat block of colour. */}
        <span
          aria-hidden
          className="bg-accent pointer-events-none absolute -top-32 h-[26rem] w-[26rem] rounded-full opacity-[0.13] blur-3xl"
          style={{ insetInlineStart: "-6rem" }}
        />
        <span
          aria-hidden
          className="bg-good pointer-events-none absolute -bottom-40 h-[24rem] w-[24rem] rounded-full opacity-[0.11] blur-3xl"
          style={{ insetInlineEnd: "-5rem" }}
        />

        <Link href="/" className="relative flex items-center gap-2.5">
          <span aria-hidden className="bg-good h-2 w-2 rounded-full" />
          <span
            dir="ltr"
            className="text-fg text-lg font-bold tracking-tight"
          >
            {t("app.name")}
          </span>
        </Link>

        <div className="relative max-w-md">
          <p className="text-fg text-2xl leading-snug font-semibold text-balance">
            {t("auth.brandLine")}
          </p>
          <p className="text-fg-muted mt-4 text-sm leading-relaxed">
            {t("auth.brandSub")}
          </p>

          <ul className="mt-8 space-y-3.5">
            {POINTS.map((point) => (
              <li key={point.key} className="flex items-start gap-3">
                <span className="bg-accent-soft text-accent mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                  <point.icon size={14} aria-hidden />
                </span>
                <span className="text-fg-muted text-sm leading-relaxed">
                  {t(point.key)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-fg-subtle relative font-mono text-[0.68rem]" dir="ltr">
          {t("auth.docNote")}
        </p>
      </aside>

      {/* ---------------------------- Form ----------------------------- */}
      <div className="flex min-h-screen flex-col lg:min-h-0">
        <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          {/* The wordmark repeats here because the brand panel is hidden
              below lg, and a sign-in with no name on it is unnerving. */}
          <Link href="/" className="flex items-center gap-2.5 lg:hidden">
            <span aria-hidden className="bg-good h-2 w-2 rounded-full" />
            <span dir="ltr" className="text-fg text-base font-bold tracking-tight">
              {t("app.name")}
            </span>
          </Link>

          <Link
            href="/"
            className="text-fg-subtle hover:text-fg hidden items-center gap-1.5 text-xs transition-colors lg:inline-flex"
          >
            <ArrowLeft size={13} aria-hidden className="rtl:rotate-180" />
            {t("auth.backToSite")}
          </Link>

          <div className="flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6">
          <div className={wide ? "w-full max-w-2xl" : "w-full max-w-md"}>
            <p className="text-fg-subtle mb-4 text-xs lg:hidden">
              {t("app.console")}
            </p>
            {children}
          </div>
        </main>

        <footer className="text-fg-subtle px-4 py-5 text-center text-xs sm:px-6">
          {t("app.subtitle")}
        </footer>
      </div>
    </div>
  );
}
