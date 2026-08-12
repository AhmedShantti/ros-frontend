"use client";

import { useI18n } from "@/lib/i18n";
import { Container, Chip, type Accent } from "./ui";
import { Reveal, useParallax } from "./motion";

const MARK_HUES: Accent[] = ["amber", "emerald", "azure", "violet", "rose"];

/**
 * The centre of the page: the wordmark, at size, with the whole colour
 * system lit behind it. It is the one moment on the site that is purely
 * brand rather than argument, which is why it gets a full band to itself
 * and nothing competes with it inside that band.
 *
 * The wordmark is rendered as text, not as an image, so it stays crisp at
 * any zoom, is selectable, and is read correctly by a screen reader.
 */
export function BrandMark() {
  const { t } = useI18n();
  const ring = useParallax<HTMLSpanElement>(0.06);

  return (
    <section
      data-accent="amber"
      className="field bg-bone relative overflow-hidden py-24 sm:py-32"
    >
      {/* The colour field. Five blobs, one per hue, drifting slowly. */}
      <span
        aria-hidden
        className="blob blob-a bg-amber top-[-6rem] h-[26rem] w-[34rem]"
        style={{ insetInlineStart: "-6rem" }}
      />
      <span
        aria-hidden
        className="blob blob-b bg-violet top-[2rem] h-[22rem] w-[28rem] opacity-40"
        style={{ insetInlineEnd: "-4rem" }}
      />
      <span
        aria-hidden
        className="blob blob-c bg-emerald bottom-[-8rem] h-[24rem] w-[30rem] opacity-35"
        style={{ insetInlineStart: "28%" }}
      />

      {/* A slowly rotating ring, sitting behind the wordmark. */}
      <span
        ref={ring}
        aria-hidden
        className="pointer-events-none absolute start-1/2 top-1/2 -ms-[22rem] -mt-[22rem] h-[44rem] w-[44rem]"
      >
        <span className="spin-slow border-amber/25 absolute inset-0 rounded-full border border-dashed" />
        <span className="spin-slow border-violet/20 absolute inset-[4rem] rounded-full border" />
      </span>

      <span
        aria-hidden
        className="dot-rule pointer-events-none absolute inset-0"
      />

      <Container className="relative text-center">
        <Reveal>
          <p className="spec text-a inline-flex items-center gap-2">
            <span aria-hidden className="bg-a h-1.5 w-1.5 rounded-full" />
            {t.brand.kicker}
          </p>
        </Reveal>

        <Reveal delay={80} kind="scale">
          {/* dir="ltr" keeps the Latin wordmark from being reordered by the
              bidi algorithm when the page is right-to-left. */}
          <p
            dir="ltr"
            className="font-display sheen mt-7 text-[3.25rem] leading-[0.95] font-bold tracking-[-0.045em] sm:text-[6rem] lg:text-[8rem]"
          >
            TRENDOW
          </p>
        </Reveal>

        <Reveal delay={150}>
          <p className="font-display text-ink mx-auto mt-8 max-w-2xl text-lg leading-snug font-medium text-balance sm:text-2xl">
            {t.brand.line}
          </p>
        </Reveal>

        <Reveal delay={200}>
          <p className="text-grey-600 mx-auto mt-5 max-w-2xl text-sm leading-relaxed sm:text-base">
            {t.brand.sub}
          </p>
        </Reveal>

        <Reveal delay={260}>
          <ul className="mt-10 flex flex-wrap justify-center gap-2.5">
            {t.brand.marks.map((m, i) => (
              <li key={m}>
                <Chip accent={MARK_HUES[i % MARK_HUES.length]}>{m}</Chip>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
