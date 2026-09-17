"use client";

/**
 * Branch ranking — SRS §13.6, FR-CST-037.
 *
 * Rank branches on any profitability metric, with configurable
 * normalisation: absolute, per seat, per square metre, per labour hour.
 * Money totals scale with size, so they are divided; percentages are already
 * size-free and are ranked as they are.
 *
 * The ranking arithmetic is `lib/console/costing-ranking.ts`. Operational
 * measures (transactions, average order, waste %) are ranked on the branch
 * scorecard, which this page links to rather than duplicating.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Localised, Money } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import {
  labourHoursByBranch,
  rankRows,
  type Normalisation,
  type RankMetric,
  type RankedRow,
} from "@/lib/console/costing-ranking";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader } from "@/components/console/page";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { Badge, Callout, Card, Field, Input, Meter, SegmentedControl, Select, cx } from "@/components/console/ui";

export default function BranchRankingPage() {
  return (
    <Gate permissions={["costing.margin.view", "costing.view"]}>
      <BranchRanking />
    </Gate>
  );
}

interface ProfitRow {
  branchId: string;
  branchName: Localised;
  grossSales: Money;
  discounts: Money;
  refunds: Money;
  netSales: Money;
  cogs: Money;
  grossProfit: Money;
  labourCost: Money;
  contributionAfterLabour: Money;
  operatingExpenses: Money;
  operatingProfit: Money;
  seats: number;
  areaSqm: number;
}

const pct = (part: Money, whole: Money) => (whole.amount > 0 ? (part.amount / whole.amount) * 100 : null);

const METRICS: RankMetric<ProfitRow>[] = [
  { key: "netSales", kind: "money", higherIsBetter: true, additive: true, read: (row) => row.netSales.amount },
  { key: "grossProfit", kind: "money", higherIsBetter: true, additive: true, read: (row) => row.grossProfit.amount },
  { key: "contributionAfterLabour", kind: "money", higherIsBetter: true, additive: true, read: (row) => row.contributionAfterLabour.amount },
  { key: "operatingProfit", kind: "money", higherIsBetter: true, additive: true, read: (row) => row.operatingProfit.amount },
  { key: "cogs", kind: "money", higherIsBetter: false, additive: true, read: (row) => row.cogs.amount },
  { key: "labourCost", kind: "money", higherIsBetter: false, additive: true, read: (row) => row.labourCost.amount },
  { key: "operatingExpenses", kind: "money", higherIsBetter: false, additive: true, read: (row) => row.operatingExpenses.amount },
  { key: "foodCostPercent", kind: "percent", higherIsBetter: false, additive: false, read: (row) => pct(row.cogs, row.netSales) },
  { key: "labourCostPercent", kind: "percent", higherIsBetter: false, additive: false, read: (row) => pct(row.labourCost, row.netSales) },
  { key: "grossMarginPercent", kind: "percent", higherIsBetter: true, additive: false, read: (row) => pct(row.grossProfit, row.netSales) },
  { key: "operatingMarginPercent", kind: "percent", higherIsBetter: true, additive: false, read: (row) => pct(row.operatingProfit, row.netSales) },
];

function BranchRanking() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [metricKey, setMetricKey] = useState("operatingProfit");
  const [normalisation, setNormalisation] = useState<Normalisation>("absolute");
  const [threshold, setThreshold] = useState("2");

  const data = useAsync(async () => {
    const [rows, attendance] = await Promise.all([
      services.costing.branchProfitability({ ...scope, branchId: null }),
      services.workforce.attendance
        .list({ scope: { ...scope, branchId: null }, limit: 20000 })
        .then((page) => page.rows)
        .catch(() => null),
    ]);
    return { rows: rows as ProfitRow[], labourHours: attendance ? labourHoursByBranch(attendance) : null };
  }, [scope.tenantId, scope.brandId]);

  const metric = METRICS.find((row) => row.key === metricKey)!;
  const sigma = Number(threshold) > 0 ? Number(threshold) : 2;

  const ranked = useMemo(() => {
    if (!data.data) return [];
    const hours = data.data.labourHours;
    return rankRows(
      data.data.rows,
      metric,
      (row) => ({ seats: row.seats, areaSqm: row.areaSqm, labourHours: hours?.get(row.branchId) ?? null }),
      normalisation,
      sigma,
    );
  }, [data.data, metric, normalisation, sigma]);

  const unit = normalisation === "absolute" || !metric.additive ? "" : t(`cst.rank.per.${normalisation}` as ConsoleKey);
  const top = ranked.find((entry) => entry.value !== null)?.value ?? 0;

  const format = (value: number | null) => {
    if (value === null) return "—";
    const currency = data.data?.rows[0]?.netSales.currency ?? "EGP";
    if (metric.kind === "percent") return formatPercent(value, fmt, 1);
    return formatMoney({ amount: Math.round(value), currency }, fmt, normalisation === "absolute");
  };

  const columns: Column<RankedRow<ProfitRow>>[] = [
    { key: "rank", header: "#", render: (entry) => <span className="font-mono tabular-nums">{entry.rank ?? "—"}</span> },
    { key: "branch", header: t("common.branch"), render: (entry) => tx(entry.row.branchName) },
    {
      key: "value",
      header: `${t(`cst.rank.metric.${metric.key}` as ConsoleKey)}${unit ? ` ${unit}` : ""}`,
      numeric: true,
      render: (entry) =>
        entry.missingBasis ? (
          <span className="text-fg-subtle text-xs">{t("cst.rank.missingBasis")}</span>
        ) : (
          <span
            className={cx("font-mono tabular-nums", entry.outlier && ((entry.z > 0) !== metric.higherIsBetter ? "text-bad font-semibold" : "text-good font-semibold"))}
            title={entry.outlier ? t("bsc.outlierTitle").replace("{z}", formatNumber(entry.z, fmt, 1)) : undefined}
          >
            {format(entry.value)}
          </span>
        ),
    },
    {
      key: "bar",
      header: "",
      render: (entry) =>
        entry.value === null || !top ? null : (
          <div className="w-28">
            <Meter value={(Math.abs(entry.value) / Math.abs(top)) * 100} tone={metric.higherIsBetter ? "accent" : "warn"} />
          </div>
        ),
    },
    { key: "seats", header: t("cst.rank.seats"), numeric: true, secondary: true, render: (entry) => formatNumber(entry.row.seats, fmt) },
    { key: "area", header: t("cst.rank.area"), numeric: true, secondary: true, render: (entry) => formatNumber(entry.row.areaSqm, fmt) },
    {
      key: "hours",
      header: t("cst.rank.labourHours"),
      numeric: true,
      secondary: true,
      render: (entry) => {
        const hours = data.data?.labourHours?.get(entry.row.branchId);
        return hours === undefined ? "—" : formatNumber(hours, fmt, 1);
      },
    },
    {
      key: "outlier",
      header: "",
      render: (entry) => (entry.outlier ? <Badge tone="warn">{`${entry.z > 0 ? "+" : ""}${formatNumber(entry.z, fmt, 1)}σ`}</Badge> : null),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("cst.rank.title")}
        subtitle={t("cst.rank.subtitle")}
        spec="FR-CST-037"
        actions={
          <ExportButton
            filename="branch-ranking"
            title={t("cst.rank.title")}
            filterSummary={`${t(`cst.rank.metric.${metric.key}` as ConsoleKey)}${unit ? ` ${unit}` : ""}`}
            rows={ranked}
            columns={[
              { key: "rank", header: "#", value: (entry) => entry.rank ?? "" },
              { key: "branch", header: t("common.branch"), value: (entry) => tx(entry.row.branchName) },
              {
                key: "value",
                header: t(`cst.rank.metric.${metric.key}` as ConsoleKey),
                value: (entry) =>
                  entry.value === null ? "" : metric.kind === "money" ? (entry.value / 100).toFixed(2) : entry.value.toFixed(2),
              },
              { key: "z", header: "z", value: (entry) => entry.z.toFixed(2) },
            ]}
          />
        }
      />
      <PageBody>
        <Card>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field label={t("bsc.rankBy")}>
              <Select value={metricKey} onChange={(event) => setMetricKey(event.target.value)}>
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(`cst.rank.metric.${m.key}` as ConsoleKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("bsc.normalise")} hint={metric.additive ? undefined : t("bsc.notAdditive")}>
              <SegmentedControl<Normalisation>
                value={normalisation}
                onChange={setNormalisation}
                options={[
                  { value: "absolute", label: t("cst.rank.norm.absolute") },
                  { value: "seat", label: t("bsc.norm.seat") },
                  { value: "area", label: t("bsc.norm.area") },
                  { value: "labourHour", label: t("cst.rank.norm.labourHour") },
                ]}
              />
            </Field>
            <Field label={t("bsc.threshold")} hint={t("bsc.thresholdHint")}>
              <Input dir="ltr" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="w-20 font-mono" />
            </Field>
          </div>
          <p className="text-fg-subtle mt-2 text-xs">
            {t("cst.rank.labourNote")}{" "}
            <Link href="/organisation/scorecard" className="text-accent underline">
              {t("cst.rank.scorecardLink")}
            </Link>
          </p>
        </Card>

        <AsyncPanel state={data} isEmpty={(ready) => ready.rows.length === 0}>
          {(ready) => (
            <>
              {normalisation === "labourHour" && ready.labourHours === null ? (
                <Callout tone="warn">{t("cst.rank.noAttendance")}</Callout>
              ) : null}
              <DataTable columns={columns} rows={ranked} rowKey={(entry) => entry.row.branchId} caption={t("cst.rank.title")} dense />
            </>
          )}
        </AsyncPanel>
      </PageBody>
    </>
  );
}
