"use client";

/**
 * Purchase orders — SRS §12.4, FR-PRC-018.
 *
 * The approval tier is derived from the order value, not chosen by the person
 * raising it. That is the whole control: a requester cannot route their own
 * order to a friendlier approver by ticking a box, and splitting one large
 * order into two small ones is visible because both still carry the supplier
 * and the date.
 *
 * Tier 0 is auto-approved. That is a deliberate threshold rather than an
 * absence of control — putting a manager in the loop for a crate of lemons
 * trains everyone to approve without reading, which is worse than not asking.
 *
 * The drawer carries the rest of the order's life (`purchasing-orders.tsx`):
 * approve or reject with segregation of duties (FR-PRC-019), an approval link
 * for an approver away from the console (FR-PRC-020), send to the supplier
 * (FR-PRC-021), amend before receipt (FR-PRC-023) and, for consolidated
 * orders, branch attribution (FR-PRC-016). Suggested orders (FR-PRC-022) are
 * one click from the header.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Link2, Pencil, Plus, Send, Sparkles } from "lucide-react";
import type { PurchaseOrder, PurchaseOrderLine } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useAsync, useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
} from "@/lib/console/format";
import { PO_STATUS, labelOf } from "@/lib/console/labels";
import { PO_APPROVAL_BANDS, suppliers } from "@/lib/console/mock/purchasing";
import { CellStack, CollectionTable, DataTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import { PurchaseOrderDrawer as PurchaseOrderFormDrawer } from "@/components/console/purchasing-forms";
import {
  AmendOrderDrawer,
  ApprovalLinkDrawer,
  OrderDecision,
  OrderHistory,
  TransmitOrderDrawer,
  canAmend,
  useOrderWorkflow,
} from "@/components/console/purchasing-orders";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Meter,
  Toast,
} from "@/components/console/ui";

function bandFor(tier: 0 | 1 | 2 | 3) {
  return PO_APPROVAL_BANDS.find((band) => band.tier === tier) ?? PO_APPROVAL_BANDS[0]!;
}

export default function PurchaseOrdersPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <PurchaseOrdersScreen />
    </Gate>
  );
}

function PurchaseOrdersScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [message, setMessage] = useTransientMessage();
  const [creating, setCreating] = useState(false);


  const collection = useCollection<PurchaseOrder>(
    (query) => services.purchasing.orders.list(query),
    { scope, initialSort: "-createdAt", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const pending = rows.filter((row) => row.status === "pending_approval");
    return {
      pending: pending.length,
      pendingValue: pending.reduce((sum, row) => sum + row.total.amount, 0),
      open: rows.filter(
        (row) =>
          row.status === "sent" ||
          row.status === "approved" ||
          row.status === "partially_received",
      ).length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.total.currency ?? "EGP";

  const columns = useMemo<Column<PurchaseOrder>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.reference}</span>}
            secondary={tx(row.supplierName)}
          />
        ),
      },
      {
        key: "deliveryLocation",
        header: t("common.location"),
        secondary: true,
        render: (row) => tx(row.deliveryLocationName),
      },
      {
        key: "createdAt",
        header: t("common.created"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.createdAt, fmt),
      },
      {
        key: "expectedDelivery",
        header: t("pur.expectedDelivery"),
        sortable: true,
        render: (row) => formatDate(row.expectedDelivery, fmt),
      },
      {
        key: "approvalTier",
        header: t("pur.approvalTier"),
        render: (row) => {
          const band = bandFor(row.approvalTier);
          return (
            <Badge tone={row.approvalTier === 0 ? "muted" : "accent"}>
              {row.approvalTier === 0 ? t("pur.autoApproved") : tx(band.approver)}
            </Badge>
          );
        },
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
          const status = labelOf(PO_STATUS, row.status);
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
        title={t("pur.ordersTitle")}
        subtitle={t("pur.ordersSubtitle")}
        spec="FR-PRC-018"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/purchasing/suggestions">
              <Button icon={<Sparkles size={14} />}>{t("prc.suggest.open")}</Button>
            </Link>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setCreating(true)}
            >
              {t("common.new")}
            </Button>
          </div>
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("pur.awaitingApproval")}
            value={formatNumber(totals.pending, fmt)}
            spec="FR-PRC-018"
          />
          <MetricTile
            label={t("pur.pendingValue")}
            value={formatMoney({ amount: totals.pendingValue, currency }, fmt, true)}
          />
          <MetricTile label={t("pur.openOrders")} value={formatNumber(totals.open, fmt)} />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(PO_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "supplierId",
              label: t("pur.supplier"),
              options: (DATA_MODE === "http" ? [] : suppliers).map((supplier) => ({
                value: supplier.id,
                label: tx(supplier.tradingName),
              })),
            },
            {
              key: "approvalTier",
              label: t("pur.approvalTier"),
              options: PO_APPROVAL_BANDS.map((band) => ({
                value: String(band.tier),
                label: tx(band.approver),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("pur.ordersTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <OrderDrawer
        key={selected ? `${selected.id}:${selected.status}:${selected.total.amount}` : "none"}
        order={selected}
        onClose={() => setSelected(null)}
        onChanged={(updated, note) => {
          setSelected(updated);
          setMessage(note);
          collection.reload();
        }}
      />
      <PurchaseOrderFormDrawer
        order={null}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(note) => {
          setCreating(false);
          setMessage(note);
          collection.reload();
        }}
      />

      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function OrderDrawer({
  order,
  onClose,
  onChanged,
}: {
  order: PurchaseOrder | null;
  onClose: () => void;
  onChanged: (order: PurchaseOrder, message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const canRaise = usePermission("purchase.order.create");
  const workflow = useOrderWorkflow(order?.id ?? null);
  const [panel, setPanel] = useState<"amend" | "send" | "link" | null>(null);
  const supplierRecord = useMemo(
    () => (DATA_MODE === "http" ? null : suppliers.find((row) => row.id === order?.supplierId) ?? null),
    [order?.supplierId],
  );
  const liveSupplier = useAsyncSupplier(order?.supplierId ?? null);

  const columns = useMemo<Column<PurchaseOrderLine>[]>(
    () => [
      {
        key: "item",
        header: t("common.name"),
        render: (row) => <CellStack primary={tx(row.itemName)} />,
      },
      {
        key: "quantity",
        header: t("pur.ordered"),
        numeric: true,
        render: (row) => formatQuantity(row.quantity, fmt),
      },
      {
        key: "receivedQuantity",
        header: t("inv.received"),
        numeric: true,
        render: (row) => {
          const ordered = Number(row.quantity.value);
          const received = Number(row.receivedQuantity.value);
          return (
            <span className="min-w-24 inline-block">
              <span className="block">{formatQuantity(row.receivedQuantity, fmt)}</span>
              {ordered > 0 ? (
                <Meter
                  className="mt-1"
                  value={(received / ordered) * 100}
                  tone={received >= ordered ? "good" : received > 0 ? "warn" : "muted"}
                />
              ) : null}
            </span>
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
        key: "taxRate",
        header: t("fin.taxAmount"),
        numeric: true,
        secondary: true,
        render: (row) => formatPercent(row.taxRate, fmt, 0),
      },
      {
        key: "lineTotal",
        header: t("common.total"),
        numeric: true,
        render: (row) => formatMoney(row.lineTotal, fmt),
      },
    ],
    [t, tx, fmt],
  );

  if (!order) return null;

  const status = labelOf(PO_STATUS, order.status);
  const band = bandFor(order.approvalTier);

  return (
    <Drawer
      open
      onClose={onClose}
      title={order.reference}
      subtitle={tx(order.supplierName)}
      footer={
        <div className="flex flex-wrap gap-2">
          {canRaise && canAmend(order) ? (
            <Button icon={<Pencil size={14} />} onClick={() => setPanel("amend")}>
              {t("prc.amend.open")}
            </Button>
          ) : null}
          {canRaise && (order.status === "approved" || order.status === "sent") ? (
            <Button icon={<Send size={14} />} onClick={() => setPanel("send")}>
              {t("prc.send.open")}
            </Button>
          ) : null}
          {order.status === "pending_approval" ? (
            <Button icon={<Link2 size={14} />} onClick={() => setPanel("link")}>
              {t("prc.link.open")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        {/* FR-PRC-019 — decided here, never by the person who raised it. */}
        <OrderDecision
          order={order}
          workflow={workflow.data ?? null}
          channel="console"
          onDone={(updated, note) => {
            workflow.reload();
            onChanged(updated, note);
          }}
        />
        {order.status === "pending_approval" ? (
          <Callout tone="warn" title={t("pur.approvalTier")}>
            {t("pur.tierNote")} {tx(band.approver)}.
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("common.location")}>{tx(order.deliveryLocationName)}</DescRow>
          <DescRow label={t("common.by")}>{tx(order.createdBy)}</DescRow>
          <DescRow label={t("common.created")}>{formatDate(order.createdAt, fmt)}</DescRow>
          <DescRow label={t("pur.expectedDelivery")}>
            {formatDate(order.expectedDelivery, fmt)}
          </DescRow>
          <DescRow label={t("pur.approver")}>
            {order.approvedBy ? tx(order.approvedBy) : tx(band.approver)}
          </DescRow>
          <DescRow label={t("common.subtotal")} mono>
            {formatMoney(order.subtotal, fmt)}
          </DescRow>
          <DescRow label={t("fin.taxAmount")} mono>
            {formatMoney(order.taxTotal, fmt)}
          </DescRow>
          <DescRow label={t("common.total")} mono>
            {formatMoney(order.total, fmt)}
          </DescRow>
        </DescList>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("recipes.components")}</h3>
          <DataTable
            columns={columns}
            rows={order.lines}
            rowKey={(row) => row.id}
            caption={order.reference}
            dense
          />
        </section>

        <section>
          <h3 className="text-fg mb-2 text-sm font-semibold">{t("prc.history.title")}</h3>
          <OrderHistory order={order} workflow={workflow.data ?? null} />
        </section>
      </div>

      {panel === "amend" ? (
        <AmendOrderDrawer
          order={order}
          workflow={workflow.data ?? null}
          onClose={() => setPanel(null)}
          onSaved={(updated, note) => {
            setPanel(null);
            workflow.reload();
            onChanged(updated, note);
          }}
        />
      ) : null}
      {panel === "send" ? (
        <TransmitOrderDrawer
          order={order}
          supplier={liveSupplier ?? supplierRecord}
          onClose={() => {
            setPanel(null);
            workflow.reload();
          }}
          onSent={async (note) => {
            setPanel(null);
            workflow.reload();
            const fresh = await services.purchasing.orders.get(order.id);
            onChanged(fresh ?? order, note);
          }}
        />
      ) : null}
      {panel === "link" ? <ApprovalLinkDrawer order={order} onClose={() => setPanel(null)} /> : null}
    </Drawer>
  );
}

function useAsyncSupplier(id: string | null) {
  const state = useAsync(() => (id ? services.purchasing.suppliers.get(id).catch(() => null) : Promise.resolve(null)), [id]);
  return state.data ?? null;
}
