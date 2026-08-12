"use client";

/**
 * Open orders — SRS §19.5.
 *
 * What is on the floor right now, oldest first, because the oldest open
 * order is the one most likely to be the problem.
 */

import { useMemo } from "react";
import type { Order } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { openOrdersOf } from "@/lib/console/live/reducer";
import { formatDuration, formatMoney, formatTime, money } from "@/lib/console/format";
import { ORDER_STATE, ORDER_TYPE } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge } from "@/components/console/ui";

export default function OpenOrdersPage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const now = useNow(5_000);

  const rows = useMemo(
    () =>
      [...openOrdersOf(state)].sort(
        (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
      ),
    [state],
  );

  const currency = rows[0]?.currency ?? "EGP";
  const outstanding = rows.reduce((s, o) => s + o.grandTotal.amount - o.paidTotal.amount, 0);
  const unfired = rows.filter((o) => o.lines.some((l) => l.state === "pending")).length;

  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: t("orders.number"),
      render: (order) => (
        <CellStack
          primary={<span className="font-mono font-medium">{order.orderNumber}</span>}
          secondary={`${tx(ORDER_TYPE[order.orderType].label)}${
            order.tableLabel ? ` · ${order.tableLabel}` : ""
          }`}
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
      key: "openedAt",
      header: t("orders.opened"),
      render: (order) => {
        const seconds = elapsedSince(order.openedAt, now);
        return (
          <CellStack
            primary={seconds === null ? "—" : formatDuration(seconds, fmt)}
            secondary={formatTime(order.openedAt, fmt)}
          />
        );
      },
    },
    {
      key: "lines",
      header: t("orders.lines"),
      numeric: true,
      render: (order) => {
        const live = order.lines.filter((l) => l.state !== "voided");
        const pending = live.filter((l) => l.state === "pending").length;
        return (
          <CellStack
            primary={String(live.length)}
            secondary={pending > 0 ? `${pending} ${t("common.pending")}` : undefined}
          />
        );
      },
    },
    {
      key: "grandTotal",
      header: t("common.total"),
      numeric: true,
      render: (order) => formatMoney(order.grandTotal, fmt),
    },
    {
      key: "balance",
      header: t("pos.balance"),
      numeric: true,
      render: (order) =>
        formatMoney(money(order.grandTotal.amount - order.paidTotal.amount, order.currency), fmt),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("orders.openOrdersTitle")}
        subtitle={t("orders.openOrdersSubtitle")}
        spec="§19.5"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid columns={3}>
          <MetricTile label={t("nav.openOrders")} value={String(rows.length)} />
          <MetricTile
            label={t("pos.balance")}
            value={formatMoney(money(outstanding, currency), fmt)}
          />
          <MetricTile label={t("pos.fire")} value={String(unfired)} spec="FR-POS-035" />
        </TileGrid>

        {rows.length === 0 ? (
          <LiveEmpty />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(order) => order.id}
            caption={t("orders.openOrdersTitle")}
          />
        )}
      </PageBody>
    </>
  );
}
