"use client";

/**
 * Goods receipts — SRS §12.5.
 *
 * Receipt is the moment purchasing becomes inventory. One posting creates the
 * stock movement, opens the batch, and runs the price-variance check against
 * the order — which is why a receipt cannot be edited after posting, only
 * disputed.
 *
 * Two fields carry more weight than their size suggests:
 *
 *   - Price variance (FR-PRC-008). The delivered unit price against the agreed
 *     one. Small drifts pass unnoticed per delivery and are the single largest
 *     source of unexplained food-cost creep over a quarter.
 *   - Temperature (FR-PRC-035). Chilled and frozen goods carry a reading at
 *     the door. Accepting them without one means a later spoilage claim has no
 *     evidence behind it.
 */

import { useMemo, useState } from "react";
import { Plus, Thermometer } from "lucide-react";
import type { GoodsReceipt, GoodsReceiptLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
} from "@/lib/console/format";
import { RECEIPT_STATUS, labelOf } from "@/lib/console/labels";
import { suppliers } from "@/lib/console/mock/purchasing";
import {
  CellStack,
  CollectionTable,
  DataTable,
  DeltaCell,
  type Column,
} from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
} from "@/components/console/ui";

export default function ReceivingPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <ReceivingScreen />
    </Gate>
  );
}

function ReceivingScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<GoodsReceipt | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<GoodsReceipt>(
    (query) => services.purchasing.receipts.list(query),
    { scope, initialSort: "-receivedAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      value: rows.reduce((sum, row) => sum + row.total.amount, 0),
      temperatureFails: rows.filter((row) => !row.temperatureOk).length,
      // A receipt where any line drifted more than 2% from the agreed price.
      priceDrift: rows.filter((row) =>
        row.lines.some((line) => Math.abs(line.priceVariancePercent) > 2),
      ).length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.total.currency ?? "EGP";

  const columns = useMemo<Column<GoodsReceipt>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={
              row.purchaseOrderRef ? (
                <span className="font-mono">{row.purchaseOrderRef}</span>
              ) : (
                <span className="text-warn">{t("pur.noPo")}</span>
              )
            }
          />
        ),
      },
      {
        key: "supplier",
        header: t("pur.supplier"),
        render: (row) => tx(row.supplierName),
      },
      {
        key: "location",
        header: t("common.location"),
        secondary: true,
        render: (row) => tx(row.locationName),
      },
      {
        key: "receivedAt",
        header: t("inv.received"),
        sortable: true,
        render: (row) => formatDateTime(row.receivedAt, fmt),
      },
      {
        key: "temperature",
        header: t("pur.temperature"),
        render: (row) =>
          row.temperatureC === null ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <Badge tone={row.temperatureOk ? "good" : "bad"}>
              <Thermometer size={11} aria-hidden />
              {formatNumber(row.temperatureC, fmt, 1)}°C
            </Badge>
          ),
      },
      {
        key: "total",
        header: t("common.total"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.total, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(RECEIPT_STATUS, row.status);
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
        title={t("pur.receivingTitle")}
        subtitle={t("pur.receivingSubtitle")}
        spec="FR-PRC-035"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("pur.receivedValue")}
            value={formatMoney({ amount: totals.value, currency }, fmt, true)}
          />
          <MetricTile
            label={t("pur.priceDrift")}
            value={formatNumber(totals.priceDrift, fmt)}
            spec="FR-PRC-008"
            hint={t("pur.priceDriftHint")}
          />
          <MetricTile
            label={t("pur.temperatureBad")}
            value={formatNumber(totals.temperatureFails, fmt)}
            spec="FR-PRC-035"
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(RECEIPT_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "supplierId",
              label: t("pur.supplier"),
              options: suppliers.map((supplier) => ({
                value: supplier.id,
                label: tx(supplier.tradingName),
              })),
            },
            {
              key: "temperatureOk",
              label: t("pur.temperature"),
              options: [
                { value: "true", label: t("pur.temperatureOk") },
                { value: "false", label: t("pur.temperatureBad") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("pur.receivingTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <ReceiptDrawer receipt={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ReceiptDrawer({
  receipt,
  onClose,
}: {
  receipt: GoodsReceipt | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();

  const columns = useMemo<Column<GoodsReceiptLine>[]>(
    () => [
      {
        key: "item",
        header: t("common.name"),
        render: (row) => (
          <CellStack
            primary={tx(row.itemName)}
            secondary={
              row.batchNumber ? (
                <span className="font-mono">{row.batchNumber}</span>
              ) : undefined
            }
          />
        ),
      },
      {
        key: "ordered",
        header: t("pur.ordered"),
        numeric: true,
        secondary: true,
        render: (row) => formatQuantity(row.ordered, fmt),
      },
      {
        key: "received",
        header: t("inv.received"),
        numeric: true,
        render: (row) => formatQuantity(row.received, fmt),
      },
      {
        key: "rejected",
        header: t("pur.rejectedQty"),
        numeric: true,
        render: (row) => {
          const rejected = Number(row.rejected.value);
          return rejected === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <span className="text-bad">{formatQuantity(row.rejected, fmt)}</span>
          );
        },
      },
      {
        key: "unitPrice",
        header: t("common.perUnit"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.unitPrice, fmt),
      },
      {
        key: "priceVariancePercent",
        header: t("pur.priceVariance"),
        numeric: true,
        render: (row) =>
          row.priceVariancePercent === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <DeltaCell value={row.priceVariancePercent}>
              {row.priceVariancePercent > 0 ? "+" : ""}
              {formatPercent(row.priceVariancePercent, fmt, 1)}
            </DeltaCell>
          ),
      },
      {
        key: "expiryDate",
        header: t("inv.expiryDate"),
        secondary: true,
        render: (row) =>
          row.expiryDate ? (
            formatDate(row.expiryDate, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
    ],
    [t, tx, fmt],
  );

  if (!receipt) return null;

  const status = labelOf(RECEIPT_STATUS, receipt.status);
  const rejections = receipt.lines.filter((line) => line.rejectionReason);

  return (
    <Drawer
      open
      onClose={onClose}
      title={receipt.reference}
      subtitle={tx(receipt.supplierName)}
    >
      <div className="space-y-5">
        {!receipt.temperatureOk ? (
          <Callout
            tone="bad"
            icon={<Thermometer size={14} />}
            title={t("pur.temperatureBad")}
          >
            {t("pur.temperatureNote")}
          </Callout>
        ) : null}

        {!receipt.purchaseOrderRef ? (
          <Callout tone="warn">{t("pur.directReceipt")}</Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("nav.purchaseOrders")} mono>
            {receipt.purchaseOrderRef ?? t("pur.noPo")}
          </DescRow>
          <DescRow label={t("common.location")}>{tx(receipt.locationName)}</DescRow>
          <DescRow label={t("inv.received")}>
            {formatDateTime(receipt.receivedAt, fmt)}
          </DescRow>
          <DescRow label={t("common.by")}>{tx(receipt.receivedBy)}</DescRow>
          <DescRow label={t("pur.temperature")} mono>
            {receipt.temperatureC === null
              ? "—"
              : `${formatNumber(receipt.temperatureC, fmt, 1)}°C`}
          </DescRow>
          <DescRow label={t("common.total")} mono>
            {formatMoney(receipt.total, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.components")}</h3>
          <DataTable
            columns={columns}
            rows={receipt.lines}
            rowKey={(row) => row.id}
            caption={receipt.reference}
            dense
          />
        </section>

        {rejections.length > 0 ? (
          <section>
            <h3 className="text-fg mb-2 text-sm font-semibold">{t("pur.rejectionReason")}</h3>
            <ul className="space-y-1.5">
              {rejections.map((line) => (
                <li key={line.id} className="text-fg-muted text-xs">
                  <span className="text-fg">{tx(line.itemName)}</span> — {line.rejectionReason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
