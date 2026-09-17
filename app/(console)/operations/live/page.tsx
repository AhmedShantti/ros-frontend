"use client";

/**
 * Live operations — FR-RPT-033.
 *
 * One screen for the floor as it is now: open orders, table states, kitchen
 * queue depth and the average current wait, active terminals, and the cash
 * drawers. It refreshes itself — the device's own terminals push into the
 * live store instantly, and everything read from the backend is polled on an
 * interval that pauses while the tab is hidden, so an unattended wall screen
 * does not hammer the API.
 *
 * Each block names its source. Where a figure cannot be read (the kitchen
 * queue from a console session, table occupancy against the API) it is a dash
 * with the reason, never a zero.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { CashSession, KitchenTicket, LiveOperationsSnapshot, Terminal, TableState } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { elapsedSince, useLive, useNow } from "@/lib/console/live/store";
import { tablesOf } from "@/lib/console/live/reducer";
import { useKitchenFeed, useOpenOrderFeed } from "@/lib/console/feeds";
import { formatDuration, formatMoney, formatNumber, formatRelative, formatTime } from "@/lib/console/format";
import { CASH_SESSION_STATUS, ORDER_TYPE, TABLE_STATE, TERMINAL_STATUS } from "@/lib/console/labels";
import { DATA_MODE } from "@/lib/api/config";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { LiveNotice, TerminalLinks } from "@/components/console/live-panels";
import { LoadingPanel } from "@/components/console/states";
import { Badge, Button, Callout, Meter, Toggle } from "@/components/console/ui";

const NONE = "—";
const POLL_MS = 15_000;
/** A ticket older than this is counted as delayed, matching the KDS default target. */
const WAIT_TARGET_SECONDS = 15 * 60;

/** Re-runs `tick` every `ms` while enabled and the document is visible. */
function usePolling(enabled: boolean, ms: number, tick: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = window.setInterval(run, ms);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ms]);
}

export default function LiveOperationsPage() {
  const { t, tx, fmt } = useI18n();
  const { scope, branch } = useSession();
  const { state } = useLive();
  const now = useNow(5_000);

  const [auto, setAuto] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date().toISOString());

  const snapshot = useAsync<LiveOperationsSnapshot>(
    async () => (await services.dashboard.get(scope)).live,
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const terminals = useAsync<Terminal[]>(
    async () => (await services.operations.terminals({ scope, limit: 200 })).rows,
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const sessions = useAsync<CashSession[]>(
    async () => (await services.finance.cashSessions.list({ scope, limit: 200 })).rows,
    [scope.tenantId, scope.brandId, scope.branchId],
  );
  const orders = useOpenOrderFeed(scope);
  const kitchen = useKitchenFeed(scope);

  const refresh = () => {
    snapshot.reload();
    terminals.reload();
    sessions.reload();
    orders.reload();
    kitchen.reload();
    setRefreshedAt(new Date().toISOString());
  };
  usePolling(auto, POLL_MS, refresh);

  // -- Open orders -----------------------------------------------------------
  const openOrders = useMemo(
    () => [...orders.rows].sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt)),
    [orders.rows],
  );
  const outstanding = openOrders.reduce((sum, order) => sum + order.grandTotal.amount - order.paidTotal.amount, 0);
  const currency = openOrders[0]?.currency ?? "EGP";

  // -- Tables ----------------------------------------------------------------
  const deviceTables = useMemo(() => (DATA_MODE === "http" ? [] : tablesOf(state)), [state]);
  const tableCounts = useMemo(() => {
    const counts = new Map<TableState, number>();
    for (const table of deviceTables) counts.set(table.state, (counts.get(table.state) ?? 0) + 1);
    return counts;
  }, [deviceTables]);

  // -- Kitchen ---------------------------------------------------------------
  const queue = useMemo(
    () => kitchen.rows.filter((ticket: KitchenTicket) => ticket.state === "queued" || ticket.state === "started" || ticket.state === "recalled"),
    [kitchen.rows],
  );
  const waits = queue.map((ticket) => elapsedSince(ticket.firedAt, now) ?? 0);
  const kitchenReadable = !kitchen.error;
  const queueDepth = kitchenReadable ? queue.length : snapshot.data?.kitchenQueueDepth ?? null;
  const averageWait = kitchenReadable
    ? waits.length > 0
      ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
      : 0
    : snapshot.data?.averageWaitSeconds ?? null;
  const delayed = kitchenReadable ? waits.filter((seconds) => seconds > WAIT_TARGET_SECONDS).length : snapshot.data?.delayedTickets ?? null;
  const byStation = useMemo(() => {
    const groups = new Map<string, { name: string; count: number; oldest: number }>();
    for (const ticket of queue) {
      const entry = groups.get(ticket.stationId) ?? { name: tx(ticket.stationName), count: 0, oldest: 0 };
      entry.count += 1;
      entry.oldest = Math.max(entry.oldest, elapsedSince(ticket.firedAt, now) ?? 0);
      groups.set(ticket.stationId, entry);
    }
    return [...groups.values()].sort((a, b) => b.oldest - a.oldest);
  }, [queue, now, tx]);

  // -- Terminals -------------------------------------------------------------
  const terminalRows = terminals.data ?? [];
  const activeTerminals = terminalRows.filter((terminal) => terminal.status === "online").length;
  const troubled = terminalRows.filter((terminal) => terminal.status === "offline" || terminal.status === "degraded");

  // -- Drawers ---------------------------------------------------------------
  const drawerSessions = useMemo(() => {
    const rows = [...(sessions.data ?? [])];
    if (DATA_MODE !== "http" && state.session) rows.unshift(state.session);
    const latest = new Map<string, CashSession>();
    for (const session of rows.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))) {
      if (!latest.has(session.drawerId)) latest.set(session.drawerId, session);
    }
    return [...latest.values()];
  }, [sessions.data, state.session]);
  const openDrawers = drawerSessions.filter((session) => session.status === "open" || session.status === "closing").length;

  const count = (value: number | null | undefined) => (value === null || value === undefined ? NONE : formatNumber(value, fmt));

  return (
    <>
      <PageHeader
        title={t("opslive.title")}
        subtitle={t("opslive.subtitle")}
        spec="FR-RPT-033"
        meta={
          <>
            {branch ? <span>{tx(branch.name)}</span> : null}
            <span>
              {t("opslive.refreshedAt")}: {formatTime(refreshedAt, fmt)}
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={12} aria-hidden />} onClick={refresh}>
              {t("rep.refresh")}
            </Button>
            <TerminalLinks />
          </>
        }
      />

      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LiveNotice source={orders.live ? "backend" : "device"} />
          <div className="min-w-56">
            <Toggle checked={auto} onChange={setAuto} label={t("opslive.autoRefresh")} hint={t("opslive.autoRefreshHint")} />
          </div>
        </div>

        <TileGrid>
          <MetricTile label={t("live.openOrders")} value={formatNumber(openOrders.length, fmt)} footer={`${t("pos.balance")} ${formatMoney({ amount: outstanding, currency }, fmt, true)}`} />
          <MetricTile
            label={t("live.tables")}
            value={
              DATA_MODE === "http"
                ? `${count(snapshot.data?.tablesOccupied)} / ${count(snapshot.data?.tablesTotal)}`
                : `${formatNumber(deviceTables.filter((table) => table.state !== "available" && table.state !== "needs_cleaning").length, fmt)} / ${formatNumber(deviceTables.length, fmt)}`
            }
          />
          <MetricTile label={t("live.queue")} value={count(queueDepth)} footer={`${t("live.delayed")} ${count(delayed)}`} />
          <MetricTile label={t("live.avgWait")} value={averageWait === null ? NONE : formatDuration(averageWait, fmt)} />
          <MetricTile label={t("live.terminals")} value={terminals.data ? `${formatNumber(activeTerminals, fmt)} / ${formatNumber(terminalRows.length, fmt)}` : NONE} />
          <MetricTile label={t("opslive.drawersOpen")} value={sessions.error && drawerSessions.length === 0 ? NONE : formatNumber(openDrawers, fmt)} />
        </TileGrid>

        <div className="grid gap-3 lg:grid-cols-2">
          <Section
            title={t("live.openOrders")}
            hint={t("opslive.ordersHint")}
            action={<Link className="text-accent text-xs font-medium" href="/operations/open-orders">{t("dash.viewAll")}</Link>}
          >
            {!orders.ready ? (
              <LoadingPanel compact />
            ) : openOrders.length === 0 ? (
              <p className="text-fg-subtle text-xs">{t("opslive.noOpenOrders")}</p>
            ) : (
              <ul className="divide-line divide-y">
                {openOrders.slice(0, 8).map((order) => {
                  const seconds = elapsedSince(order.openedAt, now) ?? 0;
                  return (
                    <li key={order.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="text-fg font-mono text-sm">{order.orderNumber}</span>
                        <span className="text-fg-subtle block text-xs">
                          {tx(ORDER_TYPE[order.orderType].label)}
                          {order.tableLabel ? ` · ${order.tableLabel}` : ""}
                        </span>
                      </span>
                      <Badge tone={seconds > 45 * 60 ? "bad" : seconds > 20 * 60 ? "warn" : "neutral"}>{formatDuration(seconds, fmt)}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title={t("opslive.tableStates")}
            action={<Link className="text-accent text-xs font-medium" href="/operations/tables">{t("dash.viewAll")}</Link>}
          >
            {DATA_MODE === "http" ? (
              <Callout tone="muted">{t("opslive.tablesNoSource")}</Callout>
            ) : deviceTables.length === 0 ? (
              <p className="text-fg-subtle text-xs">{t("opslive.noTables")}</p>
            ) : (
              <ul className="space-y-2">
                {(Object.keys(TABLE_STATE) as TableState[]).map((key) => {
                  const n = tableCounts.get(key) ?? 0;
                  return (
                    <li key={key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3">
                      <Badge tone={TABLE_STATE[key].tone}>{tx(TABLE_STATE[key].label)}</Badge>
                      <Meter value={(n / deviceTables.length) * 100} tone={TABLE_STATE[key].tone} />
                      <span className="text-fg text-end font-mono text-sm tabular-nums">{formatNumber(n, fmt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title={t("opslive.kitchen")}
            hint={t("opslive.kitchenHint")}
            action={<Link className="text-accent text-xs font-medium" href="/operations/kitchen">{t("dash.viewAll")}</Link>}
          >
            {!kitchenReadable ? (
              <Callout tone="muted">{t("opslive.kitchenNoSource")}</Callout>
            ) : byStation.length === 0 ? (
              <p className="text-fg-subtle text-xs">{t("opslive.kitchenClear")}</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">{t("opslive.kitchen")}</caption>
                <thead>
                  <tr className="text-fg-subtle border-line border-b text-xs">
                    <th scope="col" className="py-1 text-start font-medium">{t("opslive.station")}</th>
                    <th scope="col" className="py-1 text-end font-medium">{t("live.queue")}</th>
                    <th scope="col" className="py-1 text-end font-medium">{t("opslive.oldest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {byStation.map((station) => (
                    <tr key={station.name} className="border-line border-b last:border-0">
                      <td className="text-fg py-1.5">{station.name}</td>
                      <td className="py-1.5 text-end font-mono tabular-nums">{formatNumber(station.count, fmt)}</td>
                      <td className="py-1.5 text-end">
                        <Badge tone={station.oldest > WAIT_TARGET_SECONDS ? "bad" : "neutral"}>{formatDuration(station.oldest, fmt)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title={t("live.terminals")}
            action={<Link className="text-accent text-xs font-medium" href="/operations/terminals">{t("dash.viewAll")}</Link>}
          >
            {terminals.loading && !terminals.data ? (
              <LoadingPanel compact />
            ) : terminals.error ? (
              <Callout tone="muted">{terminals.error.message}</Callout>
            ) : troubled.length === 0 ? (
              <Callout tone="good">{t("opslive.terminalsHealthy").replace("{count}", formatNumber(activeTerminals, fmt))}</Callout>
            ) : (
              <ul className="divide-line divide-y">
                {troubled.map((terminal) => (
                  <li key={terminal.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="text-fg text-sm">{terminal.name}</span>
                      <span className="text-fg-subtle block text-xs">
                        {t("opslive.lastSeen")} {formatRelative(terminal.lastSeenAt, fmt)} · {formatNumber(terminal.queuedOperations, fmt)} {t("live.operations")}
                      </span>
                    </span>
                    <Badge tone={TERMINAL_STATUS[terminal.status].tone}>{tx(TERMINAL_STATUS[terminal.status].label)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={t("opslive.drawers")}
            hint={t("opslive.drawersHint")}
            className="lg:col-span-2"
            action={<Link className="text-accent text-xs font-medium" href="/finance/cash-sessions">{t("dash.viewAll")}</Link>}
          >
            {sessions.loading && !sessions.data ? (
              <LoadingPanel compact />
            ) : drawerSessions.length === 0 ? (
              <Callout tone="muted">{sessions.error ? t("opslive.drawersNoSource") : t("opslive.noDrawers")}</Callout>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {drawerSessions.map((session) => (
                  <li key={session.id} className="border-line rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-fg text-sm font-medium">{session.drawerName}</span>
                      <Badge tone={CASH_SESSION_STATUS[session.status].tone}>{tx(CASH_SESSION_STATUS[session.status].label)}</Badge>
                    </div>
                    <p className="text-fg-subtle mt-1 text-xs">
                      {tx(session.employeeName)} · {session.terminalName} · {t("opslive.openedAt")} {formatTime(session.openedAt, fmt)}
                    </p>
                    {session.status === "open" ? (
                      <p className="text-fg-muted mt-1 text-xs">
                        {t("opslive.expectedCash")} {formatMoney(session.expectedCash, fmt)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </PageBody>
    </>
  );
}
