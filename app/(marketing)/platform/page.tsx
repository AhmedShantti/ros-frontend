"use client";

import { useI18n } from "@/lib/i18n";
import {
  DataTable,
  FactRows,
  GlowCard,
  PageHero,
  Section,
  SectionHead,
  SpecTag,
  type Accent,
} from "@/components/ui";
import { Reveal, useInView } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

const PILLAR_HUES: Accent[] = ["azure", "amber", "violet", "emerald"];
const PACK_HUES: Accent[] = ["amber", "emerald", "azure"];

/** The offline-outage timeline. Draws its rail as it scrolls into view. */
function OutageTimeline() {
  const { t } = useI18n();
  const { ref, inView } = useInView<HTMLOListElement>();

  return (
    <ol ref={ref} className="border-ink/10 relative mt-14 border-s ps-8">
      <span
        aria-hidden
        className={`from-azure via-amber to-rose absolute top-0 h-full w-px bg-linear-to-b ${
          inView ? "draw-down is-in" : ""
        }`}
        style={{ insetInlineStart: "-1px" }}
      />

      {t.platform.outage.steps.map((s, i) => (
        <Reveal
          key={s.h}
          as="li"
          delay={Math.min(i * 70, 420)}
          className="relative pb-9 last:pb-0"
        >
          <span
            aria-hidden
            className="bg-a border-bone absolute top-1.5 h-3 w-3 rounded-full border-2"
            style={{ insetInlineStart: "-1.86rem" }}
          />
          <p className="spec text-a" dir="ltr">
            {s.t}
          </p>
          <h3 className="font-display text-ink mt-1.5 text-lg font-semibold">
            {s.h}
          </h3>
          <p className="text-grey-600 mt-2 max-w-2xl text-sm leading-relaxed">
            {s.d}
          </p>
        </Reveal>
      ))}
    </ol>
  );
}

export default function PlatformPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow={t.platform.eyebrow}
        title={t.platform.title}
        lede={t.platform.lede}
        accent="azure"
      />

      {/* ========================== Pillars =========================== */}
      <Section accent="azure">
        <div className="grid gap-6 lg:grid-cols-2">
          {t.platform.pillars.map((p, i) => (
            <Reveal key={p.spec} delay={Math.min(i * 80, 240)}>
              <GlowCard accent={PILLAR_HUES[i]} className="p-7">
                <div className="mb-4">
                  <SpecTag id={p.spec} />
                </div>
                <h2 className="font-display text-ink text-xl leading-snug font-semibold">
                  {p.name}
                </h2>
                <p className="text-grey-600 mt-3.5 text-sm leading-relaxed">
                  {p.text}
                </p>
                <div className="mt-7">
                  <FactRows rows={p.rows} stagger={false} />
                </div>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ======================== Architecture ======================== */}
      <Section accent="violet" tone="wash" ruled="grid">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
          <div>
            <SectionHead
              title={t.platform.arch.title}
              lede={t.platform.arch.text}
            />
            <Reveal delay={140}>
              <div className="mt-6">
                <SpecTag id={t.platform.arch.spec} />
              </div>
            </Reveal>

            <Reveal delay={180}>
              <h3 className="spec text-a mt-12">
                {t.platform.arch.decisionsTitle}
              </h3>
              <ul className="mt-5 space-y-4">
                {t.platform.arch.decisions.map(([id, text]) => (
                  <li key={id} className="flex flex-wrap gap-x-4 gap-y-1.5">
                    <SpecTag id={id} className="mt-0.5 shrink-0" />
                    <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                      {text}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={120} kind="right" className="h-fit">
            <div className="bg-paper border-ink/10 rounded-2xl border p-6 shadow-sm">
              <FactRows rows={t.platform.arch.stack} stagger={false} />
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ========================= Performance ======================== */}
      <Section accent="emerald" tone="cream">
        <SectionHead title={t.platform.perf.title} note={t.platform.perf.note} />
        <div className="mt-10 max-w-3xl">
          <FactRows rows={t.platform.perf.rows} />
        </div>
      </Section>

      {/* ===================== Scale & availability =================== */}
      <Section accent="azure">
        <SectionHead
          title={t.platform.scale.title}
          note={t.platform.scale.note}
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Reveal kind="left">
            <GlowCard accent="azure" className="p-6">
              <FactRows rows={t.platform.scale.scaleRows} stagger={false} />
            </GlowCard>
          </Reveal>
          <Reveal delay={100} kind="right">
            <GlowCard accent="emerald" className="p-6">
              <FactRows rows={t.platform.scale.availRows} stagger={false} />
            </GlowCard>
          </Reveal>
        </div>
      </Section>

      {/* ======================== Country packs ======================= */}
      <Section accent="amber" tone="wash">
        <SectionHead
          title={t.platform.packs.title}
          lede={t.platform.packs.lede}
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {t.platform.packs.items.map((p, i) => (
            <Reveal key={p.code} delay={i * 90} kind="scale">
              <GlowCard accent={PACK_HUES[i]} className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      dir="ltr"
                      className="bg-a text-bone font-display flex h-9 items-center rounded-md px-2.5 text-sm font-semibold"
                    >
                      {p.code}
                    </span>
                    <h3 className="font-display text-ink text-lg font-semibold">
                      {p.name}
                    </h3>
                  </div>
                  <SpecTag id={p.spec} />
                </div>

                <div className="mt-6">
                  <FactRows rows={p.rows} stagger={false} />
                </div>

                <p className="text-grey-500 mt-6 text-sm leading-relaxed">
                  {p.note}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div className="border-ink/15 mt-10 rounded-xl border border-dashed p-6">
            <p className="spec text-a">{t.platform.packs.phase3Label}</p>
            <p className="text-grey-600 mt-2.5 max-w-3xl text-sm leading-relaxed">
              {t.platform.packs.phase3}
            </p>
          </div>
        </Reveal>
      </Section>

      {/* ====================== Security & compliance ================= */}
      <Section accent="rose">
        <SectionHead
          title={t.platform.security.title}
          lede={t.platform.security.lede}
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {t.platform.security.items.map((s, i) => (
            <Reveal key={s.k} delay={Math.min(i * 55, 300)}>
              <GlowCard accent={i % 2 ? "violet" : "rose"} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-ink text-base font-semibold">
                    {s.k}
                  </h3>
                  <SpecTag id={s.spec} />
                </div>
                <p className="text-grey-600 mt-3 text-sm leading-relaxed">
                  {s.v}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {t.platform.security.complianceTitle}
          </h3>
          <div className="mt-6">
            <DataTable
              head={t.platform.security.complianceCols}
              firstColLabel={t.platform.security.complianceFirstCol}
              rows={t.platform.security.compliance}
            />
          </div>
        </Reveal>
      </Section>

      {/* ======================== Offline outage ====================== */}
      <Section accent="azure" tone="cream">
        <SectionHead
          eyebrow={t.platform.outage.spec}
          title={t.platform.outage.title}
          lede={t.platform.outage.lede}
        />
        <OutageTimeline />
      </Section>

      <CtaBand />
    </>
  );
}
