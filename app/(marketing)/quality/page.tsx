"use client";

import { useI18n } from "@/lib/i18n";
import {
  Bullet,
  DataTable,
  FactRows,
  Formula,
  GlowCard,
  JumpList,
  PageHero,
  Section,
  SectionHead,
  SpecTag,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

export default function QualityPage() {
  const { t } = useI18n();
  const q = t.quality;

  const jump = [
    { id: "usability", label: q.usabilityTitle },
    { id: "maintain", label: q.maintainTitle },
    { id: "testing", label: q.testTitle },
    { id: "gates", label: q.gatesTitle },
    { id: "pipeline", label: q.pipelineTitle },
    { id: "slo", label: q.sloTitle },
  ];

  return (
    <>
      <PageHero
        eyebrow={q.eyebrow}
        title={q.title}
        lede={q.lede}
        note={q.pageLede}
        accent="violet"
      >
        <JumpList items={jump} />
      </PageHero>

      {/* ========================= Usability ========================== */}
      <Section id="usability" accent="violet">
        <SectionHead title={q.usabilityTitle} lede={q.usabilityLede} />
        <Reveal className="mt-10">
          <DataTable
            head={q.usabilityCols}
            firstColLabel={q.usabilityFirstCol}
            rows={q.usability}
            compact
          />
        </Reveal>
      </Section>

      {/* ============ Maintainability, observability, portability ===== */}
      <Section id="maintain" accent="azure" tone="wash">
        <SectionHead title={q.maintainTitle} lede={q.maintainLede} />
        <Reveal className="mt-10">
          <DataTable
            head={q.maintainCols}
            firstColLabel={q.maintainFirstCol}
            rows={q.maintain}
            compact
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal kind="left">
            <GlowCard accent="emerald" className="p-6">
              <h3 className="font-display text-ink text-lg font-semibold">
                {q.obsTitle}
              </h3>
              <p className="text-grey-600 mt-2 text-sm leading-relaxed">
                {q.obsLede}
              </p>
              <ul className="mt-5 space-y-3.5">
                {q.obs.map(([id, text]) => (
                  <li key={id} className="flex flex-wrap gap-x-3 gap-y-1">
                    <SpecTag id={id} className="mt-0.5 shrink-0" />
                    <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                      {text}
                    </span>
                  </li>
                ))}
              </ul>
            </GlowCard>
          </Reveal>

          <Reveal delay={90} kind="right">
            <GlowCard accent="amber" className="p-6">
              <h3 className="font-display text-ink text-lg font-semibold">
                {q.portTitle}
              </h3>
              <ul className="mt-5 space-y-3.5">
                {q.port.map(([id, text]) => (
                  <li key={id} className="flex flex-wrap gap-x-3 gap-y-1">
                    <SpecTag id={id} className="mt-0.5 shrink-0" />
                    <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                      {text}
                    </span>
                  </li>
                ))}
              </ul>
            </GlowCard>
          </Reveal>
        </div>
      </Section>

      {/* ========================== Testing =========================== */}
      <Section id="testing" accent="emerald">
        <SectionHead title={q.testTitle} lede={q.testLede} />
        <Reveal className="mt-10">
          <DataTable
            head={q.testCols}
            firstColLabel={q.testFirstCol}
            rows={q.testCategories}
            compact
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal kind="left">
            <h3 className="font-display text-ink text-xl font-semibold">
              {q.conformanceTitle}
            </h3>
            <p className="text-grey-600 mt-3 text-sm leading-relaxed">
              {q.conformanceLede}
            </p>
            <p className="text-grey-500 mt-4 text-sm leading-relaxed">
              {q.conformanceScope}
            </p>
            <p className="text-grey-500 mt-4 text-sm leading-relaxed">
              {q.conformanceNote}
            </p>

            <h3 className="font-display text-ink mt-10 text-xl font-semibold">
              {q.testDataTitle}
            </h3>
            <ul className="mt-5 space-y-3">
              {q.testData.map((d) => (
                <Bullet key={d}>{d}</Bullet>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={90} kind="right">
            <Formula>{q.conformanceCode}</Formula>
          </Reveal>
        </div>
      </Section>

      {/* ========================== Gates ============================= */}
      <Section id="gates" accent="rose" tone="wash">
        <SectionHead title={q.gatesTitle} lede={q.gatesLede} />
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <Reveal kind="left">
            <GlowCard accent="rose" className="p-6">
              <p className="spec text-a">{q.gatesMergeLabel}</p>
              <ul className="mt-5 space-y-3">
                {q.gatesMerge.map((g) => (
                  <Bullet key={g}>{g}</Bullet>
                ))}
              </ul>
            </GlowCard>
          </Reveal>
          <Reveal delay={90} kind="right">
            <GlowCard accent="violet" className="p-6">
              <p className="spec text-a">{q.gatesReleaseLabel}</p>
              <ul className="mt-5 space-y-3">
                {q.gatesRelease.map((g) => (
                  <Bullet key={g}>{g}</Bullet>
                ))}
              </ul>
            </GlowCard>
          </Reveal>
        </div>
      </Section>

      {/* ================== Environments & pipeline =================== */}
      <Section id="pipeline" accent="azure">
        <SectionHead title={q.envTitle} />
        <Reveal className="mt-10">
          <DataTable
            head={q.envCols}
            firstColLabel={q.envFirstCol}
            rows={q.environments}
            compact
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
          <Reveal kind="left">
            <h3 className="font-display text-ink text-xl font-semibold">
              {q.pipelineTitle}
            </h3>
            <p className="text-grey-600 mt-3 text-sm leading-relaxed">
              {q.pipelineLede}
            </p>
          </Reveal>
          <Reveal delay={90} kind="right">
            <Formula>{q.pipelineCode}</Formula>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {q.opsTitle}
          </h3>
          <ul className="mt-6 max-w-4xl space-y-3.5">
            {q.ops.map(([id, text]) => (
              <li key={id} className="flex flex-wrap gap-x-3 gap-y-1">
                <SpecTag id={id} className="mt-0.5 shrink-0" />
                <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                  {text}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-grey-500 mt-6 max-w-3xl text-sm leading-relaxed">
            {q.opsNote}
          </p>
        </Reveal>
      </Section>

      {/* ==================== SLOs and incidents ====================== */}
      <Section id="slo" accent="amber" tone="cream">
        <SectionHead title={q.sloTitle} />
        <Reveal className="mt-10">
          <DataTable
            head={q.sloCols}
            firstColLabel={q.sloFirstCol}
            rows={q.slo}
            compact
          />
        </Reveal>

        <Reveal delay={100}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {q.incidentTitle}
          </h3>
          <div className="mt-6">
            <DataTable
              head={q.incidentCols}
              firstColLabel={q.incidentFirstCol}
              rows={q.incidents}
              compact
            />
          </div>
          <p className="text-grey-500 mt-6 max-w-3xl text-sm leading-relaxed">
            {q.incidentNote}
          </p>
        </Reveal>

        <Reveal delay={140}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {q.costTitle}
          </h3>
          <ul className="mt-6 max-w-4xl space-y-3.5">
            {q.cost.map(([id, text]) => (
              <li key={id} className="flex flex-wrap gap-x-3 gap-y-1">
                <SpecTag id={id} className="mt-0.5 shrink-0" />
                <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      </Section>

      <CtaBand />
    </>
  );
}
