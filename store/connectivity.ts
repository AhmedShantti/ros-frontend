"use client";

/**
 * Connectivity and the outbound queue.
 *
 * A till in a Cairo basement loses its uplink several times a service. The
 * rule the whole design follows: **losing the network never blocks a sale.**
 * Writes are appended to a local queue and acknowledged immediately; the
 * queue drains when the link returns. The cashier sees a count, not a modal.
 *
 * The six states in the UI are the six a real terminal actually passes
 * through, and they are distinguishable without colour — each carries its own
 * icon and its own label.
 *
 *   online     link healthy, queue empty
 *   degraded   round-trips slow enough to matter; still writing through
 *   offline    no link; everything queues
 *   syncing    link returned, queue draining
 *   conflict   the server rejected a queued write; needs a human
 *   synced     transient, shown for a beat after the queue empties
 */

import { useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ConnectivityState =
  | "online"
  | "degraded"
  | "offline"
  | "syncing"
  | "conflict"
  | "synced";

export type QueuedKind =
  | "order"
  | "payment"
  | "void"
  | "discount"
  | "shift"
  | "cash_movement"
  | "kds_bump"
  | "waste"
  | "count";

export type QueuedStatus = "pending" | "sending" | "conflict" | "failed";

export interface QueuedWrite {
  /**
   * The order id itself for `kind: "order"` — not a generated queue id. That
   * is what makes a retry idempotent: enqueueing the same order twice finds
   * the existing entry instead of appending a duplicate.
   */
  id: string;
  kind: QueuedKind;
  /** Shown verbatim in the sync drawer — "Order #1043 · 3 items · EGP 285". */
  label: string;
  /** The real record to replay against the server once the link returns. */
  payload?: unknown;
  createdAt: number;
  attempts: number;
  status: QueuedStatus;
  /** Populated when `status` is `conflict`; explains what the server said. */
  conflictReason?: string;
}

interface ConnectivityStore {
  state: ConnectivityState;
  queue: QueuedWrite[];
  /** False until the persisted queue has been read back on the client. */
  hydrated: boolean;
  lastSyncedAt: number | null;
  /** Set by the dev tools; when true the queue never drains on its own. */
  simulated: boolean;

  setState: (state: ConnectivityState) => void;
  simulate: (state: ConnectivityState) => void;
  enqueue: (kind: QueuedKind, label: string, opts?: { id?: string; payload?: unknown }) => string;
  drain: () => void;
  retry: (id: string) => void;
  resolveConflict: (id: string, keep: "local" | "server") => void;
  clearQueue: () => void;
  markHydrated: () => void;
}

/** Monotonic within a tab; the server assigns the real id on acceptance. */
let counter = 0;
const localId = () => `q_${(counter += 1)}_${Math.round(performance.now())}`;

export const useConnectivityStore = create<ConnectivityStore>()(
  persist(
    (set, get) => ({
      state: "online",
      queue: [],
      hydrated: false,
      lastSyncedAt: null,
      simulated: false,

      setState: (state) => set({ state }),

      simulate: (state) =>
        set({
          state,
          simulated: state === "offline" || state === "degraded" || state === "conflict",
        }),

      enqueue: (kind, label, opts) => {
        const id = opts?.id ?? localId();
        const existing = get().queue.find((q) => q.id === id);
        // Idempotent on retry: an order already queued (and not previously
        // failed) is not queued a second time — that is what stops a flaky
        // reconnect from posting the same sale twice.
        if (existing && existing.status !== "failed") return id;

        set((s) => ({
          queue: existing
            ? s.queue.map((q) =>
                q.id === id
                  ? { ...q, label, payload: opts?.payload ?? q.payload, status: "pending" as const }
                  : q,
              )
            : [
                ...s.queue,
                {
                  id,
                  kind,
                  label,
                  payload: opts?.payload,
                  createdAt: Date.now(),
                  attempts: 0,
                  status: "pending" as const,
                },
              ],
          // Queueing while online means the link just went; reflect it rather
          // than pretending the write went through.
          state: s.state === "online" || s.state === "synced" ? "syncing" : s.state,
        }));
        return id;
      },

      drain: () => {
        const { queue, simulated } = get();
        if (simulated || queue.length === 0) return;

        set({ state: "syncing", queue: queue.map((q) => ({ ...q, status: "sending" })) });

        // Stands in for the round-trip. A real client would post the batch and
        // reconcile each entry against the response. Each entry resolves on
        // its own rather than as one all-or-nothing batch, so one bad write
        // cannot block every other queued sale behind it.
        window.setTimeout(() => {
          set((s) => ({
            queue: s.queue
              .map((q) =>
                // A ~6% failure rate is enough to exercise "Sync Failed" in a
                // demo without making every session hit it.
                q.status === "sending" && Math.random() < 0.06
                  ? { ...q, status: "failed" as const, attempts: q.attempts + 1 }
                  : q,
              )
              .filter((q) => q.status === "failed"),
            state: "synced",
            lastSyncedAt: Date.now(),
          }));
          window.setTimeout(() => {
            const { queue: after } = get();
            if (after.every((q) => q.status === "failed")) {
              set({ state: after.length > 0 ? "conflict" : "online" });
            }
          }, 2200);
        }, 900);
      },

      retry: (id) =>
        set((s) => ({
          queue: s.queue.map((q) =>
            q.id === id
              ? { ...q, attempts: q.attempts + 1, status: "pending", conflictReason: undefined }
              : q,
          ),
        })),

      resolveConflict: (id, keep) =>
        set((s) => {
          // Keeping the server's version discards the local write; keeping the
          // local one re-queues it as a fresh attempt. Either way the entry
          // leaves the conflict state, because an unresolved conflict blocks
          // the rest of the queue behind it.
          if (keep === "server") {
            return { queue: s.queue.filter((q) => q.id !== id) };
          }
          return {
            queue: s.queue.map((q) =>
              q.id === id
                ? { ...q, status: "pending", attempts: q.attempts + 1, conflictReason: undefined }
                : q,
            ),
            state: s.queue.some((q) => q.id !== id && q.status === "conflict")
              ? "conflict"
              : "syncing",
          };
        }),

      clearQueue: () => set({ queue: [], state: "online", lastSyncedAt: Date.now() }),

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "ros.connectivity",
      storage: createJSONStorage(() => localStorage),
      // The queue survives a reload — that is the entire point of it. The
      // connectivity state does not: a fresh tab should re-detect the link
      // rather than inherit yesterday's "offline".
      partialize: (s) => ({ queue: s.queue, lastSyncedAt: s.lastSyncedAt }),
      version: 1,
      onRehydrateStorage: () => (store) => store?.markHydrated(),
    },
  ),
);

/** Pending-sync count for the terminal badge. */
export const pendingCount = (s: ConnectivityStore) =>
  s.queue.filter((q) => q.status !== "conflict").length;

export const conflictCount = (s: ConnectivityStore) =>
  s.queue.filter((q) => q.status === "conflict").length;

/**
 * Keeps the store in step with the browser's own view of the link.
 *
 * Without this the store was never written to by anything, which is why the
 * terminal bar showed one hard-coded state forever. `navigator.onLine` is a
 * coarse signal — it reports the interface, not whether the API answers — but
 * it is the one the browser is certain about, and losing the interface is the
 * case the design cares about most.
 *
 * A simulated state set from the dev tools wins: someone demonstrating the
 * offline path should not have it corrected out from under them.
 */
export function useBrowserConnectivity(): void {
  const setState = useConnectivityStore((s) => s.setState);
  const drain = useConnectivityStore((s) => s.drain);

  useEffect(() => {
    const apply = () => {
      if (useConnectivityStore.getState().simulated) return;
      if (navigator.onLine) {
        // Coming back with work queued means draining, not "online" —
        // `drain()` moves it on and lands on online when the queue empties.
        if (useConnectivityStore.getState().queue.length > 0) drain();
        else setState("online");
      } else {
        setState("offline");
      }
    };

    apply();
    window.addEventListener("online", apply);
    window.addEventListener("offline", apply);
    return () => {
      window.removeEventListener("online", apply);
      window.removeEventListener("offline", apply);
    };
  }, [setState, drain]);
}
