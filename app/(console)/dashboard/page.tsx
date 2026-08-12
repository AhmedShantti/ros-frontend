"use client";

/**
 * Dashboard — SRS §19.4.
 *
 * Exception over enumeration: the tiles carry the eight figures an owner
 * actually acts on, the ranking surfaces outliers rather than listing every
 * branch politely, and the alert rail is what turns a number into a task.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import type { BranchRankingRow, Money, OperationalAlert } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/console/format";
import { ALERT_KIND, SEVERITY, labelOf } from "@/lib/console/labels";
import {
  CategoryBarChart,
  HourlyChart,
  MetricTile,
  MixDonut,
  TrendChart,
} from "@/components/console/charts";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { AsyncPanel, CardSkeleton, Gate, MetricSkeleton } from "@/components/console/states";
import { LiveTodayStrip } from "@/components/console/live-panels";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Meter,
  Toast,
} from "@/components/console/ui";

export default function DashboardPage() {
  const { t, fmt } = useI18n();
  const { scope } = useSession();
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [message, setMessage] = useTransientMessage();

  const state = useAsync(
    () => services.dashboard.get(scope),
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  return (
    <>
      <PageHeader
        title={t("dash.title")}
        subtitle={t("dash.subtitle")}
        spec="§19.4"
        meta={
          state.data ? (
            <>
              <span>
                {t("common.date")}: {formatDate(state.data.businessDay, fmt)}
              </span>
              <span>
                {t("dash.dataAsOf")}: {formatDateTime(state.data.generatedAt, fmt)}
              </span>
            </>
          ) : null
        }
      />

      <AsyncPanel
        state={state}
        skeleton={
          <PageBody>
            <TileGrid>
              {Array.from({ length: 4 }, (_, index) => (
                <MetricSkeleton key={index} />
              ))}
            </TileGrid>
            <CardSkeleton />
          </PageBody>
        }
      >
        {(data) => {
          const currency = data.currency;
          const money = (minor: number, compact = true) =>
            formatMoney({ amount: Math.round(minor), currency }, fmt, compact);
          /** Chart series are stored in major units; tiles are in minor. */
          const major = (value: number) =>
            formatAmount({ amount: Math.round(value * 100), currency }, fmt, true);

          const openAlerts = data.alerts.filter(
            (alert) => !alert.acknowledged && !acknowledged.includes(alert.id),
          );

          return (
            <PageBody>
              <LiveTodayStrip />
              <Callout tone="muted">{t("dash.partialDay")}</Callout>

              <TileGrid>
                <MetricTile
                  label={t("dash.netSales")}
                  value={money(data.netSales.value)}
                  metric={data.netSales}
                  spec="FR-DSH-002"
                />
                <MetricTile
                  label={t("dash.transactions")}
                  value={formatNumber(data.transactions.value, fmt)}
                  metric={data.transactions}
                />
                <MetricTile
                  label={t("dash.aov")}
                  value={money(data.averageOrderValue.value, false)}
                  metric={data.averageOrderValue}
                />
                <MetricTile
                  label={t("dash.grossProfit")}
                  value={money(data.grossProfit.value)}
                  metric={data.grossProfit}
                />
              </TileGrid>

              <TileGrid>
                <MetricTile
                  label={t("dash.foodCost")}
                  value={formatPercent(data.foodCostPercent.value, fmt)}
                  metric={data.foodCostPercent}
                  footer={<TargetLine metric={data.foodCostPercent} />}
                  spec="FR-CST-003"
                />
                <MetricTile
                  label={t("dash.labourCost")}
                  value={formatPercent(data.labourCostPercent.value, fmt)}
                  metric={data.labourCostPercent}
                  footer={<TargetLine metric={data.labourCostPercent} />}
                />
                <MetricTile
                  label={t("dash.primeCost")}
                  value={formatPercent(data.primeCostPercent.value, fmt)}
                  metric={data.primeCostPercent}
                  footer={<TargetLine metric={data.primeCostPercent} />}
                  spec="§13.5"
                />
                <MetricTile
                  label={t("dash.waste")}
                  value={formatPercent(data.wastePercent.value, fmt)}
                  metric={data.wastePercent}
                  footer={<TargetLine metric={data.wastePercent} />}
                />
              </TileGrid>

              <div className="grid gap-3 lg:grid-cols-3">
                <Section
                  className="lg:col-span-2"
                  title={t("dash.salesTrend")}
                  hint={t("dash.salesTrendHint")}
                  spec="FR-DSH-004"
                >
                  <TrendChart
                    data={data.salesTrend}
                    valueLabel={t("dash.netSales")}
                    comparisonLabel={t("common.vsPrevious")}
                    format={major}
                  />
                </Section>

                <Section title={t("dash.categoryMix")}>
                  <MixDonut
                    data={data.categoryMix}
                    format={major}
                    centreLabel={t("dash.netSales")}
                    centreValue={major(
                      data.categoryMix.reduce((sum, point) => sum + point.value, 0),
                    )}
                  />
                </Section>
              </div>

              <Section title={t("dash.hourly")} hint={t("dash.hourlyHint")} spec="FR-CST-032">
                <HourlyChart
                  data={data.hourly}
                  salesLabel={t("dash.netSales")}
                  labourLabel={t("dash.labourCost")}
                  forecastLabel={t("common.target")}
                  format={major}
                />
              </Section>

              <Section title={t("dash.live")} spec="FR-DSH-010">
                <LiveOperations snapshot={data.live} />
              </Section>

              <Gate permissions={["report.view.sales", "report.view.financial"]} silent>
                <Section
                  title={t("dash.branchRanking")}
                  hint={t("dash.branchRankingHint")}
                  spec="FR-BRN-013"
                  padded={false}
                >
                  <BranchRanking rows={data.branchRanking} />
                </Section>
              </Gate>

              <div className="grid gap-3 lg:grid-cols-2">
                <Gate permissions={["report.view.financial"]} silent>
                  <Section title={t("dash.profitability")} spec="§13.4">
                    <ProfitabilityLadder
                      ladder={data.profitability}
                      format={(value) => formatMoney(value, fmt, false)}
                    />
                  </Section>
                </Gate>

                <Section title={t("dash.wasteByReason")} spec="FR-CST-020">
                  <CategoryBarChart
                    data={data.wasteByReason}
                    valueLabel={t("dash.waste")}
                    format={major}
                    colourByIndex
                  />
                </Section>
              </div>

              <Section
                title={t("dash.alerts")}
                hint={t("dash.alertsHint")}
                spec="FR-ALT-001"
                action={
                  <Link
                    href="/approvals"
                    className="text-accent inline-flex items-center gap-1 text-xs font-medium"
                  >
                    {t("dash.viewAll")}
                    <ArrowRight size={12} className="rtl:rotate-180" />
                  </Link>
                }
              >
                {openAlerts.length === 0 ? (
                  <p className="text-fg-muted py-6 text-center text-xs">{t("dash.noAlerts")}</p>
                ) : (
                  <ul className="divide-line divide-y">
                    {openAlerts.map((alert) => (
                      <AlertRow
                        key={alert.id}
                        alert={alert}
                        onAcknowledge={() => {
                          setAcknowledged((current) => [...current, alert.id]);
                          setMessage(t("common.approved"));
                        }}
                      />
                    ))}
                  </ul>
                )}
              </Section>
            </PageBody>
          );
        }}
      </AsyncPanel>

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tile footer: distance to target
// ---------------------------------------------------------------------------

function TargetLine({ metric }: { metric: { value: number; target: number | null } }) {
  const { t, fmt } = useI18n();
  if (metric.target === null) return null;

  const over = metric.value > metric.target;
  return (
    <span className="flex items-center gap-2">
      <span>
        {t("common.target")} {formatPercent(metric.target, fmt, 0)}
      </span>
      <Meter
        className="w-16"
        value={(metric.value / Math.max(metric.target, 0.1)) * 100}
        tone={over ? "bad" : "good"}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live operations
// ---------------------------------------------------------------------------

function LiveOperations({
  snapshot,
}: {
  snapshot: {
    openOrders: number;
    tablesOccupied: number;
    tablesTotal: number;
    kitchenQueueDepth: number;
    averageWaitSeconds: number;
    activeTerminals: number;
    totalTerminals: number;
    offlineTerminals: number;
    staffOnShift: number;
    delayedTickets: number;
    syncBacklog: number;
  };
}) {
  const { t, fmt } = useI18n();

  const cells = [
    { label: t("live.openOrders"), value: formatNumber(snapshot.openOrders, fmt) },
    {
      label: t("live.tables"),
      value: `${formatNumber(snapshot.tablesOccupied, fmt)} / ${formatNumber(snapshot.tablesTotal, fmt)}`,
    },
    { label: t("live.queue"), value: formatNumber(snapshot.kitchenQueueDepth, fmt) },
    { label: t("live.avgWait"), value: formatDuration(snapshot.averageWaitSeconds, fmt) },
    {
      label: t("live.terminals"),
      value: `${formatNumber(snapshot.activeTerminals, fmt)} / ${formatNumber(snapshot.totalTerminals, fmt)}`,
      tone: snapshot.offlineTerminals > 0 ? ("warn" as const) : undefined,
    },
    { label: t("live.staff"), value: formatNumber(snapshot.staffOnShift, fmt) },
    {
      label: t("live.delayed"),
      value: formatNumber(snapshot.delayedTickets, fmt),
      tone: snapshot.delayedTickets > 0 ? ("bad" as const) : undefined,
    },
    {
      label: t("live.syncBacklog"),
      value: `${formatNumber(snapshot.syncBacklog, fmt)} ${t("live.operations")}`,
      tone: snapshot.syncBacklog > 0 ? ("warn" as const) : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label}>
          <p className="text-fg-subtle text-xs">{cell.label}</p>
          <p
            className={
              cell.tone === "bad"
                ? "text-bad mt-1 font-mono text-lg tabular-nums"
                : cell.tone === "warn"
                  ? "text-warn mt-1 font-mono text-lg tabular-nums"
                  : "text-fg mt-1 font-mono text-lg tabular-nums"
            }
          >
            {cell.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branch ranking
// ---------------------------------------------------------------------------

function BranchRanking({ rows }: { rows: BranchRankingRow[] }) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<BranchRankingRow>[]>(
    () => [
      {
        key: "rank",
        header: t("dash.rank"),
        width: "3.5rem",
        render: (row) => (
          <span className="text-fg-muted font-mono tabular-nums">{row.rank}</span>
        ),
      },
      {
        key: "branch",
        header: t("common.branch"),
        render: (row) => (
          <CellStack primary={tx(row.branchName)} secondary={tx(row.brandName)} />
        ),
      },
      {
        key: "netSales",
        header: t("dash.netSales"),
        numeric: true,
        render: (row) => formatMoney(row.netSales, fmt, true),
      },
      {
        key: "transactions",
        header: t("dash.transactions"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.transactionCount, fmt),
      },
      {
        key: "aov",
        header: t("dash.aov"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.averageOrderValue, fmt, false),
      },
      {
        key: "foodCost",
        header: t("dash.foodCost"),
        numeric: true,
        render: (row) => formatPercent(row.foodCostPercent, fmt),
      },
      {
        key: "prime",
        header: t("dash.prime"),
        numeric: true,
        hint: t("dash.branchRankingHint"),
        render: (row) => (
          <span className={row.primeCostPercent > 65 ? "text-bad" : undefined}>
            {formatPercent(row.primeCostPercent, fmt)}
          </span>
        ),
      },
      {
        key: "outlier",
        header: "σ",
        numeric: true,
        render: (row) =>
          Math.abs(row.outlierSigma) >= 1.5 ? (
            <Badge tone="warn" dot>
              {t("dash.outlier")}
            </Badge>
          ) : (
            <span className="text-fg-subtle">{formatNumber(row.outlierSigma, fmt, 1)}</span>
          ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.branchId}
      caption={t("dash.branchRanking")}
      dense
    />
  );
}

// ---------------------------------------------------------------------------
// Profitability ladder
// ---------------------------------------------------------------------------

function ProfitabilityLadder({
  ladder,
  format,
}: {
  ladder: Record<string, Money>;
  format: (value: Money) => string;
}) {
  const { t } = useI18n();

  const lines: { key: string; label: string; negative?: boolean; strong?: boolean }[] = [
    { key: "grossSales", label: t("pl.grossSales") },
    { key: "discounts", label: t("pl.discounts"), negative: true },
    { key: "refunds", label: t("pl.refunds"), negative: true },
    { key: "netSales", label: t("pl.netSales"), strong: true },
    { key: "cogs", label: t("pl.cogs"), negative: true },
    { key: "grossProfit", label: t("pl.grossProfit"), strong: true },
    { key: "labourCost", label: t("pl.labour"), negative: true },
    { key: "contribution", label: t("pl.contribution"), strong: true },
    { key: "operatingExpenses", label: t("pl.opex"), negative: true },
    { key: "operatingProfit", label: t("pl.operatingProfit"), strong: true },
  ];

  // The ladder's own key names differ from the copy keys in two places.
  const valueOf = (key: string): Money | undefined =>
    key === "contribution" ? ladder.contributionAfterLabour : ladder[key];

  return (
    <DescList>
      {lines.map((line) => {
        const value = valueOf(line.key);
        if (!value) return null;
        return (
          <DescRow
            key={line.key}
            mono
            label={<span className={line.strong ? "text-fg font-medium" : undefined}>{line.label}</span>}
          >
            <span className={line.negative ? "text-fg-muted" : undefined}>
              {line.negative ? "−" : ""}
              {format(value)}
            </span>
          </DescRow>
        );
      })}
    </DescList>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function AlertRow({
  alert,
  onAcknowledge,
}: {
  alert: OperationalAlert;
  onAcknowledge: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const severity = labelOf(SEVERITY, alert.severity);
  const kind = labelOf(ALERT_KIND, alert.kind);

  return (
    <li className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
      <AlertTriangle
        size={15}
        className={
          alert.severity === "critical" || alert.severity === "high"
            ? "text-bad mt-0.5 shrink-0"
            : "text-warn mt-0.5 shrink-0"
        }
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-fg text-sm font-medium">{tx(alert.title)}</p>
          <Badge tone={severity.tone}>{tx(severity.label)}</Badge>
          <Badge tone="muted">{tx(kind.label)}</Badge>
        </div>
        <p className="text-fg-muted mt-1 text-xs leading-relaxed">{tx(alert.detail)}</p>
        <p className="text-fg-subtle mt-1 text-[0.68rem]">
          {alert.branchName ? `${tx(alert.branchName)} · ` : ""}
          {formatRelative(alert.raisedAt, fmt)} · {alert.specRef}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {alert.href ? (
          <Link
            href={alert.href}
            className="text-accent inline-flex items-center gap-1 text-xs font-medium"
          >
            {t("common.view")}
            <ArrowRight size={12} className="rtl:rotate-180" />
          </Link>
        ) : null}
        <Button size="sm" icon={<Check size={12} />} onClick={onAcknowledge}>
          {t("dash.acknowledge")}
        </Button>
      </div>
    </li>
  );
}
