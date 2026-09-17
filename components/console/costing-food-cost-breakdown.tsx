"use client";

/**
 * Food cost % by item, category, branch, brand, day-part and order type,
 * over a business-day range — FR-CST-004.
 *
 * Built from the orders themselves (`services.sales.orders`, a real endpoint)
 * rather than a pre-aggregated costing report, which the backend does not
 * serve. The cost side is each line's frozen `unitCostSnapshot` (FR-CST-002),
 * so this report is stable when ingredient prices move.
 *
 * The backend's order index returns headers only; lines come from the
 * single-order read. Live, a bounded number of orders is opened line by line
 * and the screen says how many were used, so a partial figure is never
 * presented as a complete one.
 */

import { useMemo, useState } from "react";
import type { Localised, Order } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import {
  DAY_PARTS,
  foodCostBreakdown,
  type FoodCostBreakdownRow,
  type FoodCostDimension,
} from "@/lib/console/costing-food-cost";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { Section, TileGrid, Toolbar } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel } from "@/components/console/states";
import { DateRangeField, type DateRange } from "@/components/console/fields";
import { ExportButton } from "@/components/console/export-button";
import { Callout, Meter, Select, cx } from "@/components/console/ui";

/** Live: how many orders are opened for their lines. */
const LIVE_DETAIL_LIMIT = 150;

interface Loaded {
  orders: Order[];
  itemCategory: Map<string, { id: string; name: Localised }>;
  brandNames: Map<string, Localised>;
  detailed: number;
  headersOnly: number;
}

async function loadOrders(scope: ReturnType<typeof useSession>["scope"]): Promise<Loaded> {
  const [page, items, categories, brands] = await Promise.all([
    services.sales.orders.list({ scope, limit: 1000, sort: "-openedAt" }),
    services.catalogue.items.list({ limit: 2000 }).catch(() => ({ rows: [], total: 0 })),
    services.catalogue.categories.list({ limit: 1000 }).catch(() => ({ rows: [], total: 0 })),
    services.organisation.brands.list({ limit: 200 }).catch(() => ({ rows: [], total: 0 })),
  ]);

  const categoryName = new Map(categories.rows.map((row) => [row.id, row.name]));
  const itemCategory = new Map(
    items.rows.map((item) => [
      item.id,
      { id: item.categoryId, name: categoryName.get(item.categoryId) ?? { en: item.categoryId, ar: item.categoryId } },
    ]),
  );
  const brandNames = new Map(brands.rows.map((row) => [row.id, row.name]));

  let orders = page.rows;
  let detailed = orders.filter((order) => order.lines.length > 0).length;
  let headersOnly = 0;

  if (DATA_MODE === "http") {
    const wanted = orders.filter((order) => order.lines.length === 0);
    const opened = await Promise.all(
      wanted.slice(0, LIVE_DETAIL_LIMIT).map((order) =>
        services.sales.orders.get(`${order.businessDay}/${order.id}`).catch(() => null),
      ),
    );
    const byId = new Map(opened.filter((row): row is Order => row !== null).map((row) => [row.id, row]));
    orders = orders.map((order) => byId.get(order.id) ?? order);
    detailed = orders.filter((order) => order.lines.length > 0).length;
    headersOnly = orders.length - detailed;
  }

  return { orders, itemCategory, brandNames, detailed, headersOnly };
}

export function FoodCostBreakdownSection() {
  const { t } = useI18n();
  const { scope } = useSession();

  const state = useAsync(() => loadOrders(scope), [scope.tenantId, scope.brandId, scope.branchId]);

  return (
    <Section title={t("cst.fc.breakdownTitle")} spec="FR-CST-004">
      <AsyncPanel state={state}>{(loaded) => <Breakdown loaded={loaded} />}</AsyncPanel>
    </Section>
  );
}

function Breakdown({ loaded }: { loaded: Loaded }) {
  const { t, tx, fmt } = useI18n();
  const { availableBranches } = useSession();
  const [dimension, setDimension] = useState<FoodCostDimension>("item");

  // Default to the span the loaded orders actually cover, so the first view
  // is never an empty range on a dataset that sits in the past.
  const span = useMemo(() => {
    const days = loaded.orders.map((order) => order.businessDay).sort();
    return { from: days[0] ?? "", to: days[days.length - 1] ?? "" };
  }, [loaded.orders]);
  const [range, setRange] = useState<DateRange>(span);

  const result = useMemo(
    () =>
      foodCostBreakdown(loaded.orders, dimension, {
        branches: new Map(availableBranches.map((branch) => [branch.id, branch])),
        brandNames: loaded.brandNames,
        itemCategory: loaded.itemCategory,
        // FR-CST-002 — the demo engine freezes the line total; the API freezes per unit.
        snapshotIsLineTotal: DATA_MODE !== "http",
        from: range.from || null,
        to: range.to || null,
      }),
    [loaded, dimension, range, availableBranches],
  );

  const money = (amount: number) => formatMoney({ amount, currency: result.currency }, fmt);
  const options: { value: FoodCostDimension; label: string }[] = [
    { value: "item", label: t("cst.fc.dim.item") },
    { value: "category", label: t("cst.fc.dim.category") },
    { value: "branch", label: t("cst.fc.dim.branch") },
    { value: "brand", label: t("cst.fc.dim.brand") },
    { value: "dayPart", label: t("cst.fc.dim.dayPart") },
    { value: "orderType", label: t("cst.fc.dim.orderType") },
  ];

  const columns: Column<FoodCostBreakdownRow>[] = [
    {
      key: "label",
      header: options.find((option) => option.value === dimension)!.label,
      render: (row) => (
        <CellStack
          primary={tx(row.label)}
          secondary={row.uncostedLines > 0 ? t("cst.fc.uncosted").replace("{n}", String(row.uncostedLines)) : undefined}
        />
      ),
    },
    { key: "orders", header: t("cst.fc.orders"), numeric: true, secondary: true, render: (row) => formatNumber(row.orders, fmt) },
    { key: "units", header: t("cst.fc.units"), numeric: true, secondary: true, render: (row) => formatNumber(row.units, fmt, 1) },
    { key: "netSales", header: t("fin.netSales"), numeric: true, render: (row) => money(row.netSales) },
    { key: "cogs", header: t("cst.fc.cogsSnapshot"), numeric: true, render: (row) => money(row.cogs) },
    {
      key: "pct",
      header: t("cost.foodCostPercent"),
      numeric: true,
      render: (row) =>
        row.foodCostPercent === null ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className="inline-block min-w-20">
            <span className={cx("block font-semibold", row.foodCostPercent > 35 && "text-bad")}>
              {formatPercent(row.foodCostPercent, fmt, 1)}
            </span>
            <Meter className="mt-1" value={(row.foodCostPercent / 50) * 100} tone={row.foodCostPercent > 35 ? "bad" : "accent"} />
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Toolbar>
        <div className="w-56">
          <Select
            aria-label={t("common.grouping")}
            value={dimension}
            onChange={(event) => setDimension(event.target.value as FoodCostDimension)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <ExportButton
          filename={`food-cost-by-${dimension}`}
          title={t("cst.fc.breakdownTitle")}
          filterSummary={`${range.from} → ${range.to}`}
          rows={result.rows}
          columns={[
            { key: "label", header: t("common.name"), value: (row) => tx(row.label) },
            { key: "orders", header: t("cst.fc.orders"), value: (row) => row.orders },
            { key: "netSales", header: t("fin.netSales"), value: (row) => (row.netSales / 100).toFixed(2) },
            { key: "cogs", header: t("cst.fc.cogsSnapshot"), value: (row) => (row.cogs / 100).toFixed(2) },
            { key: "pct", header: t("cost.foodCostPercent"), value: (row) => (row.foodCostPercent === null ? "" : row.foodCostPercent.toFixed(1)) },
          ]}
        />
      </Toolbar>

      <DateRangeField label={t("cst.fc.range")} value={range} onChange={setRange} />

      <TileGrid columns={3}>
        <MetricTile
          label={t("cost.foodCostPercent")}
          value={result.foodCostPercent === null ? "—" : formatPercent(result.foodCostPercent, fmt, 1)}
          spec="FR-CST-003"
        />
        <MetricTile label={t("fin.netSales")} value={formatMoney({ amount: result.netSales, currency: result.currency }, fmt, true)} />
        <MetricTile
          label={t("cst.fc.cogsSnapshot")}
          value={formatMoney({ amount: result.cogs, currency: result.currency }, fmt, true)}
          hint={t("cst.fc.snapshotHint")}
          spec="FR-CST-002"
        />
      </TileGrid>

      {loaded.headersOnly > 0 ? (
        <Callout tone="warn">
          {t("cst.fc.partial").replace("{used}", String(loaded.detailed)).replace("{total}", String(loaded.orders.length))}
        </Callout>
      ) : null}

      {dimension === "dayPart" ? (
        <Callout tone="muted">
          {t("cst.fc.dayPartBands")} {DAY_PARTS.map((part) => tx(part.label)).join(" · ")}
        </Callout>
      ) : null}

      <DataTable
        columns={columns}
        rows={result.rows}
        rowKey={(row) => row.key}
        caption={t("cst.fc.breakdownTitle")}
        dense
      />

      <Callout tone="muted">{t("cst.fc.netNote")}</Callout>
    </div>
  );
}
