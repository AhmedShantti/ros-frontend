"use client";

/**
 * Orders — SRS ch.8.
 *
 * The ledger of what the terminals rang up, with the line detail behind each
 * one. Names, prices and costs are read off the order, never re-derived from
 * the menu (BR-POS-004): a price change tomorrow must not restate what was
 * charged today.
 */

import { useMemo, useState } from "react";
import type { Order } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { formatMoney, formatTime, money, percentOf } from "@/lib/console/format";
import {
  ORDER_CHANNEL,
  ORDER_LINE_STATE,
  ORDER_STATE,
  ORDER_TYPE,
  SYNC_STATE,
  TENDER_TYPE,
} from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge, Callout, Drawer, DescList, DescRow, SpecTag, Tabs } from "@/components/console/ui";

type Filter = "all" | "open" | "completed" | "cancelled";

export default function OrdersPage() {
  const { t, tx, fmt } = useI18n();
  const { state, ready } = useLive();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Order | null>(null);

  const orders = useMemo(
    () => state.orderIds.map((id) => state.orders[id]!).filter(Boolean),
    [state],
  );

  const rows = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "open") {
      return orders.filter((o) =>
        ["draft", "open", "held", "parked", "partially_paid"].includes(o.state),
      );
    }
    if (filter === "completed") {
      return orders.filter((o) =>
        ["completed", "partially_refunded", "refunded"].includes(o.state),
      );
    }
    return orders.filter((o) => o.state === "cancelled");
  }, [orders, filter]);

  const totals = useMemo(() => {
    const done = orders.filter((o) => o.state === "completed" || o.state === "partially_refunded");
    const net = done.reduce((s, o) => s + o.grandTotal.amount + o.roundingAdjustment.amount, 0);
    const cogs = done.reduce((s, o) => s + o.cogsTotal.amount, 0);
    const discounts = orders.reduce((s, o) => s + o.discountTotal.amount, 0);
    return {
      count: done.length,
      net,
      cogs,
      discounts,
      average: done.length > 0 ? Math.round(net / done.length) : 0,
    };
  }, [orders]);

  const currency = orders[0]?.currency ?? "EGP";

  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("orders.number"),
      render: (order) => (
        <CellStack
          primary={<span className="font-mono font-medium">{order.orderNumber}</span>}
          secondary={`${formatTime(order.openedAt, fmt)} · ${order.terminalName}`}
        />
      ),
    },
    {
      key: "type",
      header: t("orders.type"),
      render: (order) => (
        <CellStack
          primary={tx(ORDER_TYPE[order.orderType].label)}
          secondary={order.tableLabel ?? tx(ORDER_CHANNEL[order.channel].label)}
        />
      ),
    },
    {
      key: "state",
      header: t("common.status"),
      render: (order) => (
        <Badge tone={ORDER_STATE[order.state].tone}>{tx(ORDER_STATE[order.state].label)}</Badge>
      ),
    },
    {
      key: "syncState",
      header: t("orders.sync"),
      render: (order) => (
        <Badge tone={SYNC_STATE[order.syncState].tone}>{tx(SYNC_STATE[order.syncState].label)}</Badge>
      ),
      secondary: true,
    },
    {
      key: "lines",
      header: t("orders.lines"),
      numeric: true,
      render: (order) => order.lines.filter((l) => l.state !== "voided").length,
      secondary: true,
    },
    {
      key: "grandTotal",
      header: t("common.total"),
      numeric: true,
      render: (order) =>
        formatMoney(
          money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
          fmt,
        ),
    },
    {
      key: "margin",
      header: t("orders.margin"),
      numeric: true,
      hint: t("orders.snapshotNote"),
      secondary: true,
      render: (order) => {
        if (order.grandTotal.amount === 0) return "—";
        const gross = order.grandTotal.amount - order.cogsTotal.amount;
        return `${percentOf(money(gross, order.currency), order.grandTotal).toFixed(1)}%`;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t("orders.title")}
        subtitle={t("orders.subtitle")}
        spec="ch.8"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid>
          <MetricTile
            label={t("orders.completed")}
            value={String(totals.count)}
            spec="FR-POS-001"
          />
          <MetricTile
            label={t("fin.netSales")}
            value={formatMoney(money(totals.net, currency), fmt)}
          />
          <MetricTile
            label={t("orders.cogs")}
            value={formatMoney(money(totals.cogs, currency), fmt)}
            spec="BR-CST-001"
          />
          <MetricTile
            label={t("dash.aov")}
            value={formatMoney(money(totals.average, currency), fmt)}
          />
        </TileGrid>

        {!ready || orders.length === 0 ? (
          <LiveEmpty />
        ) : (
          <Section title={t("orders.title")}>
            <div className="mb-3">
              <Tabs
                value={filter}
                onChange={setFilter}
                label={t("common.filter")}
                options={[
                  { value: "all", label: t("common.all"), count: orders.length },
                  { value: "open", label: t("nav.openOrders") },
                  { value: "completed", label: t("orders.completed") },
                  { value: "cancelled", label: tx(ORDER_STATE.cancelled.label) },
                ]}
              />
            </div>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(order) => order.id}
              onRowClick={setSelected}
              activeRowKey={selected?.id ?? null}
              caption={t("orders.title")}
            />
          </Section>
        )}
      </PageBody>

      {selected ? (
        <OrderDrawer order={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

/** How much of a cancelled order's payment, if any, has actually been sent back. */
function CancelledOrderInfo({ order }: { order: Order }) {
  const { t, tx, fmt } = useI18n();

  const refunded = order.payments
    .filter((p) => p.amount.amount < 0)
    .reduce((sum, p) => sum + -p.amount.amount, 0);

  const paymentStatus =
    order.paidTotal.amount === 0
      ? t("orders.neverCharged")
      : refunded >= order.paidTotal.amount
        ? t("orders.refunded")
        : refunded > 0
          ? t("orders.partiallyRefunded")
          : t("orders.refundPending");

  return (
    <div className="mt-4">
      <Callout tone="bad" title={t("orders.cancelled")}>
        <DescList>
          {order.cancelledAt ? (
            <DescRow label={t("orders.cancelledAt")}>{formatTime(order.cancelledAt, fmt)}</DescRow>
          ) : null}
          {order.cancelledBy ? (
            <DescRow label={t("orders.cancelledBy")}>{tx(order.cancelledBy)}</DescRow>
          ) : null}
          {order.cancelReason ? (
            <DescRow label={t("orders.cancelReason")}>{order.cancelReason}</DescRow>
          ) : null}
          <DescRow label={t("orders.originalTotal")} mono>
            {formatMoney(order.grandTotal, fmt)}
          </DescRow>
          <DescRow label={t("orders.paymentStatus")}>{paymentStatus}</DescRow>
          {refunded > 0 ? (
            <DescRow label={t("orders.refundAmount")} mono>
              {formatMoney(money(refunded, order.currency), fmt)}
            </DescRow>
          ) : null}
        </DescList>
      </Callout>
    </div>
  );
}

function OrderDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, tx, fmt } = useI18n();

  return (
    <Drawer
      open
      onClose={onClose}
      title={order.orderNumber}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={ORDER_STATE[order.state].tone}>{tx(ORDER_STATE[order.state].label)}</Badge>
          <Badge tone={SYNC_STATE[order.syncState].tone}>{tx(SYNC_STATE[order.syncState].label)}</Badge>
          <span>{tx(ORDER_TYPE[order.orderType].label)}</span>
          {order.tableLabel ? <span>· {order.tableLabel}</span> : null}
          <SpecTag id="BR-POS-004" />
        </span>
      }
    >
      <DescList>
        <DescRow label={t("orders.opened")}>{formatTime(order.openedAt, fmt)}</DescRow>
        {order.firstFiredAt ? (
          <DescRow label={t("pos.fired")}>{formatTime(order.firstFiredAt, fmt)}</DescRow>
        ) : null}
        {order.completedAt ? (
          <DescRow label={t("orders.completed")}>{formatTime(order.completedAt, fmt)}</DescRow>
        ) : null}
        {order.syncedAt ? (
          <DescRow label={t("orders.syncedAt")}>{formatTime(order.syncedAt, fmt)}</DescRow>
        ) : null}
        <DescRow label={t("orders.terminal")}>{order.terminalName}</DescRow>
        <DescRow label={t("orders.server")}>{tx(order.openedByName)}</DescRow>
        {order.guestCount ? (
          <DescRow label={t("orders.guests")}>{order.guestCount}</DescRow>
        ) : null}
      </DescList>

      {order.state === "cancelled" ? <CancelledOrderInfo order={order} /> : null}

      <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">{t("orders.lines")}</h3>
      <ul className="divide-line border-line divide-y rounded-lg border">
        {order.lines.map((line) => (
          <li key={line.id} className="px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-fg text-sm">
                  <span className="font-medium tabular-nums">{line.quantity} ×</span>{" "}
                  {tx(line.itemNameSnapshot)}
                </p>
                {line.modifiers.length > 0 ? (
                  <p className="mt-0.5 text-xs">
                    {line.modifiers.map((m) => (
                      <span
                        key={m.id}
                        className={m.kind === "removal" ? "text-bad me-2" : "text-accent me-2"}
                      >
                        {m.kind === "removal" ? "−" : "+"} {tx(m.name)}
                      </span>
                    ))}
                  </p>
                ) : null}
                {line.notes ? (
                  <p className="text-fg-subtle mt-0.5 text-xs italic">“{line.notes}”</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={ORDER_LINE_STATE[line.state].tone}>
                    {tx(ORDER_LINE_STATE[line.state].label)}
                  </Badge>
                  {line.isComp ? <Badge tone="warn">{t("orders.comp")}</Badge> : null}
                  {line.voidReason ? (
                    <span className="text-fg-subtle text-xs">{line.voidReason}</span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-end">
                <p className="text-fg text-sm tabular-nums">{formatMoney(line.lineSubtotal, fmt)}</p>
                <p className="text-fg-subtle text-xs tabular-nums">
                  {t("orders.cogs")} {formatMoney(line.unitCostSnapshot, fmt)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">{t("common.total")}</h3>
      <DescList>
        <DescRow label={t("common.subtotal")} mono>
          {formatMoney(order.subtotal, fmt)}
        </DescRow>
        <DescRow label={t("pos.discountTotal")} mono>
          {formatMoney(order.discountTotal, fmt)}
        </DescRow>
        <DescRow label={t("orders.serviceCharge")} mono>
          {formatMoney(order.serviceChargeTotal, fmt)}
        </DescRow>
        <DescRow label={t("orders.tax")} mono>
          {formatMoney(order.taxTotal, fmt)}
        </DescRow>
        <DescRow label={t("orders.rounding")} mono>
          {formatMoney(order.roundingAdjustment, fmt)}
        </DescRow>
        <DescRow label={t("common.total")} mono>
          <span className="font-semibold">
            {formatMoney(
              money(order.grandTotal.amount + order.roundingAdjustment.amount, order.currency),
              fmt,
            )}
          </span>
        </DescRow>
        <DescRow label={t("orders.cogs")} mono>
          {formatMoney(order.cogsTotal, fmt)}
        </DescRow>
      </DescList>

      {order.payments.length > 0 ? (
        <>
          <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">{t("orders.payments")}</h3>
          <DescList>
            {order.payments.map((payment) => (
              <DescRow
                key={payment.id}
                label={`${tx(TENDER_TYPE[payment.tender].label)}${
                  payment.cardLast4 ? ` ···· ${payment.cardLast4}` : ""
                }`}
                mono
              >
                {formatMoney(payment.amount, fmt)}
              </DescRow>
            ))}
          </DescList>
        </>
      ) : null}

      {order.discounts.length > 0 ? (
        <>
          <h3 className="text-fg mt-5 mb-2 text-sm font-semibold">
            {t("orders.discountsApplied")}
          </h3>
          <DescList>
            {order.discounts.map((discount) => (
              <DescRow key={discount.id} label={tx(discount.reason)} mono>
                {formatMoney(discount.amount, fmt)}
                {discount.approvedBy ? (
                  <span className="text-fg-subtle ms-2 text-xs">
                    {t("orders.approvedBy")} {tx(discount.approvedBy)}
                  </span>
                ) : null}
              </DescRow>
            ))}
          </DescList>
        </>
      ) : null}
    </Drawer>
  );
}
