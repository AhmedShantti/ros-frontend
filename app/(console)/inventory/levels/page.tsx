"use client";

/**
 * Stock levels — SRS FR-INV-010.
 *
 * On-hand here is the live figure the terminals have been moving, not a
 * nightly snapshot: fire a course on the POS and the ingredient balances on
 * this screen change with it.
 *
 * Negative balances are shown, never clamped. A negative is a signal that a
 * receipt was not entered, and hiding it only delays the investigation.
 */

import { useMemo, useState } from "react";
import type { Localised, StockItem } from "@/lib/console/types";
import { stockItems } from "@/lib/console/mock/stock-items";
import { branchById } from "@/lib/console/mock/org";
import { stockLevels } from "@/lib/console/mock/inventory";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { stockKey } from "@/lib/console/live/state";
import { formatMoney, formatNumber, money, unitLabel } from "@/lib/console/format";
import { STOCK_STATUS } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, SearchInput, Toolbar } from "@/components/console/page";
import { LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { TileGrid } from "@/components/console/page";
import { Badge, cx } from "@/components/console/ui";

interface Row {
  item: StockItem;
  name: Localised;
  onHand: number;
  reorderPoint: number;
  par: number;
  value: number;
  status: keyof typeof STOCK_STATUS;
  delta: number;
}

export default function StockLevelsPage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const [term, setTerm] = useState("");

  const branch = branchById.get(state.branchId);
  const currency = branch?.currency ?? "EGP";

  const rows = useMemo<Row[]>(() => {
    // The seeded rows carry the thresholds; the live store carries the balance.
    const thresholds = new Map(
      stockLevels
        .filter((level) => level.locationId === state.branchId)
        .map((level) => [level.itemId, level]),
    );

    return stockItems
      .map((item) => {
        const onHand = state.stock[stockKey(state.branchId, item.id)] ?? 0;
        const seeded = thresholds.get(item.id);
        const reorderPoint = seeded?.reorderPoint ?? 0;
        const par = seeded?.parLevel ?? 0;
        const moved = state.movements
          .filter((m) => m.itemId === item.id && m.locationId === state.branchId)
          .reduce((s, m) => s + Number(m.quantity.value), 0);

        const status: Row["status"] =
          onHand < 0
            ? "negative"
            : onHand === 0 || onHand < reorderPoint * 0.4
              ? "critical"
              : onHand < reorderPoint
                ? "low"
                : par > 0 && onHand > par
                  ? "overstocked"
                  : "ok";

        return {
          item,
          name: item.name,
          onHand,
          reorderPoint,
          par,
          value: onHand * item.unitCost.amount,
          status,
          delta: moved,
        };
      })
      .filter((row) => {
        if (!term.trim()) return true;
        const needle = term.trim().toLowerCase();
        return (
          row.item.sku.toLowerCase().includes(needle) ||
          row.name.en.toLowerCase().includes(needle) ||
          row.name.ar.includes(term.trim())
        );
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.item.sku.localeCompare(b.item.sku));
  }, [state, term]);

  const totals = useMemo(() => {
    const value = rows.reduce((s, row) => s + row.value, 0);
    return {
      value,
      negative: rows.filter((row) => row.status === "negative").length,
      low: rows.filter((row) => row.status === "low" || row.status === "critical").length,
      moved: rows.filter((row) => row.delta !== 0).length,
    };
  }, [rows]);

  const columns: Column<Row>[] = [
    {
      key: "sku",
      header: t("inv.sku"),
      render: (row) => (
        <CellStack primary={tx(row.name)} secondary={<span className="font-mono">{row.item.sku}</span>} />
      ),
    },
    {
      key: "onHand",
      header: t("inv.onHand"),
      numeric: true,
      render: (row) => (
        <span className={cx(row.onHand < 0 && "text-bad font-semibold")}>
          {formatNumber(row.onHand, fmt, row.item.baseUnit === "pc" ? 0 : 1)}{" "}
          <span className="text-fg-subtle text-xs">{unitLabel(row.item.baseUnit, fmt.locale)}</span>
        </span>
      ),
    },
    {
      key: "delta",
      header: t("live.todayOnDevice"),
      numeric: true,
      hint: t("live.seededNote"),
      render: (row) =>
        row.delta === 0 ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          <span className={row.delta < 0 ? "text-bad" : "text-good"}>
            {row.delta > 0 ? "+" : ""}
            {formatNumber(row.delta, fmt, 1)}
          </span>
        ),
    },
    {
      key: "reorderPoint",
      header: t("inv.reorderPoint"),
      numeric: true,
      secondary: true,
      render: (row) => formatNumber(row.reorderPoint, fmt),
    },
    {
      key: "par",
      header: t("inv.par"),
      numeric: true,
      secondary: true,
      render: (row) => formatNumber(row.par, fmt),
    },
    {
      key: "value",
      header: t("inv.stockValue"),
      numeric: true,
      render: (row) => formatMoney(money(row.value, currency), fmt, true),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={STOCK_STATUS[row.status].tone}>{tx(STOCK_STATUS[row.status].label)}</Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("inv.levelsTitle")}
        subtitle={t("inv.levelsSubtitle")}
        spec="FR-INV-010"
        actions={<TerminalLinks />}
        meta={<span>{tx(branch?.name)}</span>}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid>
          <MetricTile
            label={t("inv.stockValue")}
            value={formatMoney(money(totals.value, currency), fmt, true)}
          />
          <MetricTile label={t("live.todayOnDevice")} value={String(totals.moved)} />
          <MetricTile
            label={tx(STOCK_STATUS.low.label)}
            value={String(totals.low)}
            spec="FR-INV-012"
          />
          <MetricTile
            label={tx(STOCK_STATUS.negative.label)}
            value={String(totals.negative)}
            spec="FR-INV-013"
            footer={<span className="text-fg-subtle text-xs">{t("inv.negativeNote")}</span>}
          />
        </TileGrid>

        <Toolbar>
          <SearchInput value={term} onChange={setTerm} placeholder={t("common.searchPlaceholder")} />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.item.id}
          filtered={term.trim().length > 0}
          onClearFilters={() => setTerm("")}
          caption={t("inv.levelsTitle")}
          dense
        />
      </PageBody>
    </>
  );
}
