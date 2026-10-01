"use client";

/**
 * Period comparison for the report runner — SRS §19.3.
 *
 * Headline figures, a trend against the previous period, and the same
 * breakdown by branch, each with its change in amount and in percent. Colour
 * follows the metric, not the direction: more discounts or refunds is worse,
 * not better.
 */

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import type { SalesRollup } from "@/lib/console/reports/rollup";
import { branchesOf, bucketsOf, totalsOf, type SalesMetric } from "@/lib/console/reports/compare";
import { coverageOf, delta, type ComparisonPeriods } from "@/lib/console/reports/periods";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent, money } from "@/lib/console/format";
import { MetricTile, TrendChart } from "@/components/console/charts";
import { Section } from "@/components/console/page";
import { Badge, Callout, cx } from "@/components/console/ui";

const KPIS: { key: SalesMetric; labelKey: string; money: boolean; higherIsBetter: boolean }[] = [
  { key: "net", labelKey: "rep.col.net", money: true, higherIsBetter: true },
  { key: "orders", labelKey: "rep.col.orders", money: false, higherIsBetter: true },
  { key: "aov", labelKey: "rep.col.aov", money: true, higherIsBetter: true },
  { key: "gross", labelKey: "rep.col.gross", money: true, higherIsBetter: true },
  { key: "discounts", labelKey: "rep.col.discounts", money: true, higherIsBetter: false },
  { key: "refunds", labelKey: "rep.col.refunds", money: true, higherIsBetter: false },
];

export function PeriodComparison({
  periods,
  rollup,
}: {
  periods: ComparisonPeriods;
  rollup: SalesRollup;
}) {
  const { t, tx, fmt, locale } = useI18n();

  const coverage = coverageOf(rollup.earliest, periods.previous);
  const currency = rollup.currency;

  const current = totalsOf(rollup.rows, periods.current);
  const previous = totalsOf(rollup.rows, periods.previous);
  const buckets = bucketsOf(rollup.rows, periods, "net");
  const branches = branchesOf(rollup.rows, periods);

  const intl = locale === "ar" ? "ar-EG" : "en-GB";
  const label = (iso: string) =>
    new Intl.DateTimeFormat(
      intl,
      periods.mode === "week"
        ? { weekday: "short", day: "numeric", timeZone: "UTC" }
        : { month: "short", timeZone: "UTC" },
    ).format(new Date(`${iso}T00:00:00.000Z`));

  const showMoney = (value: number) => formatMoney(money(value, currency as never), fmt);
  const compactMoney = (value: number) => formatMoney(money(value, currency as never), fmt, true);

  return (
    <div className="space-y-4">
      <Callout tone="muted">
        <span dir="ltr" className="font-mono text-xs">
          {periods.current.from} → {periods.current.to}
        </span>{" "}
        {t("rep.cmp.against")}{" "}
        <span dir="ltr" className="font-mono text-xs">
          {periods.previous.from} → {periods.previous.to}
        </span>
        . {t("rep.cmp.likeForLike")}{" "}
        {rollup.source === "rollup" ? t("rep.cmp.sourceRollup") : t("rep.cmp.sourceOrders")}
      </Callout>

      {coverage === "none" ? (
        <Callout tone="warn" title={t("rep.cmp.coverageNoneTitle")}>
          {t("rep.cmp.coverageNoneBody").replace("{date}", rollup.earliest ?? "—")}
        </Callout>
      ) : (
        <>
          {coverage === "partial" ? (
            <Callout tone="warn" title={t("rep.cmp.coveragePartialTitle")}>
              {t("rep.cmp.coveragePartialBody").replace("{date}", rollup.earliest ?? "—")}
            </Callout>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {KPIS.map((kpi) => {
              const change = delta(current[kpi.key], previous[kpi.key]);
              return (
                <MetricTile
                  key={kpi.key}
                  label={t(kpi.labelKey as never)}
                  value={
                    kpi.money ? compactMoney(current[kpi.key]) : formatNumber(current[kpi.key], fmt)
                  }
                  metric={
                    change.percent === null
                      ? undefined
                      : {
                          value: current[kpi.key],
                          previous: previous[kpi.key],
                          target: null,
                          deltaPercent: change.percent,
                          direction: change.direction,
                          higherIsBetter: kpi.higherIsBetter,
                        }
                  }
                  hint={change.percent === null ? t("rep.cmp.noPrev") : undefined}
                  footer={
                    <>
                      {t("rep.cmp.previous")}:{" "}
                      {kpi.money ? compactMoney(previous[kpi.key]) : formatNumber(previous[kpi.key], fmt)}
                    </>
                  }
                />
              );
            })}
          </div>

          <Section title={t("rep.cmp.trend")} padded={false}>
            <div className="p-4">
              <TrendChart
                valueLabel={t("rep.cmp.current")}
                comparisonLabel={t("rep.cmp.previous")}
                format={compactMoney}
                data={buckets.map((bucket) => ({
                  label: label(bucket.labelDate),
                  value: bucket.current,
                  comparison: bucket.previous,
                }))}
              />
            </div>
          </Section>

          <Section
            title={periods.mode === "week" ? t("rep.cmp.byDay") : t("rep.cmp.byMonth")}
            padded={false}
          >
            <ComparisonTable
              firstHeader={t("rep.col.group")}
              rows={buckets.map((bucket) => ({
                id: bucket.key,
                label: label(bucket.labelDate),
                current: bucket.current,
                previous: bucket.previous,
              }))}
              show={showMoney}
              total={{ current: current.net, previous: previous.net }}
            />
          </Section>

          {branches.length > 1 ? (
            <Section title={t("rep.cmp.byBranch")} padded={false}>
              <ComparisonTable
                firstHeader={t("common.branch")}
                rows={branches.map((branch) => ({
                  id: branch.branchId,
                  label: tx(branch.name),
                  current: branch.current.net,
                  previous: branch.previous.net,
                }))}
                show={showMoney}
              />
            </Section>
          ) : null}

          <p className="text-fg-subtle text-xs">
            {t("rep.dataAsOf")}: {rollup.generatedAt.slice(0, 16).replace("T", " ")}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ComparisonRow {
  id: string;
  label: string;
  current: number;
  previous: number;
}

function ComparisonTable({
  firstHeader,
  rows,
  show,
  total,
}: {
  firstHeader: string;
  rows: ComparisonRow[];
  show: (value: number) => string;
  total?: { current: number; previous: number };
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line bg-sunken border-b">
            <th scope="col" className="text-fg-muted px-3 py-2 text-start text-xs font-medium">
              {firstHeader}
            </th>
            {(["rep.cmp.current", "rep.cmp.previous", "rep.cmp.change", "rep.cmp.changePct"] as const).map(
              (key) => (
                <th key={key} scope="col" className="text-fg-muted px-3 py-2 text-end text-xs font-medium">
                  {t(key)}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((row) => (
            <ComparisonLine key={row.id} row={row} show={show} />
          ))}
        </tbody>
        {total ? (
          <tfoot>
            <ComparisonLine
              row={{ id: "total", label: t("rep.total"), ...total }}
              show={show}
              strong
            />
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function ComparisonLine({
  row,
  show,
  strong,
}: {
  row: ComparisonRow;
  show: (value: number) => string;
  strong?: boolean;
}) {
  const { fmt } = useI18n();
  const change = delta(row.current, row.previous);

  const Arrow =
    change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : ArrowRight;
  const tone =
    change.direction === "flat" ? "text-fg-muted" : change.direction === "up" ? "text-good" : "text-bad";

  return (
    <tr className={cx(strong && "border-line bg-sunken border-t font-medium")}>
      <th scope="row" className="text-fg px-3 py-2 text-start text-sm font-normal">
        {row.label}
      </th>
      <td className="px-3 py-2 text-end font-mono tabular-nums">{show(row.current)}</td>
      <td className="text-fg-muted px-3 py-2 text-end font-mono tabular-nums">{show(row.previous)}</td>
      <td className={cx("px-3 py-2 text-end font-mono tabular-nums", tone)}>
        {change.change > 0 ? "+" : ""}
        {show(change.change)}
      </td>
      <td className={cx("px-3 py-2 text-end", tone)}>
        {change.percent === null ? (
          <Badge tone="muted">—</Badge>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums">
            <Arrow size={12} aria-hidden />
            {formatPercent(Math.abs(change.percent), fmt, 1)}
          </span>
        )}
      </td>
    </tr>
  );
}
