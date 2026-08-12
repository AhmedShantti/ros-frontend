"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cx, type Accent } from "./ui";
import { LangSwitch } from "./LangSwitch";

type NavKey =
  | "home"
  | "modules"
  | "flows"
  | "platform"
  | "architecture"
  | "quality"
  | "segments"
  | "pricing"
  | "spec";

const NAV: { key: NavKey; href: string; accent: Accent }[] = [
  { key: "home", href: "/", accent: "amber" },
  { key: "modules", href: "/modules", accent: "amber" },
  { key: "flows", href: "/flows", accent: "emerald" },
  { key: "platform", href: "/platform", accent: "azure" },
  { key: "architecture", href: "/architecture", accent: "azure" },
  { key: "quality", href: "/quality", accent: "violet" },
  { key: "segments", href: "/segments", accent: "rose" },
  { key: "pricing", href: "/pricing", accent: "emerald" },
  { key: "spec", href: "/spec", accent: "violet" },
];

/** The three destinations that stay visible in the bar on a wide screen. */
const INLINE: NavKey[] = ["modules", "flows", "platform"];

export function Header() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Any navigation closes the overlay.
  useEffect(() => setOpen(false), [pathname]);

  // Lock the page, move focus into the overlay, and close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? doc.scrollTop / scrollable : 0);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const activeAccent =
    NAV.find((n) => n.href !== "/" && isActive(n.href))?.accent ?? "amber";

  return (
    <>
      <header
        data-accent={activeAccent}
        className="pointer-events-none sticky top-0 z-50 px-4 pt-3 sm:px-6 sm:pt-4"
      >
        <div className="border-ink/10 bg-bone/80 pointer-events-auto mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-full border py-2 ps-4 pe-2 shadow-lg backdrop-blur-xl sm:ps-5">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <span aria-hidden className="text-emerald relative flex h-2 w-2">
              <span className="ping absolute inset-0 rounded-full" />
              <span className="bg-emerald relative h-2 w-2 rounded-full" />
            </span>
            <span
              dir="ltr"
              className="font-display text-ink group-hover:text-a text-base font-bold tracking-tight transition-colors sm:text-lg"
            >
              TRENDOW
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.filter((n) => INLINE.includes(n.key)).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                data-accent={n.accent}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={cx(
                  "rounded-full px-3 py-1.5 text-[0.82rem] transition-colors",
                  isActive(n.href)
                    ? "bg-a-wash text-a"
                    : "text-grey-600 hover:bg-a-wash hover:text-a",
                )}
              >
                {t.nav[n.key]}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <LangSwitch />

            <Link
              href="/contact"
              className="bg-ink text-bone hover:bg-a-deep hidden rounded-full px-4 py-2 text-[0.82rem] font-medium transition-colors sm:inline-flex"
            >
              {t.nav.contact}
            </Link>

            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="site-menu"
              className="border-ink/12 text-ink hover:border-a hover:text-a flex items-center gap-2 rounded-full border px-3.5 py-2 text-[0.82rem] transition-colors"
            >
              <span aria-hidden className="flex flex-col gap-[3px]">
                <span className="block h-[1.5px] w-3.5 bg-current" />
                <span className="block h-[1.5px] w-3.5 bg-current" />
              </span>
              {t.nav.menu}
            </button>
          </div>
        </div>

        {/* Reading progress, drawn under the capsule. */}
        <div
          aria-hidden
          className="mx-auto mt-1.5 h-[2px] w-full max-w-5xl overflow-hidden rounded-full"
        >
          <div
            className="from-amber via-rose to-violet h-full origin-[left_center] bg-linear-to-r rtl:origin-[right_center]"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </header>

      {/* ===================== Full-screen menu ====================== */}
      <div
        id="site-menu"
        role="dialog"
        aria-modal="true"
        aria-label={t.nav.overlayTitle}
        className={cx(
          "fixed inset-0 z-60 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div
          data-accent="amber"
          className="field bg-bone absolute inset-0 overflow-y-auto"
        >
          <span
            aria-hidden
            className="blob blob-a bg-amber -top-32 h-[26rem] w-[34rem]"
            style={{ insetInlineStart: "-6rem" }}
          />
          <span
            aria-hidden
            className="blob blob-b bg-violet bottom-[-8rem] h-[24rem] w-[30rem] opacity-40"
            style={{ insetInlineEnd: "-5rem" }}
          />
          <span
            aria-hidden
            className="dot-rule pointer-events-none absolute inset-0"
          />

          <div className="relative mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
            <div className="flex items-center justify-between gap-3">
              <span
                dir="ltr"
                className="font-display text-ink text-base font-bold tracking-tight sm:text-lg"
              >
                TRENDOW
              </span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="border-ink/12 text-ink hover:border-a hover:text-a rounded-full border px-4 py-2 text-[0.82rem] transition-colors"
              >
                {t.nav.close}
              </button>
            </div>

            <p className="spec text-grey-400 mt-10">{t.nav.overlayTitle}</p>

            <ul className="mt-6 grid gap-x-10 sm:grid-cols-2">
              {NAV.map((n, i) => (
                <li key={n.href} data-accent={n.accent}>
                  <Link
                    href={n.href}
                    aria-current={isActive(n.href) ? "page" : undefined}
                    className="border-ink/8 hover:border-a group flex items-baseline gap-4 border-b py-4"
                    style={{
                      transitionDelay: open ? `${i * 25}ms` : "0ms",
                      opacity: open ? 1 : 0,
                      transform: open ? "none" : "translateY(10px)",
                      transitionProperty: "opacity, transform, border-color",
                      transitionDuration: "420ms",
                      transitionTimingFunction: "cubic-bezier(.16,1,.3,1)",
                    }}
                  >
                    <span className="spec text-grey-300 group-hover:text-a tabular-nums transition-colors">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1">
                      <span
                        className={cx(
                          "font-display block text-[1.4rem] leading-tight font-semibold transition-colors sm:text-[1.75rem]",
                          isActive(n.href)
                            ? "text-a"
                            : "text-ink group-hover:text-a",
                        )}
                      >
                        {t.nav[n.key]}
                      </span>
                      <span className="text-grey-500 mt-1 block text-sm">
                        {t.nav.desc[n.key]}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="text-a opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
              <Link
                href="/contact"
                className="bg-ink text-bone hover:bg-a-deep inline-flex items-center gap-3 rounded-full px-6 py-3 text-sm font-medium transition-colors"
              >
                {t.nav.contact}
                <span className="text-grey-300 hidden text-xs sm:inline">
                  {t.nav.desc.contact}
                </span>
              </Link>

              <LangSwitch size="lg" />
            </div>

            <p className="spec text-grey-400 border-ink/8 mt-10 border-t pt-6 pb-10">
              {t.nav.overlayNote}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
