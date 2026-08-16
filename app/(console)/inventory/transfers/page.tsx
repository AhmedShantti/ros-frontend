"use client";

/**
 * Inter-branch transfers — SRS §11.5, §17.4.
 *
 * Dispatch and receipt are two events, not one. Between them the stock belongs
 * to neither location — it is in transit, and it is visible as such. A system
 * that moves the balance instantly hides exactly the window in which stock
 * goes missing.
 *
 * The discrepancy column is the reconciliation: dispatched minus received. A
 * non-zero value puts the transfer into `discrepancy` rather than `received`,
 * because closing it silently would make the loss disappear into two branches'
 * variance reports where nobody owns it.
 */

import { useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { Transfer, TransferLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDateTime, formatMoney, formatNumber, formatQuantity } from "@/lib/console/format";
import { TRANSFER_STATUS, labelOf } from "@/lib/console/labels";
import { stockLocations } from "@/lib/console/mock/org";
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

export default function TransfersPage() {
  return (
    <Gate permissions={["inventory.view"]}>
      <TransfersScreen />
    </Gate>
  );
}

function TransfersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Transfer>(
    (query) => services.inventory.transfers.list(query),
    { scope, initialSort: "-dispatchedAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const inTransit = rows.filter(
      (row) => row.status === "dispatched" || row.status === "in_transit",
    );
    return {
      inTransit: inTransit.length,
      inTransitValue: inTransit.reduce((sum, row) => sum + row.totalValue.amount, 0),
      discrepancies: rows.filter((row) => row.status === "discrepancy").length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.totalValue.currency ?? "EGP";

  const columns = useMemo<Column<Transfer>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={tx(row.requestedBy)}
          />
        ),
      },
      {
        key: "route",
        header: t("inv.from"),
        render: (row) => (
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-fg">{tx(row.fromLocationName)}</span>
            <ArrowRight size={12} className="text-fg-subtle shrink-0 rtl:rotate-180" aria-hidden />
            <span className="text-fg">{tx(row.toLocationName)}</span>
          </span>
        ),
      },
      {
        key: "dispatchedAt",
        header: t("inv.dispatched"),
        sortable: true,
        secondary: true,
        render: (row) =>
          row.dispatchedAt ? (
            formatDateTime(row.dispatchedAt, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "receivedAt",
        header: t("inv.received"),
        secondary: true,
        render: (row) =>
          row.receivedAt ? (
            formatDateTime(row.receivedAt, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "lines",
        header: t("common.quantity"),
        numeric: true,
        secondary: true,
        render: (row) => formatNumber(row.lines.length, fmt),
      },
      {
        key: "totalValue",
        header: t("common.value"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.totalValue, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(TRANSFER_STATUS, row.status);
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
        title={t("inv.transfersTitle")}
        subtitle={t("inv.transfersSubtitle")}
        spec="FR-INV-030"
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
          <MetricTile label={t("inv.inTransit")} value={formatNumber(totals.inTransit, fmt)} />
          <MetricTile
            label={t("inv.inTransitValue")}
            value={formatMoney({ amount: totals.inTransitValue, currency }, fmt, true)}
            hint={t("inv.inTransitHint")}
          />
          <MetricTile
            label={t("inv.discrepancy")}
            value={formatNumber(totals.discrepancies, fmt)}
            spec="FR-INV-034"
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(TRANSFER_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "fromLocationId",
              label: t("inv.from"),
              options: stockLocations.map((location) => ({
                value: location.id,
                label: tx(location.name),
              })),
            },
            {
              key: "toLocationId",
              label: t("inv.to"),
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
          caption={t("inv.transfersTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <TransferDrawer
        transfer={selected}
        onClose={() => setSelected(null)}
        onReceive={() => setMessage(t("common.notInBuild"))}
      />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function TransferDrawer({
  transfer,
  onClose,
  onReceive,
}: {
  transfer: Transfer | null;
  onClose: () => void;
  onReceive: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canReceive = usePermission("inventory.transfer.receive");

  const columns = useMemo<Column<TransferLine>[]>(
    () => [
      {
        key: "item",
        header: t("common.name"),
        render: (row) => <CellStack primary={tx(row.itemName)} />,
      },
      {
        key: "dispatched",
        header: t("inv.dispatched"),
        numeric: true,
        render: (row) => formatQuantity(row.dispatched, fmt),
      },
      {
        key: "received",
        header: t("inv.received"),
        numeric: true,
        render: (row) =>
          row.received ? (
            formatQuantity(row.received, fmt)
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "discrepancy",
        header: t("inv.discrepancy"),
        numeric: true,
        render: (row) =>
          row.discrepancy === 0 ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <DeltaCell value={row.discrepancy}>
              {row.discrepancy > 0 ? "+" : ""}
              {formatNumber(row.discrepancy, fmt, 2)}
            </DeltaCell>
          ),
      },
      {
        key: "unitCost",
        header: t("inv.unitCost"),
        numeric: true,
        secondary: true,
        render: (row) => formatMoney(row.unitCost, fmt),
      },
    ],
    [t, tx, fmt],
  );

  if (!transfer) return null;

  const status = labelOf(TRANSFER_STATUS, transfer.status);
  const hasDiscrepancy = transfer.lines.some((line) => line.discrepancy !== 0);

  return (
    <Drawer
      open
      onClose={onClose}
      title={transfer.reference}
      subtitle={
        <span className="flex items-center gap-1.5">
          {tx(transfer.fromLocationName)}
          <ArrowRight size={11} className="rtl:rotate-180" aria-hidden />
          {tx(transfer.toLocationName)}
        </span>
      }
      footer={
        canReceive && (transfer.status === "dispatched" || transfer.status === "in_transit") ? (
          <Button variant="primary" onClick={onReceive}>
            {t("inv.receiveTransfer")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {hasDiscrepancy ? (
          <Callout tone="bad" title={t("inv.discrepancy")}>
            {t("inv.discrepancyNote")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("common.by")}>{tx(transfer.requestedBy)}</DescRow>
          <DescRow label={t("inv.dispatched")}>
            {transfer.dispatchedAt ? formatDateTime(transfer.dispatchedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("inv.received")}>
            {transfer.receivedAt ? formatDateTime(transfer.receivedAt, fmt) : "—"}
          </DescRow>
          <DescRow label={t("common.value")} mono>
            {formatMoney(transfer.totalValue, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.components")}</h3>
          <DataTable
            columns={columns}
            rows={transfer.lines}
            rowKey={(row) => row.id}
            caption={transfer.reference}
            dense
          />
        </section>
      </div>
    </Drawer>
  );
}
