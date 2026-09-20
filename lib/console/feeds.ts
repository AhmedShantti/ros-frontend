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

import { useMemo } from "react";

import { DATA_MODE } from "@/lib/api/config";
import { services } from "./services";
import { ServiceError } from "./services";
import type { Scope } from "./services/types";
import { useAsync } from "./hooks";
import { useLive } from "./live/store";
import type { AuditEntry, KitchenTicket, Order, StockMovement, WasteRecord } from "./types";

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
        .filter(
          (order) =>
            order &&
            ["draft", "open", "held", "parked", "partially_paid"].includes(order.state),
        ),
    [state.orderIds, state.orders],
  );

  return fromRemote(remote, live, local, ready);
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

/**
 * SRS ch.9 — the tickets on the station displays.
 *
 * `GET /kds/stations/{id}/queue` exists, but it is terminal-bound: a KDS
 * terminal is bound to one station, and *every* other caller — including
 * this console screen, regardless of scope or role — is refused on every
 * station, every time. That is not a fan-out worth attempting; it is a
 * deterministic contract mismatch, so this fails without ever sending the
 * request rather than polling an endpoint no console session can pass.
 *
 * The `TERMINAL_ONLY` code lets `KitchenPage` show that specifically,
 * rather than the generic retry-invites-more-of-the-same error panel.
 */
export function useKitchenFeed(scope?: Scope): Feed<KitchenTicket> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<KitchenTicket[]>(async () => {
    if (!live) return [];
    throw new ServiceError(
      "TERMINAL_ONLY",
      "The live kitchen queue can only be read from a KDS terminal.",
      403,
      "GET /kds/stations/{stationId}/queue requires a terminal-bound session; every console caller is refused on every station.",
    );
  }, [live, key]);

  const local = useMemo(
    () =>
      state.ticketIds
        .map((id) => state.tickets[id]!)
        .filter((ticket) => ticket && ticket.branchId === state.branchId),
    [state.ticketIds, state.tickets, state.branchId],
  );

  return fromRemote(remote, live, local, ready);
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
