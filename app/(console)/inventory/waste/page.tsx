"use client";

/**
 * Waste — SRS §11.7.
 *
 * Split by whether it is true waste. A staff meal and a burnt steak both
 * leave stock, but only one of them is a loss to chase; reporting them
 * together is how a kitchen ends up investigating its own meal policy.
 */

import { useMemo } from "react";
import type { Currency, WasteRecord } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { wasteRecords } from "@/lib/console/mock/inventory";
import { formatDateTime, formatMoney, money, type FormatOptions } from "@/lib/console/format";
import { WASTE_CATEGORY } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge } from "@/components/console/ui";

/** Total value plus a ranked-item breakdown — reused for item/category/branch/reason. */
function summarise(records: WasteRecord[], keyOf: (r: WasteRecord) => string, nameOf: (r: WasteRecord) => string) {
  const totals = new Map<string, { name: string; amount: number }>();
  for (const record of records) {
    const key = keyOf(record);
    const entry = totals.get(key) ?? { name: nameOf(record), amount: 0 };
    entry.amount += record.value.amount;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
}

export default function WastePage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();

  const rows = state.waste;
  const currency = rows[0]?.value.currency ?? wasteRecords[0]?.value.currency ?? "EGP";

  // The broader report — every branch, not only the terminal this session is
  // pinned to, which is what makes "waste by branch" mean anything.
  const report = useMemo(() => {
    const totalCost = wasteRecords.reduce((s, r) => s + r.value.amount, 0);
    return {
      totalCost,
      byItem: summarise(wasteRecords, (r) => r.itemId, (r) => tx(r.itemName)).slice(0, 8),
      byCategory: summarise(wasteRecords, (r) => r.category, (r) => tx(WASTE_CATEGORY[r.category].label)),
      byBranch: summarise(wasteRecords, (r) => r.locationId, (r) => tx(r.locationName)),
      byReason: summarise(wasteRecords, (r) => r.reasonCode, (r) => tx(r.reasonName)),
    };
  }, [tx]);

  const totals = useMemo(() => {
    const trueWaste = rows.filter((row) => row.isTrueWaste);
    return {
      trueWaste: trueWaste.reduce((s, row) => s + row.value.amount, 0),
      controlled: rows
        .filter((row) => !row.isTrueWaste)
        .reduce((s, row) => s + row.value.amount, 0),
      count: rows.length,
    };
  }, [rows]);

  const columns: Column<WasteRecord>[] = [
    {
      key: "recordedAt",
      header: t("common.time"),
      render: (row) => formatDateTime(row.recordedAt, fmt),
    },
    {
      key: "item",
      header: t("common.name"),
      render: (row) => (
        <CellStack
          primary={tx(row.itemName)}
          secondary={`${row.quantity.value} ${row.quantity.unit}`}
        />
      ),
    },
    {
      key: "reason",
      header: t("shift.reason"),
      render: (row) => (
        <CellStack primary={tx(row.reasonName)} secondary={row.notes ?? undefined} />
      ),
    },
    {
      key: "category",
      header: t("int.category"),
      render: (row) => (
        <Badge tone={WASTE_CATEGORY[row.category].tone}>
          {tx(WASTE_CATEGORY[row.category].label)}
        </Badge>
      ),
    },
    {
      key: "isTrueWaste",
      header: t("inv.trueWaste"),
      render: (row) =>
        row.isTrueWaste ? (
          <Badge tone="bad">{t("common.yes")}</Badge>
        ) : (
          <Badge tone="muted">{t("inv.controlledConsumption")}</Badge>
        ),
    },
    {
      key: "value",
      header: t("common.value"),
      numeric: true,
      render: (row) => formatMoney(row.value, fmt),
    },
    {
      key: "recordedBy",
      header: t("inv.performedBy"),
      secondary: true,
      render: (row) => tx(row.recordedByName),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("inv.wasteTitle")}
        subtitle={t("inv.wasteSubtitle")}
        spec="§11.7"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid columns={3}>
          <MetricTile
            label={t("inv.trueWaste")}
            value={formatMoney(money(totals.trueWaste, currency), fmt)}
            spec="FR-INV-059"
          />
          <MetricTile
            label={t("inv.controlledConsumption")}
            value={formatMoney(money(totals.controlled, currency), fmt)}
          />
          <MetricTile label={t("common.results")} value={String(totals.count)} />
        </TileGrid>

        {rows.length === 0 ? (
          <LiveEmpty />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            caption={t("inv.wasteTitle")}
          />
        )}

        <Section title={t("inv.wasteReportTitle")} hint={t("inv.wasteReportHint")}>
          <MetricTile
            label={t("inv.totalWasteCost")}
            value={formatMoney(money(report.totalCost, currency), fmt)}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <WasteBreakdown title={t("inv.wasteByItem")} rows={report.byItem} currency={currency} fmt={fmt} />
            <WasteBreakdown
              title={t("inv.wasteByCategory")}
              rows={report.byCategory}
              currency={currency}
              fmt={fmt}
            />
            <WasteBreakdown
              title={t("inv.wasteByBranch")}
              rows={report.byBranch}
              currency={currency}
              fmt={fmt}
            />
            <WasteBreakdown
              title={t("inv.wasteByReason")}
              rows={report.byReason}
              currency={currency}
              fmt={fmt}
            />
          </div>
        </Section>
      </PageBody>
    </>
  );
}

function WasteBreakdown({
  title,
  rows,
  currency,
  fmt,
}: {
  title: string;
  rows: { name: string; amount: number }[];
  currency: Currency;
  fmt: FormatOptions;
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
              <span className="text-fg-subtle shrink-0 text-xs tabular-nums">
                {formatMoney(money(row.amount, currency), fmt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
