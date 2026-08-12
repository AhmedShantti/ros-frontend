"use client";

/**
 * Kitchen queue — SRS ch.9.
 *
 * The manager's view of the same tickets the cooks are looking at, plus the
 * two derived numbers worth acting on: which station is the bottleneck
 * (FR-KDS-043) and what ticket time is running at (FR-KDS-042).
 */

import { useMemo } from "react";
import type { KitchenTicket } from "@/lib/console/types";
import { useI18n } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { stationsByBranch } from "@/lib/console/live/reducer";
import { urgencyFor } from "@/lib/console/live/engine";
import { formatDuration, formatElapsed } from "@/lib/console/format";
import { ORDER_TYPE, TICKET_STATE, TICKET_URGENCY } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { Badge, Card, CardHeader, Meter } from "@/components/console/ui";

export default function KitchenPage() {
  const { t, tx, fmt } = useI18n();
  const { state } = useLive();
  const now = useNow(1000);

  const stations = useMemo(
    () => (stationsByBranch.get(state.branchId) ?? []).filter((s) => s.active),
    [state.branchId],
  );

  const active = useMemo(
    () =>
      state.ticketIds
        .map((id) => state.tickets[id]!)
        .filter((ticket) => ticket.branchId === state.branchId && ticket.state !== "bumped"),
    [state],
  );

  const bumped = useMemo(
    () =>
      state.ticketIds
        .map((id) => state.tickets[id]!)
        .filter((ticket) => ticket.branchId === state.branchId && ticket.state === "bumped"),
    [state],
  );

  /** FR-KDS-042 — bump time minus fire time, over the tickets that finished. */
  const averageTicket = useMemo(() => {
    const times = bumped
      .map((ticket) => {
        const order = state.orders[ticket.orderId];
        const line = order?.lines.find((l) => l.readyAt);
        if (!line?.readyAt) return null;
        return (new Date(line.readyAt).getTime() - new Date(ticket.firedAt).getTime()) / 1000;
      })
      .filter((v): v is number => v !== null && v >= 0);
    if (times.length === 0) return null;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }, [bumped, state.orders]);

  /** FR-KDS-043 — queue depth against the station's hourly throughput. */
  const load = useMemo(
    () =>
      stations
        .map((station) => {
          const queue = active.filter((ticket) => ticket.stationId === station.id);
          const items = queue.reduce(
            (s, ticket) =>
              s + ticket.lines.filter((l) => l.state !== "ready" && l.state !== "voided").length,
            0,
          );
          return {
            station,
            tickets: queue.length,
            items,
            pressure: station.capacityPerHour > 0 ? (items / station.capacityPerHour) * 100 : 0,
          };
        })
        .sort((a, b) => b.pressure - a.pressure),
    [stations, active],
  );

  const bottleneck = load.find((row) => row.items > 0) ?? null;

  const columns: Column<KitchenTicket>[] = [
    {
      key: "orderNumber",
      header: t("orders.number"),
      render: (ticket) => (
        <CellStack
          primary={<span className="font-mono font-medium">{ticket.orderNumber}</span>}
          secondary={`${tx(ORDER_TYPE[ticket.orderType].label)}${
            ticket.tableLabel ? ` · ${ticket.tableLabel}` : ""
          }`}
        />
      ),
    },
    {
      key: "station",
      header: t("term.station"),
      render: (ticket) => tx(ticket.stationName),
    },
    {
      key: "lines",
      header: t("orders.lines"),
      render: (ticket) => (
        <CellStack
          primary={ticket.lines.map((l) => `${l.quantity}× ${tx(l.name)}`).join(", ")}
          secondary={
            ticket.course > 1 ? `${t("orders.course")} ${ticket.course}` : undefined
          }
        />
      ),
    },
    {
      key: "state",
      header: t("common.status"),
      render: (ticket) => (
        <Badge tone={TICKET_STATE[ticket.state].tone}>{tx(TICKET_STATE[ticket.state].label)}</Badge>
      ),
    },
    {
      key: "elapsed",
      header: t("kds.elapsed"),
      numeric: true,
      render: (ticket) => {
        const elapsed = elapsedSince(ticket.firedAt, now) ?? 0;
        const urgency = urgencyFor(elapsed, ticket.targetSeconds);
        return (
          <span className="inline-flex items-center gap-2">
            <span className="tabular-nums">{formatElapsed(elapsed)}</span>
            <Badge tone={TICKET_URGENCY[urgency].tone}>{tx(TICKET_URGENCY[urgency].label)}</Badge>
          </span>
        );
      },
    },
    {
      key: "target",
      header: t("kds.target"),
      numeric: true,
      secondary: true,
      render: (ticket) => formatElapsed(ticket.targetSeconds),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("kds.title")}
        subtitle={t("kds.noTicketsNote")}
        spec="ch.9"
        actions={<TerminalLinks />}
      />

      <PageBody>
        <LiveNotice />

        <TileGrid columns={3}>
          <MetricTile label={t("kds.queue")} value={String(active.length)} spec="FR-KDS-020" />
          <MetricTile
            label={t("kds.avgTicket")}
            value={averageTicket === null ? "—" : formatDuration(Math.round(averageTicket), fmt)}
            spec="FR-KDS-042"
          />
          <MetricTile
            label={t("kds.bottleneck")}
            value={bottleneck ? tx(bottleneck.station.name) : "—"}
            spec="FR-KDS-043"
          />
        </TileGrid>

        {stations.length > 0 ? (
          <Card>
            <CardHeader title={t("term.allStations")} spec="FR-KDS-045" />
            <ul className="space-y-2.5">
              {load.map((row) => (
                <li key={row.station.id}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="text-fg font-medium">{tx(row.station.name)}</span>
                    <span className="text-fg-muted tabular-nums">
                      {row.items} · {row.station.capacityPerHour}/h
                    </span>
                  </div>
                  <Meter
                    value={row.pressure}
                    tone={row.pressure > 80 ? "bad" : row.pressure > 45 ? "warn" : "good"}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {active.length === 0 ? (
          <LiveEmpty title={t("kds.noTickets")} />
        ) : (
          <Section title={t("kds.queue")}>
            <DataTable
              columns={columns}
              rows={active}
              rowKey={(ticket) => ticket.id}
              caption={t("kds.queue")}
            />
          </Section>
        )}
      </PageBody>
    </>
  );
}
