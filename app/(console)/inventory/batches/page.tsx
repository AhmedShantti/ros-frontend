"use client";

/**
 * Batches — SRS §11.4.
 *
 * A batch is the unit that FEFO consumes: first expired, first out. Tracking
 * stock only at item level makes that impossible, because "800 g of chicken"
 * does not say whether it is the delivery from Tuesday or the one from
 * Saturday.
 *
 * This is the register — every batch on hand, with its value. The narrower
 * question of what is about to expire has its own screen at /inventory/expiry,
 * because a list sorted by risk answers a different question from a list
 * sorted by item.
 */

import { useMemo, useState } from "react";
import type { Batch } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useCollection } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { BATCH_STATUS, labelOf } from "@/lib/console/labels";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { Badge, Callout, DescList, DescRow, Drawer, cx } from "@/components/console/ui";

export default function BatchesPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <BatchesScreen />
    </Gate>
  );
}

function BatchesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Batch | null>(null);

  // Locations from the service, so the filter offers ids that exist.
  const locationList = useAsync(() => services.organisation.locations(), []);
  const locations = locationList.data ?? [];

  const collection = useCollection<Batch>(
    (query) => services.inventory.batches.list(query),
    { scope, initialSort: "expiryDate", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      value: rows.reduce((sum, row) => sum + row.value.amount, 0),
      atRisk: rows
        .filter((row) => row.status === "expiring" || row.status === "critical")
        .reduce((sum, row) => sum + row.value.amount, 0),
      expired: rows.filter((row) => row.status === "expired").length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.value.currency ?? "EGP";

  const columns = useMemo<Column<Batch>[]>(
    () => [
      {
        key: "itemName",
        header: t("inv.sku"),
        sortable: true,
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={<span className="font-mono">{row.batchNumber}</span>}
          />
        ),
      },
      {
        key: "location",
        header: t("common.location"),
        secondary: true,
        render: (row) => tx(row.locationName),
      },
      {
        key: "quantity",
        header: t("inv.onHand"),
        numeric: true,
        render: (row) => formatQuantity(row.quantity, fmt),
      },
      {
        key: "productionDate",
        header: t("inv.productionDate"),
        secondary: true,
        render: (row) =>
          row.productionDate ? (
            formatDate(row.productionDate, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "expiryDate",
        header: t("inv.expiryDate"),
        sortable: true,
        render: (row) => formatDate(row.expiryDate, fmt),
      },
      {
        key: "daysToExpiry",
        header: t("inv.daysToExpiry"),
        sortable: true,
        numeric: true,
        render: (row) => (
          <span
            className={cx(
              row.daysToExpiry < 0 && "text-bad font-semibold",
              row.daysToExpiry >= 0 && row.daysToExpiry <= 3 && "text-warn",
            )}
          >
            {formatNumber(row.daysToExpiry, fmt)}
          </span>
        ),
      },
      {
        key: "value",
        header: t("common.value"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.value, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(BATCH_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
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
        title={t("inv.batchesTitle")}
        subtitle={t("inv.batchesSubtitle")}
        spec="FR-INV-020"
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("inv.stockValue")}
            value={formatMoney({ amount: totals.value, currency }, fmt, true)}
          />
          <MetricTile
            label={t("inv.valueAtRisk")}
            value={formatMoney({ amount: totals.atRisk, currency }, fmt, true)}
            spec="FR-INV-024"
            hint={t("inv.atRiskHint")}
          />
          <MetricTile
            label={tx(BATCH_STATUS.expired.label)}
            value={formatNumber(totals.expired, fmt)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          searchPlaceholder={t("inv.batchSearchPlaceholder")}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(BATCH_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "locationId",
              label: t("common.location"),
              options: locations.map((location) => ({
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
          caption={t("inv.batchesTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <BatchDrawer batch={selected} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function BatchDrawer({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();
  if (!batch) return null;

  const status = labelOf(BATCH_STATUS, batch.status);

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(batch.itemName)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {batch.batchNumber}
        </span>
      }
    >
      <div className="space-y-5">
        {batch.status === "expired" ? (
          <Callout tone="bad" title={tx(BATCH_STATUS.expired.label)}>
            {t("inv.expiredNote")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("common.location")}>{tx(batch.locationName)}</DescRow>
          <DescRow label={t("inv.onHand")} mono>
            {formatQuantity(batch.quantity, fmt)}
          </DescRow>
          <DescRow label={t("inv.productionDate")}>
            {batch.productionDate ? formatDate(batch.productionDate, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.expiryDate")}>{formatDate(batch.expiryDate, fmt)}</DescRow>
          <DescRow label={t("inv.daysToExpiry")} mono>
            {formatNumber(batch.daysToExpiry, fmt)}
          </DescRow>
          <DescRow label={t("inv.unitCost")} mono>
            {formatMoney(batch.unitCost, fmt)}
          </DescRow>
          <DescRow label={t("common.value")} mono>
            {formatMoney(batch.value, fmt)}
          </DescRow>
          <DescRow label={t("pur.supplier")}>
            {batch.supplierName ? tx(batch.supplierName) : t("common.none")}
          </DescRow>
        </DescList>

        <Callout tone="muted">{t("inv.fefoNote")}</Callout>
      </div>
    </Drawer>
  );
}
