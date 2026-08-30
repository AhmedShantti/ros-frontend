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
 * A screen whose domain the backend does not serve at all (the kitchen
 * display, tender summaries, the audit trail) is not listed here. Those keep
 * reading the device, and `LiveNotice` says so rather than implying a link
 * that does not exist.
 */

import { useMemo } from "react";

import { DATA_MODE } from "@/lib/api/config";
import { services } from "./services";
import type { ServiceError } from "./services";
import type { Scope } from "./services/types";
import { useAsync } from "./hooks";
import { useLive } from "./live/store";
import type { Order, StockMovement, WasteRecord } from "./types";

/** How many rows a device-facing screen asks the backend for. */
const FEED_LIMIT = 200;

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

/** SRS ch.8 — the order ledger. `GET /orders` is a real keyset cursor. */
export function useOrderFeed(scope?: Scope): Feed<Order> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<Order[]>(
    async () =>
      live ? (await services.sales.orders.list({ scope, limit: FEED_LIMIT })).rows : [],
    [live, key],
  );

  const local = useMemo(
    () => state.orderIds.map((id) => state.orders[id]!).filter(Boolean),
    [state.orderIds, state.orders],
  );

  return fromRemote(remote, live, local, ready);
}

/**
 * FR-POS-001 — what is still open.
 *
 * The backend has no "open orders" endpoint of its own; `operations.openOrders`
 * filters the order list by state, which is why this is a separate feed from
 * `useOrderFeed` rather than a filter over it.
 */
export function useOpenOrderFeed(scope?: Scope): Feed<Order> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<Order[]>(
    async () =>
      live ? (await services.operations.openOrders({ scope, limit: FEED_LIMIT })).rows : [],
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

/** SRS §7.4.3 — the append-only stock ledger. */
export function useMovementFeed(scope?: Scope): Feed<StockMovement> {
  const live = DATA_MODE === "http";
  const { state, ready } = useLive();
  const key = scopeKey(scope);

  const remote = useAsync<StockMovement[]>(
    async () =>
      live ? (await services.inventory.movements.list({ scope, limit: FEED_LIMIT })).rows : [],
    [live, key],
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
 * Whether a screen's data can come from the backend at all.
 *
 * Used by the pages the backend does not serve, so their banner can name the
 * gap instead of promising a link. Deliberately a function of `DATA_MODE`
 * alone: in demo mode every one of these screens is genuinely device-fed.
 */
export function useDeviceOnly(): boolean {
  return DATA_MODE === "http";
}
