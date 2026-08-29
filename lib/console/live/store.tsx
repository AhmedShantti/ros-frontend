"use client";

/**
 * The live store.
 *
 * There is no server in this build, so "the system" is this provider: a
 * reducer, localStorage for durability, and a `storage` listener so two tabs
 * on the same machine behave like two terminals on the same local network.
 * Open the POS in one tab and the KDS in another and they talk to each
 * other — which is the closest a frontend-only build can honestly get to
 * NFR-REL-003.
 *
 * Persistence is write-through: every accepted action lands in storage
 * before the next render, so closing the tab mid-order loses nothing
 * (NFR-REL-001).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Id, Order } from "../types";
import { liveReducer, type LiveAction } from "./reducer";
import {
  initialLiveState,
  LIVE_STATE_VERSION,
  LIVE_STORAGE_KEY,
  type LiveState,
} from "./state";
import { useConnectivityStore, type QueuedStatus } from "@/store/connectivity";

type RootAction = LiveAction | { type: "HYDRATE"; state: LiveState };

function rootReducer(state: LiveState, action: RootAction): LiveState {
  if (action.type === "HYDRATE") return action.state;
  return liveReducer(state, action);
}

/**
 * Actions carry their own timestamp; the provider fills it in on dispatch.
 *
 * The conditional is distributive on purpose. A plain `Omit<LiveAction, "at">`
 * would collapse the union into one object type and lose every discriminated
 * member, so `dispatch({type: "LINE_ADD", ...})` would stop typechecking.
 */
type WithOptionalAt<T> = T extends { at: string } ? Omit<T, "at"> & { at?: string } : T;

export type Dispatchable = WithOptionalAt<LiveAction>;

interface LiveValue {
  state: LiveState;
  dispatch: (action: Dispatchable) => void;
  /** False until localStorage has been read, so the UI can avoid flicker. */
  ready: boolean;
  activeOrder: Order | null;
  reset: () => void;
}

const LiveContext = createContext<LiveValue | null>(null);

function readStored(): LiveState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveState;
    // A schema change invalidates the drawer rather than corrupting it.
    if (parsed.version !== LIVE_STATE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Offline POS sync.
 *
 * A completed sale is never blocked by the network — it settles locally the
 * instant payment clears. This hook is what happens after: the moment a sale
 * lands while offline it is queued for the server, carrying the real order
 * so the queue can actually replay it later rather than just describing it.
 * The order id doubles as the queue's idempotency key, so a reconnect that
 * retries never re-submits the same sale twice.
 *
 * `openedAt` (when the sale actually happened) and `syncedAt` (when it
 * reached the server) are deliberately different fields — an order rung up
 * at 8:35pm during an outage and synced at 9:10pm keeps both times.
 */
function useOfflineOrderSync(state: LiveState, dispatch: (action: Dispatchable) => void): void {
  // A newly-completed order is resolved the instant it appears: synced right
  // away if the link is up, queued if it is not.
  useEffect(() => {
    const connectivity = useConnectivityStore.getState();
    const offline = connectivity.state === "offline" || connectivity.state === "degraded";

    for (const order of Object.values(state.orders)) {
      if (order.state !== "completed" || order.syncState !== "local") continue;

      if (offline) {
        const items = order.lines.filter((l) => l.state !== "voided").length;
        const major = (order.grandTotal.amount / 100).toFixed(2);
        dispatch({ type: "ORDER_SYNC", orderId: order.id, syncState: "pending" });
        connectivity.enqueue("order", `${order.orderNumber} · ${items} items · ${order.currency} ${major}`, {
          id: order.id,
          payload: order,
        });
      } else {
        dispatch({
          type: "ORDER_SYNC",
          orderId: order.id,
          syncState: "synced",
          syncedAt: order.completedAt ?? order.openedAt,
        });
      }
    }
  }, [state.orders, dispatch]);

  // The queue resolves independently, on its own timer. An order's entry
  // disappearing means it synced; landing on `failed` means it did not.
  const queue = useConnectivityStore((s) => s.queue);
  const lastSyncedAt = useConnectivityStore((s) => s.lastSyncedAt);
  const prevQueueRef = useRef<Map<string, QueuedStatus>>(new Map());

  useEffect(() => {
    const previous = prevQueueRef.current;
    const now = new Map(queue.map((q) => [q.id, q.status]));

    for (const [orderId, previousStatus] of previous) {
      if (state.orders[orderId]?.syncState !== "pending") continue;
      const currentStatus = now.get(orderId);

      if (currentStatus === undefined) {
        dispatch({
          type: "ORDER_SYNC",
          orderId,
          syncState: "synced",
          syncedAt: new Date(lastSyncedAt ?? Date.now()).toISOString(),
        });
      } else if (currentStatus === "failed" && previousStatus !== "failed") {
        dispatch({ type: "ORDER_SYNC", orderId, syncState: "conflicted" });
      }
    }

    prevQueueRef.current = now;
  }, [queue, lastSyncedAt, state.orders, dispatch]);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(rootReducer, undefined, () => initialLiveState());
  const [ready, setReady] = useState(false);
  // What this tab last wrote, so an echo of our own write is ignored.
  const lastSerialised = useRef<string | null>(null);

  // Rehydrate after mount. Doing it here rather than in the initialiser keeps
  // the server render and the first client render identical.
  useEffect(() => {
    const stored = readStored();
    if (stored) {
      lastSerialised.current = JSON.stringify(stored);
      rawDispatch({ type: "HYDRATE", state: stored });
    }
    setReady(true);
  }, []);

  // Write-through persistence.
  useEffect(() => {
    if (!ready) return;
    try {
      const serialised = JSON.stringify(state);
      if (serialised === lastSerialised.current) return;
      lastSerialised.current = serialised;
      window.localStorage.setItem(LIVE_STORAGE_KEY, serialised);
    } catch {
      // A full or blocked quota must never take the terminal down mid-service.
    }
  }, [state, ready]);

  // Another tab moved: adopt its state. This is what makes the KDS light up
  // a second after the POS fires a course.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== LIVE_STORAGE_KEY || !event.newValue) return;
      if (event.newValue === lastSerialised.current) return;
      try {
        const parsed = JSON.parse(event.newValue) as LiveState;
        if (parsed.version !== LIVE_STATE_VERSION) return;
        lastSerialised.current = event.newValue;
        rawDispatch({ type: "HYDRATE", state: parsed });
      } catch {
        // Ignore a half-written value; the next write will be complete.
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dispatch = useCallback((action: Dispatchable) => {
    rawDispatch({ ...action, at: action.at ?? new Date().toISOString() } as LiveAction);
  }, []);

  useOfflineOrderSync(state, dispatch);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(LIVE_STORAGE_KEY);
    } catch {
      // Nothing to do — the in-memory reset below is what matters.
    }
    lastSerialised.current = null;
    rawDispatch({ type: "RESET", at: new Date().toISOString() });
  }, []);

  const value = useMemo<LiveValue>(
    () => ({
      state,
      dispatch,
      ready,
      activeOrder: state.activeOrderId ? (state.orders[state.activeOrderId] ?? null) : null,
      reset,
    }),
    [state, dispatch, ready, reset],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside <LiveProvider>");
  return ctx;
}

/**
 * A ticking clock for elapsed timers.
 *
 * Returns 0 until mounted so the server render and the first client render
 * agree; after that it advances on the interval. Kitchen timers use it
 * rather than storing elapsed seconds in the reducer, which would write to
 * localStorage — and wake every other tab — once a second.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Elapsed seconds since an ISO timestamp, or null before the clock starts. */
export function elapsedSince(iso: string, now: number): number | null {
  if (!now) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
}

export function useLiveOrder(orderId: Id | null): Order | null {
  const { state } = useLive();
  return orderId ? (state.orders[orderId] ?? null) : null;
}
