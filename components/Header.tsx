"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Arrow, Button, cx } from "./ui";
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

const NAV: { key: NavKey; href: string }[] = [
  { key: "home", href: "/" },
  { key: "modules", href: "/modules" },
  { key: "flows", href: "/flows" },
  { key: "platform", href: "/platform" },
  { key: "architecture", href: "/architecture" },
  { key: "quality", href: "/quality" },
  { key: "segments", href: "/segments" },
  { key: "pricing", href: "/pricing" },
  { key: "spec", href: "/spec" },
];

/** The two destinations that sit beside the menu button on a wide screen. */
const INLINE: NavKey[] = ["modules", "flows"];

/**
 * The wordmark.
 *
 * Set in the display face and sheared, which is the one place the
 * reference allows itself a flourish — the mark and the name lean into
 * the reading direction together, so the logo reads as moving. The shear
 * is mirrored in RTL by the same rule that mirrors the arrow.
 */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <span className="text-a">
        <Arrow className="h-3 w-6" />
      </span>
      <span
        dir="ltr"
        className="font-display text-ink text-2xl leading-none tracking-[0.02em] italic sm:text-[1.75rem]"
      >
        TRENDOW
      </span>
    </span>
  );
}

/**
 * The bar.
 *
 * Laid out the way the reference lays it out: the menu and the shortcut
 * links on the leading side, the wordmark dead centre, the call to
 * action and the language on the trailing side. A centred wordmark is
 * the single decision that makes the arrangement read as this design
 * rather than as a default site header, because it forces the navigation
 * to the edges and leaves the middle to the brand.
 *
 * It starts transparent so the hero runs to the top of the window, and
 * takes a ground and a hairline once the page moves. Unlike the
 * reference — whose header scrolls away and never returns — this one
 * stays pinned: these pages run to fifteen thousand pixels across ten
 * destinations, where the reference has three, so the bar earns its keep.
 */
export function Header() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Any navigation closes the overlay.
  useEffect(() => setOpen(false), [pathname]);

  /**
   * Lock the page, move focus into the overlay, keep it there, and close on
   * Escape.
   *
   * The trap is the part that was missing. A dialog with `aria-modal="true"`
   * tells a screen reader that the rest of the page is inert, but it does not
   * make it so for the keyboard: without this, Tab walked straight out of the
   * menu and into the links behind it, which are covered by an opaque overlay
   * and cannot be seen. Focus would simply disappear.
   *
   * Focus is restored to whatever opened the menu on the way out, because
   * returning someone to the top of the document is its own small
   * disorientation.
   */
  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const focusable = () => {
      const root = document.getElementById("site-menu");
      if (!root) return [] as HTMLElement[];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
        // A hidden control is still in the DOM while the overlay fades.
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      // Wrap at both ends, and catch the case where focus has already escaped
      // — clicking the overlay's backdrop, for instance — by pulling it back.
      if (!active || !items.includes(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      setStuck(window.scrollY > 24);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <header
        data-accent="amber"
        className={cx(
          "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
          stuck
            ? "bg-bone/95 border-ink/12 border-b backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        {/*
          Three columns rather than a flex row with `justify-between`:
          the wordmark has to be centred on the page, not centred in
          whatever space the two navigation clusters leave behind, and
          those clusters are different widths in every language.
        */}
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-4 sm:px-10">
          {/* ---------------------- Leading ---------------------- */}
          <div className="flex items-center gap-7">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={t.nav.menu}
              className="text-ink hover:text-a flex shrink-0 flex-col gap-[5px] py-2 transition-colors"
            >
              <span aria-hidden className="block h-[2px] w-6 bg-current" />
              <span aria-hidden className="block h-[2px] w-6 bg-current" />
            </button>

            <nav className="hidden items-center gap-7 lg:flex">
              {NAV.filter((n) => INLINE.includes(n.key)).map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={cx(
                    "font-display ui-nav link-line whitespace-nowrap transition-colors",
                    isActive(n.href) ? "text-a" : "text-ink hover:text-a",
                  )}
                >
                  {t.nav[n.key]}
                </Link>
              ))}
            </nav>
          </div>

          {/* ----------------------- Centre ---------------------- */}
          <Link href="/" aria-label="TRENDOW" className="group justify-self-center">
            <Wordmark className="group-hover:opacity-80 transition-opacity" />
          </Link>

          {/* ---------------------- Trailing --------------------- */}
          <div className="flex items-center justify-end gap-5">
            <Button href="/contact" className="hidden sm:inline-flex">
              {t.nav.contact}
            </Button>

            <LangSwitch />
          </div>
        </div>
      </header>

      {/* =====================================================================
          The full-screen index.

          The nav labels are set at the size the display face was drawn
          for, because on a nine-page reference site the menu is a table
          of contents rather than a set of buttons, and it should read
          like the front of a document.
          ===================================================================== */}
      {/*
        `inert` while closed, not just transparent.

        The overlay stays mounted so it can fade, and `opacity-0` hides it
        from the eye without taking it out of the tab order — so before this,
        tabbing along the closed page walked through all ten invisible menu
        links. `inert` removes the whole subtree from focus and from the
        accessibility tree at once, which is the thing `pointer-events-none`
        only did for the mouse.
      */}
      <div
        id="site-menu"
        role="dialog"
        aria-modal="true"
        aria-label={t.nav.overlayTitle}
        inert={!open}
        className={cx(
          "fixed inset-0 z-60 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="bg-void absolute inset-0 overflow-y-auto">
          <div className="relative mx-auto w-full max-w-6xl px-6 py-4 sm:px-10">
            <div className="flex items-center justify-between gap-3 py-1">
              <Wordmark />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="border-ink/20 text-ink hover:border-a hover:text-a font-display ui-nav border px-4 py-2.5 transition-colors"
              >
                {t.nav.close}
              </button>
            </div>

            <p className="spec text-grey-400 mt-12">{t.nav.overlayTitle}</p>

            <ul className="border-ink/12 mt-6 border-t">
              {NAV.map((n, i) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={isActive(n.href) ? "page" : undefined}
                    className="border-ink/12 hover:bg-ink/4 group flex items-baseline gap-5 border-b py-4 sm:py-5"
                    style={{
                      transitionDelay: open ? `${i * 25}ms` : "0ms",
                      opacity: open ? 1 : 0,
                      transform: open ? "none" : "translateY(10px)",
                      transitionProperty: "opacity, transform, background-color",
                      transitionDuration: "420ms",
                      transitionTimingFunction: "cubic-bezier(.16,1,.3,1)",
                    }}
                  >
                    <span className="spec text-grey-400 group-hover:text-a w-8 shrink-0 tabular-nums transition-colors">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1">
                      <span
                        className={cx(
                          "font-display block text-[2rem] transition-colors sm:text-[3.25rem]",
                          isActive(n.href)
                            ? "text-a"
                            : "text-ink group-hover:text-a",
                        )}
                      >
                        {t.nav[n.key]}
                      </span>
                      <span className="text-grey-500 mt-2 block text-sm">
                        {t.nav.desc[n.key]}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="text-a opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Arrow className="h-2.5 w-5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
              <Button href="/contact">{t.nav.contact}</Button>

              <LangSwitch size="lg" />
            </div>

            <p className="spec text-grey-400 border-ink/12 mt-12 border-t pt-6 pb-10">
              {t.nav.overlayNote}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
