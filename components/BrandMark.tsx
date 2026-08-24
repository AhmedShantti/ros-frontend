"use client";

import { useI18n } from "@/lib/i18n";
import { Container, Chip, Arrow } from "./ui";
import { Reveal } from "./motion";

/**
 * The centre of the page: the wordmark, at size, on the deepest ground
 * on the site with nothing else in the band.
 *
 * In the light system this moment was carried by five drifting colour
 * fields and a rotating ring. None of that survives here, and it does
 * not need to: at this size the display face is the effect. The band is
 * empty on purpose — it is the one place on the site that is brand
 * rather than argument, and anything else inside it would be competing.
 *
 * The wordmark is rendered as text, not as an image, so it stays crisp at
 * any zoom, is selectable, and is read correctly by a screen reader.
 */
export function BrandMark() {
  const { t } = useI18n();

  return (
    <section
      data-accent="amber"
      className="bg-void relative overflow-hidden py-28 sm:py-40"
    >
      <span
        aria-hidden
        className="bg-ink/12 pointer-events-none absolute inset-x-0 top-0 h-px"
      />

      <Container className="relative flex flex-col items-center text-center">
        <Reveal>
          <p className="spec text-a inline-flex items-center gap-2.5">
            <Arrow />
            {t.brand.kicker}
          </p>
        </Reveal>

        <Reveal delay={80}>
          {/* dir="ltr" keeps the Latin wordmark from being reordered by the
              bidi algorithm when the page is right-to-left. */}
          <p
            dir="ltr"
            className="font-display display-xl text-ink mt-10 w-full"
          >
            TRENDOW
          </p>
        </Reveal>

        <Reveal delay={150}>
          <p className="font-display text-ink mt-10 max-w-3xl text-2xl text-balance sm:text-4xl">
            {t.brand.line}
          </p>
        </Reveal>

        <Reveal delay={200}>
          <p className="text-grey-500 mx-auto mt-6 max-w-2xl text-sm leading-relaxed sm:text-base">
            {t.brand.sub}
          </p>
        </Reveal>

        <Reveal delay={260}>
          <ul className="mt-12 flex flex-wrap justify-center gap-2">
            {t.brand.marks.map((m) => (
              <li key={m}>
                <Chip>{m}</Chip>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
