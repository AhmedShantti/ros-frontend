"use client";

/**
 * Employee performance — SRS §14.5, §13.5.
 *
 * Sales per labour hour is the headline because it is the only metric here
 * that is fair across shifts. Net sales rewards whoever worked Friday night;
 * dividing by hours worked lets a Tuesday lunch server be compared with them.
 *
 * The control metrics — voids, discounts, cash variance — sit in the same
 * table on purpose. Read alone, a high seller looks like a star; read beside a
 * void rate three times the branch average, the same person is a question. The
 * SRS is explicit that this is a prompt for a conversation and not a verdict
 * (FR-CST-042), so nothing here is scored or ranked into a league table.
 */

import { useMemo, useState } from "react";
import type { EmployeePerformance } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
} from "@/lib/console/format";
import { employeePerformance } from "@/lib/console/mock/workforce";
import {
  CellStack,
  CollectionTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Callout,
  DescList,
  DescRow,
  Drawer,
  Meter,
  cx,
} from "@/components/console/ui";

export default function PerformancePage() {
  return (
    <Gate permissions={["hr.performance.view"]}>
      <PerformanceScreen />
    </Gate>
  );
}

function PerformanceScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<EmployeePerformance | null>(null);

  const collection = useCollection<EmployeePerformance>(
    (query) => services.workforce.performance.list(query),
    { scope, initialSort: "-salesPerLabourHour", pageSize: 25 },
  );

  const positions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of employeePerformance) {
      if (!seen.has(row.position.en)) seen.set(row.position.en, tx(row.position));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tx]);

  const totals = useMemo(() => {
    const rows = collection.rows;
    if (rows.length === 0) {
      return { netSales: 0, averageSph: 0, voidRate: 0, orders: 0 };
    }
    const netSales = rows.reduce((sum, row) => sum + row.netSales.amount, 0);
    const orders = rows.reduce((sum, row) => sum + row.orderCount, 0);
    const voids = rows.reduce((sum, row) => sum + row.voidCount, 0);
    const hours = rows.reduce((sum, row) => sum + row.hoursWorked, 0);
    return {
      netSales,
      orders,
      averageSph: hours === 0 ? 0 : netSales / hours,
      voidRate: orders === 0 ? 0 : (voids / orders) * 100,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.netSales.currency ?? "EGP";
  const topSph = collection.rows[0]?.salesPerLabourHour.amount ?? 0;

  const columns = useMemo<Column<EmployeePerformance>[]>(
    () => [
      {
        key: "employeeName",
        header: t("wf.employee"),
        render: (row) => (
          <CellStack primary={tx(row.employeeName)} secondary={tx(row.position)} />
        ),
      },
      {
        key: "netSales",
        header: t("fin.netSales"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.netSales, fmt, true),
      },
      {
        key: "orderCount",
        header: t("wf.orderCount"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.orderCount, fmt),
      },
      {
        key: "salesPerLabourHour",
        header: t("wf.salesPerHour"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span className="inline-block min-w-24">
            <span className="block">{formatMoney(row.salesPerLabourHour, fmt)}</span>
            <Meter
              className="mt-1"
              value={topSph === 0 ? 0 : (row.salesPerLabourHour.amount / topSph) * 100}
              tone="accent"
            />
          </span>
        ),
      },
      {
        key: "upsellRate",
        header: t("wf.upsellRate"),
        sortable: true,
        numeric: true,
        secondary: true,
        render: (row) => formatPercent(row.upsellRate, fmt, 1),
      },
      {
        key: "voidCount",
        header: t("wf.voidCount"),
        sortable: true,
        numeric: true,
        render: (row) => {
          const rate = row.orderCount === 0 ? 0 : (row.voidCount / row.orderCount) * 100;
          return (
            <span className={cx(rate > 5 && "text-bad font-semibold", rate > 2 && rate <= 5 && "text-warn")}>
              {formatNumber(row.voidCount, fmt)}
            </span>
          );
        },
      },
      {
        key: "cashVariance",
        header: t("wf.cashVariance"),
        numeric: true,
        render: (row) =>
          row.cashVariance.amount === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <DeltaCell value={-Math.abs(row.cashVariance.amount)}>
              {formatMoney(row.cashVariance, fmt)}
            </DeltaCell>
          ),
      },
    ],
    [t, tx, fmt, topSph],
  );

  return (
    <>
      <PageHeader
        title={t("wf.performanceTitle")}
        subtitle={t("wf.performanceSubtitle")}
        spec="FR-HRM-030"
      />

      <PageBody>
        <TileGrid columns={4}>
          <MetricTile
            label={t("fin.netSales")}
            value={formatMoney({ amount: totals.netSales, currency }, fmt, true)}
          />
          <MetricTile
            label={t("wf.salesPerHour")}
            value={formatMoney({ amount: totals.averageSph, currency }, fmt, true)}
            spec="FR-CST-025"
            hint={t("wf.sphHint")}
          />
          <MetricTile label={t("wf.orderCount")} value={formatNumber(totals.orders, fmt)} />
          <MetricTile
            label={t("wf.voidRate")}
            value={formatPercent(totals.voidRate, fmt, 2)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[{ key: "position", label: t("wf.position"), options: positions }]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.employeeId}
          caption={t("wf.performanceTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.employeeId ?? null}
          dense
        />

        <Callout tone="muted">{t("wf.performanceNote")}</Callout>
      </PageBody>

      <PerformanceDrawer row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function PerformanceDrawer({
  row,
  onClose,
}: {
  row: EmployeePerformance | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!row) return null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(row.employeeName)}
      subtitle={`${tx(row.position)} · ${tx(row.branchName)}`}
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("fin.netSales")} mono>
            {formatMoney(row.netSales, fmt)}
          </DescRow>
          <DescRow label={t("wf.orderCount")} mono>
            {formatNumber(row.orderCount, fmt)}
          </DescRow>
          <DescRow label={t("dash.aov")} mono>
            {formatMoney(row.averageOrderValue, fmt)}
          </DescRow>
          <DescRow label={t("wf.itemsPerOrder")} mono>
            {formatNumber(row.itemsPerOrder, fmt, 1)}
          </DescRow>
          <DescRow label={t("wf.upsellRate")} mono>
            {formatPercent(row.upsellRate, fmt, 1)}
          </DescRow>
          <DescRow label={t("wf.serviceTime")} mono>
            {formatDuration(row.averageServiceSeconds, fmt)}
          </DescRow>
          <DescRow label={t("wf.hours")} mono>
            {formatNumber(row.hoursWorked, fmt, 1)}
          </DescRow>
          <DescRow label={t("wf.salesPerHour")} mono>
            {formatMoney(row.salesPerLabourHour, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("wf.controlMetrics")}</h3>
          <DescList>
            <DescRow label={t("wf.voidCount")} mono>
              {formatNumber(row.voidCount, fmt)}
            </DescRow>
            <DescRow label={t("wf.voidValue")} mono>
              {formatMoney(row.voidValue, fmt)}
            </DescRow>
            <DescRow label={t("wf.discountValue")} mono>
              {formatMoney(row.discountValue, fmt)}
            </DescRow>
            <DescRow label={t("wf.cashVariance")} mono>
              <DeltaCell value={-Math.abs(row.cashVariance.amount)}>
                {formatMoney(row.cashVariance, fmt)}
              </DeltaCell>
            </DescRow>
          </DescList>
        </section>

        <Callout tone="muted">{t("wf.performanceNote")}</Callout>
      </div>
    </Drawer>
  );
}
