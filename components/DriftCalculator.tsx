"use client";

import { useId, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SectionHead, SpecTag } from "./ui";
import { Reveal } from "./motion";

/**
 * The arithmetic of an uncontrolled food cost, per SRS §2.2. Three cost
 * levels against a 30% controlled target — the drift between them is the
 * money that leaves through the back door rather than the till.
 */
const TARGET = 0.3;
const TYPICAL = 0.345;
const POOR = 0.38;

const MIN = 20_000;
const MAX = 1_000_000;
const STEP = 5_000;

export function DriftCalculator() {
  const { t, lang } = useI18n();
  const [revenue, setRevenue] = useState(150_000);
  const sliderId = useId();

  // Arabic renders Arabic-Indic numerals (FR-LOC-005). Switch this locale
  // string to "en-US" if you want Western numerals in the Arabic build.
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", {
        maximumFractionDigits: 0,
      }),
    [lang],
  );

  /* Three cost levels, one colour. The escalation is carried by the
     density of the bar rather than by hue: the controlled target is a
     neutral rule because it is the baseline rather than the problem,
     and the orange arrives as the number gets worse. */
  const rows = [
    { label: t.drift.targetLabel, rate: TARGET, bar: "bg-ink/25" },
    { label: t.drift.typicalLabel, rate: TYPICAL, bar: "bg-amber/55" },
    { label: t.drift.poorLabel, rate: POOR, bar: "bg-amber" },
  ];

  const lostMonthly = revenue * (TYPICAL - TARGET);
  const lostAnnual = lostMonthly * 12;

  return (
    <div>
      <SectionHead
        eyebrow={t.drift.eyebrow}
        title={t.drift.title}
        lede={t.drift.lede}
      />

      <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
        <Reveal>
          <label
            htmlFor={sliderId}
            className="text-grey-600 flex flex-wrap items-baseline justify-between gap-2 text-sm"
          >
            <span>{t.drift.revenueLabel}</span>
            <span className="font-display text-ink text-3xl">
              {fmt.format(revenue)}
            </span>
          </label>

          <input
            id={sliderId}
            type="range"
            min={MIN}
            max={MAX}
            step={STEP}
            value={revenue}
            onChange={(e) => setRevenue(Number(e.target.value))}
            className="accent-amber-deep mt-4 w-full cursor-pointer"
          />

          <div className="text-grey-400 mt-2 flex justify-between font-mono text-xs tabular-nums">
            <span>{fmt.format(MIN)}</span>
            <span>{fmt.format(MAX)}</span>
          </div>

          <ul className="mt-10 space-y-5">
            {rows.map((row) => {
              const cogs = revenue * row.rate;
              return (
                <li key={row.label}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink text-sm">{row.label}</span>
                    <span className="font-mono text-sm tabular-nums">
                      {fmt.format(cogs)}
                    </span>
                  </div>
                  <div className="bg-ink/10 mt-2.5 h-2 w-full overflow-hidden">
                    <div
                      className={`h-full transition-[width] duration-500 ease-out ${row.bar}`}
                      style={{ width: `${(row.rate / POOR) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-ink/15 mt-10 border border-dashed p-5">
            <p className="spec text-a">{t.drift.workedTitle}</p>
            <p className="text-grey-600 mt-2.5 text-sm leading-relaxed">
              {t.drift.workedText}
            </p>
          </div>
        </Reveal>

        <Reveal delay={120} as="aside" className="h-fit">
          <div
            data-accent="amber"
            className="bg-paper border-ink/12 relative overflow-hidden border p-7 sm:p-8"
          >
            <span
              aria-hidden
              className="edge-lit pointer-events-none absolute inset-x-0 top-0 h-px"
            />

            <p className="spec text-a relative">{t.drift.lostLabel}</p>

            <p className="font-display text-ink relative mt-5 text-5xl leading-none sm:text-6xl">
              {fmt.format(lostMonthly)}
            </p>
            <p className="text-grey-500 relative mt-1.5 text-sm">
              {t.drift.monthly}
            </p>

            <div className="border-ink/12 relative my-7 border-t" />

            <p className="font-display text-a relative text-4xl leading-none">
              {fmt.format(lostAnnual)}
            </p>
            <p className="text-grey-500 relative mt-1.5 text-sm">
              {t.drift.annual}
            </p>

            <p className="text-ink relative mt-7 text-sm leading-relaxed">
              {t.drift.verdictA}
            </p>
            <p className="text-grey-600 relative mt-3 text-sm leading-relaxed">
              {t.drift.verdictB}
            </p>

            <div className="relative mt-6">
              <SpecTag id={t.drift.spec} />
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
