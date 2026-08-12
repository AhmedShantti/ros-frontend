"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import {
  DataTable,
  PageHero,
  Section,
  SectionHead,
  cx,
  type Accent,
} from "@/components/ui";
import { Reveal, useGlow } from "@/components/motion";
import { CtaBand } from "@/components/Footer";

const TIER_HUES: Accent[] = ["emerald", "amber", "violet"];

/** "yes" / "no" are sentinels in both dictionaries — render them as marks. */
function cell(value: string): ReactNode {
  if (value === "yes")
    return (
      <span className="text-emerald-deep" aria-label="yes">
        ✓
      </span>
    );
  if (value === "no" || value === "—")
    return (
      <span className="text-grey-300" aria-label="no">
        —
      </span>
    );
  return <span className="text-ink">{value}</span>;
}

function Tier({
  tier,
  featured,
  accent,
  ctaLabel,
  popularLabel,
  perMonth,
}: {
  tier: { name: string; price: string; for: string; highlights: string[] };
  featured: boolean;
  accent: Accent;
  ctaLabel: string;
  popularLabel: string;
  perMonth: string;
}) {
  const { ref, onPointerMove } = useGlow<HTMLElement>();

  return (
    <article
      ref={ref}
      data-accent={accent}
      onPointerMove={onPointerMove}
      className={cx(
        "glow-card card-bar bg-paper relative flex h-full flex-col overflow-hidden rounded-2xl border p-7",
        featured ? "border-a shadow-lg" : "border-ink/10 shadow-2xs",
      )}
    >
      {featured ? (
        <span className="spec bg-a text-bone absolute top-4 end-4 rounded-full px-2.5 py-1">
          {popularLabel}
        </span>
      ) : null}

      <h2 className="font-display text-ink text-lg font-semibold">
        {tier.name}
      </h2>
      <p className="text-grey-500 mt-1.5 text-sm">{tier.for}</p>

      <p className="mt-7 flex items-baseline gap-1.5">
        <span className="text-grey-400 font-mono text-sm">USD</span>
        <span className="font-display text-a text-4xl font-semibold tabular-nums">
          {tier.price}
        </span>
      </p>
      <p className="text-grey-400 mt-1 text-xs">{perMonth}</p>

      <ul className="mt-8 flex-1 space-y-3">
        {tier.highlights.map((h) => (
          <li
            key={h}
            className="text-grey-600 relative ps-5 text-sm leading-relaxed"
          >
            <span
              aria-hidden
              className="text-a absolute"
              style={{ insetInlineStart: 0 }}
            >
              ✓
            </span>
            {h}
          </li>
        ))}
      </ul>

      <Link
        href="/contact"
        className={cx(
          "mt-9 rounded-full px-5 py-3 text-center text-sm font-medium transition-all duration-300 hover:-translate-y-0.5",
          featured
            ? "bg-ink text-bone hover:bg-a-deep"
            : "border-ink/20 text-ink hover:border-a hover:text-a border",
        )}
      >
        {ctaLabel}
      </Link>
    </article>
  );
}

export default function PricingPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow={t.pricing.eyebrow}
        title={t.pricing.title}
        lede={t.pricing.lede}
        accent="emerald"
      />

      <Section accent="emerald">
        <div className="grid gap-6 lg:grid-cols-3">
          {t.pricing.tiers.map((tier, i) => (
            <Reveal
              key={tier.name}
              delay={i * 90}
              kind="scale"
              className="h-full"
            >
              <Tier
                tier={tier}
                featured={i === 1}
                accent={TIER_HUES[i] ?? "amber"}
                ctaLabel={t.pricing.ctaTier}
                popularLabel={t.pricing.popular}
                perMonth={t.pricing.perMonth}
              />
            </Reveal>
          ))}
        </div>
      </Section>

      <Section accent="azure" tone="wash">
        <SectionHead title={t.pricing.matrixTitle} />
        <Reveal className="mt-10">
          <DataTable
            head={t.pricing.matrixCols}
            firstColLabel={t.pricing.matrixFirstCol}
            rows={t.pricing.matrix}
            renderCell={cell}
            compact
          />
        </Reveal>
      </Section>

      <Section accent="amber">
        <SectionHead title={t.pricing.addonsTitle} />
        <Reveal>
          <dl className="border-ink/10 divide-ink/8 mt-10 max-w-4xl divide-y border-t">
            {t.pricing.addons.map(([name, price, note]) => (
              <div
                key={name}
                className="hover:bg-a-wash/60 grid gap-1 px-1 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-6"
              >
                <div>
                  <dt className="text-ink text-sm font-medium">{name}</dt>
                  {note ? (
                    <p className="text-grey-500 mt-1 text-xs leading-relaxed">
                      {note}
                    </p>
                  ) : null}
                </div>
                <dd className="text-a font-mono text-sm sm:text-end">{price}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Section>

      {/* Tenant lifecycle — FR-PLT-020..023 */}
      <Section accent="rose" tone="cream">
        <SectionHead
          title={t.pricing.lifecycleTitle}
          lede={t.pricing.lifecycleLede}
        />
        <Reveal className="mt-10">
          <DataTable
            head={t.pricing.lifecycleCols}
            firstColLabel={t.pricing.lifecycleFirstCol}
            rows={t.pricing.lifecycle}
          />
        </Reveal>
        <Reveal delay={100}>
          <p className="text-grey-600 mt-8 max-w-3xl text-sm leading-relaxed">
            {t.pricing.lifecycleNote}
          </p>
        </Reveal>
      </Section>

      <Section accent="amber" ruled={false} className="py-12 sm:py-14">
        <p className="text-grey-500 max-w-2xl text-xs leading-relaxed">
          {t.pricing.footnote}
        </p>
      </Section>

      <CtaBand />
    </>
  );
}
