"use client";

/**
 * Break-even progress — SRS §13.6, FR-CST-038.
 *
 * For each branch: the month's fixed costs (the allocated fixed operating
 * expenses, FR-CST-036) divided by the average contribution margin gives the
 * net sales the branch must reach before it earns anything; month-to-date
 * net sales show how far along it is.
 *
 * Sources, each named on screen:
 *   - net sales month-to-date from the orders (`services.sales.orders`, real);
 *   - contribution margin from the same orders' cost snapshots when their
 *     lines are present, otherwise from branch profitability (demo only),
 *     otherwise from an assumption the manager types in and that is labelled
 *     as one;
 *   - fixed costs from the local operating-expense register.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Order } from "@/lib/console/types";
import type { ConsoleKey } from "@/locales";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatPercent } from "@/lib/console/format";
import { branchCostsForMonth } from "@/lib/console/costing-opex";
import { lineCostSnapshot } from "@/lib/console/costing-food-cost";
import { breakEven, daysInMonth, type BreakEvenResult } from "@/lib/console/costing-break-even";
import { loadAllocationInputs } from "@/components/console/costing-opex-form";
import { DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { PercentInput } from "@/components/console/fields";
import { Badge, Callout, Card, Field, Input, Meter } from "@/components/console/ui";

export default function BreakEvenPage() {
  return (
    <Gate permissions={["costing.margin.view", "costing.view"]}>
      <BreakEven />
    </Gate>
  );
}

type MarginSource = "orders" | "profitability" | "assumed" | "none";

interface Row extends BreakEvenResult {
  name: string;
  marginSource: MarginSource;
}

const COUNTED = new Set<Order["state"]>(["completed", "partially_refunded", "refunded"]);

function BreakEven() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches, tenant } = useSession();
  const [month, setMonth] = useState<string | null>(null);
  const [assumed, setAssumed] = useState("");

  const areas = useMemo(() => new Map(availableBranches.map((branch) => [branch.id, branch.areaSqm])), [availableBranches]);

  const state = useAsync(async () => {
    const [orders, expenses, allocation, profitability] = await Promise.all([
      services.sales.orders.list({ scope: { ...scope, branchId: null }, limit: 1000 }).then((page) => page.rows),
      services.operatingExpenses.all(),
      loadAllocationInputs(scope, areas),
      services.costing.branchProfitability({ ...scope, branchId: null }).catch(() => null),
    ]);
    return { orders, expenses, allocation, profitability };
  }, [scope.tenantId, scope.brandId, areas]);

  const currency = availableBranches[0]?.currency ?? tenant.baseCurrency;

  return (
    <>
      <PageHeader title={t("cst.be.title")} subtitle={t("cst.be.subtitle")} spec="FR-CST-038" />
      <PageBody>
        <AsyncPanel state={state}>
          {(ready) => {
            const latestDay = ready.orders.map((order) => order.businessDay).sort().pop() ?? null;
            const thisMonth = new Date().toISOString().slice(0, 7);
            // Default to the latest month that has trading, so a dataset that
            // sits in the past does not open on an empty month.
            const chosen = month ?? (latestDay ? latestDay.slice(0, 7) : thisMonth);
            const total = daysInMonth(chosen);
            const monthOrders = ready.orders.filter((order) => order.businessDay.startsWith(chosen) && COUNTED.has(order.state));
            const lastTraded = monthOrders.map((order) => order.businessDay).sort().pop() ?? null;
            const asAtDay =
              chosen === thisMonth ? new Date().toISOString().slice(0, 10) : chosen < thisMonth ? (lastTraded ?? `${chosen}-${String(total).padStart(2, "0")}`) : null;
            const elapsed = asAtDay ? Math.min(total, Number(asAtDay.slice(8, 10))) : 0;

            const fixed = branchCostsForMonth(ready.expenses, chosen, ready.allocation.inputs, { fixedOnly: true });
            const assumedMargin = assumed.trim() === "" ? null : Number(assumed);

            const rows: Row[] = availableBranches
              .filter((branch) => !scope.branchId || branch.id === scope.branchId)
              .map((branch) => {
                const branchOrders = monthOrders.filter((order) => order.branchId === branch.id);
                const net = branchOrders.reduce(
                  (sum, order) =>
                    sum +
                    Math.max(
                      0,
                      order.subtotal.amount -
                        order.discountTotal.amount -
                        order.payments.filter((payment) => payment.amount.amount < 0).reduce((s, p) => s + Math.abs(p.amount.amount), 0),
                    ),
                  0,
                );
                const withLines = branchOrders.filter((order) => order.lines.length > 0);
                let marginSource: MarginSource = "none";
                let cm: number | null = null;
                if (withLines.length > 0 && withLines.length === branchOrders.length && net > 0) {
                  // FR-CST-002 — cost from the sale-time snapshot on each line.
                  const cogs = withLines.reduce(
                    (sum, order) =>
                      sum +
                      order.lines
                        .filter((line) => line.state !== "voided")
                        .reduce((s, line) => s + lineCostSnapshot(line, DATA_MODE !== "http"), 0),
                    0,
                  );
                  cm = ((net - cogs) / net) * 100;
                  marginSource = "orders";
                } else {
                  const profit = ready.profitability?.find((row) => row.branchId === branch.id);
                  if (profit && profit.netSales.amount > 0) {
                    cm = ((profit.netSales.amount - profit.cogs.amount) / profit.netSales.amount) * 100;
                    marginSource = "profitability";
                  } else if (assumedMargin !== null && Number.isFinite(assumedMargin)) {
                    cm = assumedMargin;
                    marginSource = "assumed";
                  }
                }
                return {
                  name: tx(branch.name),
                  marginSource,
                  ...breakEven({
                    branchId: branch.id,
                    fixedCostsMinor: fixed.get(branch.id) ?? 0,
                    mtdNetSalesMinor: net,
                    contributionMarginPercent: cm,
                    daysInMonth: total,
                    elapsedDays: elapsed,
                  }),
                };
              });

            const money = (amount: number | null) => (amount === null ? "—" : formatMoney({ amount, currency }, fmt));
            const noFixed = rows.every((row) => row.fixedCostsMinor === 0);
            const needsAssumption = rows.some((row) => row.marginSource === "none" || row.marginSource === "assumed");

            const columns: Column<Row>[] = [
              {
                key: "branch",
                header: t("common.branch"),
                render: (row) => (
                  <span className="flex flex-col">
                    <span className="text-fg text-sm">{row.name}</span>
                    <span className="text-fg-subtle text-xs">{t(`cst.be.source.${row.marginSource}` as ConsoleKey)}</span>
                  </span>
                ),
              },
              { key: "fixed", header: t("cst.be.fixedCosts"), numeric: true, render: (row) => money(row.fixedCostsMinor) },
              {
                key: "cm",
                header: t("cst.be.cm"),
                numeric: true,
                render: (row) => (row.contributionMarginPercent === null ? "—" : formatPercent(row.contributionMarginPercent, fmt, 1)),
              },
              { key: "be", header: t("cst.be.breakEven"), numeric: true, render: (row) => money(row.breakEvenMinor) },
              { key: "mtd", header: t("cst.be.mtd"), numeric: true, render: (row) => money(row.mtdNetSalesMinor) },
              {
                key: "progress",
                header: t("cst.be.progress"),
                render: (row) =>
                  row.progressPercent === null ? (
                    <span className="text-fg-subtle text-xs">{row.fixedCostsMinor === 0 ? t("cst.be.noFixedShort") : t("cst.be.noMarginShort")}</span>
                  ) : (
                    <div className="min-w-32">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono tabular-nums">{formatPercent(row.progressPercent, fmt, 0)}</span>
                        {row.reached ? <Badge tone="good">{t("cst.be.reached")}</Badge> : null}
                      </div>
                      <Meter className="mt-1" value={row.progressPercent} tone={row.reached ? "good" : row.projectedReaches ? "accent" : "warn"} />
                    </div>
                  ),
              },
              {
                key: "daily",
                header: t("cst.be.requiredDaily"),
                numeric: true,
                secondary: true,
                render: (row) => money(row.requiredDailyMinor),
              },
              {
                key: "projected",
                header: t("cst.be.projected"),
                numeric: true,
                render: (row) =>
                  row.projectedReaches === null ? (
                    money(row.projectedMonthEndMinor)
                  ) : (
                    <span className={row.projectedReaches ? "text-good" : "text-bad"}>{money(row.projectedMonthEndMinor)}</span>
                  ),
              },
            ];

            return (
              <>
                <Card>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t("cst.opex.month")}>
                      <Input type="month" dir="ltr" value={chosen} onChange={(event) => setMonth(event.target.value)} />
                    </Field>
                    <Field label={t("cst.be.assumedCm")} hint={t("cst.be.assumedHint")}>
                      <PercentInput value={assumed} onChange={setAssumed} />
                    </Field>
                    <div className="text-fg-subtle self-end text-xs">
                      {asAtDay
                        ? t("cst.be.asAt").replace("{day}", formatDate(asAtDay, fmt)).replace("{elapsed}", String(elapsed)).replace("{total}", String(total))
                        : t("cst.be.future")}
                    </div>
                  </div>
                </Card>

                {noFixed ? (
                  <Callout tone="warn" title={t("cst.be.noFixedTitle")}>
                    {t("cst.be.noFixedBody")}{" "}
                    <Link href="/costing/operating-expenses" className="text-accent underline">
                      {t("cst.opex.title")}
                    </Link>
                  </Callout>
                ) : null}
                {needsAssumption ? <Callout tone="muted">{t("cst.be.assumptionNote")}</Callout> : null}

                <TileGrid columns={3}>
                  <MetricTile label={t("cst.be.fixedCosts")} value={money(rows.reduce((s, row) => s + row.fixedCostsMinor, 0))} />
                  <MetricTile label={t("cst.be.mtd")} value={money(rows.reduce((s, row) => s + row.mtdNetSalesMinor, 0))} />
                  <MetricTile
                    label={t("cst.be.reachedCount")}
                    value={`${rows.filter((row) => row.reached).length} / ${rows.filter((row) => row.breakEvenMinor !== null).length}`}
                  />
                </TileGrid>

                <div className="flex justify-end">
                  <ExportButton
                    filename={`break-even-${chosen}`}
                    title={t("cst.be.title")}
                    filterSummary={chosen}
                    rows={rows}
                    columns={[
                      { key: "branch", header: t("common.branch"), value: (row) => row.name },
                      { key: "fixed", header: t("cst.be.fixedCosts"), value: (row) => (row.fixedCostsMinor / 100).toFixed(2) },
                      { key: "cm", header: t("cst.be.cm"), value: (row) => row.contributionMarginPercent?.toFixed(1) ?? "" },
                      { key: "be", header: t("cst.be.breakEven"), value: (row) => (row.breakEvenMinor === null ? "" : (row.breakEvenMinor / 100).toFixed(2)) },
                      { key: "mtd", header: t("cst.be.mtd"), value: (row) => (row.mtdNetSalesMinor / 100).toFixed(2) },
                      { key: "progress", header: t("cst.be.progress"), value: (row) => row.progressPercent?.toFixed(1) ?? "" },
                      { key: "source", header: t("cst.be.cmSource"), value: (row) => row.marginSource },
                    ]}
                  />
                </div>

                <DataTable columns={columns} rows={rows} rowKey={(row) => row.branchId} caption={t("cst.be.title")} dense />

                <Callout tone="muted">{t("cst.be.formula")}</Callout>
              </>
            );
          }}
        </AsyncPanel>
      </PageBody>
    </>
  );
}
