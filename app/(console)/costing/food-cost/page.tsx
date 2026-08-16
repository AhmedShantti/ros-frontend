"use client";

/**
 * Food cost — SRS §13.2.
 *
 * COGS ÷ net sales, cut three ways. The number itself is easy; what makes it
 * useful is the comparison against target, because "31% food cost" means
 * nothing without knowing whether this concept was built for 28% or 34%.
 *
 * Net sales here is ex-tax and net of discounts. Computing the ratio against
 * gross sales instead — a common shortcut — flatters the figure by exactly the
 * discount rate, which is worst precisely when discounting is out of control.
 *
 * Variance is expressed in percentage points, not percent. A move from 30% to
 * 33% is three points, not ten percent, and conflating the two is how a small
 * report becomes a large argument.
 */

import { useMemo, useState } from "react";
import type { FoodCostRow } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent, formatPoints } from "@/lib/console/format";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { CategoryBarChart, MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Meter, SegmentedControl, cx } from "@/components/console/ui";

type Grouping = "branch" | "brand" | "category";

export default function FoodCostPage() {
  return (
    <Gate permissions={["costing.view"]}>
      <FoodCostScreen />
    </Gate>
  );
}

function FoodCostScreen() {
  const { t } = useI18n();
  const { scope } = useSession();
  const [grouping, setGrouping] = useState<Grouping>("branch");

  const state = useAsync<FoodCostRow[]>(() => {
    if (grouping === "brand") return services.costing.foodCostByBrand(scope);
    if (grouping === "category") return services.costing.foodCostByCategory(scope);
    return services.costing.foodCostByBranch(scope);
  }, [grouping, scope.tenantId, scope.brandId, scope.branchId]);

  return (
    <>
      <PageHeader
        title={t("cost.foodCostTitle")}
        subtitle={t("cost.foodCostSubtitle")}
        spec="FR-CST-001"
      />

      <PageBody>
        <Toolbar>
          <SegmentedControl<Grouping>
            label={t("common.grouping")}
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "branch", label: t("cost.byBranch") },
              { value: "brand", label: t("cost.byBrand") },
              { value: "category", label: t("cost.byCategory") },
            ]}
          />
        </Toolbar>

        <AsyncPanel state={state}>{(rows) => <FoodCostBody rows={rows} />}</AsyncPanel>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------

function FoodCostBody({ rows }: { rows: FoodCostRow[] }) {
  const { t, tx, fmt } = useI18n();

  const totals = useMemo(() => {
    const netSales = rows.reduce((sum, row) => sum + row.netSales.amount, 0);
    const cogs = rows.reduce((sum, row) => sum + row.cogs.amount, 0);
    // Weighted by sales, not a mean of the percentages — averaging ratios
    // gives a small branch the same weight as a flagship.
    const blended = netSales === 0 ? 0 : (cogs / netSales) * 100;
    const target =
      rows.length === 0
        ? 0
        : rows.reduce((sum, row) => sum + row.targetPercent, 0) / rows.length;

    return {
      netSales,
      cogs,
      blended,
      target,
      overTarget: rows.filter((row) => row.variancePoints > 0).length,
    };
  }, [rows]);

  const currency = rows[0]?.netSales.currency ?? "EGP";

  const chartData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.foodCostPercent - a.foodCostPercent)
        .map((row) => ({ label: tx(row.label), value: row.foodCostPercent })),
    [rows, tx],
  );

  const columns = useMemo<Column<FoodCostRow>[]>(
    () => [
      {
        key: "label",
        header: t("common.name"),
        render: (row) => <CellStack primary={tx(row.label)} />,
      },
      {
        key: "netSales",
        header: t("fin.netSales"),
        numeric: true,
        render: (row) => formatMoney(row.netSales, fmt, true),
      },
      {
        key: "cogs",
        header: t("pl.cogs"),
        numeric: true,
        render: (row) => formatMoney(row.cogs, fmt, true),
      },
      {
        key: "foodCostPercent",
        header: t("cost.foodCostPercent"),
        numeric: true,
        render: (row) => (
          <span className="inline-block min-w-20">
            <span
              className={cx(
                "block font-semibold",
                row.variancePoints > 1.5 && "text-bad",
                row.variancePoints > 0 && row.variancePoints <= 1.5 && "text-warn",
                row.variancePoints <= 0 && "text-good",
              )}
            >
              {formatPercent(row.foodCostPercent, fmt, 1)}
            </span>
            <Meter
              className="mt-1"
              // Scaled against a 50% ceiling so the bars stay comparable.
              value={(row.foodCostPercent / 50) * 100}
              tone={
                row.variancePoints > 1.5
                  ? "bad"
                  : row.variancePoints > 0
                    ? "warn"
                    : "good"
              }
            />
          </span>
        ),
      },
      {
        key: "targetPercent",
        header: t("cost.targetPercent"),
        numeric: true,
        secondary: true,
        render: (row) => formatPercent(row.targetPercent, fmt, 1),
      },
      {
        key: "variancePoints",
        header: t("cost.variancePoints"),
        numeric: true,
        render: (row) => (
          <span
            className={cx(
              "font-mono tabular-nums",
              row.variancePoints > 0 ? "text-bad" : "text-good",
            )}
          >
            {formatPoints(row.variancePoints, fmt)}
          </span>
        ),
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <TileGrid columns={4}>
        <MetricTile
          label={t("cost.foodCostPercent")}
          value={formatPercent(totals.blended, fmt, 1)}
          spec="FR-CST-001"
          hint={t("cost.blendedHint")}
        />
        <MetricTile
          label={t("cost.targetPercent")}
          value={formatPercent(totals.target, fmt, 1)}
        />
        <MetricTile
          label={t("pl.cogs")}
          value={formatMoney({ amount: totals.cogs, currency }, fmt, true)}
        />
        <MetricTile
          label={t("cost.overTarget")}
          value={formatNumber(totals.overTarget, fmt)}
        />
      </TileGrid>

      <Section title={t("cost.foodCostPercent")} spec="FR-CST-001" padded={false}>
        <div className="px-5 pb-5">
          <CategoryBarChart
            data={chartData}
            valueLabel={t("cost.foodCostPercent")}
            format={(value) => formatPercent(value, fmt, 1)}
            height={Math.max(200, chartData.length * 34)}
          />
        </div>
      </Section>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        caption={t("cost.foodCostTitle")}
        dense
      />
    </>
  );
}
