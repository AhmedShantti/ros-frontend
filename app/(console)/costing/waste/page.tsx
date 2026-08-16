"use client";

/**
 * Waste analysis — SRS §13.4.
 *
 * The separation that makes this report honest is true waste against
 * controlled consumption (FR-INV-059). Staff meals and tastings leave stock
 * and cost money, but they are a decision, not a loss. Reporting them together
 * inflates the waste figure until nobody trusts it, and the genuine spoilage
 * hides inside a number everyone has learned to discount.
 *
 * "Revenue required to offset" is the framing that changes behaviour. Waste
 * of 8,000 at a 68% margin is not an 8,000 problem — it is a 11,800 sales
 * problem, because that is what has to be sold to earn the money back. Kitchen
 * teams argue with a cost figure and act on a sales one.
 */

import { useMemo, useState } from "react";
import type { Money, WasteAnalysisRow } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid, Toolbar } from "@/components/console/page";
import { CategoryBarChart, MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { Badge, Callout, Meter, SegmentedControl } from "@/components/console/ui";

type GroupBy = "reason" | "item" | "location" | "employee";

interface WasteTotals {
  trueWaste: Money;
  controlledConsumption: Money;
  percentOfCogs: number;
  percentOfNetSales: number;
  revenueRequiredToOffset: Money;
}

export default function WasteAnalysisPage() {
  return (
    <Gate permissions={["costing.view", "report.view.inventory"]}>
      <WasteAnalysisScreen />
    </Gate>
  );
}

function WasteAnalysisScreen() {
  const { t } = useI18n();
  const { scope } = useSession();
  const [groupBy, setGroupBy] = useState<GroupBy>("reason");

  const scopeKey = `${scope.tenantId}|${scope.brandId}|${scope.branchId}`;

  const rowsState = useAsync<WasteAnalysisRow[]>(
    () => services.costing.wasteAnalysis(groupBy, scope),
    [groupBy, scopeKey],
  );

  const totalsState = useAsync<WasteTotals>(
    () => services.costing.wasteTotals(scope),
    [scopeKey],
  );

  return (
    <>
      <PageHeader
        title={t("cost.wasteTitle")}
        subtitle={t("cost.wasteSubtitle")}
        spec="FR-CST-030"
      />

      <PageBody>
        <AsyncPanel state={totalsState}>
          {(totals) => <WasteTiles totals={totals} />}
        </AsyncPanel>

        <Toolbar>
          <SegmentedControl<GroupBy>
            label={t("common.grouping")}
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "reason", label: t("cost.byReason") },
              { value: "item", label: t("cost.byItem") },
              { value: "location", label: t("cost.byLocation") },
              { value: "employee", label: t("cost.byEmployee") },
            ]}
          />
        </Toolbar>

        <AsyncPanel state={rowsState}>{(rows) => <WasteBody rows={rows} />}</AsyncPanel>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------

function WasteTiles({ totals }: { totals: WasteTotals }) {
  const { t, fmt } = useI18n();

  return (
    <TileGrid columns={4}>
      <MetricTile
        label={t("inv.trueWaste")}
        value={formatMoney(totals.trueWaste, fmt, true)}
        spec="FR-INV-059"
        footer={
          <span>
            {formatPercent(totals.percentOfCogs, fmt, 1)} {t("cost.percentOfCogs")}
          </span>
        }
      />
      <MetricTile
        label={t("inv.controlledConsumption")}
        value={formatMoney(totals.controlledConsumption, fmt, true)}
        hint={t("cost.controlledHint")}
      />
      <MetricTile
        label={t("common.percentOfSales")}
        value={formatPercent(totals.percentOfNetSales, fmt, 2)}
      />
      <MetricTile
        label={t("cost.revenueToOffset")}
        value={formatMoney(totals.revenueRequiredToOffset, fmt, true)}
        hint={t("cost.revenueToOffsetHint")}
      />
    </TileGrid>
  );
}

// ---------------------------------------------------------------------------

function WasteBody({ rows }: { rows: WasteAnalysisRow[] }) {
  const { t, tx, fmt } = useI18n();

  const ranked = useMemo(
    () => [...rows].sort((a, b) => b.value.amount - a.value.amount),
    [rows],
  );

  const largest = ranked[0]?.value.amount ?? 0;
  const currency = ranked[0]?.value.currency ?? "EGP";

  const chartData = useMemo(
    () => ranked.slice(0, 10).map((row) => ({ label: tx(row.label), value: row.value.amount })),
    [ranked, tx],
  );

  const columns = useMemo<Column<WasteAnalysisRow>[]>(
    () => [
      {
        key: "label",
        header: t("common.name"),
        render: (row) => (
          <div className="flex items-center gap-2">
            <CellStack primary={tx(row.label)} />
            {!row.isTrueWaste ? (
              <Badge tone="muted">{t("inv.controlledConsumption")}</Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: "quantity",
        header: t("common.quantity"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.quantity, fmt, 1),
      },
      {
        key: "recordCount",
        header: t("cost.records"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.recordCount, fmt),
      },
      {
        key: "percentOfCogs",
        header: t("cost.percentOfCogs"),
        numeric: true,
        render: (row) => formatPercent(row.percentOfCogs, fmt, 2),
      },
      {
        key: "value",
        header: t("common.value"),
        numeric: true,
        render: (row) => (
          <span className="inline-block min-w-24">
            <span className="block">{formatMoney(row.value, fmt)}</span>
            <Meter
              className="mt-1"
              value={largest === 0 ? 0 : (row.value.amount / largest) * 100}
              tone={row.isTrueWaste ? "bad" : "muted"}
            />
          </span>
        ),
      },
    ],
    [t, tx, fmt, largest],
  );

  return (
    <>
      <Section title={t("cost.wasteTitle")} padded={false}>
        <div className="px-5 pb-5">
          <CategoryBarChart
            data={chartData}
            valueLabel={t("common.value")}
            format={(value) => formatMoney({ amount: value, currency }, fmt, true)}
            height={Math.max(200, chartData.length * 34)}
          />
        </div>
      </Section>

      <DataTable
        columns={columns}
        rows={ranked}
        rowKey={(row) => row.key}
        caption={t("cost.wasteTitle")}
        dense
      />

      <Callout tone="muted">{t("cost.wasteSeparationNote")}</Callout>
    </>
  );
}
