"use client";

/**
 * Usage build-up and variance trend — FR-CST-011, FR-CST-013, FR-CST-016,
 * FR-CST-017. The arithmetic lives in `lib/console/costing-usage.ts`; this
 * file loads the counts, the ledger and the waste records and renders them.
 *
 * Live, the backend has no index of count sessions (a count is reachable by
 * id only) and the movement ledger is addressable per item, so the periods
 * cannot be assembled from this browser. The screen says so rather than
 * rendering an empty table that reads as "no variance".
 */

import { useMemo, useState } from "react";
import type { CountSession } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync } from "@/lib/console/hooks";
import { useI18n } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, formatPercent } from "@/lib/console/format";
import { SHIFT_HOURS, buildUsage, varianceTrend, type UsageRow } from "@/lib/console/costing-usage";
import { CellStack, DataTable, DeltaCell, type Column } from "@/components/console/data-table";
import { Section, TileGrid, Toolbar } from "@/components/console/page";
import { CategoryBarChart, MetricTile } from "@/components/console/charts";
import { AsyncPanel } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { EmptyState } from "@/components/console/fields";
import { Badge, Callout, DescList, DescRow, Drawer, SegmentedControl, Select, cx } from "@/components/console/ui";

async function loadUsage(): Promise<UsageRow[]> {
  const [countPage, movementPage, wastePage] = await Promise.all([
    services.inventory.counts.list({ limit: 1000 }),
    services.inventory.movements.list({ limit: 20000 }),
    services.inventory.waste.list({ limit: 20000 }).catch(() => ({ rows: [], total: 0 })),
  ]);
  const counts: CountSession[] = await Promise.all(
    countPage.rows.map(async (session) =>
      session.status === "posted" && session.lines.length === 0
        ? ((await services.inventory.counts.get(session.id).catch(() => null)) ?? session)
        : session,
    ),
  );
  return buildUsage(counts, movementPage.rows, wastePage.rows);
}

export function useUsageRows() {
  return useAsync(loadUsage, []);
}

function LiveGap() {
  const { t } = useI18n();
  return DATA_MODE === "http" ? <Callout tone="warn">{t("cst.usage.liveGap")}</Callout> : null;
}

// ---------------------------------------------------------------------------
// Build-up
// ---------------------------------------------------------------------------

export function UsageBuildUp() {
  const { t } = useI18n();
  const state = useUsageRows();
  return (
    <div className="space-y-4">
      <LiveGap />
      <AsyncPanel
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title={t("cst.usage.emptyTitle")} body={t("cst.usage.emptyBody")} />}
      >
        {(rows) => <UsageTable rows={rows} />}
      </AsyncPanel>
    </div>
  );
}

function UsageTable({ rows }: { rows: UsageRow[] }) {
  const { t, tx, fmt } = useI18n();
  const [granularity, setGranularity] = useState<"all" | "shift" | "count_period">("all");
  const [selected, setSelected] = useState<UsageRow | null>(null);

  const visible = useMemo(
    () => rows.filter((row) => granularity === "all" || row.granularity === granularity),
    [rows, granularity],
  );
  const qty = (value: number) => formatNumber(value, fmt, 2);
  const currency = "EGP" as const;

  const totals = useMemo(
    () => ({
      loss: visible.filter((row) => row.varianceValueMinor > 0).reduce((sum, row) => sum + row.varianceValueMinor, 0),
      shift: rows.filter((row) => row.granularity === "shift").length,
      unexplained: visible.filter((row) => row.unexplainedQty > 0.0005).length,
    }),
    [visible, rows],
  );

  const columns: Column<UsageRow>[] = [
    {
      key: "item",
      header: t("inv.sku"),
      render: (row) => <CellStack primary={tx(row.itemName)} secondary={`${tx(row.locationName)} · ${row.sku}`} />,
    },
    {
      key: "period",
      header: t("cst.usage.period"),
      render: (row) => (
        <span className="flex flex-col gap-1">
          <span className="text-xs">{formatDateTime(row.periodEnd, fmt)}</span>
          <GranularityBadge row={row} />
        </span>
      ),
    },
    { key: "actual", header: t("cost.actualUsage"), numeric: true, render: (row) => qty(row.actualUsage) },
    { key: "theoretical", header: t("cost.theoretical"), numeric: true, render: (row) => qty(row.theoreticalUsage) },
    {
      key: "variance",
      header: t("common.variance"),
      numeric: true,
      render: (row) => <DeltaCell value={-row.varianceQty}>{qty(row.varianceQty)}</DeltaCell>,
    },
    // FR-CST-013 — recorded waste as its own column, then what it leaves unexplained.
    { key: "waste", header: t("cst.usage.explainedByWaste"), numeric: true, secondary: true, render: (row) => qty(row.recordedWaste) },
    {
      key: "unexplained",
      header: t("cost.unexplained"),
      numeric: true,
      render: (row) => (
        <span className={cx(row.unexplainedQty > 0.0005 && "text-bad font-semibold")}>{qty(row.unexplainedQty)}</span>
      ),
    },
    {
      key: "pct",
      header: "%",
      numeric: true,
      render: (row) => (row.variancePercent === null ? "—" : formatPercent(row.variancePercent, fmt, 1)),
    },
    {
      key: "value",
      header: t("cost.varianceValue"),
      numeric: true,
      render: (row) => (
        <DeltaCell value={-row.varianceValueMinor}>{formatMoney({ amount: row.varianceValueMinor, currency }, fmt)}</DeltaCell>
      ),
    },
  ];

  return (
    <>
      <TileGrid columns={3}>
        <MetricTile label={t("cost.varianceLoss")} value={formatMoney({ amount: totals.loss, currency }, fmt, true)} spec="FR-CST-012" />
        <MetricTile label={t("cst.usage.shiftRows")} value={formatNumber(totals.shift, fmt)} hint={t("cst.usage.shiftHint").replace("{h}", String(SHIFT_HOURS))} spec="FR-CST-016" />
        <MetricTile label={t("cost.unexplained")} value={formatNumber(totals.unexplained, fmt)} spec="FR-CST-013" />
      </TileGrid>

      <Callout tone="muted">{t("cst.usage.formula")}</Callout>

      <Toolbar
        actions={
          <ExportButton
            filename="usage-build-up"
            title={t("cst.usage.title")}
            rows={visible}
            columns={[
              { key: "item", header: t("inv.sku"), value: (row) => `${row.sku} ${tx(row.itemName)}` },
              { key: "location", header: t("common.location"), value: (row) => tx(row.locationName) },
              { key: "from", header: t("range.from"), value: (row) => row.periodStart },
              { key: "to", header: t("range.to"), value: (row) => row.periodEnd },
              { key: "granularity", header: t("cst.usage.granularity"), value: (row) => row.granularity },
              { key: "opening", header: t("cst.usage.opening"), value: (row) => row.opening },
              { key: "purchases", header: t("cst.usage.purchases"), value: (row) => row.purchases },
              { key: "transfersIn", header: t("cst.usage.transfersIn"), value: (row) => row.transfersIn },
              { key: "production", header: t("cst.usage.productionOutput"), value: (row) => row.productionOutput },
              { key: "transfersOut", header: t("cst.usage.transfersOut"), value: (row) => row.transfersOut },
              { key: "closing", header: t("cst.usage.closing"), value: (row) => row.closing },
              { key: "actual", header: t("cost.actualUsage"), value: (row) => row.actualUsage },
              { key: "theoretical", header: t("cost.theoretical"), value: (row) => row.theoreticalUsage },
              { key: "waste", header: t("cost.recordedWaste"), value: (row) => row.recordedWaste },
              { key: "unexplained", header: t("cost.unexplained"), value: (row) => row.unexplainedQty },
              { key: "value", header: t("cost.varianceValue"), value: (row) => (row.varianceValueMinor / 100).toFixed(2) },
            ]}
          />
        }
      >
        <SegmentedControl
          label={t("cst.usage.granularity")}
          value={granularity}
          onChange={setGranularity}
          options={[
            { value: "all", label: t("common.all") },
            { value: "shift", label: t("cst.usage.shift") },
            { value: "count_period", label: t("cst.usage.countPeriod") },
          ]}
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(row) => row.key}
        caption={t("cst.usage.title")}
        onRowClick={setSelected}
        activeRowKey={selected?.key ?? null}
        dense
      />

      {selected ? (
        <Drawer open onClose={() => setSelected(null)} title={tx(selected.itemName)} subtitle={tx(selected.locationName)}>
          <div className="space-y-4">
            <GranularityBadge row={selected} />
            {/* FR-CST-011 — every term of the actual-usage formula, shown. */}
            <DescList>
              <DescRow label={`${t("cst.usage.opening")} · ${selected.openingCountRef}`} mono>{qty(selected.opening)}</DescRow>
              <DescRow label={`+ ${t("cst.usage.purchases")}`} mono>{qty(selected.purchases)}</DescRow>
              <DescRow label={`+ ${t("cst.usage.transfersIn")}`} mono>{qty(selected.transfersIn)}</DescRow>
              <DescRow label={`+ ${t("cst.usage.productionOutput")}`} mono>{qty(selected.productionOutput)}</DescRow>
              <DescRow label={`− ${t("cst.usage.transfersOut")}`} mono>{qty(selected.transfersOut)}</DescRow>
              <DescRow label={`− ${t("cst.usage.closing")} · ${selected.closingCountRef}`} mono>{qty(selected.closing)}</DescRow>
              <DescRow label={`= ${t("cost.actualUsage")}`} mono>
                <span className="font-semibold">{qty(selected.actualUsage)}</span>
              </DescRow>
              <DescRow label={`− ${t("cost.theoretical")}`} mono>{qty(selected.theoreticalUsage)}</DescRow>
              <DescRow label={`= ${t("common.variance")}`} mono>{qty(selected.varianceQty)}</DescRow>
              <DescRow label={`− ${t("cost.recordedWaste")}`} mono>{qty(selected.recordedWaste)}</DescRow>
              <DescRow label={`= ${t("cost.unexplained")}`} mono>
                <span className="text-bad font-semibold">{qty(selected.unexplainedQty)}</span>
              </DescRow>
            </DescList>
            <Callout tone="muted">{t("cst.usage.theoreticalNote")}</Callout>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

function GranularityBadge({ row }: { row: UsageRow }) {
  const { t } = useI18n();
  return row.granularity === "shift" ? (
    <Badge tone="accent">{t("cst.usage.shift")}</Badge>
  ) : (
    <Badge tone="muted">{t("cst.usage.countPeriodFallback")}</Badge>
  );
}

// ---------------------------------------------------------------------------
// Trend — FR-CST-017
// ---------------------------------------------------------------------------

export function VarianceTrendView() {
  const { t } = useI18n();
  const state = useUsageRows();
  return (
    <div className="space-y-4">
      <LiveGap />
      <AsyncPanel
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty={<EmptyState title={t("cst.usage.emptyTitle")} body={t("cst.usage.emptyBody")} />}
      >
        {(rows) => <Trend rows={rows} />}
      </AsyncPanel>
    </div>
  );
}

function Trend({ rows }: { rows: UsageRow[] }) {
  const { t, tx, fmt } = useI18n();

  const items = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; periods: number }>();
    for (const row of rows) {
      const entry = seen.get(row.itemId) ?? { id: row.itemId, label: tx(row.itemName), periods: 0 };
      entry.periods += 1;
      seen.set(row.itemId, entry);
    }
    return [...seen.values()].sort((a, b) => b.periods - a.periods || a.label.localeCompare(b.label));
  }, [rows, tx]);

  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(row.locationId, tx(row.locationName));
    return [...seen.entries()];
  }, [rows, tx]);

  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [locationId, setLocationId] = useState("");
  const points = useMemo(() => varianceTrend(rows, itemId, locationId || null), [rows, itemId, locationId]);

  const chart = points
    .filter((point) => point.variancePercent !== null)
    .map((point) => ({ label: `${formatDateTime(point.periodEnd, fmt)}`, value: Math.round(point.variancePercent! * 10) / 10 }));

  return (
    <Section title={t("cst.trend.title")} hint={t("cst.trend.hint")} spec="FR-CST-017">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select aria-label={t("inv.sku")} value={itemId} onChange={(event) => setItemId(event.target.value)}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {`${item.label} (${item.periods})`}
              </option>
            ))}
          </Select>
          <Select aria-label={t("common.location")} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">{t("common.all")}</option>
            {locations.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {points.length < 2 ? <Callout tone="muted">{t("cst.trend.fewPeriods")}</Callout> : null}

        {chart.length > 0 ? (
          <CategoryBarChart
            data={chart}
            valueLabel={t("cst.trend.variancePercent")}
            format={(value) => formatPercent(value, fmt, 1)}
            height={Math.max(160, chart.length * 34)}
          />
        ) : null}

        <ul className="divide-line divide-y text-sm">
          {points.map((point) => (
            <li key={`${point.periodEnd}-${point.label}`} className="flex items-center justify-between gap-3 py-2">
              <span className="flex flex-col">
                <span className="text-fg">{formatDateTime(point.periodEnd, fmt)}</span>
                <span className="text-fg-subtle text-xs">
                  {tx(point.locationName)} · <span dir="ltr">{point.label}</span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={point.granularity === "shift" ? "accent" : "muted"}>
                  {point.granularity === "shift" ? t("cst.usage.shift") : t("cst.usage.countPeriod")}
                </Badge>
                <span className="font-mono tabular-nums">
                  {point.variancePercent === null ? "—" : formatPercent(point.variancePercent, fmt, 1)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
