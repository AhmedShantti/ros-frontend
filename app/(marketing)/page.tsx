"use client";

import { useI18n } from "@/lib/i18n";
import {
  Button,
  Container,
  DataTable,
  Eyebrow,
  GlowCard,
  Ordinal,
  Section,
  SectionHead,
  SpecTag,
  type Accent,
} from "@/components/ui";
import {
  Counter,
  Marquee,
  Reveal,
  WordCycle,
  useParallax,
} from "@/components/motion";
import { SaleCascade } from "@/components/SaleCascade";
import { DriftCalculator } from "@/components/DriftCalculator";
import { BrandMark } from "@/components/BrandMark";
import { CtaBand } from "@/components/Footer";

/** The four diagnostic numbers, the four differentiators and the four
 *  segments each get their own hue so the page reads as sections rather
 *  than as one long column of cards. */
const NUMBER_HUES: Accent[] = ["amber", "rose", "azure", "emerald"];
const DIFF_HUES: Accent[] = ["violet", "azure", "emerald", "amber"];
const SEGMENT_HUES: Accent[] = ["amber", "emerald", "azure", "violet"];
const MODULE_HUES: Accent[] = ["amber", "emerald", "azure", "violet", "rose"];

export default function HomePage() {
  const { t } = useI18n();
  const blob1 = useParallax<HTMLSpanElement>(0.12);
  const blob2 = useParallax<HTMLSpanElement>(-0.08);

  return (
    <>
      {/* ============================ Hero ============================ */}
      <section
        data-accent="amber"
        className="field bg-bone text-ink relative overflow-hidden"
      >
        <span
          ref={blob1}
          aria-hidden
          className="blob blob-a bg-amber -top-48 h-[30rem] w-[42rem]"
          style={{ insetInlineStart: "-10rem" }}
        />
        <span
          ref={blob2}
          aria-hidden
          className="blob blob-b bg-violet top-10 h-[26rem] w-[34rem] opacity-35"
          style={{ insetInlineEnd: "-8rem" }}
        />
        <span
          aria-hidden
          className="blob blob-c bg-emerald top-[36rem] h-[24rem] w-[30rem] opacity-25"
          style={{ insetInlineStart: "30%" }}
        />
        <span
          aria-hidden
          className="grid-rule pointer-events-none absolute inset-0"
        />

        <Container className="relative py-20 sm:py-28">
          <div className="max-w-4xl">
            <Reveal>
              <Eyebrow className="mb-6">{t.hero.eyebrow}</Eyebrow>
            </Reveal>

            <Reveal delay={70}>
              <h1 className="font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance sm:text-[3.5rem]">
                <span className="text-grey-400">{t.hero.titleA} </span>
                <span className="text-ink">{t.hero.titleB}</span>{" "}
                <span className="sheen">{t.hero.titleC}</span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="text-grey-500 mt-6 flex flex-wrap items-baseline gap-x-2 font-mono text-sm">
                <span aria-hidden className="bg-emerald h-1.5 w-1.5 rounded-full" />
                <span>{t.ui.live}</span>
                <span aria-hidden>·</span>
                <WordCycle
                  words={t.hero.cycle}
                  className="text-amber-deep inline-block font-medium"
                />
              </p>
            </Reveal>

            <Reveal delay={170}>
              <p className="text-grey-600 mt-6 max-w-2xl text-base leading-relaxed sm:text-lg">
                {t.hero.lede}
              </p>
            </Reveal>

            <Reveal delay={220}>
              <div className="mt-9 flex flex-wrap gap-3">
                <Button href="/contact">{t.hero.ctaPrimary}</Button>
                <Button href="/modules" variant="ghost">
                  {t.hero.ctaSecondary}
                </Button>
              </div>
            </Reveal>
          </div>

          {/* The four figures the whole site is underwritten by */}
          <div className="border-ink/10 mt-16 grid gap-x-8 gap-y-8 border-t pt-10 sm:grid-cols-2 lg:grid-cols-4">
            {t.hero.stats.map((s, i) => (
              <Reveal key={s.k} delay={i * 80}>
                <div data-accent={NUMBER_HUES[i]}>
                  <p className="font-display text-a text-3xl leading-none font-semibold tabular-nums sm:text-4xl">
                    <Counter to={s.to} suffix={s.suffix} />
                  </p>
                  <p className="text-grey-500 mt-2.5 text-sm leading-relaxed">
                    {s.k}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* The thesis */}
          <Reveal delay={100}>
            <figure className="border-amber my-16 border-s-2 ps-6">
              <blockquote className="font-display text-ink max-w-2xl text-lg leading-snug sm:text-2xl">
                {t.hero.thesis}
              </blockquote>
              <figcaption className="mt-4">
                <SpecTag id={t.hero.thesisSpec} />
              </figcaption>
            </figure>
          </Reveal>

          <SaleCascade />
        </Container>

        {/* Integration ribbon */}
        <div className="border-ink/10 relative border-t py-8">
          <Container>
            <p className="spec text-grey-400 mb-5 text-center">
              {t.ribbon.label}
            </p>
          </Container>
          <Marquee duration={58}>
            {t.ribbon.items.map((n) => (
              <span
                key={n}
                dir="ltr"
                className="text-grey-400 font-display hover:text-amber-deep text-lg whitespace-nowrap transition-colors sm:text-xl"
              >
                {n}
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      {/* ======================== Four numbers ======================== */}
      <Section accent="rose" tone="cream">
        <SectionHead
          eyebrow={t.numbers.eyebrow}
          title={t.numbers.title}
          lede={t.numbers.lede}
          note={t.numbers.note}
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.numbers.items.map((n, i) => (
            <Reveal key={n.k} delay={i * 80}>
              <GlowCard accent={NUMBER_HUES[i]} tilt className="p-6">
                <Ordinal n={i + 1} />
                <h3 className="font-display text-ink mt-4 text-lg font-semibold">
                  {n.k}
                </h3>
                <p className="text-a mt-1.5 font-mono text-xs" dir="ltr">
                  {n.v}
                </p>
                <p className="text-grey-600 mt-3.5 text-sm leading-relaxed">
                  {n.note}
                </p>
                <div className="mt-4">
                  <SpecTag id={n.spec} />
                </div>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ====================== Drift calculator ====================== */}
      <Section accent="amber" tone="wash" ruled="grid">
        <DriftCalculator />
      </Section>

      {/* ====================== Differentiators ======================= */}
      <Section accent="violet">
        <SectionHead
          eyebrow={t.diff.eyebrow}
          title={t.diff.title}
          lede={t.diff.lede}
        />

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {t.diff.items.map((d, i) => (
            <Reveal key={d.n} delay={i * 80} kind={i % 2 ? "right" : "left"}>
              <GlowCard accent={DIFF_HUES[i]} className="p-7">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Ordinal n={i + 1} />
                  <SpecTag id={d.spec} />
                </div>
                <h3 className="font-display text-ink text-xl leading-snug font-semibold">
                  {d.n}
                </h3>
                <p className="text-grey-600 mt-3.5 text-sm leading-relaxed">
                  {d.text}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ===================== The wordmark, centred ================== */}
      <BrandMark />

      {/* ==================== Competitive landscape =================== */}
      <Section accent="rose" tone="wash">
        <SectionHead
          eyebrow={t.compare.eyebrow}
          title={t.compare.title}
          lede={t.compare.lede}
        />
        <Reveal className="mt-12">
          <DataTable
            head={t.compare.cols}
            firstColLabel={t.compare.firstCol}
            rows={t.compare.rows}
          />
        </Reveal>
      </Section>

      {/* ===================== Modules preview ======================== */}
      <Section accent="azure">
        <SectionHead
          eyebrow={t.modules.eyebrow}
          title={t.modules.title}
          lede={t.modules.lede}
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.modules.items.map((m, i) => (
            <Reveal key={m.id} delay={Math.min(i * 40, 320)}>
              <GlowCard
                href={`/modules#${m.id}`}
                accent={MODULE_HUES[i % MODULE_HUES.length]}
                className="p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-ink group-hover:text-a text-base font-semibold transition-colors">
                    {m.name}
                  </h3>
                  <SpecTag id={m.spec} />
                </div>
                <p className="text-grey-600 mt-2.5 text-sm leading-relaxed">
                  {m.line}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ======================= Unit economics ======================= */}
      <Section accent="emerald" tone="cream">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
          <div>
            <SectionHead
              eyebrow={t.economics.eyebrow}
              title={t.economics.title}
              lede={t.economics.lede}
            />
            <Reveal delay={140}>
              <div
                data-accent="rose"
                className="border-a bg-a-wash mt-10 rounded-xl border p-5"
              >
                <p className="spec text-a">{t.economics.riskLabel}</p>
                <p className="text-grey-600 mt-2.5 text-sm leading-relaxed">
                  {t.economics.riskText}
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={100} kind="right" className="h-fit">
            <div className="bg-paper border-ink/10 rounded-2xl border p-6 shadow-sm">
              <dl className="divide-ink/8 divide-y">
                {t.economics.items.map((e) => (
                  <div
                    key={e.k}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5 first:pt-0 last:pb-0"
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

      {/* ====================== Segments preview ====================== */}
      <Section accent="violet" tone="wash">
        <SectionHead
          eyebrow={t.segments.eyebrow}
          title={t.segments.title}
          lede={t.segments.lede}
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.segments.items.map((s, i) => (
            <Reveal key={s.tag} delay={i * 80} kind="scale">
              <GlowCard
                href="/segments"
                accent={SEGMENT_HUES[i]}
                tilt
                className="p-6"
              >
                <span className="bg-a-wash text-a font-display border-a flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold">
                  {s.tag}
                </span>
                <h3 className="font-display text-ink mt-4 text-base font-semibold">
                  {s.name}
                </h3>
                <p className="text-grey-600 mt-2.5 text-sm leading-relaxed">
                  {s.profile}
                </p>
                <p className="text-a mt-4 font-mono text-xs">{s.price}</p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
