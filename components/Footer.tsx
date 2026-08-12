"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Container, Button, type Accent } from "./ui";
import { Counter, Reveal, usePrefersReducedMotion } from "./motion";
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
  | "spec"
  | "contact";

/**
 * The footer index.
 *
 * On a ten-page reference site, short columns of bare link labels are
 * close to useless — they tell you a page exists without telling you what
 * is on it. Every destination therefore carries its hue, its one-line
 * description, and enough room to read both.
 */
const INDEX: { key: NavKey; href: string; accent: Accent }[] = [
  { key: "home", href: "/", accent: "amber" },
  { key: "modules", href: "/modules", accent: "amber" },
  { key: "flows", href: "/flows", accent: "emerald" },
  { key: "platform", href: "/platform", accent: "azure" },
  { key: "architecture", href: "/architecture", accent: "azure" },
  { key: "quality", href: "/quality", accent: "violet" },
  { key: "segments", href: "/segments", accent: "rose" },
  { key: "pricing", href: "/pricing", accent: "emerald" },
  { key: "spec", href: "/spec", accent: "violet" },
  { key: "contact", href: "/contact", accent: "rose" },
];

const STAT_HUES: Accent[] = ["amber", "rose", "azure", "emerald"];

export function CtaBand() {
  const { t } = useI18n();

  return (
    <section
      data-accent="amber"
      className="field bg-cream text-ink relative overflow-hidden"
    >
      <span
        aria-hidden
        className="blob blob-a bg-amber -top-32 h-[24rem] w-[34rem]"
        style={{ insetInlineStart: "-6rem" }}
      />
      <span
        aria-hidden
        className="blob blob-c bg-rose bottom-[-10rem] h-[22rem] w-[28rem] opacity-35"
        style={{ insetInlineEnd: "-4rem" }}
      />
      <span
        aria-hidden
        className="edge-lit pointer-events-none absolute inset-x-0 top-0 h-px"
      />

      <Container className="relative py-20 sm:py-24">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <Reveal className="max-w-2xl">
            <h2 className="font-display text-ink text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-[2.6rem]">
              {t.cta.title}
            </h2>
            <p className="text-grey-600 mt-5 text-base leading-relaxed">
              {t.cta.text}
            </p>
          </Reveal>

          <Reveal delay={100} className="flex flex-wrap gap-3">
            <Button href="/contact">{t.cta.button}</Button>
            <Button href="/pricing" variant="ghost">
              {t.cta.secondary}
            </Button>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

export function Footer() {
  const { t } = useI18n();
  const reduce = usePrefersReducedMotion();

  const toTop = () =>
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });

  return (
    <footer
      data-accent="amber"
      className="bg-bone text-grey-600 border-ink/10 relative overflow-hidden border-t"
    >
      <span
        aria-hidden
        className="dot-rule pointer-events-none absolute inset-0"
      />

      <Container className="relative py-16 sm:py-20">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-20">
          {/* ---------------------- Identity ---------------------- */}
          <div>
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="text-emerald relative flex h-2 w-2">
                <span className="ping absolute inset-0 rounded-full" />
                <span className="bg-emerald relative h-2 w-2 rounded-full" />
              </span>
              <p
                dir="ltr"
                className="font-display text-ink text-xl font-bold tracking-tight"
              >
                TRENDOW
              </p>
            </div>

            <p className="text-grey-500 mt-2 text-sm">{t.footer.tagline}</p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed">
              {t.footer.built}
            </p>

            <div className="mt-8">
              <LangSwitch />
            </div>
          </div>

          {/* ------------------------ Index ----------------------- */}
          <nav aria-label={t.footer.indexTitle}>
            <p className="spec text-a">{t.footer.indexTitle}</p>

            <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
              {INDEX.map((n, i) => (
                <li key={n.href} data-accent={n.accent}>
                  <Reveal delay={Math.min(i * 35, 260)}>
                    <Link
                      href={n.href}
                      className="border-ink/8 hover:border-a group flex items-baseline gap-3 border-b py-3 transition-colors"
                    >
                      <span
                        aria-hidden
                        className="bg-a mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full opacity-40 transition-opacity group-hover:opacity-100"
                      />
                      <span className="flex-1">
                        <span className="text-ink group-hover:text-a block text-sm font-medium transition-colors">
                          {t.nav[n.key]}
                        </span>
                        <span className="text-grey-400 mt-0.5 block text-xs leading-relaxed">
                          {t.nav.desc[n.key]}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="text-a text-xs opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
                      >
                        →
                      </span>
                    </Link>
                  </Reveal>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* ---------------- What the baseline contains ---------------- */}
        <div className="border-ink/10 mt-16 border-t pt-10">
          <p className="spec text-grey-400">{t.footer.countsTitle}</p>
          <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {t.hero.stats.map((s, i) => (
              <Reveal key={s.k} delay={i * 70}>
                <div data-accent={STAT_HUES[i % STAT_HUES.length]}>
                  <p className="font-display text-a text-2xl leading-none font-semibold tabular-nums">
                    <Counter to={s.to} suffix={s.suffix} />
                  </p>
                  <p className="text-grey-500 mt-2 text-xs leading-relaxed">
                    {s.k}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* ------------------------- Bottom bar ------------------------- */}
        <div className="border-ink/10 mt-12 flex flex-col gap-4 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="spec text-grey-400" dir="ltr">
            {t.footer.docNote}
          </p>

          <div className="flex flex-wrap items-center gap-5">
            <p className="text-grey-500">© 2026 TRENDOW. {t.footer.rights}</p>
            <button
              type="button"
              onClick={toTop}
              className="text-grey-500 hover:text-a group inline-flex items-center gap-1.5 transition-colors"
            >
              <span
                aria-hidden
                className="transition-transform group-hover:-translate-y-0.5"
              >
                ↑
              </span>
              {t.footer.top}
            </button>
          </div>
        </div>
      </Container>
    </footer>
  );
}
