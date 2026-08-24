"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Container, Button, Arrow } from "./ui";
import { Counter, Reveal, usePrefersReducedMotion } from "./motion";

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

const INDEX: { key: NavKey; href: string }[] = [
  { key: "home", href: "/" },
  { key: "modules", href: "/modules" },
  { key: "flows", href: "/flows" },
  { key: "platform", href: "/platform" },
  { key: "architecture", href: "/architecture" },
  { key: "quality", href: "/quality" },
  { key: "segments", href: "/segments" },
  { key: "pricing", href: "/pricing" },
  { key: "spec", href: "/spec" },
  { key: "contact", href: "/contact" },
];

/**
 * The shards behind the footer's leading corner.
 *
 * The reference puts a large angular graphic in that corner, barely
 * above the ground — a few degrees of contrast, no colour. It reads as
 * texture rather than as an image, which is the only reason a flat dark
 * footer this tall does not go dead. Drawn rather than placed, so it
 * costs nothing and mirrors with the reading direction.
 */
function Shards() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 420 520"
      preserveAspectRatio="xMinYMin slice"
      className="text-ink pointer-events-none absolute inset-y-0 start-0 h-full w-[28rem] rtl:-scale-x-100"
      fill="currentColor"
    >
      <g>
        <path d="M-40 -30 L250 -30 L20 250Z" opacity=".05" />
        <path d="M-40 90 L150 -30 L-10 330Z" opacity=".04" />
        <path d="M60 -30 L330 -30 L120 190Z" opacity=".03" />
        <path d="M-40 210 L90 -30 L-40 420Z" opacity=".035" />
      </g>
    </svg>
  );
}

/** The wordmark: the mark, then the name, sheared into the reading direction. */
function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="text-a">
        <Arrow className={size === "lg" ? "h-3.5 w-7" : "h-3 w-6"} />
      </span>
      <span
        dir="ltr"
        className={`font-display text-ink leading-none tracking-[0.02em] italic ${
          size === "lg" ? "text-3xl" : "text-2xl"
        }`}
      >
        TRENDOW
      </span>
    </span>
  );
}

/**
 * The closing argument, on the inverted plate.
 *
 * It is the one band on every page that flips to near-white, and it is
 * placed immediately before the footer so the site ends on a change of
 * ground rather than fading out into more of the same dark.
 */
export function CtaBand() {
  const { t } = useI18n();

  return (
    <section
      data-accent="amber"
      data-tone="light"
      className="bg-cream text-ink relative overflow-hidden"
    >
      <Container className="relative py-24 sm:py-32">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-end lg:justify-between">
          <Reveal className="max-w-3xl">
            <h2 className="font-display display-md text-ink text-balance">
              {t.cta.title}
            </h2>
            <p className="text-grey-600 mt-6 max-w-xl text-base leading-relaxed">
              {t.cta.text}
            </p>
          </Reveal>

          <Reveal delay={100} className="flex flex-wrap gap-8">
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

/**
 * The footer, arranged the way the reference arranges it.
 *
 * The destinations are the whole middle of it, set centred at display
 * size — not a column of link labels off to one side. Two facts flank
 * that stack, each a small grey label over a value. Then a hairline, and
 * a bottom bar with the wordmark centred inside it.
 *
 * The reference carries three destinations and can afford ninety-four
 * pixels apiece. Ten will not take that, so the stack steps down to a
 * size that still reads as the same gesture, and each row keeps its
 * one-line description — on a ten-page reference site the footer is a
 * table of contents, and a bare label does not say what is on a page.
 */
export function Footer() {
  const { t } = useI18n();
  const reduce = usePrefersReducedMotion();

  const toTop = () =>
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });

  return (
    <footer
      data-accent="amber"
      className="bg-void text-grey-600 relative overflow-hidden"
    >
      <Shards />

      <Container className="relative py-20 sm:py-28">
        {/* ==============================================================
            The index, centred, with a fact on either side.
            ============================================================== */}
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start lg:gap-10">
          {/* --------------------- Leading fact -------------------- */}
          <Reveal className="lg:pt-28 lg:text-end">
            <p className="font-display ui-label text-grey-400">
              {t.footer.countsTitle}
            </p>
            <p className="font-display ui-value text-ink mt-3">
              <Counter to={t.hero.stats[0].to} />
              {" / "}
              <Counter to={t.hero.stats[1].to} />
            </p>
            <p className="text-grey-500 mt-2.5 text-xs leading-relaxed lg:ms-auto lg:max-w-[14rem]">
              {t.footer.tagline}
            </p>
          </Reveal>

          {/* ------------------------- Index ----------------------- */}
          <nav
            aria-label={t.footer.indexTitle}
            className="order-first lg:order-none"
          >
            <ul className="flex flex-col items-center">
              {INDEX.map((n, i) => (
                <li key={n.href}>
                  <Reveal delay={Math.min(i * 30, 240)}>
                    <Link href={n.href} className="group block py-1.5 text-center">
                      <span className="font-display text-ink group-hover:text-a block text-[2.25rem] transition-colors sm:text-[3.25rem]">
                        {t.nav[n.key]}
                      </span>
                      <span className="text-grey-500 group-hover:text-grey-400 mt-1 block text-xs leading-relaxed transition-colors">
                        {t.nav.desc[n.key]}
                      </span>
                    </Link>
                  </Reveal>
                </li>
              ))}
            </ul>
          </nav>

          {/* -------------------- Trailing fact -------------------- */}
          <Reveal delay={120} className="lg:pt-28">
            <p className="font-display ui-label text-grey-400">
              {t.nav.contact}
            </p>
            <Link
              href="/contact"
              className="font-display ui-value text-ink hover:text-a mt-3 block transition-colors"
            >
              {t.cta.button}
            </Link>
            <p className="text-grey-500 mt-2.5 text-xs leading-relaxed lg:max-w-[14rem]">
              {t.nav.desc.contact}
            </p>
          </Reveal>
        </div>

        {/* ==============================================================
            The rule, then the bottom bar with the wordmark centred.
            ============================================================== */}
        <div className="border-ink/12 mt-20 border-t pt-8 sm:mt-24">
          {/* The document reference gets its own line. The reference site
              puts a VAT number here and it fits beside the copyright at
              display size; this one is a sentence, and at 22px in the
              display face it wraps the bottom bar onto two ragged rows. */}
          <p className="spec text-grey-400 mb-8 text-center" dir="ltr">
            {t.footer.docNote}
          </p>

          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <p className="font-display ui-small text-ink">© 2026 TRENDOW</p>

            <span className="justify-self-center">
              <Wordmark />
            </span>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:justify-end">
              <p className="font-display ui-small text-grey-400">
                {t.footer.rights}
              </p>

              <button
                type="button"
                onClick={toTop}
                className="font-display ui-small text-ink hover:text-a group inline-flex items-center gap-2 transition-colors"
              >
                {/* Drawn upright rather than rotated: the arrow mark is
                    mirrored in RTL by its own class, and a rotation on
                    top of that produced a shape that read as neither an
                    arrow nor a chevron. */}
                <svg
                  viewBox="0 0 10 12"
                  aria-hidden
                  className="h-3 w-2.5 shrink-0 transition-transform group-hover:-translate-y-0.5"
                  fill="none"
                >
                  <path d="M5 12V1.6" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M0.6 5.4 5 0.8 9.4 5.4Z" fill="currentColor" />
                </svg>
                {t.footer.top}
              </button>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
