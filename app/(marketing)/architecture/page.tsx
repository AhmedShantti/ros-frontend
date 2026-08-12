"use client";

import { useI18n } from "@/lib/i18n";
import {
  Bullet,
  DataTable,
  FactRows,
  Formula,
  GlowCard,
  JumpList,
  Ordinal,
  PageHero,
  Section,
  SectionHead,
  SpecTag,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

export default function ArchitecturePage() {
  const { t } = useI18n();
  const a = t.architecture;

  const jump = [
    { id: "drivers", label: a.driversTitle },
    { id: "modular", label: a.rulesTitle },
    { id: "events", label: a.eventsTitle },
    { id: "domain", label: a.domainTitle },
    { id: "patterns", label: a.patternsTitle },
    { id: "data", label: a.dataTitle },
    { id: "api", label: a.apiTitle },
  ];

  return (
    <>
      <PageHero
        eyebrow={a.eyebrow}
        title={a.title}
        lede={a.lede}
        note={a.pageLede}
        accent="azure"
      >
        <JumpList items={jump} />
      </PageHero>

      {/* ========================== Drivers =========================== */}
      <Section id="drivers" accent="azure">
        <SectionHead title={a.driversTitle} lede={a.driversLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.driversCols}
            firstColLabel={a.driversFirstCol}
            rows={a.drivers}
          />
        </Reveal>
      </Section>

      {/* ==================== What modular requires =================== */}
      <Section id="modular" accent="violet" tone="wash">
        <SectionHead title={a.rulesTitle} lede={a.rulesLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.rulesCols}
            firstColLabel={a.rulesFirstCol}
            rows={a.rules}
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <Reveal>
              <h3 className="font-display text-ink text-xl font-semibold">
                {a.extractionTitle}
              </h3>
              <p className="text-grey-600 mt-3 text-sm leading-relaxed">
                {a.extractionLede}
              </p>
            </Reveal>
            <Reveal delay={90}>
              <ol className="mt-6 space-y-3">
                {a.extraction.map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <Ordinal n={i + 1} />
                    <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                      {s}
                    </span>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>

          <div>
            <Reveal kind="right">
              <h3 className="font-display text-ink text-xl font-semibold">
                {a.commsTitle}
              </h3>
              <div className="mt-6 space-y-4">
                {a.comms.map((c, i) => (
                  <GlowCard
                    key={c.k}
                    accent={
                      i === 0 ? "azure" : i === 1 ? "emerald" : "amber"
                    }
                    className="p-5"
                  >
                    <p className="font-display text-ink text-sm font-semibold">
                      {c.k}
                    </p>
                    <p className="text-grey-600 mt-2 text-sm leading-relaxed">
                      {c.v}
                    </p>
                  </GlowCard>
                ))}
              </div>
            </Reveal>
          </div>
        </div>

        <Reveal delay={100}>
          <div className="mt-10">
            <Formula>{a.outboxCode}</Formula>
            <p className="text-grey-600 mt-4 max-w-3xl text-sm leading-relaxed">
              {a.outboxNote}
            </p>
          </div>
        </Reveal>
      </Section>

      {/* =========================== Events =========================== */}
      <Section id="events" accent="emerald">
        <SectionHead title={a.eventsTitle} lede={a.eventsLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.eventsCols}
            firstColLabel={a.eventsFirstCol}
            rows={a.events}
            compact
          />
        </Reveal>

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal kind="left">
            <h3 className="font-display text-ink text-xl font-semibold">
              {a.envelopeTitle}
            </h3>
            <p className="text-grey-600 mt-3 text-sm leading-relaxed">
              {a.envelopeNote}
            </p>
          </Reveal>
          <Reveal delay={90} kind="right">
            <Formula>{a.envelopeCode}</Formula>
          </Reveal>
        </div>
      </Section>

      {/* ========================= Domain model ======================= */}
      <Section id="domain" accent="amber" tone="cream">
        <SectionHead title={a.domainTitle} lede={a.domainLede} />
        <Reveal delay={80}>
          <ul className="mt-8 max-w-3xl space-y-3">
            {a.domainRules.map((r) => (
              <Bullet key={r}>{r}</Bullet>
            ))}
          </ul>
        </Reveal>

        <div className="mt-16">
          <SectionHead title={a.valueTitle} lede={a.valueLede} />
          <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-14">
            <Reveal kind="left">
              <FactRows rows={a.valueRows} stagger={false} />
            </Reveal>
            <Reveal delay={90} kind="right">
              <h4 className="spec text-a">{a.valueBrTitle}</h4>
              <ul className="mt-4 space-y-4">
                {a.valueBr.map(([id, text]) => (
                  <li key={id} className="flex flex-wrap gap-x-3 gap-y-1.5">
                    <SpecTag id={id} className="mt-0.5 shrink-0" />
                    <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                      {text}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-grey-500 mt-6 text-sm leading-relaxed">
                {a.allocateNote}
              </p>
              <p className="text-grey-500 mt-3 text-sm leading-relaxed">
                {a.precisionNote}
              </p>
            </Reveal>
          </div>
        </div>

        <div className="mt-16">
          <SectionHead title={a.statesTitle} lede={a.statesLede} />
          <Reveal className="mt-8">
            <Formula>{a.statesDiagram}</Formula>
          </Reveal>
          <Reveal delay={90}>
            <ul className="mt-8 max-w-4xl space-y-4">
              {a.statesBr.map(([id, text]) => (
                <li key={id} className="flex flex-wrap gap-x-3 gap-y-1.5">
                  <SpecTag id={id} className="mt-0.5 shrink-0" />
                  <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                    {text}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-grey-500 mt-6 max-w-3xl text-sm leading-relaxed">
              {a.snapshotNote}
            </p>
          </Reveal>
        </div>

        <div className="mt-16">
          <SectionHead title={a.movementsTitle} lede={a.movementsLede} />
          <Reveal className="mt-8">
            <DataTable
              head={a.movementsCols}
              firstColLabel={a.movementsFirstCol}
              rows={a.movements}
              compact
            />
          </Reveal>
        </div>
      </Section>

      {/* ========================== Patterns ========================== */}
      <Section id="patterns" accent="violet">
        <SectionHead title={a.patternsTitle} lede={a.patternsLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.patternsCols}
            firstColLabel={a.patternsFirstCol}
            rows={a.patterns}
            compact
          />
        </Reveal>

        <Reveal delay={100}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {a.resilienceTitle}
          </h3>
          <div className="mt-6 max-w-3xl">
            <FactRows rows={a.resilience} stagger={false} />
          </div>
        </Reveal>
      </Section>

      <Section accent="rose" tone="wash">
        <SectionHead title={a.antiTitle} lede={a.antiLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.antiCols}
            firstColLabel={a.antiFirstCol}
            rows={a.anti}
            compact
          />
        </Reveal>
      </Section>

      {/* ====================== Data architecture ===================== */}
      <Section id="data" accent="azure">
        <SectionHead title={a.dataTitle} lede={a.dataLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.schemasCols}
            firstColLabel={a.schemasFirstCol}
            rows={a.schemas}
            compact
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal kind="left">
            <h3 className="font-display text-ink text-xl font-semibold">
              {a.appendOnlyTitle}
            </h3>
            <p className="text-grey-600 mt-3 text-sm leading-relaxed">
              {a.appendOnlyNote}
            </p>
          </Reveal>
          <Reveal delay={90} kind="right">
            <Formula>{a.appendOnlyCode}</Formula>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {a.partitionTitle}
          </h3>
          <div className="mt-6">
            <DataTable
              head={a.partitionCols}
              firstColLabel={a.partitionFirstCol}
              rows={a.partition}
              compact
            />
          </div>
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal kind="left">
            <h3 className="font-display text-ink text-xl font-semibold">
              {a.migrationTitle}
            </h3>
            <p className="text-grey-600 mt-3 text-sm leading-relaxed">
              {a.migrationLede}
            </p>
            <ol className="mt-6 space-y-3">
              {a.migration.map((s, i) => (
                <li key={s} className="flex gap-3">
                  <Ordinal n={i + 1} />
                  <span className="text-grey-600 flex-1 text-sm leading-relaxed">
                    {s}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-grey-500 mt-5 text-sm leading-relaxed">
              {a.migrationNote}
            </p>
          </Reveal>

          <Reveal delay={90} kind="right">
            <h3 className="font-display text-ink text-xl font-semibold">
              {a.backupTitle}
            </h3>
            <div className="mt-6">
              <FactRows rows={a.backup} stagger={false} />
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ============================= API ============================ */}
      <Section id="api" accent="emerald" tone="cream">
        <SectionHead title={a.apiTitle} lede={a.apiLede} />
        <Reveal className="mt-10">
          <DataTable
            head={a.apiCols}
            firstColLabel={a.apiFirstCol}
            rows={a.api}
            compact
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal kind="left">
            <h3 className="font-display text-ink text-xl font-semibold">
              {a.statusTitle}
            </h3>
            <div className="mt-6">
              <DataTable
                head={a.statusCols}
                firstColLabel={a.statusFirstCol}
                rows={a.status}
                compact
              />
            </div>
            <p className="text-grey-500 mt-5 text-sm leading-relaxed">
              {a.statusNote}
            </p>
          </Reveal>

          <Reveal delay={90} kind="right">
            <h3 className="font-display text-ink text-xl font-semibold">
              {a.errorTitle}
            </h3>
            <p className="text-grey-600 mt-3 text-sm leading-relaxed">
              {a.errorNote}
            </p>
            <div className="mt-5">
              <Formula>{a.errorCode}</Formula>
            </div>

            <h3 className="font-display text-ink mt-10 text-xl font-semibold">
              {a.idempotencyTitle}
            </h3>
            <ul className="mt-5 space-y-3">
              {a.idempotency.map((s) => (
                <Bullet key={s}>{s}</Bullet>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <h3 className="font-display text-ink mt-16 text-xl font-semibold">
            {a.endpointsTitle}
          </h3>
          <div className="mt-6">
            <Formula>{a.endpointsCode}</Formula>
          </div>
        </Reveal>
      </Section>

      <CtaBand />
    </>
  );
}
