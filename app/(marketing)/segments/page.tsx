"use client";

import { useI18n } from "@/lib/i18n";
import {
  Chip,
  GlowCard,
  PageHero,
  Section,
  SectionHead,
  SpecTag,
  type Accent,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

const SEGMENT_HUES: Accent[] = ["amber", "emerald", "azure", "violet"];
const PERSONA_HUES: Accent[] = ["amber", "emerald", "azure", "violet", "rose"];

export default function SegmentsPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow={t.segments.eyebrow}
        title={t.segments.title}
        lede={t.segments.lede}
        note={t.segments.pageLede}
        accent="rose"
      />

      <Section accent="amber">
        <div className="grid gap-6 lg:grid-cols-2">
          {t.segments.items.map((s, i) => (
            <Reveal key={s.tag} delay={i * 80} kind={i % 2 ? "right" : "left"}>
              <GlowCard accent={SEGMENT_HUES[i]} className="p-7">
                <div className="flex items-start gap-4">
                  <span className="bg-a-wash text-a font-display border-a flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-base font-semibold">
                    {s.tag}
                  </span>
                  <div>
                    <h2 className="font-display text-ink text-xl leading-snug font-semibold">
                      {s.name}
                    </h2>
                    <p className="text-grey-600 mt-1.5 text-sm leading-relaxed">
                      {s.profile}
                    </p>
                  </div>
                </div>

                <div data-accent="rose" className="bg-a-wash mt-7 rounded-lg p-4">
                  <p className="spec text-a">{t.segments.painLabel}</p>
                  <p className="text-grey-600 mt-2 text-sm leading-relaxed">
                    {s.pain}
                  </p>
                </div>

                <div className="mt-6">
                  <p className="spec text-grey-400">{t.segments.buyingLabel}</p>
                  <p className="text-grey-600 mt-2 text-sm leading-relaxed">
                    {s.buying}
                  </p>
                </div>

                <div className="mt-6">
                  <p className="spec text-grey-400">{t.segments.needsLabel}</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {s.needs.map((n) => (
                      <li key={n}>
                        <Chip accent={SEGMENT_HUES[i]}>{n}</Chip>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-ink/10 mt-7 flex flex-wrap items-baseline justify-between gap-2 border-t pt-4">
                  <span className="spec text-grey-400">
                    {t.segments.priceLabel}
                  </span>
                  <span className="text-a font-mono text-sm">{s.price}</span>
                </div>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* The five personas the hard requirements came from */}
      <Section accent="violet" tone="wash">
        <SectionHead
          eyebrow={t.segments.eyebrow}
          title={t.segments.personasTitle}
          lede={t.segments.personasLede}
        />

        <div className="mt-14 space-y-4">
          {t.segments.personas.map((p, i) => (
            <Reveal key={p.who} delay={Math.min(i * 70, 300)}>
              <GlowCard accent={PERSONA_HUES[i]} className="p-7">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-10">
                  <div>
                    <h3 className="font-display text-ink text-lg font-semibold">
                      {p.who}
                    </h3>
                    <div className="mt-3">
                      <SpecTag id={p.req} />
                    </div>
                    <p className="text-a mt-3 text-sm leading-relaxed">
                      {p.reqText}
                    </p>
                  </div>

                  <div>
                    <p className="text-grey-600 text-sm leading-relaxed">
                      {p.cond}
                    </p>
                    <p
                      data-accent="rose"
                      className="border-a text-grey-600 mt-4 border-s-2 ps-4 text-sm leading-relaxed"
                    >
                      {p.broke}
                    </p>
                  </div>
                </div>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section accent="rose" tone="cream">
        <div className="max-w-3xl">
          <Reveal>
            <h2 className="font-display text-ink text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.02em] text-balance sm:text-[2.6rem]">
              {t.segments.incumbent.title}
            </h2>
          </Reveal>
          <Reveal delay={90}>
            <p className="text-grey-600 mt-6 text-base leading-relaxed sm:text-lg">
              {t.segments.incumbent.text}
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="mt-7">
              <SpecTag id={t.segments.incumbent.spec} />
            </div>
          </Reveal>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
