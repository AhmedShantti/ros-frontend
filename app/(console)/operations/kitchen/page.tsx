"use client";

/**
 * Kitchen queue — SRS ch.9, KITCHEN-QUEUE-MANAGER-REAL-BACKEND-P0.
 *
 * The manager's READ-ONLY view of the branch's active kitchen queue —
 * NOT the KDS terminal. Backed by `GET /kitchen/branches/{branchId}/queue`
 * (`kitchen.queue.view`), a Dashboard-session route deliberately separate
 * from the KDS terminal's own `GET /kds/stations/{id}/queue`
 * (`kds.operate`, KDS-session-bound) — see `kitchen-queue.permissions.ts`
 * in the backend for why. No bump/start/recall exists here; that stays the
 * KDS terminal's job.
 *
 * Branch selection mirrors `operations/tables/page.tsx`'s own rule (never
 * `cash-sessions/page.tsx`'s auto-default-to-first-branch one): a branch is
 * only ever considered selected when the Console's own top-bar scope
 * already names one, or exactly one branch is authorised at all (nothing to
 * choose), or the actor actively picks one below — NEVER a silent default
 * to "the first branch in the list" while the scope is genuinely
 * "All branches". A kitchen queue is one branch's queue; silently picking
 * one, or merging several, would show a manager tickets that are not where
 * they think they are.
 */

import { useMemo, useState } from "react";
import type { KitchenQueueTicket } from "@/lib/console/types";
import { useI18n, useSession } from "@/lib/console/providers";
import { elapsedSince, useNow } from "@/lib/console/live/store";
import { useKitchenQueue } from "@/lib/console/feeds";
import { formatElapsed } from "@/lib/console/format";
import { ORDER_TYPE, TICKET_STATE } from "@/lib/console/labels";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { LiveEmpty, LiveNotice } from "@/components/console/live-panels";
import { MetricTile } from "@/components/console/charts";
import { ErrorPanel, Gate, LoadingPanel } from "@/components/console/states";
import { Badge, Callout, Card, CardHeader, Field, Select } from "@/components/console/ui";

export default function KitchenPage() {
  return (
    <Gate permissions={["kitchen.queue.view"]}>
      <KitchenQueueScreen />
    </Gate>
  );
}

function KitchenQueueScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches } = useSession();
  const now = useNow(1000);

  const singleAuthorizedBranch = availableBranches.length === 1 ? availableBranches[0]! : null;
  const contextBranchId = scope.branchId ?? singleAuthorizedBranch?.id ?? null;
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = contextBranchId ?? (pickedBranchId || null);

  const feed = useKitchenQueue(branchId, scope);
  const snapshot = feed.snapshot;

  const tickets = useMemo<KitchenQueueTicket[]>(() => {
    if (!snapshot) return [];
    return snapshot.stations
      .flatMap((station) => station.tickets)
      .sort((a, b) => new Date(a.firedAt).getTime() - new Date(b.firedAt).getTime());
  }, [snapshot]);

  const columns: Column<KitchenQueueTicket>[] = [
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
          secondary={ticket.course > 1 ? `${t("orders.course")} ${ticket.course}` : undefined}
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
        const elapsed = elapsedSince(ticket.firedAt, now) ?? ticket.elapsedSeconds;
        return (
          <span className="inline-flex items-center gap-2">
            <span className="tabular-nums">{formatElapsed(elapsed)}</span>
            {ticket.delayed ? <Badge tone="bad">{t("kds.delayed")}</Badge> : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title={t("kds.title")} subtitle={t("kds.dashboardSubtitle")} spec="ch.9" />

      <PageBody>
        <LiveNotice source={feed.live ? "backend" : "device"} />

        {!contextBranchId && availableBranches.length > 1 ? (
          <Field label={t("common.branch")}>
            <Select value={pickedBranchId} onChange={(event) => setPickedBranchId(event.target.value)}>
              <option value="">—</option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {tx(b.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {!branchId ? (
          <Callout tone="muted">{t("kds.selectBranch")}</Callout>
        ) : feed.error ? (
          <ErrorPanel error={feed.error} onRetry={feed.reload} />
        ) : !feed.ready || !snapshot ? (
          <LoadingPanel />
        ) : (
          <>
            <TileGrid columns={2}>
              <MetricTile
                label={t("kds.queue")}
                value={String(snapshot.totalActiveTickets)}
                spec="FR-KDS-020"
              />
              <MetricTile
                label={t("kds.avgWait")}
                value={
                  snapshot.averageWaitSeconds === null
                    ? "—"
                    : formatElapsed(snapshot.averageWaitSeconds)
                }
                spec="FR-RPT-033"
              />
            </TileGrid>

            {snapshot.stations.length > 0 ? (
              <Card>
                <CardHeader title={t("term.allStations")} spec="FR-KDS-020" />
                <ul className="space-y-2.5">
                  {snapshot.stations.map((station) => (
                    <li key={station.stationId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-fg font-medium">{tx(station.stationName)}</span>
                      <span className="text-fg-muted tabular-nums">{station.queueDepth}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {tickets.length === 0 ? (
              <LiveEmpty title={t("kds.emptyBranch")} />
            ) : (
              <Section title={t("kds.queue")}>
                <DataTable
                  columns={columns}
                  rows={tickets}
                  rowKey={(ticket) => ticket.id}
                  caption={t("kds.queue")}
                />
              </Section>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
