"use client";

import { useI18n } from "@/lib/i18n";
import {
  Arrow,
  Backdrop,
  Button,
  Container,
  DataTable,
  Eyebrow,
  GlowCard,
  Ordinal,
  Section,
  SectionHead,
  SpecTag,
} from "@/components/ui";
import {
  Counter,
  LitText,
  Marquee,
  PinnedStatements,
  Reveal,
  WordCycle,
} from "@/components/motion";
import { SaleCascade } from "@/components/SaleCascade";
import { DriftCalculator } from "@/components/DriftCalculator";
import { BrandMark } from "@/components/BrandMark";
import { CtaBand } from "@/components/Footer";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <>
      {/* ==============================================================
          Hero

          Full bleed, edge to edge, running under the transparent header.
          There is one object above the fold — the sentence — and it is
          set at the largest size the display face has on the site. The
          eyebrow names the thing, the sentence makes the claim, the
          orange rectangle is the only way out.
          ============================================================== */}
      <section
        data-accent="amber"
        className="bg-void text-ink relative isolate flex min-h-[100svh] flex-col justify-center overflow-hidden"
      >
        <Backdrop />

        {/*
          Centred, the way the reference is. A left-aligned hero puts the
          headline in a column and leaves the other half of the window
          empty; centring lets the sentence use the full measure, which
          is the only reason type at this size is worth setting at all.
        */}
        <Container className="relative flex flex-col items-center pt-32 pb-20 text-center sm:pt-40 sm:pb-28">
          <Reveal>
            <Eyebrow className="mb-8">{t.hero.eyebrow}</Eyebrow>
          </Reveal>

          <Reveal delay={70}>
            <h1 className="font-display display-xl text-ink max-w-[18ch] text-balance">
              {t.hero.titleA} {t.hero.titleB}
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="text-grey-600 mx-auto mt-10 max-w-2xl text-base leading-relaxed sm:text-lg">
              {t.hero.lede}
            </p>
          </Reveal>

          <Reveal delay={200}>
            <div className="mt-11 flex flex-wrap justify-center gap-8">
              <Button href="/contact">{t.hero.ctaPrimary}</Button>
              <Button href="/modules" variant="ghost">
                {t.hero.ctaSecondary}
              </Button>
            </div>
          </Reveal>

          {/* The live line. One moving thing above the fold, no more. */}
          <Reveal delay={260}>
            <p className="text-grey-500 mt-14 flex flex-wrap items-baseline justify-center gap-x-3 font-mono text-xs">
              <span aria-hidden className="text-a relative flex h-1.5 w-1.5">
                <span className="ping absolute inset-0 rounded-full" />
                <span className="bg-a relative h-1.5 w-1.5 rounded-full" />
              </span>
              <span className="spec">{t.ui.live}</span>
              <WordCycle
                words={t.hero.cycle}
                className="text-a inline-block"
              />
            </p>
          </Reveal>
        </Container>
      </section>

      {/* ==============================================================
          The integration ribbon. Names only, no claims.
          ============================================================== */}
      <div
        data-accent="amber"
        className="bg-void border-ink/12 relative border-y py-10"
      >
        <Container>
          <p className="spec text-grey-400 mb-7 text-center">
            {t.ribbon.label}
          </p>
        </Container>
        <Marquee duration={58}>
          {t.ribbon.items.map((n) => (
            <span
              key={n}
              dir="ltr"
              className="font-display text-grey-400 hover:text-a text-2xl whitespace-nowrap transition-colors sm:text-3xl"
            >
              {n}
            </span>
          ))}
        </Marquee>
      </div>

      {/* ==============================================================
          The thesis, and the four figures the site is underwritten by.
          ============================================================== */}
      <Section accent="amber" ruled={false}>
        <Reveal>
          <figure className="max-w-4xl">
            <blockquote className="font-display display-md text-ink text-balance">
              {t.hero.thesis}
            </blockquote>
            <figcaption className="mt-7">
              <SpecTag id={t.hero.thesisSpec} />
            </figcaption>
          </figure>
        </Reveal>

        {/*
          A hairline grid rather than four floating cards: these are four
          readings off one instrument, not four separate objects.

          The rules are the container showing through a one-pixel gap
          between opaque cells, which is why there is no nth-child
          arithmetic here — the grid reflows at every breakpoint and the
          dividers land correctly on their own.

          The padding has to be on both sides of a cell, not just the
          end: with `pe-6` alone the content sat flush against the
          divider on its start edge, which in Arabic put the rule through
          the first letter of every label. Padding both sides and pulling
          the grid out by the same amount keeps the first cell aligned
          with the container while giving every divider air.
        */}
        <div className="bg-ink/12 -mx-6 mt-20 grid gap-px sm:grid-cols-2 lg:grid-cols-4">
          {t.hero.stats.map((s, i) => (
            <Reveal key={s.k} delay={i * 80} className="bg-bone px-6 py-9">
              <p className="font-display text-a text-6xl leading-none sm:text-7xl">
                <Counter to={s.to} suffix={s.suffix} />
              </p>
              <p className="text-grey-500 mt-4 text-sm leading-relaxed">
                {s.k}
              </p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ==============================================================
          The sale cascade — the one argument the product rests on.
          ============================================================== */}
      <Section accent="amber" tone="wash">
        <SaleCascade />
      </Section>

      {/* ==============================================================
          The diagnosis.
          ============================================================== */}
      <Section accent="rose">
        <SectionHead
          eyebrow={t.numbers.eyebrow}
          title={t.numbers.title}
          lede={t.numbers.lede}
          note={t.numbers.note}
        />

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.numbers.items.map((n, i) => (
            <Reveal key={n.k} delay={i * 80}>
              <GlowCard className="p-7">
                <Ordinal n={i + 1} />
                <h3 className="font-display text-ink mt-6 text-2xl">
                  {n.k}
                </h3>
                <p className="text-a mt-3 font-mono text-xs" dir="ltr">
                  {n.v}
                </p>
                <p className="text-grey-600 mt-5 text-sm leading-relaxed">
                  {n.note}
                </p>
                <div className="mt-6">
                  <SpecTag id={n.spec} />
                </div>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ==============================================================
          The arithmetic.
          ============================================================== */}
      <Section accent="amber" tone="wash">
        <DriftCalculator />
      </Section>

      {/* ==============================================================
          The four commitments, one at a time.

          The pinned stack states each of them at full size and spends a
          viewport of scroll doing it; the section immediately after is
          where each one is argued. Saying it large and then explaining
          it is the shape of the whole page in miniature.
          ============================================================== */}
      <section
        data-accent="amber"
        className="bg-bone border-ink/12 relative border-t"
      >
        <Container className="relative pt-24 sm:pt-32">
          <Reveal>
            <Eyebrow>{t.diff.eyebrow}</Eyebrow>
          </Reveal>
        </Container>

        <PinnedStatements items={t.diff.items.map((d) => d.n)} />
      </section>

      <Section accent="violet" ruled={false}>
        <Reveal>
          <p className="text-grey-600 max-w-2xl text-base leading-relaxed">
            {t.diff.lede}
          </p>
        </Reveal>

        <h2 className="sr-only">{t.diff.title}</h2>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {t.diff.items.map((d, i) => (
            <Reveal key={d.n} delay={i * 80}>
              <GlowCard className="p-8">
                <div className="mb-6 flex flex-wrap items-center gap-4">
                  <Ordinal n={i + 1} />
                  <SpecTag id={d.spec} />
                </div>
                <h3 className="font-display text-ink text-2xl">
                  {d.n}
                </h3>
                <p className="text-grey-600 mt-5 text-sm leading-relaxed">
                  {d.text}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ==============================================================
          The wordmark, centred.
          ============================================================== */}
      <BrandMark />

      {/* ==============================================================
          The competitive landscape, on the inverted plate.

          A wide comparison matrix is the one thing on this site that is
          genuinely easier to read as dark type on a light ground, so
          this is the band that flips.
          ============================================================== */}
      <Section accent="rose" tone="cream">
        <SectionHead
          eyebrow={t.compare.eyebrow}
          title={t.compare.title}
          lede={t.compare.lede}
        />
        <Reveal className="mt-14">
          <DataTable
            head={t.compare.cols}
            firstColLabel={t.compare.firstCol}
            rows={t.compare.rows}
          />
        </Reveal>
      </Section>

      {/* ==============================================================
          The modules — the first six.

          Three across, two rows, and then out to the modules page for
          the rest. Seventeen cards at three to a row is six rows and
          most of a screen and a half, which buys the homepage nothing:
          the point of the section is that there are seventeen of them
          working off one transaction, and the count in the eyebrow
          already says so. The page they link to carries all of them,
          grouped, with their requirement points.
          ============================================================== */}
      <Section accent="azure">
        <SectionHead
          eyebrow={t.modules.eyebrow}
          title={t.modules.title}
          lede={t.modules.lede}
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.modules.items.slice(0, 6).map((m, i) => (
            <Reveal key={m.id} delay={Math.min(i * 35, 300)}>
              <GlowCard href={`/modules#${m.id}`} className="p-5">
                <div className="flex items-start justify-between gap-2.5">
                  <h3 className="font-display text-ink group-hover:text-a text-lg transition-colors">
                    {m.name}
                  </h3>
                  <SpecTag id={m.spec} />
                </div>
                <p className="text-grey-600 mt-3.5 text-[0.8125rem] leading-relaxed">
                  {m.line}
                </p>
                <span className="text-a mt-5 inline-flex items-center gap-2">
                  <Arrow />
                </span>
              </GlowCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={140} className="mt-12 flex justify-center">
          <Button href="/modules" variant="ghost">
            {t.hero.ctaSecondary}
          </Button>
        </Reveal>
      </Section>

      {/* ==============================================================
          Unit economics.

          The lede here is the one paragraph on the page that is set to
          be read rather than scanned, so it lights up a word at a time
          as the section is crossed.
          ============================================================== */}
      <Section accent="emerald" tone="wash">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-20">
          <div>
            <Reveal>
              <Eyebrow className="mb-6">{t.economics.eyebrow}</Eyebrow>
            </Reveal>
            <Reveal delay={60}>
              <h2 className="font-display display-md text-ink text-balance">
                {t.economics.title}
              </h2>
            </Reveal>

            <LitText
              text={t.economics.lede}
              className="mt-8 max-w-2xl text-lg leading-relaxed"
            />

            <Reveal delay={140}>
              <div className="border-a bg-a-wash mt-12 border p-6">
                <p className="spec text-a">{t.economics.riskLabel}</p>
                <p className="text-grey-600 mt-3 text-sm leading-relaxed">
                  {t.economics.riskText}
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={100} kind="right" className="h-fit">
            <div className="border-ink/12 bg-paper border p-7">
              <dl className="divide-ink/10 divide-y">
                {t.economics.items.map((e) => (
                  <div
                    key={e.k}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 first:pt-0 last:pb-0"
                  >
                    <dt className="text-grey-600 text-sm">{e.k}</dt>
                    <dd className="text-a font-mono text-sm tabular-nums">
                      {e.v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ==============================================================
          The segments.
          ============================================================== */}
      <Section accent="violet">
        <SectionHead
          eyebrow={t.segments.eyebrow}
          title={t.segments.title}
          lede={t.segments.lede}
        />

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.segments.items.map((s, i) => (
            <Reveal key={s.tag} delay={i * 80}>
              <GlowCard href="/segments" className="p-7">
                <span className="font-display text-a border-a flex h-11 w-11 items-center justify-center border text-lg">
                  {s.tag}
                </span>
                <h3 className="font-display text-ink mt-6 text-xl">
                  {s.name}
                </h3>
                <p className="text-grey-600 mt-4 text-sm leading-relaxed">
                  {s.profile}
                </p>
                <p className="text-a mt-6 font-mono text-xs">{s.price}</p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
