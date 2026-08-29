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
import type { BranchRankingRow, Money, OperationalAlert, OrderType, TenderType } from "@/lib/console/types";
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
import { ALERT_KIND, ORDER_TYPE, SEVERITY, TENDER_TYPE, labelOf } from "@/lib/console/labels";
import { orders } from "@/lib/console/mock/sales";
import { cashSessions } from "@/lib/console/mock/finance";
import { branches } from "@/lib/console/mock/org";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { menuCategories, menuItemById } from "@/lib/console/mock/catalogue";
import {
  CategoryBarChart,
  HourlyChart,
  MetricTile,
  MixDonut,
  TrendChart,
} from "@/components/console/charts";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { AsyncPanel, CardSkeleton, Gate, MetricSkeleton } from "@/components/console/states";
import { LiveTodayStrip, useLiveAlerts } from "@/components/console/live-panels";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Field,
  Meter,
  Select,
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

  const liveAlerts = useLiveAlerts();

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

          // What the terminals on this device have actually raised goes
          // first: a negative balance or a ticket past its threshold is
          // happening now, where the fixtures describe a seeded yesterday.
          const openAlerts = [...liveAlerts, ...data.alerts].filter(
            (alert) => !alert.acknowledged && !acknowledged.includes(alert.id),
          );

          return (
            <PageBody>
              <LiveTodayStrip />

              <MorningBrief
                metrics={[
                  { label: t("dash.foodCost"), metric: data.foodCostPercent },
                  { label: t("dash.labourCost"), metric: data.labourCostPercent },
                  { label: t("dash.primeCost"), metric: data.primeCostPercent },
                  { label: t("dash.waste"), metric: data.wastePercent },
                ]}
                ranking={data.branchRanking}
                alerts={openAlerts}
              />

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

      <OrderActivitySection />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Morning brief — FR-RPT-041
// ---------------------------------------------------------------------------

/**
 * The prior business day, stated as exceptions rather than totals.
 *
 * §19.1 principle 1: the default view surfaces what is abnormal, not what
 * happened. A manager should not have to scan four tile rows to notice that
 * one number is wrong — so anything at or under target is deliberately not
 * mentioned here at all. When nothing is out of tolerance the panel says so
 * in one line and stops.
 */
function MorningBrief({
  metrics,
  ranking,
  alerts,
}: {
  metrics: { label: string; metric: { value: number; target: number | null } }[];
  ranking: BranchRankingRow[];
  alerts: OperationalAlert[];
}) {
  const { t, tx, fmt } = useI18n();

  const overTarget = metrics.filter(
    (m) => m.metric.target !== null && m.metric.value > m.metric.target,
  );

  // The outlier worth naming is the one furthest from the group mean, and
  // only when it clears the 1.5σ bar the branch ranking already uses.
  const outlier = [...ranking]
    .filter((row) => Math.abs(row.outlierSigma) >= 1.5)
    .sort((a, b) => Math.abs(b.outlierSigma) - Math.abs(a.outlierSigma))[0];

  const severe = alerts.filter(
    (a) => a.severity === "critical" || a.severity === "high",
  ).length;

  const clear = overTarget.length === 0 && !outlier && alerts.length === 0;

  return (
    <Section title={t("dash.briefTitle")} hint={t("dash.briefHint")} spec="FR-RPT-041">
      {clear ? (
        <Callout tone="good">{t("dash.briefAllClear")}</Callout>
      ) : (
        <ul className="space-y-2.5">
          {overTarget.map(({ label, metric }) => (
            <li key={label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge tone="bad" dot>
                {formatPercent(metric.value, fmt)}
              </Badge>
              <span className="text-fg font-medium">{label}</span>
              <span className="text-fg-muted">
                {t("dash.briefOverTarget")} {formatPercent(metric.target ?? 0, fmt, 0)}
              </span>
            </li>
          ))}

          {outlier ? (
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge tone="warn" dot>
                {formatNumber(outlier.outlierSigma, fmt, 1)}σ
              </Badge>
              <span className="text-fg font-medium">{tx(outlier.branchName)}</span>
              <span className="text-fg-muted">{t("dash.briefWatchBranch")}</span>
            </li>
          ) : (
            <li className="text-fg-subtle text-xs">{t("dash.briefNothingToday")}</li>
          )}

          {alerts.length > 0 ? (
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge tone={severe > 0 ? "bad" : "warn"} dot>
                {formatNumber(alerts.length, fmt)}
              </Badge>
              <span className="text-fg-muted">
                {t("dash.briefAlerts")} {formatNumber(severe, fmt)}{" "}
                {t("dash.briefCritical")}
              </span>
            </li>
          ) : null}
        </ul>
      )}
    </Section>
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

// ---------------------------------------------------------------------------
// Order activity — filterable, and read straight off real orders
// ---------------------------------------------------------------------------

type DateFilter = "all" | "today" | "yesterday" | "last7";
const REVENUE_STATES = new Set(["completed", "partially_refunded", "refunded"]);
const DASHBOARD_ORDER_TYPES: OrderType[] = ["dine_in", "takeaway", "pickup", "drive_thru"];

/**
 * Everything in this section is derived from the real `orders` fixture, not
 * the pre-aggregated tenant economy `services.dashboard` serves above — that
 * is what lets Branch, Cashier, Order type and Payment method actually change
 * the numbers rather than only relabelling a chart nothing recomputed.
 */
function OrderActivitySection() {
  const { t, tx, fmt } = useI18n();
  const [dateFilter, setDateFilter] = useState<DateFilter>("last7");
  const [branchId, setBranchId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [orderType, setOrderType] = useState<OrderType | "all">("all");
  const [tender, setTender] = useState<TenderType | "all">("all");

  const rows = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return orders.filter((o) => {
      const age = now - new Date(o.openedAt).getTime();
      if (dateFilter === "today" && age >= dayMs) return false;
      if (dateFilter === "yesterday" && (age < dayMs || age >= 2 * dayMs)) return false;
      if (dateFilter === "last7" && age >= 7 * dayMs) return false;
      if (branchId !== "all" && o.branchId !== branchId) return false;
      if (employeeId !== "all" && o.openedBy !== employeeId) return false;
      if (orderType !== "all" && o.orderType !== orderType) return false;
      if (tender !== "all" && !o.payments.some((p) => p.tender === tender && p.amount.amount > 0))
        return false;
      return true;
    });
  }, [dateFilter, branchId, employeeId, orderType, tender]);

  const currency = rows[0]?.currency ?? "EGP";

  const totals = useMemo(() => {
    let grossSales = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let serviceChargeTotal = 0;
    let cashSales = 0;
    let cardSales = 0;
    let otherSales = 0;
    let refundTotal = 0;
    let cancelledOrders = 0;
    let completedCount = 0;
    let offlineOrders = 0;
    let pendingSync = 0;
    let syncedOffline = 0;
    const byType = new Map<OrderType, number>();
    const byCashier = new Map<string, { name: string; amount: number }>();
    const byBranch = new Map<string, { name: string; amount: number }>();
    const byCategory = new Map<string, { name: string; amount: number }>();
    const byItem = new Map<string, { name: string; qty: number; amount: number }>();
    const byHour = new Array(24).fill(0) as number[];

    for (const order of rows) {
      byHour[new Date(order.openedAt).getHours()] += 1;
      byType.set(order.orderType, (byType.get(order.orderType) ?? 0) + 1);

      if (order.state === "cancelled") cancelledOrders += 1;

      if (REVENUE_STATES.has(order.state)) {
        completedCount += 1;
        grossSales += order.subtotal.amount;
        discountTotal += order.discountTotal.amount;
        taxTotal += order.taxTotal.amount;
        serviceChargeTotal += order.serviceChargeTotal.amount;

        const netForOrder =
          order.subtotal.amount - order.discountTotal.amount + order.serviceChargeTotal.amount;
        const cashierKey = order.openedBy;
        const cashier = byCashier.get(cashierKey) ?? { name: tx(order.openedByName), amount: 0 };
        cashier.amount += netForOrder;
        byCashier.set(cashierKey, cashier);

        const branch = byBranch.get(order.branchId) ?? { name: tx(order.branchName), amount: 0 };
        branch.amount += netForOrder;
        byBranch.set(order.branchId, branch);

        for (const line of order.lines) {
          if (line.state === "voided") continue;
          const menuItem = menuItemById.get(line.menuItemId);
          const categoryId = menuItem?.categoryId ?? "unknown";
          const category = menuCategories.find((c) => c.id === categoryId);
          const catEntry = byCategory.get(categoryId) ?? {
            name: category ? tx(category.name) : t("common.uncategorised"),
            amount: 0,
          };
          catEntry.amount += line.lineSubtotal.amount;
          byCategory.set(categoryId, catEntry);

          const itemEntry = byItem.get(line.menuItemId) ?? {
            name: tx(line.itemNameSnapshot),
            qty: 0,
            amount: 0,
          };
          itemEntry.qty += line.quantity;
          itemEntry.amount += line.lineSubtotal.amount;
          byItem.set(line.menuItemId, itemEntry);
        }
      }

      for (const payment of order.payments) {
        const amount = payment.amount.amount;
        if (amount >= 0) {
          if (payment.tender === "cash") cashSales += amount;
          else if (payment.tender === "card") cardSales += amount;
          else otherSales += amount;
        } else {
          refundTotal += -amount;
        }
      }

      if (order.syncState === "pending") pendingSync += 1;
      if (order.syncState === "pending" || order.syncState === "conflicted") offlineOrders += 1;
      if (order.syncState === "synced" && order.syncedAt) {
        const gapMs = new Date(order.syncedAt).getTime() - new Date(order.openedAt).getTime();
        if (gapMs > 60_000) {
          offlineOrders += 1;
          syncedOffline += 1;
        }
      }
    }

    const netSales = grossSales - discountTotal + serviceChargeTotal;
    const bestSelling = [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const lowestSelling = [...byItem.values()].sort((a, b) => a.amount - b.amount).slice(0, 5);
    const salesByCashier = [...byCashier.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
    const salesByBranch = [...byBranch.values()].sort((a, b) => b.amount - a.amount);
    const salesByCategory = [...byCategory.values()].sort((a, b) => b.amount - a.amount);

    return {
      grossSales,
      netSales,
      discountTotal,
      taxTotal,
      serviceChargeTotal,
      cashSales,
      cardSales,
      otherSales,
      refundTotal,
      cancelledOrders,
      totalOrders: rows.length,
      averageOrderValue: completedCount > 0 ? Math.round(netSales / completedCount) : 0,
      byType,
      byHour,
      bestSelling,
      lowestSelling,
      salesByCashier,
      salesByBranch,
      salesByCategory,
      offlineOrders,
      pendingSync,
      syncedOffline,
    };
  }, [rows, tx, t]);

  const shiftCounts = useMemo(() => {
    const scoped = branchId === "all" ? cashSessions : cashSessions.filter((s) => s.branchId === branchId);
    return {
      open: scoped.filter((s) => s.status === "open" || s.status === "closing").length,
      closed: scoped.filter((s) => s.status === "closed" || s.status === "force_closed").length,
      cashDifference: scoped.reduce((s, x) => s + x.variance.amount, 0),
    };
  }, [branchId]);

  const money = (minor: number) => formatMoney({ amount: Math.round(minor), currency }, fmt, true);

  return (
    <PageBody>
      <Section
        title={t("dash.activityTitle")}
        hint={t("dash.activityHint")}
        action={
          <Toolbar>
            <Field label={t("common.date")}>
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}>
                <option value="all">{t("common.all")}</option>
                <option value="today">{t("filter.today")}</option>
                <option value="yesterday">{t("filter.yesterday")}</option>
                <option value="last7">{t("filter.last7")}</option>
              </Select>
            </Field>
            <Field label={t("common.branch")}>
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="all">{t("common.all")}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {tx(b.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fin.cashier")}>
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="all">{t("common.all")}</option>
                {activeEmployees
                  .filter((e) => branchId === "all" || e.homeBranchId === branchId)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {tx(e.name)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t("orders.type")}>
              <Select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as OrderType | "all")}
              >
                <option value="all">{t("common.all")}</option>
                {DASHBOARD_ORDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tx(ORDER_TYPE[type].label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("pos.tender")}>
              <Select value={tender} onChange={(e) => setTender(e.target.value as TenderType | "all")}>
                <option value="all">{t("common.all")}</option>
                {(["cash", "card", "wallet", "gift_card", "loyalty_points"] as TenderType[]).map((tv) => (
                  <option key={tv} value={tv}>
                    {tx(TENDER_TYPE[tv].label)}
                  </option>
                ))}
              </Select>
            </Field>
          </Toolbar>
        }
      >
        <TileGrid>
          <MetricTile label={t("dash.grossSales")} value={money(totals.grossSales)} />
          <MetricTile label={t("shift.netSales")} value={money(totals.netSales)} />
          <MetricTile label={t("dash.totalOrders")} value={formatNumber(totals.totalOrders, fmt, 0)} />
          <MetricTile label={t("dash.aov")} value={money(totals.averageOrderValue)} />
          <MetricTile label={t("orders.tax")} value={money(totals.taxTotal)} />
          <MetricTile label={t("orders.serviceCharge")} value={money(totals.serviceChargeTotal)} />
          <MetricTile label={t("pos.discountTotal")} value={money(totals.discountTotal)} />
          <MetricTile label={t("shift.refunds")} value={money(totals.refundTotal)} />
          <MetricTile
            label={t("shift.cancelledOrders")}
            value={formatNumber(totals.cancelledOrders, fmt, 0)}
          />
          <MetricTile label={t("shift.cashSales")} value={money(totals.cashSales)} />
          <MetricTile label={t("shift.cardSales")} value={money(totals.cardSales)} />
          <MetricTile label={t("shift.otherSales")} value={money(totals.otherSales)} />
        </TileGrid>

        <TileGrid columns={4}>
          {DASHBOARD_ORDER_TYPES.map((type) => (
            <MetricTile
              key={type}
              label={tx(ORDER_TYPE[type].label)}
              value={formatNumber(totals.byType.get(type) ?? 0, fmt, 0)}
            />
          ))}
        </TileGrid>

        <TileGrid>
          <MetricTile label={t("dash.openShifts")} value={formatNumber(shiftCounts.open, fmt, 0)} />
          <MetricTile label={t("dash.closedShifts")} value={formatNumber(shiftCounts.closed, fmt, 0)} />
          <MetricTile label={t("dash.cashDrawerDiff")} value={money(shiftCounts.cashDifference)} />
          <MetricTile
            label={t("dash.offlineOrders")}
            value={formatNumber(totals.offlineOrders, fmt, 0)}
          />
          <MetricTile
            label={t("dash.pendingSyncOrders")}
            value={formatNumber(totals.pendingSync, fmt, 0)}
          />
          <MetricTile
            label={t("dash.syncedOfflineOrders")}
            value={formatNumber(totals.syncedOffline, fmt, 0)}
          />
        </TileGrid>

        <div className="grid gap-4 lg:grid-cols-2">
          <RankedList title={t("dash.byCashier")} rows={totals.salesByCashier} money={money} />
          <RankedList title={t("dash.byBranch")} rows={totals.salesByBranch} money={money} />
          <RankedList title={t("dash.byCategory")} rows={totals.salesByCategory} money={money} />
          <RankedList
            title={t("dash.bestSelling")}
            rows={totals.bestSelling.map((r) => ({ name: r.name, amount: r.amount }))}
            money={money}
          />
          <RankedList
            title={t("dash.lowestSelling")}
            rows={totals.lowestSelling.map((r) => ({ name: r.name, amount: r.amount }))}
            money={money}
          />
        </div>

        <div>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("dash.ordersByHour")}</h3>
          <div className="flex h-24 items-end gap-0.5">
            {totals.byHour.map((count, hour) => {
              const max = Math.max(1, ...totals.byHour);
              return (
                <div
                  key={hour}
                  title={`${hour}:00 · ${count}`}
                  className="bg-accent/70 min-h-0.5 flex-1 rounded-t"
                  style={{ height: `${(count / max) * 100}%` }}
                />
              );
            })}
          </div>
        </div>
      </Section>
    </PageBody>
  );
}

function RankedList({
  title,
  rows,
  money,
}: {
  title: string;
  rows: { name: string; amount: number }[];
  money: (minor: number) => string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <h3 className="text-fg mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("common.noResults")}</p>
      ) : (
        <ul className="divide-line border-line divide-y rounded-lg border">
          {rows.map((row, i) => (
            <li key={`${row.name}_${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-fg min-w-0 truncate text-sm">{row.name}</span>
              <span className="text-fg-subtle shrink-0 text-xs tabular-nums">{money(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
