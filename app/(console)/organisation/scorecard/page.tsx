"use client";

/**
 * Branch scorecard — SRS §17.3, FR-BRN-010 … FR-BRN-014.
 *
 * Comparing branches is only fair once size is taken out: a 120-seat
 * flagship will out-sell a 30-seat kiosk every day and prove nothing by it.
 * So every additive figure can be read per seat, per square metre or per
 * trading hour (FR-BRN-011); percentages are already size-free and are left
 * alone. Outliers are flagged against the group's own spread (FR-BRN-013),
 * and a branch still in its opening months can be kept out of the average it
 * is compared with (FR-BRN-014), because a new site's numbers pull the mean
 * and then make every mature branch look unusual.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import type { Branch, BranchRankingRow, DashboardData } from "@/lib/console/types";
import type { OperatingHours } from "@/lib/console/services/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section } from "@/components/console/page";
import { ExportButton } from "@/components/console/export-button";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Badge, Callout, Card, Field, Input, Meter, SegmentedControl, Select, Toast, Toggle, cx } from "@/components/console/ui";

export default function ScorecardPage() {
  return (
    <Gate permissions={["report.view.sales", "org.manage", "costing.view"]}>
      <Scorecard />
    </Gate>
  );
}

type MetricKey =
  | "netSales"
  | "transactionCount"
  | "averageOrderValue"
  | "foodCostPercent"
  | "labourCostPercent"
  | "primeCostPercent"
  | "wastePercent"
  | "varianceValue";

type Normalise = "none" | "seat" | "area" | "tradingHour";

interface MetricDef {
  key: MetricKey;
  kind: "money" | "count" | "percent";
  higherIsBetter: boolean;
  /** Only additive figures change with the size of the branch. */
  additive: boolean;
  read: (row: BranchRankingRow) => number | null;
}

const METRICS: MetricDef[] = [
  { key: "netSales", kind: "money", higherIsBetter: true, additive: true, read: (row) => row.netSales.amount },
  { key: "transactionCount", kind: "count", higherIsBetter: true, additive: true, read: (row) => row.transactionCount },
  { key: "averageOrderValue", kind: "money", higherIsBetter: true, additive: false, read: (row) => row.averageOrderValue.amount },
  { key: "foodCostPercent", kind: "percent", higherIsBetter: false, additive: false, read: (row) => row.foodCostPercent },
  { key: "labourCostPercent", kind: "percent", higherIsBetter: false, additive: false, read: (row) => row.labourCostPercent },
  { key: "primeCostPercent", kind: "percent", higherIsBetter: false, additive: false, read: (row) => row.primeCostPercent },
  { key: "wastePercent", kind: "percent", higherIsBetter: false, additive: false, read: (row) => row.wastePercent },
  { key: "varianceValue", kind: "money", higherIsBetter: false, additive: true, read: (row) => (row.varianceValue ? Math.abs(row.varianceValue.amount) : null) },
];

function hoursOn(hours: OperatingHours[], dayOfWeek: number): number | null {
  const today = hours.filter((row) => row.dayOfWeek === dayOfWeek);
  if (today.length === 0) return null;
  return today.reduce((sum, row) => {
    const [oh, om] = row.opensAt.split(":").map(Number);
    const [ch, cm] = row.closesAt.split(":").map(Number);
    let minutes = (ch! * 60 + cm!) - (oh! * 60 + om!);
    if (minutes <= 0) minutes += 24 * 60; // overnight
    return sum + minutes / 60;
  }, 0);
}

function monthsSince(iso: string, now = new Date()): number {
  const opened = new Date(iso);
  return (now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth());
}

function Scorecard() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  const [message, setMessage] = useTransientMessage();
  const [metric, setMetric] = useState<MetricKey>("netSales");
  const [normalise, setNormalise] = useState<Normalise>("none");
  const [threshold, setThreshold] = useState("2");
  const [likeForLike, setLikeForLike] = useState(false);
  const [maturity, setMaturity] = useState("12");

  const data = useAsync(async () => {
    const dashboard = await services.dashboard.get({ ...scope, branchId: null });
    const hours = await Promise.all(
      dashboard.branchRanking.map((row) =>
        services.organisation
          .operatingHours(row.branchId)
          .then((rows) => [row.branchId, rows] as const)
          .catch(() => [row.branchId, [] as OperatingHours[]] as const),
      ),
    );
    return { dashboard, hours: new Map(hours) };
  }, [scope.tenantId, scope.brandId]);

  const branchById = useMemo(() => new Map(availableBranches.map((row) => [row.id, row])), [availableBranches]);
  const def = METRICS.find((row) => row.key === metric)!;
  const sigma = Number(threshold) > 0 ? Number(threshold) : 2;
  const matureMonths = Math.max(0, Number(maturity) || 0);

  const rows = useMemo(() => {
    const dashboard: DashboardData | undefined = data.data?.dashboard;
    if (!dashboard) return [];
    const weekday = new Date(`${dashboard.businessDay}T12:00:00`).getDay();

    const divisor = (branch: Branch | undefined, branchId: string): number | null => {
      if (normalise === "none") return 1;
      if (!branch) return null;
      if (normalise === "seat") return branch.seats > 0 ? branch.seats : null;
      if (normalise === "area") return branch.areaSqm > 0 ? branch.areaSqm : null;
      return hoursOn(data.data?.hours.get(branchId) ?? [], weekday);
    };

    const base = dashboard.branchRanking.map((row) => {
      const branch = branchById.get(row.branchId);
      const values = Object.fromEntries(
        METRICS.map((m) => {
          const raw = m.read(row);
          if (raw === null) return [m.key, null];
          if (!m.additive) return [m.key, raw];
          const d = divisor(branch, row.branchId);
          return [m.key, d === null ? null : raw / d];
        }),
      ) as Record<MetricKey, number | null>;
      const mature = branch ? monthsSince(branch.openedAt) >= matureMonths : true;
      return { row, branch, values, mature };
    });

    // FR-BRN-013 / FR-BRN-014 — mean and spread from the comparison group.
    const stats = Object.fromEntries(
      METRICS.map((m) => {
        const pool = base
          .filter((entry) => !likeForLike || entry.mature)
          .map((entry) => entry.values[m.key])
          .filter((value): value is number => value !== null);
        const mean = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
        const sd = pool.length > 1 ? Math.sqrt(pool.reduce((a, b) => a + (b - mean) ** 2, 0) / (pool.length - 1)) : 0;
        return [m.key, { mean, sd }];
      }),
    ) as Record<MetricKey, { mean: number; sd: number }>;

    const ranked = [...base].sort((a, b) => {
      const x = a.values[metric];
      const y = b.values[metric];
      if (x === null) return 1;
      if (y === null) return -1;
      return def.higherIsBetter ? y - x : x - y;
    });

    return ranked.map((entry, index) => ({
      ...entry,
      rank: entry.values[metric] === null ? null : index + 1,
      z: Object.fromEntries(
        METRICS.map((m) => {
          const value = entry.values[m.key];
          const { mean, sd } = stats[m.key];
          return [m.key, value === null || sd === 0 ? 0 : (value - mean) / sd];
        }),
      ) as Record<MetricKey, number>,
      groupMean: stats,
    }));
  }, [data.data, branchById, normalise, likeForLike, matureMonths, metric, def]);

  type Row = (typeof rows)[number];
  const top = rows.find((entry) => entry.values[metric] !== null)?.values[metric] ?? 0;

  const format = (m: MetricDef, value: number | null) => {
    if (value === null) return "—";
    const currency = data.data?.dashboard.currency ?? "EGP";
    if (m.kind === "percent") return formatPercent(value, fmt);
    if (m.kind === "money") return formatMoney({ amount: Math.round(value), currency }, fmt, normalise === "none");
    return formatNumber(value, fmt, normalise === "none" ? 0 : 1);
  };

  const unit = normalise === "none" ? "" : t(`bsc.per.${normalise}` as ConsoleKey);

  const columns: Column<Row>[] = [
    {
      key: "rank",
      header: "#",
      render: (entry) => {
        // Movement is only meaningful against the prior period's ranking on
        // the same basis, which the server gives for net sales, unnormalised.
        const comparable = metric === "netSales" && normalise === "none" && entry.row.previousRank !== null;
        const move = comparable ? entry.row.previousRank! - (entry.rank ?? 0) : 0;
        return (
          <span className="flex items-center gap-1 font-mono tabular-nums">
            {entry.rank ?? "—"}
            {comparable ? (
              move > 0 ? (
                <ArrowUp size={11} className="text-good" aria-label={t("bsc.up").replace("{n}", String(move))} />
              ) : move < 0 ? (
                <ArrowDown size={11} className="text-bad" aria-label={t("bsc.down").replace("{n}", String(-move))} />
              ) : (
                <Minus size={11} className="text-fg-subtle" aria-hidden />
              )
            ) : null}
          </span>
        );
      },
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: (entry) => (
        <span className="flex flex-col">
          <span className="text-fg text-sm">{tx(entry.row.branchName)}</span>
          <span className="text-fg-subtle text-xs">
            {tx(entry.row.brandName)}
            {!entry.mature ? ` · ${t("bsc.immature")}` : ""}
          </span>
        </span>
      ),
    },
    ...METRICS.map<Column<Row>>((m) => ({
      key: m.key,
      header: t(`bsc.metric.${m.key}` as ConsoleKey),
      numeric: true,
      secondary: m.key !== metric && m.key !== "netSales",
      render: (entry) => {
        const z = entry.z[m.key];
        const outlier = Math.abs(z) > sigma;
        const bad = outlier && (z > 0) !== m.higherIsBetter;
        return (
          <span
            className={cx("font-mono tabular-nums", outlier && (bad ? "text-bad font-semibold" : "text-good font-semibold"))}
            title={outlier ? t("bsc.outlierTitle").replace("{z}", formatNumber(z, fmt, 1)) : undefined}
          >
            {format(m, entry.values[m.key])}
            {outlier ? " •" : ""}
          </span>
        );
      },
    })),
    {
      key: "bar",
      header: "",
      render: (entry) =>
        entry.values[metric] === null || !top ? null : (
          <div className="w-24">
            <Meter value={(Math.abs(entry.values[metric]!) / Math.abs(top)) * 100} tone={def.higherIsBetter ? "accent" : "warn"} />
          </div>
        ),
    },
  ];

  const outliers = rows.filter((entry) => METRICS.some((m) => Math.abs(entry.z[m.key]) > sigma));

  return (
    <>
      <PageHeader
        title={t("bsc.title")}
        subtitle={t("bsc.subtitle")}
        spec="FR-BRN-010"
        actions={
          <ExportButton
            filename="branch-scorecard"
            title={t("bsc.title")}
            filterSummary={`${t(`bsc.metric.${metric}` as ConsoleKey)}${unit ? ` · ${unit}` : ""}`}
            rows={rows}
            onExported={setMessage}
            columns={[
              { key: "rank", header: "#", value: (entry) => entry.rank ?? "" },
              { key: "branch", header: t("common.branch"), value: (entry) => tx(entry.row.branchName) },
              ...METRICS.map((m) => ({
                key: m.key,
                header: t(`bsc.metric.${m.key}` as ConsoleKey),
                value: (entry: Row) => {
                  const value = entry.values[m.key];
                  if (value === null) return "";
                  return m.kind === "money" ? Math.round(value) / 100 : Number(value.toFixed(2));
                },
              })),
            ]}
          />
        }
      />
      <PageBody>
        <Card>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field label={t("bsc.rankBy")}>
              <Select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}>
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {t(`bsc.metric.${m.key}` as ConsoleKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("bsc.normalise")} hint={def.additive ? undefined : t("bsc.notAdditive")}>
              <SegmentedControl<Normalise>
                value={normalise}
                onChange={setNormalise}
                options={[
                  { value: "none", label: t("bsc.norm.none") },
                  { value: "seat", label: t("bsc.norm.seat") },
                  { value: "area", label: t("bsc.norm.area") },
                  { value: "tradingHour", label: t("bsc.norm.tradingHour") },
                ]}
              />
            </Field>
            <Field label={t("bsc.threshold")} hint={t("bsc.thresholdHint")}>
              <Input dir="ltr" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="w-20 font-mono" />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <Toggle checked={likeForLike} onChange={setLikeForLike} label={t("bsc.likeForLike")} hint={t("bsc.likeForLikeHint")} />
            {likeForLike ? (
              <Field label={t("bsc.maturity")}>
                <Input dir="ltr" inputMode="numeric" value={maturity} onChange={(event) => setMaturity(event.target.value)} className="w-20 font-mono" />
              </Field>
            ) : null}
          </div>
          <p className="text-fg-subtle mt-2 text-xs">
            {t("bsc.labourHoursNote")} {t("bsc.missingMeasures")}
          </p>
        </Card>

        <AsyncPanel state={data} isEmpty={(ready) => ready.dashboard.branchRanking.length === 0}>
          {(ready) => (
            <>
              <Callout tone="muted">
                {t("bsc.period").replace("{day}", ready.dashboard.businessDay)}
                {unit ? ` ${t("bsc.showingPer").replace("{unit}", unit)}` : ""}
              </Callout>
              <DataTable columns={columns} rows={rows} rowKey={(entry) => entry.row.branchId} caption={t("bsc.title")} dense />
              <Section title={t("bsc.outliers")} hint={t("bsc.outliersHint").replace("{n}", String(sigma))}>
                {outliers.length === 0 ? (
                  <p className="text-fg-muted text-sm">{t("bsc.noOutliers")}</p>
                ) : (
                  <ul className="space-y-2">
                    {outliers.map((entry) => (
                      <li key={entry.row.branchId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-fg font-medium">{tx(entry.row.branchName)}</span>
                        {METRICS.filter((m) => Math.abs(entry.z[m.key]) > sigma).map((m) => {
                          const bad = (entry.z[m.key] > 0) !== m.higherIsBetter;
                          return (
                            <Badge key={m.key} tone={bad ? "bad" : "good"}>
                              {t(`bsc.metric.${m.key}` as ConsoleKey)} {entry.z[m.key] > 0 ? "+" : ""}
                              {formatNumber(entry.z[m.key], fmt, 1)}σ
                            </Badge>
                          );
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}
