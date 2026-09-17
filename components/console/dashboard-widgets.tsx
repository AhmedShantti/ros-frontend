"use client";

/**
 * Dashboard widgets — SRS §19.4.
 *
 * Every widget the customisable dashboard can place (FR-RPT-034) is rendered
 * from here by id. The catalogue, permissions and role templates live in
 * `lib/console/reports/dashboard-layout.ts`; this file only draws.
 *
 * The rule inherited from the fixed dashboard still holds: a figure the
 * backend cannot supply reads as a dash with a reason, never as a zero.
 *
 * NFR-USA-009 — every chart that carries information has a keyboard- and
 * screen-reader-reachable table beside it (`<details>`), and every link and
 * action here is a native, focusable control.
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import type {
  AttendanceRecord,
  BranchRankingRow,
  DashboardData,
  LiveOperationsSnapshot,
  Money,
  OperationalAlert,
  Order,
  OrderType,
  TenderType,
} from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  formatAmount,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
} from "@/lib/console/format";
import { ALERT_KIND, ORDER_TYPE, SEVERITY, TENDER_TYPE, labelOf } from "@/lib/console/labels";
import { runReport, type ReportResult } from "@/lib/console/reports/engine";
import { WIDGET_BY_ID, type WidgetId } from "@/lib/console/reports/dashboard-layout";
import { orders as fixtureOrders } from "@/lib/console/mock/sales";
import { cashSessions } from "@/lib/console/mock/finance";
import { branches } from "@/lib/console/mock/org";
import { activeEmployees } from "@/lib/console/mock/workforce";
import { menuCategories, menuItemById } from "@/lib/console/mock/catalogue";
import {
  CategoryBarChart,
  HourlyChart,
  MetricTile,
  MixDonut,
  Sparkline,
  TrendChart,
} from "@/components/console/charts";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { Section, TileGrid, Toolbar } from "@/components/console/page";
import { ErrorPanel, Gate, LoadingPanel, UnsupportedPanel } from "@/components/console/states";
import { DATA_MODE } from "@/lib/api/config";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Field,
  Meter,
  Select,
} from "@/components/console/ui";

/** A figure with no source: a dash, never a zero. */
export const NONE = "—";

export interface WidgetContext {
  data: DashboardData;
  openAlerts: OperationalAlert[];
  onAcknowledge: (alert: OperationalAlert) => void;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isoDay(offsetDays: number, from = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function useReportRun(id: string, days: number, groupBy = "") {
  const { scope } = useSession();
  const { locale } = useI18n();
  return useAsync<ReportResult>(
    () =>
      runReport(id, {
        from: isoDay(-(days - 1)),
        to: isoDay(0),
        scope,
        groupBy,
        compare: false,
        locale,
      }),
    [id, days, groupBy, scope.tenantId, scope.brandId, scope.branchId, locale],
  );
}

function useMoney(currency: DashboardData["currency"]) {
  const { fmt } = useI18n();
  return {
    money: (minor: number, compact = true) =>
      formatMoney({ amount: Math.round(minor), currency }, fmt, compact),
    /** Chart series are stored in major units; tiles are in minor. */
    major: (value: number) => formatAmount({ amount: Math.round(value * 100), currency }, fmt, true),
  };
}

/**
 * NFR-USA-009 — a chart's numbers, reachable without a pointer.
 *
 * `<details>` is focusable and toggles with Enter or Space natively, so the
 * table costs no extra key handling and is announced as a disclosure.
 */
export function ChartTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="text-fg-muted hover:text-fg focus-visible:ring-accent w-fit cursor-pointer rounded text-xs focus-visible:ring-2 focus-visible:outline-none">
        {t("dashw.showTable")}
      </summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-fg-subtle border-line border-b">
              {headers.map((header) => (
                <th key={header} scope="col" className="px-2 py-1 text-start font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-line border-b last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="text-fg px-2 py-1 font-mono tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-accent focus-visible:ring-accent inline-flex items-center gap-1 rounded text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
      <ArrowRight size={12} className="rtl:rotate-180" aria-hidden />
    </Link>
  );
}

function ReportState({ state, children }: { state: ReturnType<typeof useReportRun>; children: (data: ReportResult) => ReactNode }) {
  const { t } = useI18n();
  if (state.loading && !state.data) return <LoadingPanel compact />;
  if (state.error) return <ErrorPanel error={state.error} onRetry={state.reload} compact />;
  if (!state.data) return null;
  if (state.data.unavailable) {
    return <Callout tone="muted" title={t("rep.noSourceTitle")}>{t("rep.noSourceBody")}</Callout>;
  }
  return <>{children(state.data)}</>;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function DashboardWidget({ id, ctx }: { id: WidgetId; ctx: WidgetContext }) {
  const { t } = useI18n();
  const definition = WIDGET_BY_ID.get(id);
  if (!definition) return null;

  switch (id) {
    case "morning_brief":
      return <MorningBrief data={ctx.data} alerts={ctx.openAlerts} />;
    case "kpi_tiles":
      return <KpiTiles data={ctx.data} />;
    case "cost_tiles":
      return <CostTiles data={ctx.data} />;
    case "exec_net_sales_target":
      return <NetSalesTarget data={ctx.data} />;
    case "exec_prime_cost":
      return <PrimeCost data={ctx.data} />;
    case "exec_exceptions":
      return <Exceptions alerts={ctx.openAlerts} />;
    case "exec_trend_sparklines":
      return <TrendSparklines currency={ctx.data.currency} />;
    case "exec_branch_ranking":
      return (
        <Section title={t("dash.branchRanking")} hint={t("dash.branchRankingHint")} spec="FR-RPT-031" padded={false}>
          <BranchRanking rows={ctx.data.branchRanking} />
        </Section>
      );
    case "exec_top_bottom_items":
      return <TopBottomItems currency={ctx.data.currency} />;
    case "mgr_today_vs_forecast":
      return <TodayVsForecast data={ctx.data} />;
    case "mgr_hourly_curve":
      return <HourlyCurve data={ctx.data} />;
    case "mgr_food_cost_trend":
      return <FoodCostTrend data={ctx.data} />;
    case "mgr_reorder":
      return <ReorderWatch />;
    case "mgr_expiry":
      return <ExpiryWatch currency={ctx.data.currency} />;
    case "mgr_staff_on_shift":
      return <StaffOnShift snapshot={ctx.data.live} />;
    case "live_ops":
      return (
        <Section
          title={t("dash.live")}
          hint={t("dashw.liveDesc")}
          spec="FR-RPT-033"
          action={<MoreLink href="/operations/live">{t("dashw.openLive")}</MoreLink>}
        >
          <LiveOperations snapshot={ctx.data.live} />
        </Section>
      );
    case "sales_trend":
      return <SalesTrend data={ctx.data} />;
    case "category_mix":
      return <CategoryMix data={ctx.data} />;
    case "profitability":
      return (
        <Gate permissions={["report.view.financial"]} silent>
          <Section title={t("dash.profitability")} spec="§13.4">
            <ProfitabilityLadder ladder={ctx.data.profitability} />
          </Section>
        </Gate>
      );
    case "waste_by_reason":
      return <WasteByReason data={ctx.data} />;
    case "alerts":
      return <AlertsWidget alerts={ctx.openAlerts} onAcknowledge={ctx.onAcknowledge} />;
    case "order_activity":
      return <OrderActivitySection />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function KpiTiles({ data }: { data: DashboardData }) {
  const { t, fmt } = useI18n();
  const { money } = useMoney(data.currency);
  return (
    <TileGrid>
      <MetricTile label={t("dash.netSales")} value={money(data.netSales.value)} metric={data.netSales} />
      <MetricTile label={t("dash.transactions")} value={formatNumber(data.transactions.value, fmt)} metric={data.transactions} />
      <MetricTile label={t("dash.aov")} value={money(data.averageOrderValue.value, false)} metric={data.averageOrderValue} />
      <MetricTile
        label={t("dash.grossProfit")}
        value={data.grossProfit ? money(data.grossProfit.value) : NONE}
        metric={data.grossProfit ?? undefined}
      />
    </TileGrid>
  );
}

function CostTiles({ data }: { data: DashboardData }) {
  const { t, fmt } = useI18n();
  const pct = (metric: DashboardData["foodCostPercent"]) => (metric ? formatPercent(metric.value, fmt) : NONE);
  return (
    <TileGrid>
      <MetricTile label={t("dash.foodCost")} value={pct(data.foodCostPercent)} metric={data.foodCostPercent ?? undefined} footer={<TargetLine metric={data.foodCostPercent} />} spec="FR-CST-003" />
      <MetricTile label={t("dash.labourCost")} value={pct(data.labourCostPercent)} metric={data.labourCostPercent ?? undefined} footer={<TargetLine metric={data.labourCostPercent} />} />
      <MetricTile label={t("dash.primeCost")} value={pct(data.primeCostPercent)} metric={data.primeCostPercent ?? undefined} footer={<TargetLine metric={data.primeCostPercent} />} spec="§13.5" />
      <MetricTile label={t("dash.waste")} value={pct(data.wastePercent)} metric={data.wastePercent ?? undefined} footer={<TargetLine metric={data.wastePercent} />} />
    </TileGrid>
  );
}

function TargetLine({ metric }: { metric: { value: number; target: number | null } | null }) {
  const { t, fmt } = useI18n();
  if (!metric || metric.target === null) return null;
  const over = metric.value > metric.target;
  return (
    <span className="flex items-center gap-2">
      <span>
        {t("common.target")} {formatPercent(metric.target, fmt, 0)}
      </span>
      <Meter className="w-16" value={(metric.value / Math.max(metric.target, 0.1)) * 100} tone={over ? "bad" : "good"} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// FR-RPT-031 — Executive
// ---------------------------------------------------------------------------

/** FR-RPT-031 — net sales against target, with its trend. */
function NetSalesTarget({ data }: { data: DashboardData }) {
  const { t, fmt } = useI18n();
  const { money } = useMoney(data.currency);
  const metric = data.netSales;
  const share = metric.target ? (metric.value / metric.target) * 100 : null;
  const tone = share === null ? "muted" : share >= 100 ? "good" : share >= 85 ? "warn" : "bad";

  return (
    <Section title={t("dashw.netSalesTarget")} hint={t("dashw.netSalesTargetDesc")} spec="FR-RPT-031">
      <p className="text-fg font-mono text-2xl tabular-nums">{money(metric.value)}</p>
      {metric.target !== null && share !== null ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-fg-muted flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              {t("common.target")} {money(metric.target)}
            </span>
            <Badge tone={tone}>{formatPercent(share, fmt, 0)}</Badge>
          </div>
          <Meter value={share} tone={tone} />
          <p className="text-fg-subtle text-xs">
            {share >= 100
              ? t("dashw.aheadOfTarget").replace("{amount}", money(metric.value - metric.target))
              : t("dashw.behindTarget").replace("{amount}", money(metric.target - metric.value))}
          </p>
        </div>
      ) : (
        <p className="text-fg-subtle mt-3 text-xs">{t("dashw.noTarget")}</p>
      )}
      {data.salesTrend.length > 1 ? (
        <div className="mt-4">
          <p className="text-fg-subtle mb-1 text-[0.68rem]">{t("dash.salesTrend")}</p>
          <Sparkline values={data.salesTrend.map((point) => point.value)} />
        </div>
      ) : null}
    </Section>
  );
}

/** FR-RPT-031 — prime cost %: food plus labour, against its ceiling. */
function PrimeCost({ data }: { data: DashboardData }) {
  const { t, fmt } = useI18n();
  const prime = data.primeCostPercent;
  const over = prime && prime.target !== null && prime.value > prime.target;

  return (
    <Section title={t("dashw.primeCost")} hint={t("dashw.primeCostDesc")} spec="FR-RPT-031">
      {prime ? (
        <>
          <div className="flex flex-wrap items-baseline gap-3">
            <p className={over ? "text-bad font-mono text-2xl tabular-nums" : "text-fg font-mono text-2xl tabular-nums"}>
              {formatPercent(prime.value, fmt)}
            </p>
            {prime.target !== null ? (
              <Badge tone={over ? "bad" : "good"}>
                {t("common.target")} {formatPercent(prime.target, fmt, 0)}
              </Badge>
            ) : null}
          </div>
          <DescList>
            <DescRow label={t("dash.foodCost")} mono>
              {data.foodCostPercent ? formatPercent(data.foodCostPercent.value, fmt) : NONE}
            </DescRow>
            <DescRow label={t("dash.labourCost")} mono>
              {data.labourCostPercent ? formatPercent(data.labourCostPercent.value, fmt) : NONE}
            </DescRow>
          </DescList>
        </>
      ) : (
        <>
          <p className="text-fg font-mono text-2xl">{NONE}</p>
          <p className="text-fg-subtle mt-2 text-xs">{t("dashw.primeCostNoSource")}</p>
        </>
      )}
    </Section>
  );
}

/** FR-RPT-031 — exception count, by severity, with the way to act on them. */
function Exceptions({ alerts }: { alerts: OperationalAlert[] }) {
  const { t, tx, fmt } = useI18n();
  const bySeverity = (["critical", "high", "medium", "low", "info"] as const)
    .map((severity) => ({ severity, count: alerts.filter((alert) => alert.severity === severity).length }))
    .filter((entry) => entry.count > 0);

  return (
    <Section
      title={t("dashw.exceptions")}
      hint={t("dashw.exceptionsDesc")}
      spec="FR-RPT-031"
      action={<MoreLink href="/approvals">{t("dash.viewAll")}</MoreLink>}
    >
      <p className={alerts.length > 0 ? "text-bad font-mono text-2xl tabular-nums" : "text-good font-mono text-2xl tabular-nums"}>
        {formatNumber(alerts.length, fmt)}
      </p>
      {bySeverity.length === 0 ? (
        <p className="text-fg-subtle mt-2 text-xs">{t("dash.noAlerts")}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {bySeverity.map(({ severity, count }) => {
            const label = labelOf(SEVERITY, severity);
            return (
              <li key={severity}>
                <Badge tone={label.tone} dot>
                  {tx(label.label)} · {formatNumber(count, fmt)}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** FR-RPT-031 — trend sparklines, computed from the last fourteen days of orders. */
function TrendSparklines({ currency }: { currency: DashboardData["currency"] }) {
  const { t, fmt } = useI18n();
  const { money } = useMoney(currency);
  const sales = useReportRun("sales-summary", 14, "day");
  const food = useReportRun("food-cost", 14, "day");

  return (
    <Section title={t("dashw.sparklines")} hint={t("dashw.sparklinesDesc")} spec="FR-RPT-031">
      <ReportState state={sales}>
        {(result) => {
          const days = [...result.rows].sort((a, b) => a.id.localeCompare(b.id));
          if (days.length < 2) return <p className="text-fg-subtle text-xs">{t("dashw.notEnoughHistory")}</p>;
          const series = (key: string) => days.map((row) => Number(row.values[key] ?? 0));
          const last = (key: string) => series(key).at(-1) ?? 0;
          const foodDays = food.data && !food.data.unavailable ? [...food.data.rows].sort((a, b) => a.id.localeCompare(b.id)) : [];
          const lines: { label: string; values: number[]; latest: string; tone?: "bad" }[] = [
            { label: t("dash.netSales"), values: series("net"), latest: money(last("net")) },
            { label: t("dash.transactions"), values: series("orders"), latest: formatNumber(last("orders"), fmt) },
            { label: t("dash.aov"), values: series("aov"), latest: money(last("aov"), false) },
          ];
          if (foodDays.length > 1) {
            const values = foodDays.map((row) => Number(row.values.foodCostPercent ?? 0));
            lines.push({ label: t("dash.foodCost"), values, latest: formatPercent(values.at(-1) ?? 0, fmt), tone: "bad" });
          }
          return (
            <>
              <ul className="divide-line divide-y">
                {lines.map((line) => (
                  <li key={line.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 py-2">
                    <span className="text-fg-muted truncate text-xs">{line.label}</span>
                    <Sparkline values={line.values} tone={line.tone === "bad" ? "warn" : "accent"} height={28} />
                    <span className="text-fg font-mono text-xs tabular-nums">{line.latest}</span>
                  </li>
                ))}
              </ul>
              <ChartTable
                caption={t("dashw.sparklines")}
                headers={[t("common.date"), t("dash.netSales"), t("dash.transactions"), t("dash.aov")]}
                rows={days.map((row) => [row.id, money(Number(row.values.net)), Number(row.values.orders), money(Number(row.values.aov), false)])}
              />
            </>
          );
        }}
      </ReportState>
    </Section>
  );
}

/** FR-RPT-031 — top and bottom performing items over the last seven days. */
function TopBottomItems({ currency }: { currency: DashboardData["currency"] }) {
  const { t, fmt } = useI18n();
  const { money } = useMoney(currency);
  const items = useReportRun("sales-by-item", 7);

  return (
    <Section
      title={t("dashw.topBottom")}
      hint={t("dashw.topBottomDesc")}
      spec="FR-RPT-031"
      action={<MoreLink href="/reports/sales-by-item">{t("dashw.openReport")}</MoreLink>}
    >
      <ReportState state={items}>
        {(result) => {
          const rows = [...result.rows].sort((a, b) => Number(b.values.net) - Number(a.values.net));
          if (rows.length === 0) return <p className="text-fg-subtle text-xs">{t("rep.emptyBody")}</p>;
          const top = rows.slice(0, 5);
          const bottom = rows.length > 5 ? rows.slice(-5).reverse() : [];
          const list = (title: string, list: typeof rows, tone: "good" | "bad") => (
            <div>
              <h3 className="text-fg mb-2 text-xs font-semibold">{title}</h3>
              <ol className="divide-line border-line divide-y rounded-lg border">
                {list.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-fg min-w-0 truncate text-sm">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-fg-subtle text-xs tabular-nums">
                        ×{formatNumber(Number(row.values.units), fmt)}
                      </span>
                      <Badge tone={tone}>{money(Number(row.values.net))}</Badge>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
          return (
            <div className="grid gap-4 lg:grid-cols-2">
              {list(t("dash.bestSelling"), top, "good")}
              {bottom.length > 0 ? list(t("dash.lowestSelling"), bottom, "bad") : null}
            </div>
          );
        }}
      </ReportState>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// FR-RPT-032 — Branch Manager
// ---------------------------------------------------------------------------

/** FR-RPT-032 — today's sales against forecast, and labour %. */
function TodayVsForecast({ data }: { data: DashboardData }) {
  const { t, fmt } = useI18n();
  const { money } = useMoney(data.currency);

  const hasForecast = data.hourly.some((point) => point.forecast !== null);
  const nowHour = new Date().getHours();
  const soFar = data.hourly.filter((point) => Number(point.hour.slice(0, 2)) <= nowHour);
  // Hourly series are major units; tiles are minor.
  const forecastToNow = hasForecast ? soFar.reduce((sum, point) => sum + (point.forecast ?? 0), 0) * 100 : null;
  const forecastDay = hasForecast ? data.hourly.reduce((sum, point) => sum + (point.forecast ?? 0), 0) * 100 : null;
  const actualToNow = soFar.reduce((sum, point) => sum + point.sales, 0) * 100;
  const delta = forecastToNow ? ((actualToNow - forecastToNow) / forecastToNow) * 100 : null;
  const labour = data.labourCostPercent;

  return (
    <Section title={t("dashw.todayForecast")} hint={t("dashw.todayForecastDesc")} spec="FR-RPT-032">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-fg-subtle text-xs">{t("dashw.salesSoFar")}</p>
          <p className="text-fg mt-1 font-mono text-2xl tabular-nums">{money(actualToNow)}</p>
          {forecastToNow !== null && delta !== null ? (
            <div className="mt-2 space-y-1.5">
              <p className="text-fg-muted text-xs">
                {t("dashw.forecastSoFar")} {money(forecastToNow)} · {t("dashw.forecastDay")} {money(forecastDay ?? 0)}
              </p>
              <Badge tone={delta >= 0 ? "good" : delta > -10 ? "warn" : "bad"}>
                {delta >= 0 ? "+" : "−"}
                {formatPercent(Math.abs(delta), fmt, 1)} {t("dashw.vsForecast")}
              </Badge>
            </div>
          ) : (
            <p className="text-fg-subtle mt-2 text-xs">{t("dashw.noForecast")}</p>
          )}
        </div>
        <div>
          <p className="text-fg-subtle text-xs">{t("dash.labourCost")}</p>
          <p className="text-fg mt-1 font-mono text-2xl tabular-nums">{labour ? formatPercent(labour.value, fmt) : NONE}</p>
          {labour ? <div className="text-fg-subtle mt-2 text-xs"><TargetLine metric={labour} /></div> : (
            <p className="text-fg-subtle mt-2 text-xs">{t("dashw.noLabourSource")}</p>
          )}
        </div>
      </div>
    </Section>
  );
}

/**
 * FR-RPT-032 — the hourly curve, with labour and the same weekday last week.
 *
 * The prior week is read off the order ledger (net of discounts, by the hour
 * the order opened), so it is real where the orders are; an hour with no
 * orders that day is a gap in the line, not a zero.
 */
function HourlyCurve({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const { scope } = useSession();
  const { major } = useMoney(data.currency);

  const priorDay = useMemo(() => {
    const date = new Date(`${data.businessDay}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 7);
    return date.toISOString().slice(0, 10);
  }, [data.businessDay]);

  const prior = useAsync<Map<string, number> | null>(async () => {
    const page = await services.sales.orders.list({ scope, limit: 500 });
    const sameDay = page.rows.filter((order: Order) => (order.businessDay ?? order.openedAt.slice(0, 10)) === priorDay);
    if (sameDay.length === 0) return null;
    const byHour = new Map<string, number>();
    for (const order of sameDay) {
      const hour = `${order.openedAt.slice(11, 13)}:00`;
      byHour.set(hour, (byHour.get(hour) ?? 0) + (order.subtotal.amount - order.discountTotal.amount) / 100);
    }
    return byHour;
  }, [priorDay, scope.tenantId, scope.brandId, scope.branchId]);

  const series = data.hourly.map((point) => ({
    ...point,
    priorWeek: prior.data ? (prior.data.get(point.hour) ?? null) : null,
  }));

  return (
    <Section title={t("dashw.hourly")} hint={t("dashw.hourlyDesc")} spec="FR-RPT-032">
      {series.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("rep.emptyBody")}</p>
      ) : (
        <>
          <HourlyChart
            data={series}
            salesLabel={t("dash.netSales")}
            labourLabel={t("dash.labourCost")}
            forecastLabel={data.hourly.some((point) => point.forecast !== null) ? t("dashw.forecast") : undefined}
            priorWeekLabel={t("dashw.priorWeek")}
            format={major}
          />
          <p className="text-fg-subtle mt-2 text-xs">
            {prior.data ? t("dashw.priorWeekFrom").replace("{date}", priorDay) : t("dashw.priorWeekNone").replace("{date}", priorDay)}
            {series.every((point) => point.labourCost === null) ? ` ${t("dashw.noLabourSource")}` : ""}
          </p>
          <ChartTable
            caption={t("dashw.hourly")}
            headers={[t("dashw.hour"), t("dash.netSales"), t("dash.labourCost"), t("dashw.forecast"), t("dashw.priorWeek")]}
            rows={series.map((point) => [
              point.hour,
              major(point.sales),
              point.labourCost === null ? NONE : major(point.labourCost),
              point.forecast === null ? NONE : major(point.forecast),
              point.priorWeek === null ? NONE : major(point.priorWeek),
            ])}
          />
        </>
      )}
    </Section>
  );
}

/** FR-RPT-032 — food cost trend, from the line cost snapshots per day. */
function FoodCostTrend({ data }: { data: DashboardData }) {
  const { t, fmt } = useI18n();
  const trend = useReportRun("food-cost", 14, "day");
  const target = data.foodCostPercent?.target ?? undefined;

  return (
    <Section
      title={t("dashw.foodCostTrend")}
      hint={t("dashw.foodCostTrendDesc")}
      spec="FR-RPT-032"
      action={<MoreLink href="/costing/food-cost">{t("dashw.openReport")}</MoreLink>}
    >
      <ReportState state={trend}>
        {(result) => {
          const points = [...result.rows]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((row) => ({ label: row.id.slice(5), value: Number(row.values.foodCostPercent ?? 0) }));
          if (points.length < 2) return <p className="text-fg-subtle text-xs">{t("dashw.notEnoughHistory")}</p>;
          return (
            <>
              <TrendChart
                data={points}
                height={200}
                valueLabel={t("dash.foodCost")}
                format={(value) => formatPercent(value, fmt, 1)}
                target={typeof target === "number" ? target : undefined}
                targetLabel={t("common.target")}
              />
              <ChartTable
                caption={t("dashw.foodCostTrend")}
                headers={[t("common.date"), t("dash.foodCost")]}
                rows={points.map((point) => [point.label, formatPercent(point.value, fmt, 1)])}
              />
            </>
          );
        }}
      </ReportState>
    </Section>
  );
}

/** FR-RPT-032 — items requiring reorder. */
function ReorderWatch() {
  const { t, fmt } = useI18n();
  const low = useReportRun("low-stock", 1);
  return (
    <Section
      title={t("dashw.reorder")}
      hint={t("dashw.reorderDesc")}
      spec="FR-RPT-032"
      action={<MoreLink href="/inventory/levels">{t("dash.viewAll")}</MoreLink>}
    >
      <ReportState state={low}>
        {(result) =>
          result.rows.length === 0 ? (
            <Callout tone="good">{t("dashw.reorderNone")}</Callout>
          ) : (
            <>
              <p className="text-fg-muted mb-2 text-xs">
                {t("dashw.reorderCount").replace("{count}", formatNumber(result.rows.length, fmt))}
              </p>
              <ul className="divide-line divide-y">
                {result.rows.slice(0, 6).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <CellStack primary={row.label} secondary={row.secondary} />
                    <span className="shrink-0 text-end">
                      <Badge tone={row.values.status === "negative" || row.values.status === "critical" ? "bad" : "warn"}>
                        {formatNumber(Number(row.values.onHand), fmt, 2)} {String(row.values.unit)}
                      </Badge>
                      <span className="text-fg-subtle mt-0.5 block text-[0.68rem]">
                        {t("rep.col.suggested")} {formatNumber(Number(row.values.suggested), fmt, 2)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </ReportState>
    </Section>
  );
}

/** FR-RPT-032 — expiry watch. */
function ExpiryWatch({ currency }: { currency: DashboardData["currency"] }) {
  const { t, fmt } = useI18n();
  const { money } = useMoney(currency);
  const expiring = useReportRun("expiry-watch", 1);
  return (
    <Section
      title={t("dashw.expiry")}
      hint={t("dashw.expiryDesc")}
      spec="FR-RPT-032"
      action={<MoreLink href="/inventory/expiry">{t("dash.viewAll")}</MoreLink>}
    >
      <ReportState state={expiring}>
        {(result) =>
          result.rows.length === 0 ? (
            <Callout tone="good">{t("dashw.expiryNone")}</Callout>
          ) : (
            <>
              <p className="text-fg-muted mb-2 text-xs">
                {t("dashw.valueAtRisk")} {money(Number(result.totals?.value ?? 0))}
              </p>
              <ul className="divide-line divide-y">
                {result.rows.slice(0, 6).map((row) => {
                  const days = Number(row.values.daysToExpiry);
                  return (
                    <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                      <CellStack primary={row.label} secondary={row.secondary} />
                      <Badge tone={days <= 0 ? "bad" : days <= 2 ? "warn" : "neutral"}>
                        {days <= 0 ? t("dashw.expired") : t("dashw.daysLeft").replace("{days}", formatNumber(days, fmt))}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        }
      </ReportState>
    </Section>
  );
}

/** FR-RPT-032 — staff on shift: clocked in today and not yet out. */
function StaffOnShift({ snapshot }: { snapshot: LiveOperationsSnapshot }) {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const today = isoDay(0);
  const attendance = useAsync<AttendanceRecord[]>(
    async () => (await services.workforce.attendance.list({ scope, limit: 500 })).rows,
    [scope.tenantId, scope.brandId, scope.branchId],
  );

  const onShift = (attendance.data ?? []).filter(
    (record) => record.clockIn !== null && record.clockOut === null && (record.date === today || record.clockIn.slice(0, 10) === today),
  );

  return (
    <Section
      title={t("dashw.staff")}
      hint={t("dashw.staffDesc")}
      spec="FR-RPT-032"
      action={<MoreLink href="/workforce/attendance">{t("dash.viewAll")}</MoreLink>}
    >
      {attendance.loading && !attendance.data ? (
        <LoadingPanel compact />
      ) : attendance.error ? (
        <>
          <p className="text-fg font-mono text-2xl tabular-nums">
            {snapshot.staffOnShift === null ? NONE : formatNumber(snapshot.staffOnShift, fmt)}
          </p>
          <p className="text-fg-subtle mt-2 text-xs">{t("dashw.staffNoSource")}</p>
        </>
      ) : (
        <>
          <p className="text-fg font-mono text-2xl tabular-nums">{formatNumber(onShift.length, fmt)}</p>
          {onShift.length === 0 ? (
            <p className="text-fg-subtle mt-2 text-xs">{t("dashw.staffNone")}</p>
          ) : (
            <ul className="divide-line mt-2 divide-y">
              {onShift.slice(0, 8).map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="text-fg truncate">{tx(record.employeeName)}</span>
                  <span className="text-fg-subtle shrink-0 text-xs">
                    {t("dashw.since")} {formatTime(record.clockIn, fmt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Charts carried over from the fixed dashboard
// ---------------------------------------------------------------------------

function SalesTrend({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const { major } = useMoney(data.currency);
  return (
    <Section title={t("dash.salesTrend")} hint={t("dash.salesTrendHint")}>
      <TrendChart data={data.salesTrend} valueLabel={t("dash.netSales")} comparisonLabel={t("common.vsPrevious")} format={major} />
      <ChartTable
        caption={t("dash.salesTrend")}
        headers={[t("common.date"), t("dash.netSales"), t("common.vsPrevious")]}
        rows={data.salesTrend.map((point) => [point.label, major(point.value), point.comparison === undefined ? NONE : major(point.comparison)])}
      />
    </Section>
  );
}

function CategoryMix({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const { major } = useMoney(data.currency);
  return (
    <Section title={t("dash.categoryMix")}>
      <MixDonut
        data={data.categoryMix}
        format={major}
        centreLabel={t("dash.netSales")}
        centreValue={major(data.categoryMix.reduce((sum, point) => sum + point.value, 0))}
      />
      <ChartTable
        caption={t("dash.categoryMix")}
        headers={[t("dashw.category"), t("dash.netSales")]}
        rows={data.categoryMix.map((point) => [point.label, major(point.value)])}
      />
    </Section>
  );
}

function WasteByReason({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const { major } = useMoney(data.currency);
  return (
    <Section title={t("dash.wasteByReason")} spec="FR-CST-020">
      {data.wasteByReason.length === 0 ? (
        <p className="text-fg-subtle text-xs">{t("rep.emptyBody")}</p>
      ) : (
        <>
          <CategoryBarChart data={data.wasteByReason} valueLabel={t("dash.waste")} format={major} colourByIndex />
          <ChartTable
            caption={t("dash.wasteByReason")}
            headers={[t("rep.group.reason"), t("dash.waste")]}
            rows={data.wasteByReason.map((point) => [point.label, major(point.value)])}
          />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Morning brief — FR-RPT-041
// ---------------------------------------------------------------------------

/**
 * The prior business day, stated as exceptions rather than totals — §19.1
 * principle 1. Anything at or under target is deliberately not mentioned.
 */
function MorningBrief({ data, alerts }: { data: DashboardData; alerts: OperationalAlert[] }) {
  const { t, tx, fmt } = useI18n();

  const metrics = [
    { label: t("dash.foodCost"), metric: data.foodCostPercent },
    { label: t("dash.labourCost"), metric: data.labourCostPercent },
    { label: t("dash.primeCost"), metric: data.primeCostPercent },
    { label: t("dash.waste"), metric: data.wastePercent },
  ];
  const overTarget = metrics.filter(
    (m): m is { label: string; metric: NonNullable<typeof m.metric> & { target: number } } =>
      m.metric !== null && m.metric.target !== null && m.metric.value > m.metric.target,
  );
  const outlier = [...data.branchRanking]
    .filter((row) => Math.abs(row.outlierSigma) >= 1.5)
    .sort((a, b) => Math.abs(b.outlierSigma) - Math.abs(a.outlierSigma))[0];
  const severe = alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;
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
                {t("dash.briefOverTarget")} {formatPercent(metric.target, fmt, 0)}
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
                {t("dash.briefAlerts")} {formatNumber(severe, fmt)} {t("dash.briefCritical")}
              </span>
            </li>
          ) : null}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Live operations summary
// ---------------------------------------------------------------------------

/** Unread figures stay a dash: an empty queue and an unwatched one differ. */
export function LiveOperations({ snapshot }: { snapshot: LiveOperationsSnapshot }) {
  const { t, fmt } = useI18n();
  const count = (value: number | null) => (value === null ? NONE : formatNumber(value, fmt));

  const cells: { label: string; value: string; tone?: "warn" | "bad" }[] = [
    { label: t("live.openOrders"), value: count(snapshot.openOrders) },
    { label: t("live.tables"), value: `${count(snapshot.tablesOccupied)} / ${count(snapshot.tablesTotal)}` },
    { label: t("live.queue"), value: count(snapshot.kitchenQueueDepth) },
    { label: t("live.avgWait"), value: snapshot.averageWaitSeconds === null ? NONE : formatDuration(snapshot.averageWaitSeconds, fmt) },
    {
      label: t("live.terminals"),
      value: `${count(snapshot.activeTerminals)} / ${count(snapshot.totalTerminals)}`,
      tone: snapshot.offlineTerminals > 0 ? "warn" : undefined,
    },
    { label: t("live.staff"), value: count(snapshot.staffOnShift) },
    {
      label: t("live.delayed"),
      value: count(snapshot.delayedTickets),
      tone: snapshot.delayedTickets !== null && snapshot.delayedTickets > 0 ? "bad" : undefined,
    },
    {
      label: t("live.syncBacklog"),
      value: `${formatNumber(snapshot.syncBacklog, fmt)} ${t("live.operations")}`,
      tone: snapshot.syncBacklog > 0 ? "warn" : undefined,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label}>
          <dt className="text-fg-subtle text-xs">{cell.label}</dt>
          <dd
            className={
              cell.tone === "bad"
                ? "text-bad mt-1 font-mono text-lg tabular-nums"
                : cell.tone === "warn"
                  ? "text-warn mt-1 font-mono text-lg tabular-nums"
                  : "text-fg mt-1 font-mono text-lg tabular-nums"
            }
          >
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Branch ranking
// ---------------------------------------------------------------------------

export function BranchRanking({ rows }: { rows: BranchRankingRow[] }) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<BranchRankingRow>[]>(
    () => [
      { key: "rank", header: t("dash.rank"), width: "3.5rem", render: (row) => <span className="text-fg-muted font-mono tabular-nums">{row.rank}</span> },
      { key: "branch", header: t("common.branch"), render: (row) => <CellStack primary={tx(row.branchName)} secondary={tx(row.brandName)} /> },
      { key: "netSales", header: t("dash.netSales"), numeric: true, render: (row) => formatMoney(row.netSales, fmt, true) },
      { key: "transactions", header: t("dash.transactions"), numeric: true, secondary: true, render: (row) => formatNumber(row.transactionCount, fmt) },
      { key: "aov", header: t("dash.aov"), numeric: true, secondary: true, render: (row) => formatMoney(row.averageOrderValue, fmt, false) },
      { key: "foodCost", header: t("dash.foodCost"), numeric: true, render: (row) => (row.foodCostPercent === null ? NONE : formatPercent(row.foodCostPercent, fmt)) },
      {
        key: "prime",
        header: t("dash.prime"),
        numeric: true,
        hint: t("dash.branchRankingHint"),
        render: (row) => (
          <span className={row.primeCostPercent !== null && row.primeCostPercent > 65 ? "text-bad" : undefined}>
            {row.primeCostPercent === null ? NONE : formatPercent(row.primeCostPercent, fmt)}
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

  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.branchId} caption={t("dash.branchRanking")} dense />;
}

// ---------------------------------------------------------------------------
// Profitability ladder
// ---------------------------------------------------------------------------

function ProfitabilityLadder({ ladder }: { ladder: DashboardData["profitability"] }) {
  const { t, fmt } = useI18n();
  const lines: { key: string; label: string; value: Money | null; negative?: boolean; strong?: boolean }[] = [
    { key: "grossSales", label: t("pl.grossSales"), value: ladder.grossSales },
    { key: "discounts", label: t("pl.discounts"), value: ladder.discounts, negative: true },
    { key: "refunds", label: t("pl.refunds"), value: ladder.refunds, negative: true },
    { key: "netSales", label: t("pl.netSales"), value: ladder.netSales, strong: true },
    { key: "cogs", label: t("pl.cogs"), value: ladder.cogs, negative: true },
    { key: "grossProfit", label: t("pl.grossProfit"), value: ladder.grossProfit, strong: true },
    { key: "labourCost", label: t("pl.labour"), value: ladder.labourCost, negative: true },
    { key: "contribution", label: t("pl.contribution"), value: ladder.contributionAfterLabour, strong: true },
    { key: "operatingExpenses", label: t("pl.opex"), value: ladder.operatingExpenses, negative: true },
    { key: "operatingProfit", label: t("pl.operatingProfit"), value: ladder.operatingProfit, strong: true },
  ];
  return (
    <DescList>
      {lines.map((line) =>
        line.value ? (
          <DescRow key={line.key} mono label={<span className={line.strong ? "text-fg font-medium" : undefined}>{line.label}</span>}>
            <span className={line.negative ? "text-fg-muted" : undefined}>
              {line.negative ? "−" : ""}
              {formatMoney(line.value, fmt, false)}
            </span>
          </DescRow>
        ) : null,
      )}
    </DescList>
  );
}

// ---------------------------------------------------------------------------
// Alerts — the open exceptions list
// ---------------------------------------------------------------------------

function AlertsWidget({ alerts, onAcknowledge }: { alerts: OperationalAlert[]; onAcknowledge: (alert: OperationalAlert) => void }) {
  const { t } = useI18n();
  return (
    <Section
      title={t("dash.alerts")}
      hint={t("dash.alertsHint")}
      spec="FR-ALT-001"
      action={<MoreLink href="/approvals">{t("dash.viewAll")}</MoreLink>}
    >
      {alerts.length === 0 ? (
        <p className="text-fg-muted py-6 text-center text-xs">{t("dash.noAlerts")}</p>
      ) : (
        <ul className="divide-line divide-y">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} onAcknowledge={() => onAcknowledge(alert)} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AlertRow({ alert, onAcknowledge }: { alert: OperationalAlert; onAcknowledge: () => void }) {
  const { t, tx, fmt } = useI18n();
  const severity = labelOf(SEVERITY, alert.severity);
  const kind = labelOf(ALERT_KIND, alert.kind);

  return (
    <li className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
      <AlertTriangle
        size={15}
        aria-hidden
        className={alert.severity === "critical" || alert.severity === "high" ? "text-bad mt-0.5 shrink-0" : "text-warn mt-0.5 shrink-0"}
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
        {alert.href ? <MoreLink href={alert.href}>{t("common.view")}</MoreLink> : null}
        <Button size="sm" icon={<Check size={12} />} onClick={onAcknowledge}>
          {t("dash.acknowledge")}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Order activity — filterable, read straight off real orders (demo only)
// ---------------------------------------------------------------------------

type DateFilter = "all" | "today" | "yesterday" | "last7";
const REVENUE_STATES = new Set(["completed", "partially_refunded", "refunded"]);
const DASHBOARD_ORDER_TYPES: OrderType[] = ["dine_in", "takeaway", "pickup", "drive_thru"];

/**
 * Derived from the `orders` fixture, which is what lets every filter change
 * the numbers. Live, two of its four filters have no source (`GET /orders`
 * carries no line snapshots; there is no cash-session index), so it says so
 * instead of rendering controls that quietly do nothing.
 */
function OrderActivitySection() {
  const { t } = useI18n();
  if (DATA_MODE === "http") {
    return (
      <Section title={t("dash.activityTitle")} hint={t("dash.activityHint")}>
        <UnsupportedPanel compact detail="GET /orders returns headers without line snapshots, and no cash-session index exists." />
      </Section>
    );
  }
  return <OrderActivityFromFixtures />;
}

function OrderActivityFromFixtures() {
  const { t, tx, fmt } = useI18n();
  const [dateFilter, setDateFilter] = useState<DateFilter>("last7");
  const [branchId, setBranchId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [orderType, setOrderType] = useState<OrderType | "all">("all");
  const [tender, setTender] = useState<TenderType | "all">("all");

  const rows = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return fixtureOrders.filter((o) => {
      const age = now - new Date(o.openedAt).getTime();
      if (dateFilter === "today" && age >= dayMs) return false;
      if (dateFilter === "yesterday" && (age < dayMs || age >= 2 * dayMs)) return false;
      if (dateFilter === "last7" && age >= 7 * dayMs) return false;
      if (branchId !== "all" && o.branchId !== branchId) return false;
      if (employeeId !== "all" && o.openedBy !== employeeId) return false;
      if (orderType !== "all" && o.orderType !== orderType) return false;
      if (tender !== "all" && !o.payments.some((p) => p.tender === tender && p.amount.amount > 0)) return false;
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
        const netForOrder = order.subtotal.amount - order.discountTotal.amount + order.serviceChargeTotal.amount;
        const cashier = byCashier.get(order.openedBy) ?? { name: tx(order.openedByName), amount: 0 };
        cashier.amount += netForOrder;
        byCashier.set(order.openedBy, cashier);
        const branch = byBranch.get(order.branchId) ?? { name: tx(order.branchName), amount: 0 };
        branch.amount += netForOrder;
        byBranch.set(order.branchId, branch);

        for (const line of order.lines) {
          if (line.state === "voided") continue;
          const menuItem = menuItemById.get(line.menuItemId);
          const categoryId = menuItem?.categoryId ?? "unknown";
          const category = menuCategories.find((c) => c.id === categoryId);
          const catEntry = byCategory.get(categoryId) ?? { name: category ? tx(category.name) : t("common.uncategorised"), amount: 0 };
          catEntry.amount += line.lineSubtotal.amount;
          byCategory.set(categoryId, catEntry);
          const itemEntry = byItem.get(line.menuItemId) ?? { name: tx(line.itemNameSnapshot), qty: 0, amount: 0 };
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
      bestSelling: [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
      lowestSelling: [...byItem.values()].sort((a, b) => a.amount - b.amount).slice(0, 5),
      salesByCashier: [...byCashier.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
      salesByBranch: [...byBranch.values()].sort((a, b) => b.amount - a.amount),
      salesByCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
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
            <Select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType | "all")}>
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
      <div className="space-y-4">
        <TileGrid>
          <MetricTile label={t("dash.grossSales")} value={money(totals.grossSales)} />
          <MetricTile label={t("shift.netSales")} value={money(totals.netSales)} />
          <MetricTile label={t("dash.totalOrders")} value={formatNumber(totals.totalOrders, fmt, 0)} />
          <MetricTile label={t("dash.aov")} value={money(totals.averageOrderValue)} />
          <MetricTile label={t("orders.tax")} value={money(totals.taxTotal)} />
          <MetricTile label={t("orders.serviceCharge")} value={money(totals.serviceChargeTotal)} />
          <MetricTile label={t("pos.discountTotal")} value={money(totals.discountTotal)} />
          <MetricTile label={t("shift.refunds")} value={money(totals.refundTotal)} />
          <MetricTile label={t("shift.cancelledOrders")} value={formatNumber(totals.cancelledOrders, fmt, 0)} />
          <MetricTile label={t("shift.cashSales")} value={money(totals.cashSales)} />
          <MetricTile label={t("shift.cardSales")} value={money(totals.cardSales)} />
          <MetricTile label={t("shift.otherSales")} value={money(totals.otherSales)} />
        </TileGrid>

        <TileGrid columns={4}>
          {DASHBOARD_ORDER_TYPES.map((type) => (
            <MetricTile key={type} label={tx(ORDER_TYPE[type].label)} value={formatNumber(totals.byType.get(type) ?? 0, fmt, 0)} />
          ))}
        </TileGrid>

        <TileGrid>
          <MetricTile label={t("dash.openShifts")} value={formatNumber(shiftCounts.open, fmt, 0)} />
          <MetricTile label={t("dash.closedShifts")} value={formatNumber(shiftCounts.closed, fmt, 0)} />
          <MetricTile label={t("dash.cashDrawerDiff")} value={money(shiftCounts.cashDifference)} />
          <MetricTile label={t("dash.offlineOrders")} value={formatNumber(totals.offlineOrders, fmt, 0)} />
          <MetricTile label={t("dash.pendingSyncOrders")} value={formatNumber(totals.pendingSync, fmt, 0)} />
          <MetricTile label={t("dash.syncedOfflineOrders")} value={formatNumber(totals.syncedOffline, fmt, 0)} />
        </TileGrid>

        <div className="grid gap-4 lg:grid-cols-2">
          <RankedList title={t("dash.byCashier")} rows={totals.salesByCashier} money={money} />
          <RankedList title={t("dash.byBranch")} rows={totals.salesByBranch} money={money} />
          <RankedList title={t("dash.byCategory")} rows={totals.salesByCategory} money={money} />
          <RankedList title={t("dash.bestSelling")} rows={totals.bestSelling} money={money} />
          <RankedList title={t("dash.lowestSelling")} rows={totals.lowestSelling} money={money} />
        </div>

        <div>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("dash.ordersByHour")}</h3>
          <div className="flex h-24 items-end gap-0.5" aria-hidden>
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
          <ChartTable
            caption={t("dash.ordersByHour")}
            headers={[t("dashw.hour"), t("dash.totalOrders")]}
            rows={totals.byHour.map((count, hour) => [`${String(hour).padStart(2, "0")}:00`, count]).filter((row) => Number(row[1]) > 0)}
          />
        </div>
      </div>
    </Section>
  );
}

function RankedList({ title, rows, money }: { title: string; rows: { name: string; amount: number }[]; money: (minor: number) => string }) {
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
