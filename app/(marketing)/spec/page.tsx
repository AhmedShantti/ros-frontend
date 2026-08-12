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
import { Reveal } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

const GLOSSARY_HUES: Accent[] = ["amber", "emerald", "azure", "violet", "rose"];

/**
 * The reference page. Everything on the rest of the site carries a tag
 * like FR-POS-040; this page is where those tags are decoded, and where
 * the parts of the specification that are structure rather than feature
 * are published rather than summarised.
 */
export default function SpecPage() {
  const { t } = useI18n();
  const s = t.spec;

  return (
    <>
      <PageHero
        eyebrow={s.eyebrow}
        title={s.title}
        lede={s.lede}
        note={s.note}
        accent="violet"
      />

      {/* ====================== Document control ====================== */}
      <Section accent="violet">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <SectionHead title={s.controlTitle} />
            <Reveal delay={120}>
              <GlowCard accent="violet" className="mt-8 p-6">
                <FactRows rows={s.controlRows} stagger={false} />
              </GlowCard>
            </Reveal>
          </div>

          <div>
            <SectionHead title={s.schemeTitle} lede={s.schemeLede} />

            <div className="mt-10 grid gap-10 sm:grid-cols-2">
              <Reveal kind="left">
                <h3 className="spec text-a">{s.typesTitle}</h3>
                <dl className="border-ink/10 divide-ink/8 mt-4 divide-y border-t">
                  {s.types.map(([id, meaning]) => (
                    <div key={id} className="flex gap-4 py-3">
                      <dt className="shrink-0">
                        <SpecTag id={id} />
                      </dt>
                      <dd className="text-grey-600 text-sm leading-relaxed">
                        {meaning}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Reveal>

              <Reveal delay={100} kind="right">
                <h3 className="spec text-a">{s.codesTitle}</h3>
                <dl className="border-ink/10 divide-ink/8 mt-4 divide-y border-t">
                  {s.codes.map(([code, name]) => (
                    <div key={code} className="flex gap-4 py-2.5">
                      <dt className="w-12 shrink-0">
                        <SpecTag id={code} />
                      </dt>
                      <dd className="text-grey-600 text-sm leading-relaxed">
                        {name}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            <Reveal delay={150}>
              <h3 className="spec text-a mt-12">{s.conventionsTitle}</h3>
              <dl className="border-ink/10 divide-ink/8 mt-4 divide-y border-t">
                {s.conventions.map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-4 gap-y-1 py-3">
                    <dt className="shrink-0">
                      <SpecTag id={k} />
                    </dt>
                    <dd className="text-grey-600 flex-1 text-sm leading-relaxed">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </div>
      </Section>

      {/* ========================== Priority ========================== */}
      <Section accent="amber" tone="wash">
        <SectionHead title={s.priorityTitle} />
        <Reveal className="mt-10">
          <DataTable
            head={s.priorityCols}
            firstColLabel={s.priorityFirstCol}
            rows={s.priority}
          />
        </Reveal>
      </Section>

      {/* ================= Assumptions and constraints ================ */}
      <Section accent="rose" tone="cream">
        <SectionHead title={s.assumptionsTitle} lede={s.assumptionsLede} />
        <Reveal className="mt-10">
          <DataTable
            head={s.assumptionsCols}
            firstColLabel={s.assumptionsFirstCol}
            rows={s.assumptions}
          />
        </Reveal>

        <Reveal delay={100}>
          <h2 className="font-display text-ink mt-20 text-xl font-semibold sm:text-2xl">
            {s.constraintsTitle}
          </h2>
          <div className="mt-8">
            <DataTable
              head={s.constraintsCols}
              firstColLabel={s.constraintsFirstCol}
              rows={s.constraints}
            />
          </div>
        </Reveal>
      </Section>

      {/* ======================== Out of scope ======================== */}
      <Section accent="azure">
        <SectionHead title={s.scopeTitle} lede={s.scopeLede} />
        <Reveal className="mt-10">
          <DataTable
            head={s.scopeCols}
            firstColLabel={s.scopeFirstCol}
            rows={s.scope}
          />
        </Reveal>
      </Section>

      {/* ========================== Glossary ========================== */}
      <Section accent="emerald" tone="wash">
        <SectionHead title={s.glossaryTitle} lede={s.glossaryLede} />
        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {s.glossary.map(([term, def], i) => (
            <Reveal key={term} delay={Math.min(i * 30, 300)}>
              <GlowCard
                accent={GLOSSARY_HUES[i % GLOSSARY_HUES.length]}
                className="p-5"
              >
                <h3 className="font-display text-ink text-base font-semibold">
                  {term}
                </h3>
                <p className="text-grey-600 mt-2 text-sm leading-relaxed">
                  {def}
                </p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ============================ Actors ========================== */}
      <Section accent="violet">
        <SectionHead title={s.actorsTitle} lede={s.actorsLede} />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <Reveal kind="left">
            <GlowCard accent="violet" className="p-6">
              <h3 className="spec text-a">{s.humanLabel}</h3>
              <dl className="border-ink/10 divide-ink/8 mt-4 divide-y border-t">
                {s.humanActors.map(([id, name, scope]) => (
                  <div
                    key={id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5"
                  >
                    <dt className="w-20 shrink-0">
                      <SpecTag id={id} />
                    </dt>
                    <dd className="text-ink flex-1 text-sm">{name}</dd>
                    <dd className="text-grey-500 basis-full text-xs sm:basis-auto sm:text-end">
                      {scope}
                    </dd>
                  </div>
                ))}
              </dl>
            </GlowCard>
          </Reveal>

          <Reveal delay={100} kind="right">
            <GlowCard accent="azure" className="p-6">
              <h3 className="spec text-a">{s.systemLabel}</h3>
              <dl className="border-ink/10 divide-ink/8 mt-4 divide-y border-t">
                {s.systemActors.map(([id, name, scope]) => (
                  <div
                    key={id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5"
                  >
                    <dt className="w-20 shrink-0">
                      <SpecTag id={id} />
                    </dt>
                    <dd className="text-ink flex-1 text-sm">{name}</dd>
                    <dd className="text-grey-500 basis-full text-xs sm:basis-auto sm:text-end">
                      {scope}
                    </dd>
                  </div>
                ))}
              </dl>
            </GlowCard>
          </Reveal>
        </div>
      </Section>

      {/* ====================== Bounded contexts ====================== */}
      <Section accent="azure" tone="cream">
        <SectionHead title={s.contextsTitle} lede={s.contextsLede} />
        <Reveal className="mt-10">
          <DataTable
            head={s.contextsCols}
            firstColLabel={s.contextsFirstCol}
            rows={s.contexts}
            compact
          />
        </Reveal>
      </Section>

      {/* ================== Release-blocking scenarios ================ */}
      <Section accent="rose" tone="wash">
        <SectionHead title={s.testsTitle} lede={s.testsLede} />
        <Reveal className="mt-10">
          <DataTable
            head={s.testsCols}
            firstColLabel={s.testsFirstCol}
            rows={s.tests}
            compact
          />
        </Reveal>

        <Reveal delay={100}>
          <h3 className="font-display text-ink mt-20 text-xl font-semibold">
            {s.pyramidTitle}
          </h3>
          <div className="mt-8 max-w-2xl">
            <FactRows rows={s.pyramid} stagger={false} />
          </div>
          <p className="text-grey-600 mt-6 max-w-2xl text-sm leading-relaxed">
            {s.pyramidNote}
          </p>
        </Reveal>
      </Section>

      {/* ========================= Data volume ======================== */}
      <Section accent="emerald">
        <SectionHead title={s.volumeTitle} lede={s.volumeLede} />
        <Reveal className="mt-10">
          <DataTable
            head={s.volumeCols}
            firstColLabel={s.volumeFirstCol}
            rows={s.volume}
            compact
          />
        </Reveal>
      </Section>

      <CtaBand />
    </>
  );
}
