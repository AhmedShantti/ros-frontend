"use client";

/**
 * Stock movements — SRS §7.4.3.
 *
 * The append-only ledger every balance is derived from. Each row here was
 * written by something that actually happened: a course fired, a void
 * returned to stock, a refund reversed. Nothing edits a movement; a
 * correction is another movement.
 */

import { useMemo, useState } from "react";
import type { StockMovement } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { formatDateTime, formatMoney, formatNumber, money, unitLabel } from "@/lib/console/format";
import { MOVEMENT_TYPE, labelOf } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, SearchInput, TileGrid, Toolbar } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge, cx } from "@/components/console/ui";

export default function MovementsPage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const [term, setTerm] = useState("");

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return state.movements.filter((movement) => {
      if (!needle) return true;
      return (
        movement.itemName.en.toLowerCase().includes(needle) ||
        movement.itemName.ar.includes(term.trim()) ||
        movement.movementType.includes(needle)
      );
    });
  }, [state.movements, term]);

  const currency = state.movements[0]?.totalCost.currency ?? "EGP";
  const depleted = state.movements.filter((m) => m.movementType === "sale_depletion");
  const reversed = state.movements.filter((m) => m.movementType === "sale_reversal");
  const cost = depleted.reduce((s, m) => s + m.totalCost.amount, 0);

  const columns: Column<StockMovement>[] = [
    {
      key: "occurredAt",
      header: t("common.time"),
      render: (movement) => (
        <CellStack
          primary={formatDateTime(movement.occurredAt, fmt)}
          secondary={<span className="font-mono text-[0.68rem]">{movement.referenceId}</span>}
        />
      ),
    },
    {
      key: "item",
      header: t("common.name"),
      render: (movement) => tx(movement.itemName),
    },
    {
      key: "movementType",
      header: t("inv.movementType"),
      render: (movement) => {
        const entry = labelOf(MOVEMENT_TYPE, movement.movementType);
        return <Badge tone={entry.tone}>{tx(entry.label)}</Badge>;
      },
    },
    {
      key: "quantity",
      header: t("common.quantity"),
      numeric: true,
      render: (movement) => {
        const value = Number(movement.quantity.value);
        return (
          <span className={cx(value < 0 ? "text-bad" : "text-good")}>
            {value > 0 ? "+" : ""}
            {formatNumber(value, fmt, 1)}{" "}
            <span className="text-fg-subtle text-xs">
              {unitLabel(movement.quantity.unit, fmt.locale)}
            </span>
          </span>
        );
      },
    },
    {
      key: "balanceAfter",
      header: t("inv.balanceAfter"),
      numeric: true,
      render: (movement) => formatNumber(Number(movement.balanceAfter.value), fmt, 1),
    },
    {
      key: "totalCost",
      header: t("inv.unitCost"),
      numeric: true,
      secondary: true,
      render: (movement) => formatMoney(movement.totalCost, fmt, true),
    },
    {
      key: "performedBy",
      header: t("inv.performedBy"),
      secondary: true,
      render: (movement) => tx(movement.performedByName),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("inv.movementsTitle")}
        subtitle={t("inv.movementsSubtitle")}
        spec="§7.4.3"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid columns={3}>
          <MetricTile label={t("inv.movementsTitle")} value={String(state.movements.length)} />
          <MetricTile
            label={tx(MOVEMENT_TYPE.sale_depletion.label)}
            value={String(depleted.length)}
            footer={
              <span className="text-fg-subtle text-xs">
                {formatMoney(money(cost, currency), fmt, true)}
              </span>
            }
          />
          <MetricTile
            label={tx(MOVEMENT_TYPE.sale_reversal.label)}
            value={String(reversed.length)}
            spec="FR-POS-071"
          />
        </TileGrid>

        {state.movements.length === 0 ? (
          <LiveEmpty />
        ) : (
          <>
            <Toolbar>
              <SearchInput
                value={term}
                onChange={setTerm}
                placeholder={t("common.searchPlaceholder")}
              />
            </Toolbar>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(movement) => movement.id}
              filtered={term.trim().length > 0}
              onClearFilters={() => setTerm("")}
              caption={t("inv.movementsTitle")}
              dense
            />
          </>
        )}
      </PageBody>
    </>
  );
}
