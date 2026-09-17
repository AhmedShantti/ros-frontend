"use client";

/**
 * The earning rule, shown working — FR-CRM-016.
 *
 * A setting called "exclude discounted lines" is read three different ways by
 * three different managers. So the programme screen carries a calculator that
 * runs the exact function the till uses (`pointsEarned`) against the draft
 * settings as they are being edited, and the fixed worked examples below it,
 * each with its pass/fail against the function as built.
 */

import { useMemo, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import type { LoyaltyProgramme } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatNumber, money } from "@/lib/console/format";
import { pointsEarned, runEarnConformance, type EarnLine } from "@/lib/console/loyalty-earn";
import { MoneyInput } from "@/components/console/fields";
import { Button, DescList, DescRow, Field, Input, Toggle, cx } from "@/components/console/ui";

export function LoyaltyEarnCalculator({ programme }: { programme: LoyaltyProgramme }) {
  const { t, fmt } = useI18n();
  const [lines, setLines] = useState<EarnLine[]>([
    { grossMinor: 12_000, lineDiscountMinor: 0, taxMinor: 1_474 },
    { grossMinor: 4_500, lineDiscountMinor: 1_000, taxMinor: 430 },
  ]);
  const [orderDiscountMinor, setOrderDiscountMinor] = useState(0);
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [multiplier, setMultiplier] = useState("1");

  const breakdown = pointsEarned(
    { lines, orderDiscountMinor, taxInclusive, minorPerMajor: 100, pointsMultiplier: Number(multiplier) || 1 },
    programme,
  );
  const conformance = useMemo(() => runEarnConformance(), []);
  const m = (minor: number) => formatMoney(money(minor, "EGP"), fmt);

  function patch(index: number, part: Partial<EarnLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...part } : line)));
  }

  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-xs">{t("loy.calc.intro")}</p>

      <Toggle checked={taxInclusive} onChange={setTaxInclusive} label={t("loy.calc.taxInclusive")} />

      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[32rem] text-xs">
          <thead>
            <tr className="bg-sunken border-line border-b">
              <th scope="col" className="text-fg-muted px-2 py-2 text-start font-medium">{t("loy.calc.line")}</th>
              <th scope="col" className="text-fg-muted px-2 py-2 text-end font-medium">{t("loy.calc.gross")}</th>
              <th scope="col" className="text-fg-muted px-2 py-2 text-end font-medium">{t("loy.calc.lineDiscount")}</th>
              <th scope="col" className="text-fg-muted px-2 py-2 text-end font-medium">{t("loy.calc.tax")}</th>
              <th scope="col" className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="text-fg-muted px-2 py-1.5">{index + 1}</td>
                <td className="px-2 py-1.5">
                  <MoneyInput value={line.grossMinor} currency="EGP" onChange={(v) => patch(index, { grossMinor: v ?? 0 })} aria-label={t("loy.calc.gross")} />
                </td>
                <td className="px-2 py-1.5">
                  <MoneyInput value={line.lineDiscountMinor} currency="EGP" onChange={(v) => patch(index, { lineDiscountMinor: v ?? 0 })} aria-label={t("loy.calc.lineDiscount")} />
                </td>
                <td className="px-2 py-1.5">
                  <MoneyInput value={line.taxMinor} currency="EGP" onChange={(v) => patch(index, { taxMinor: v ?? 0 })} aria-label={t("loy.calc.tax")} />
                </td>
                <td className="px-2 py-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("common.delete")}
                    icon={<Trash2 size={12} />}
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        size="sm"
        icon={<Plus size={12} />}
        onClick={() => setLines((current) => [...current, { grossMinor: 0, lineDiscountMinor: 0, taxMinor: 0 }])}
      >
        {t("loy.calc.addLine")}
      </Button>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("loy.calc.orderDiscount")}>
          <MoneyInput value={orderDiscountMinor} currency="EGP" onChange={(v) => setOrderDiscountMinor(v ?? 0)} aria-label={t("loy.calc.orderDiscount")} />
        </Field>
        <Field label={t("loy.calc.multiplier")} hint={t("loy.calc.multiplierHint")}>
          <Input dir="ltr" inputMode="decimal" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} className="text-end font-mono tabular-nums" />
        </Field>
      </div>

      {/* FR-CRM-016 — each exclusion shown as its own line. */}
      <DescList>
        <DescRow label={t("loy.calc.grossTotal")} mono>{m(breakdown.grossMinor)}</DescRow>
        <DescRow label={t("loy.calc.lessDiscounts")} mono>−{m(breakdown.discountExcludedMinor)}</DescRow>
        {programme.excludeDiscountedLines ? (
          <DescRow label={t("loy.calc.lessDiscountedLines")} mono>−{m(breakdown.discountedLinesExcludedMinor)}</DescRow>
        ) : null}
        <DescRow label={t("loy.calc.lessTax")} mono>−{m(breakdown.taxExcludedMinor)}</DescRow>
        <DescRow label={t("loy.calc.eligible")} mono>{m(breakdown.eligibleMinor)}</DescRow>
        <DescRow label={t("loy.calc.points")} mono>
          <span className="text-fg text-lg font-semibold">{formatNumber(breakdown.points, fmt)}</span>
        </DescRow>
      </DescList>

      <section>
        <h3 className="text-fg mb-2 text-sm font-semibold">{t("loy.calc.vectors")}</h3>
        <ul className="border-line divide-line divide-y rounded-lg border text-xs">
          {conformance.map((row) => (
            <li key={row.name} className="flex items-center gap-2 px-3 py-2">
              {row.passed ? <Check size={13} className="text-good" aria-label={t("loy.calc.pass")} /> : <X size={13} className="text-bad" aria-label={t("loy.calc.fail")} />}
              <span className="text-fg min-w-0 flex-1">{row.name}</span>
              <span className={cx("font-mono tabular-nums", row.passed ? "text-fg-muted" : "text-bad")}>
                {row.actual} / {row.expected}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
