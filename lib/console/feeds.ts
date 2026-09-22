"use client";

/**
 * One list, two sources.
 *
 * A handful of console screens — orders, open orders, stock movements,
 * waste — were built against the in-memory engine in `lib/console/live/`,
 * which is what a device does when there is no server. There is a server
 * now, and against it those screens were reading the wrong thing entirely:
 * the local simulator never sees a sale the *backend* recorded, so the table
 * rendered empty under a banner promising it would fill up as the POS rang
 * things in. Empty and confidently wrong is worse than empty.
 *
 * So each feed below picks its source from `DATA_MODE`, and says which one
 * it picked. Both hooks run either way — a React hook cannot be called
 * conditionally, and reading the store is a context read that costs nothing
 * when its rows go unused.
 *
 * A screen whose domain the backend does not serve at all (the cash-session
 * index) is not listed here. That keeps reading the device, and `LiveNotice`
 * says so rather than implying a link that does not exist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DATA_MODE } from "@/lib/api/config";
import { services } from "./services";
import { ServiceError } from "./services";
import type { Scope, TableStatusRow } from "./services/types";
import { useAsync, useStations } from "./hooks";
import { useLive } from "./live/store";
import { tablesOf } from "./live/reducer";
import type {
  AuditEntry,
  Id,
  KitchenQueueSnapshot,
  KitchenQueueStation,
  KitchenQueueTicket,
  Order,
  StockMovement,
  WasteRecord,
} from "./types";

/** How many rows a device-facing screen asks the backend for. */
const FEED_LIMIT = 200;

/**
 * ORDERS-HISTORY-LIMIT-CONTRACT-FIX-P0 — `GET /orders/history`'s own
 * contract caps `limit` at 100 (`ListOrdersQueryDto`,
 * `src/modules/sales/sales.dto.ts`); asking for more is a 400, not a
 * larger page. A dedicated constant, not a change to the shared
 * `FEED_LIMIT` above, which other feeds (movements/waste/audit) hit
 * different, unverified-here endpoints through.
 */
export const ORDER_HISTORY_FEED_LIMIT = 100;

export interface Feed<T> {
  rows: T[];
  /** False until the first load settles, either way. */
  ready: boolean;
  error: ServiceError | Error | null;
  /** True when these rows came from the backend rather than this device. */
  live: boolean;
  reload: () => void;
}

/** Stable identity for a scope, so a feed refetches when the picker moves. */
function scopeKey(scope?: Scope): string {
  return `${scope?.tenantId ?? ""}:${scope?.brandId ?? ""}:${scope?.branchId ?? ""}`;
}

function fromRemote<T>(
  remote: ReturnType<typeof useAsync<T[]>>,
  live: boolean,
  local: T[],
  localReady: boolean,
): Feed<T> {
  if (!live) {
    return { rows: local, ready: localReady, error: null, live: false, reload: () => {} };
  }
  return {
    rows: remote.data ?? [],
    ready: !remote.loading || remote.data !== null,
    error: remote.error,
    live: true,
    reload: remote.reload,
  };
}

/**
 * SRS ch.8 — the order ledger, for the Dashboard `/orders` page.
 *
 * ORDERS-MODULE-ACCEPTANCE-CORRECTION-P0 BLOCKER A — this calls
 * `services.sales.listOrderHistoryPage` (`GET /orders/history`,
 * `pos.order.view_history`), NEVER `services.sales.orders.list`
 * (`GET /orders`, `pos.order.create`). Cashier holds the latter as an
 * ordinary POS grant; routing this DASHBOARD feed through that same call
 * would silently hand Cashier back-office order history. The POS
 * terminal's own Resume/Open-Orders picker (`pos-live.tsx`) calls
 * `services.operations.openOrders` directly and is unaffected.
 */
export function useOrderFeed(scope?: Scope): Feed<Order> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<Order[]>(
    async () =>
      live
        ? (
            await services.sales.listOrderHistoryPage({
              branchId: scope?.branchId ?? undefined,
              limit: ORDER_HISTORY_FEED_LIMIT,
            })
          ).orders
        : [],
    [live, key],
  );

  const local = useMemo(
    () => state.orderIds.map((id) => state.orders[id]!).filter(Boolean),
    [state.orderIds, state.orders],
  );

  return fromRemote(remote, live, local, ready);
}

/**
 * FR-POS-001 — what is still open, for the Dashboard
 * `/operations/open-orders` page.
 *
 * ORDERS-HISTORY-LIMIT-CONTRACT-FIX-P0 — `GET /orders/history` orders
 * purely by recency, with no state filter, unbounded by total order
 * volume. A single bounded page (even a full `limit=100` one), filtered
 * for open states CLIENT-side, cannot promise completeness: once a
 * branch/tenant has processed more orders (of any state) than one page
 * holds since an older order was opened, that still-open order falls off
 * the page entirely and silently vanishes from this screen — the "still
 * on the floor" list is what managers use to find problems, so a silent
 * gap there is a real operational-truth defect, not a cosmetic one. This
 * now asks the backend to filter server-side instead (`state: "open"`,
 * `ListOrderHistoryQueryDto`) and WALKS every page to exhaustion — that is
 * NOT "loading the entire history client-side" (explicitly out of scope):
 * every row returned is already a genuinely open order, so the total
 * fetched is bounded by how many orders are actually open right now, a
 * small, real, operationally-bounded set, never by total history size.
 * `MAX_OPEN_ORDER_PAGES` is a defensive backstop against a runaway loop
 * only (e.g. a future server bug always returning a `nextCursor`), not a
 * real-world limit: at 100 open orders per page it would take literally
 * thousands of orders open AT ONCE to hit it.
 *
 * `services.operations.openOrders` (`GET /orders`, `pos.order.create`) is
 * deliberately NOT used here — that call is the POS terminal's own
 * Resume/Open-Orders picker contract (ORDERS-MODULE-ACCEPTANCE-
 * CORRECTION-P0 BLOCKER A), and routing this DASHBOARD page through it
 * would hand Cashier the same back-office access BLOCKER A exists to
 * remove. `services.operations.openOrders` itself, and everything under
 * `pos-live.tsx`, is unchanged.
 */
const MAX_OPEN_ORDER_PAGES = 50;

/**
 * The walk itself, pulled out of the hook so it is directly unit-testable
 * (`feeds.open-orders.test.ts`) without React hook-testing machinery —
 * matches this codebase's own preference for testing plain async functions
 * at the service boundary (e.g. `http.open-orders.test.ts`).
 */
export async function fetchAllOpenOrders(branchId?: string): Promise<Order[]> {
  const collected: Order[] = [];
  let cursor: { businessDay: string; id: string } | null = null;
  for (let page = 0; page < MAX_OPEN_ORDER_PAGES; page += 1) {
    const result = await services.sales.listOrderHistoryPage({
      branchId,
      state: "open",
      limit: ORDER_HISTORY_FEED_LIMIT,
      cursor,
    });
    collected.push(...result.orders);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return collected;
}

/** Every `Order.state` that still counts as "on the floor". */
const OPEN_ORDER_STATES: Order["state"][] = ["draft", "open", "held", "parked", "partially_paid"];

export function useOpenOrderFeed(scope?: Scope): Feed<Order> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<Order[]>(
    async () => (live ? fetchAllOpenOrders(scope?.branchId ?? undefined) : []),
    [live, key],
  );

  const local = useMemo(
    () =>
      state.orderIds
        .map((id) => state.orders[id]!)
        .filter((order) => order && OPEN_ORDER_STATES.includes(order.state)),
    [state.orderIds, state.orders],
  );

  return fromRemote(remote, live, local, ready);
}

/** How often Live Operations re-polls Open Orders — the same cadence as Table Status and the Kitchen Queue. */
const LIVE_OPEN_ORDERS_POLL_MS = 15_000;

export interface BranchOpenOrdersFeed {
  /** True once THIS branch's first response (rows or error) has settled. */
  ready: boolean;
  error: ServiceError | Error | null;
  live: boolean;
  reload: () => void;
  /** Null until a concrete branch is selected and its own first load settles, and whenever the last read failed. */
  rows: Order[] | null;
}

type BranchOpenOrdersResult =
  | { branchId: Id; rows: Order[]; error: null }
  | { branchId: Id; rows: null; error: ServiceError | Error };

/**
 * LIVE-OPERATIONS-P0 — the branch-scoped open-orders count the Live
 * Operations cockpit needs.
 *
 * Calls the exact same walk `useOpenOrderFeed`'s live path runs
 * (`fetchAllOpenOrders`, `GET /orders/history?state=open`,
 * `pos.order.view_history`) — no separate query, no client-side "open"
 * inference. `useOpenOrderFeed` itself is unchanged and still backs
 * `/operations/open-orders`, whose own scope may legitimately be "All
 * branches"; this hook exists because Live Operations never may: like
 * `useKitchenQueue`/`useTableStatus`, `branchId === null` sends nothing.
 *
 * Polling and stale-branch protection follow `useTableStatus`'s own
 * pattern exactly (branch-tagged results, in-flight guard, torn down on
 * unmount/branch change) rather than `useOpenOrderFeed`'s plain
 * `useAsync`, because a cockpit that polls needs the same "never show the
 * previous branch's numbers" guarantee Table Status already proved.
 */
export function useBranchOpenOrders(branchId: Id | null): BranchOpenOrdersFeed {
  const live = DATA_MODE === "http";
  const { state, ready: deviceReady } = useLive();

  const [result, setResult] = useState<BranchOpenOrdersResult | null>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!live || !branchId) return;
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const rows = await fetchAllOpenOrders(branchId);
        if (!cancelled) setResult({ branchId, rows, error: null });
      } catch (caught) {
        if (!cancelled) {
          setResult({
            branchId,
            rows: null,
            error: caught instanceof Error ? caught : new Error(String(caught)),
          });
        }
      } finally {
        inFlight = false;
      }
    };

    loadRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), LIVE_OPEN_ORDERS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (loadRef.current === load) loadRef.current = null;
    };
  }, [live, branchId]);

  const reload = useCallback(() => {
    void loadRef.current?.();
  }, []);

  const local = useMemo<Order[] | null>(() => {
    if (live) return null;
    const branch = branchId ?? state.branchId;
    if (!branch) return null;
    return state.orderIds
      .map((id) => state.orders[id]!)
      .filter((order) => order && order.branchId === branch && OPEN_ORDER_STATES.includes(order.state));
  }, [live, branchId, state.orderIds, state.orders, state.branchId]);

  if (!live) {
    return { rows: local, ready: deviceReady, error: null, live: false, reload: () => {} };
  }

  const current = result && result.branchId === branchId ? result : null;
  return {
    rows: current?.rows ?? null,
    ready: current !== null,
    error: current?.error ?? null,
    live: true,
    reload,
  };
}

/**
 * SRS §7.4.3 — the append-only stock ledger.
 *
 * The endpoint is addressable per item only — `GET /inventory/items/{id}/movements`
 * — there is no index across every item. `itemId` undefined is not "no
 * filter"; in live mode it means nothing has been asked for yet, so this
 * does not call the backend at all rather than firing a request the service
 * layer would answer with an empty page anyway.
 */
export function useMovementFeed(scope?: Scope, itemId?: string): Feed<StockMovement> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<StockMovement[]>(
    async () =>
      live && itemId
        ? (await services.inventory.movements.list({ scope, limit: FEED_LIMIT, filters: { itemId } }))
            .rows
        : [],
    [live, key, itemId],
  );

  return fromRemote(remote, live, state.movements, ready);
}

/** SRS §11.7 — waste, staff meals and the rest of what leaves without a sale. */
export function useWasteFeed(scope?: Scope): Feed<WasteRecord> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<WasteRecord[]>(
    async () =>
      live ? (await services.inventory.waste.list({ scope, limit: FEED_LIMIT })).rows : [],
    [live, key],
  );

  return fromRemote(remote, live, state.waste, ready);
}

/**
 * SRS ch.20 — the tamper-evident audit trail.
 *
 * `GET /governance/audit/entries` (FR-AUD-008) exists now, so this reads one
 * page from it in live mode rather than the local reducer, which only ever
 * saw what *this device* did. `governance.audit.list` reads one bounded
 * page — the audit screen has no cursor UI yet, so walking `nextCursor`
 * would fetch rows nothing renders.
 */
export function useAuditFeed(scope?: Scope): Feed<AuditEntry> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<AuditEntry[]>(
    async () =>
      live ? (await services.governance.audit.list({ scope, limit: FEED_LIMIT })).rows : [],
    [live, key],
  );

  return fromRemote(remote, live, state.audit, ready);
}

/** How often the Dashboard Kitchen Queue re-polls — an operational screen, not a terminal; 5s (the KDS terminal's own interval) would hammer Render for no benefit a manager needs. */
const KITCHEN_QUEUE_POLL_MS = 15_000;

export interface KitchenQueueFeed {
  ready: boolean;
  error: ServiceError | Error | null;
  live: boolean;
  reload: () => void;
  /** Null until a concrete branch is selected, or before the first load settles. */
  snapshot: KitchenQueueSnapshot | null;
}

/**
 * KITCHEN-QUEUE-MANAGER-REAL-BACKEND-P0 — SRS ch.9's Dashboard read.
 *
 * `GET /kitchen/branches/{branchId}/queue` (`kitchen.queue.view`) is the
 * manager-safe twin of the KDS terminal's own `GET /kds/stations/{id}/queue`
 * — this is NOT that route, and does not fan out over stations trying to
 * pass a `kds.operate`/KDS-session check it was never going to pass (the
 * fan-out `services.operations.kitchenQueue` still exists, unchanged, for
 * `lib/console/reports/engine.ts`'s own analytics use — this hook does not
 * call it).
 *
 * Requires a CONCRETE branch — `branchId === null` (the "All branches"
 * scope) returns `snapshot: null` without ever sending a request, exactly
 * like the "no station chosen yet" case on the KDS terminal: a kitchen queue
 * is one branch's queue, and silently picking one, or merging several,
 * would show a manager tickets that are not where they think they are.
 *
 * Polling mirrors `kds-live.tsx`'s own pattern (`useAsync` + `setInterval`
 * calling its stable `reload`, torn down on unmount/branch change) — no
 * mutation ever runs from this screen, so there is no in-flight action to
 * pause the interval for.
 */
export function useKitchenQueue(branchId: Id | null, scope?: Scope): KitchenQueueFeed {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();

  const remote = useAsync<KitchenQueueSnapshot | null>(
    async () => (live && branchId ? services.kitchen.branchQueue(branchId) : null),
    [live, branchId],
  );

  const reload = remote.reload;
  useEffect(() => {
    if (!live || !branchId) return;
    const timer = window.setInterval(reload, KITCHEN_QUEUE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, branchId, reload]);

  const stations = useStations(scope);
  const local = useMemo<KitchenQueueSnapshot | null>(() => {
    if (live) return null;
    const branch = branchId ?? state.branchId;
    if (!branch) return null;

    const tickets = state.ticketIds
      .map((id) => state.tickets[id]!)
      .filter((ticket) => ticket && ticket.branchId === branch);

    const byStation = new Map<Id, KitchenQueueTicket[]>();
    for (const ticket of tickets) {
      const delayed = ticket.urgency === "exceeded" || ticket.urgency === "critical";
      const bucket = byStation.get(ticket.stationId);
      const row = { ...ticket, delayed };
      if (bucket) bucket.push(row);
      else byStation.set(ticket.stationId, [row]);
    }

    const stationRows: KitchenQueueStation[] = stations
      .filter((station) => station.branchId === branch)
      .map((station) => {
        const stationTickets = byStation.get(station.id) ?? [];
        return {
          stationId: station.id,
          stationName: station.name,
          colour: station.colour,
          queueDepth: stationTickets.length,
          tickets: stationTickets,
        };
      });

    const active = [...byStation.values()].flat();
    return {
      branchId: branch,
      dataAsOf: new Date().toISOString(),
      stations: stationRows,
      totalActiveTickets: active.length,
      averageWaitSeconds:
        active.length === 0
          ? null
          : Math.round(active.reduce((sum, t) => sum + t.elapsedSeconds, 0) / active.length),
    };
  }, [live, branchId, state.branchId, state.ticketIds, state.tickets, stations]);

  if (!live) {
    return { snapshot: local, ready, error: null, live: false, reload: () => {} };
  }
  return {
    snapshot: remote.data ?? null,
    ready: !remote.loading || remote.data !== null,
    error: remote.error,
    live: true,
    reload,
  };
}

/** How often Table Status re-polls — the same cadence as the Kitchen Queue. */
const TABLE_STATUS_POLL_MS = 15_000;

export interface TableStatusFeed {
  /** True once THIS branch's first response (rows or error) has settled. */
  ready: boolean;
  error: ServiceError | Error | null;
  live: boolean;
  reload: () => void;
  /** Null until a concrete branch is selected and its own first load settles, and whenever the last read failed. */
  rows: TableStatusRow[] | null;
}

type TableStatusResult =
  | { branchId: Id; rows: TableStatusRow[]; error: null }
  | { branchId: Id; rows: null; error: ServiceError | Error };

/**
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — the Dashboard's live table occupancy.
 *
 * `GET /orders/tables/status?branchId=` (`pos.order.view_history`) is the
 * ONLY source in live (`http`) mode — occupancy is the backend's derived
 * truth, never inferred from orders here, never the Organisation table
 * records (`/org/branches/{id}/tables`), never the POS terminal's own list.
 * One request per read; no per-table follow-up.
 *
 * Requires a CONCRETE branch: `branchId === null` ("All branches") sends
 * nothing — same rule as the Kitchen Queue, and for the same reason.
 *
 * Unlike `useKitchenQueue` (which sits on `useAsync`, whose `data` survives a
 * dependency change), every result here is TAGGED with the branch it was read
 * for and ignored unless it matches the branch now selected: switching
 * branches shows a loading state, never the previous branch's tables, and a
 * previous branch's error never lingers on the new one.
 *
 * Polling: one immediate read, then every `TABLE_STATUS_POLL_MS`. A read
 * that is still in flight when the next tick fires is skipped rather than
 * stacked (per-effect flag, so a branch change is never blocked by the old
 * branch's slow request), and both the timer and any late response are torn
 * down with the effect. A failed read replaces the rows with the error — a
 * failure is never rendered as an empty or all-available floor — and the next
 * successful tick clears it.
 *
 * In demo mode (no server) it maps the device's own simulated floor to the
 * same shape, and the page's `LiveNotice` says so.
 */
export function useTableStatus(branchId: Id | null): TableStatusFeed {
  const live = DATA_MODE === "http";
  const { state, ready: deviceReady } = useLive();

  const [result, setResult] = useState<TableStatusResult | null>(null);
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!live || !branchId) return;
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const rows = await services.sales.tableStatus(branchId);
        if (!cancelled) setResult({ branchId, rows, error: null });
      } catch (caught) {
        if (!cancelled) {
          setResult({
            branchId,
            rows: null,
            error: caught instanceof Error ? caught : new Error(String(caught)),
          });
        }
      } finally {
        inFlight = false;
      }
    };

    loadRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), TABLE_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (loadRef.current === load) loadRef.current = null;
    };
  }, [live, branchId]);

  const reload = useCallback(() => {
    void loadRef.current?.();
  }, []);

  const local = useMemo<TableStatusRow[] | null>(() => {
    if (live) return null;
    const branch = branchId ?? state.branchId;
    if (!branch) return null;
    return tablesOf(state)
      .filter((table) => table.branchId === branch)
      .map((table) => {
        const order = table.orderId ? state.orders[table.orderId] : undefined;
        // The demo floor has richer states; the Dashboard only ever shows the
        // three the backend actually models.
        const occupied = table.state !== "available" && table.state !== "needs_cleaning";
        return {
          id: table.id,
          label: table.label,
          section: table.area.en,
          seatCapacity: table.capacity,
          occupancy: occupied ? ("occupied" as const) : ("available" as const),
          activeOrder:
            occupied && order
              ? {
                  id: order.id,
                  businessDay: order.businessDay,
                  orderNumber: order.orderNumber,
                  state: order.state,
                  version: order.version ?? 0,
                }
              : null,
          conflictingOrders: [],
        };
      });
  }, [live, branchId, state]);

  if (!live) {
    return { rows: local, ready: deviceReady, error: null, live: false, reload: () => {} };
  }

  const current = result && result.branchId === branchId ? result : null;
  return {
    rows: current?.rows ?? null,
    ready: current !== null,
    error: current?.error ?? null,
    live: true,
    reload,
  };
}

/**
 * Whether a screen's data can come from the backend at all.
 *
 * Used by the pages the backend does not serve, so their banner can name the
 * gap instead of promising a link. Deliberately a function of `DATA_MODE`
 * alone: in demo mode every one of these screens is genuinely device-fed.
 */
export function useDeviceOnly(): boolean {
  return DATA_MODE === "http";
}
