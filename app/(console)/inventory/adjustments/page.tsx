"use client";

/**
 * Stock adjustments — SRS §11.5, FR-INV-036.
 *
 * An adjustment is a write to the ledger that no business event produced. That
 * makes it the most sensitive record in inventory: it is the one way a balance
 * can be made to agree with a count without anything physical happening.
 *
 * So every adjustment carries a reason code, and adjustments above the value
 * threshold carry an approval. The reason is not commentary — it is the
 * difference between "we found the missing receipt" and "we made the number
 * fit", and the costing module reads it when it decides whether a variance is
 * explained.
 */

import { useMemo, useState } from "react";
import type { StockAdjustment } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { APPROVAL_STATE, labelOf } from "@/lib/console/labels";
import { adjustmentReasons } from "@/lib/console/mock/inventory";
import { stockLocations } from "@/lib/console/mock/org";
import {
  CellStack,
  CollectionTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Callout, DescList, DescRow, Drawer } from "@/components/console/ui";

export default function AdjustmentsPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <AdjustmentsScreen />
    </Gate>
  );
}

function AdjustmentsScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<StockAdjustment | null>(null);

  const collection = useCollection<StockAdjustment>(
    (query) => services.inventory.adjustments.list(query),
    { scope, initialSort: "-createdAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      pending: rows.filter((row) => row.approval === "pending").length,
      // Write-downs and write-ups are separate figures: they do not cancel out
      // as a control concern, only as an accounting one.
      writeDown: rows
        .filter((row) => row.value.amount < 0)
        .reduce((sum, row) => sum + row.value.amount, 0),
      writeUp: rows
        .filter((row) => row.value.amount > 0)
        .reduce((sum, row) => sum + row.value.amount, 0),
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.value.currency ?? "EGP";

  const columns = useMemo<Column<StockAdjustment>[]>(
    () => [
      {
        key: "item",
        header: t("inv.sku"),
        render: (row) => (
          <CellStack primary={tx(row.itemName)} secondary={tx(row.locationName)} />
        ),
      },
      {
        key: "quantity",
        header: t("common.quantity"),
        numeric: true,
        render: (row) => {
          const value = Number(row.quantity.value);
          return (
            <DeltaCell value={value} invert>
              {value > 0 ? "+" : ""}
              {formatQuantity(row.quantity, fmt)}
            </DeltaCell>
          );
        },
      },
      {
        key: "reason",
        header: t("common.reason"),
        render: (row) => <span className="text-fg-muted text-xs">{tx(row.reasonName)}</span>,
      },
      {
        key: "value",
        header: t("common.value"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <DeltaCell value={row.value.amount} invert>
            {formatMoney(row.value, fmt)}
          </DeltaCell>
        ),
      },
      {
        key: "createdAt",
        header: t("common.date"),
        sortable: true,
        secondary: true,
        render: (row) => formatDateTime(row.createdAt, fmt),
      },
      {
        key: "createdBy",
        header: t("common.by"),
        secondary: true,
        render: (row) => tx(row.createdBy),
      },
      {
        key: "approval",
        header: t("apr.title"),
        render: (row) => {
          const approval = labelOf(APPROVAL_STATE, row.approval);
          return (
            <Badge tone={approval.tone} dot={row.approval !== "not_required"}>
              {tx(approval.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("inv.adjustmentsTitle")}
        subtitle={t("inv.adjustmentsSubtitle")}
        spec="FR-INV-036"
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("inv.writeUp")}
            value={formatMoney({ amount: totals.writeUp, currency }, fmt, true)}
            hint={t("inv.writeUpHint")}
          />
          <MetricTile
            label={t("inv.writeDown")}
            value={formatMoney({ amount: Math.abs(totals.writeDown), currency }, fmt, true)}
          />
          <MetricTile
            label={t("common.pending")}
            value={formatNumber(totals.pending, fmt)}
            spec="FR-INV-038"
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "reasonCode",
              label: t("common.reason"),
              options: adjustmentReasons.map((reason) => ({
                value: reason.code,
                label: tx(reason.name),
              })),
            },
            {
              key: "approval",
              label: t("apr.title"),
              options: Object.entries(APPROVAL_STATE).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "locationId",
              label: t("common.location"),
              options: stockLocations.map((location) => ({
                value: location.id,
                label: tx(location.name),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("inv.adjustmentsTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <AdjustmentDrawer adjustment={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function AdjustmentDrawer({
  adjustment,
  onClose,
}: {
  adjustment: StockAdjustment | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!adjustment) return null;

  const approval = labelOf(APPROVAL_STATE, adjustment.approval);
  const quantity = Number(adjustment.quantity.value);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(adjustment.itemName)}
      subtitle={tx(adjustment.locationName)}
    >
      <div className="space-y-5">
        <DescList>
          <DescRow label={t("common.quantity")} mono>
            <DeltaCell value={quantity} invert>
              {quantity > 0 ? "+" : ""}
              {formatQuantity(adjustment.quantity, fmt)}
            </DeltaCell>
          </DescRow>
          <DescRow label={t("common.value")} mono>
            <DeltaCell value={adjustment.value.amount} invert>
              {formatMoney(adjustment.value, fmt)}
            </DeltaCell>
          </DescRow>
          <DescRow label={t("common.reason")}>{tx(adjustment.reasonName)}</DescRow>
          <DescRow label={t("common.date")}>
            {formatDateTime(adjustment.createdAt, fmt)}
          </DescRow>
          <DescRow label={t("common.by")}>{tx(adjustment.createdBy)}</DescRow>
          <DescRow label={t("apr.title")}>
            <Badge tone={approval.tone} dot={adjustment.approval !== "not_required"}>
              {tx(approval.label)}
            </Badge>
          </DescRow>
        </DescList>

        {adjustment.notes ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("common.notes")}</h3>
            <p className="text-fg-muted text-sm leading-relaxed">{adjustment.notes}</p>
          </section>
        ) : null}

        <Callout tone="muted">{t("inv.adjustmentNote")}</Callout>
      </div>
    </Drawer>
  );
}
