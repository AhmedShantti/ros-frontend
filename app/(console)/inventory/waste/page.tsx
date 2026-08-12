"use client";

/**
 * Waste — SRS §11.7.
 *
 * Split by whether it is true waste. A staff meal and a burnt steak both
 * leave stock, but only one of them is a loss to chase; reporting them
 * together is how a kitchen ends up investigating its own meal policy.
 */

import { useMemo } from "react";
import type { WasteRecord } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { formatDateTime, formatMoney, money } from "@/lib/console/format";
import { WASTE_CATEGORY } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge } from "@/components/console/ui";

export default function WastePage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();

  const rows = state.waste;
  const currency = rows[0]?.value.currency ?? "EGP";

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
      </PageBody>
    </>
  );
}
