import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * KITCHEN-QUEUE-MANAGER-REAL-BACKEND-P0 — `useKitchenQueue` (`lib/console/
 * feeds.ts`).
 *
 * Proves, at the hook level (page-level rendering is covered separately by
 * `app/(console)/operations/kitchen/page.test.tsx`):
 *
 *  14. In live (`http`) mode, the ONLY data source is
 *      `services.kitchen.branchQueue` — never the local/device ticket store
 *      (`useLive`'s `state.tickets`), which is asserted UNTOUCHED (populated
 *      with tickets the hook must never surface while live).
 *  16. `branchId === null` ("All branches") never calls the service at all —
 *      no fan-out, no accidental cross-branch merge.
 *  22. Polling re-calls the service on an interval and is torn down on
 *      unmount (no leaked timer); a stale, slow response is never applied
 *      over a newer, already-settled one (`useAsync`'s own `requestId`
 *      guard, exercised here through the public hook).
 *
 * `vi.useFakeTimers()` is in effect for every test, so this file flushes
 * pending microtasks with `await act(async () => { await Promise.resolve() })`
 * rather than `@testing-library/react`'s `waitFor` — `waitFor` polls on a
 * REAL timer internally, which never fires once fake timers are installed.
 */

const branchQueueMock = vi.fn();
const stationsMock = vi.fn();

vi.mock("@/lib/api/config", () => ({ DATA_MODE: "http" }));

vi.mock("./services", () => ({
  ServiceError: class ServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  services: {
    kitchen: { branchQueue: (...args: unknown[]) => branchQueueMock(...args) },
    operations: { stations: (...args: unknown[]) => stationsMock(...args) },
  },
}));

const DEVICE_TICKET = {
  id: "device-ticket-1",
  branchId: "branch-1",
  stationId: "station-1",
};

vi.mock("./live/store", () => ({
  useLive: () => ({
    state: { ticketIds: ["device-ticket-1"], tickets: { "device-ticket-1": DEVICE_TICKET }, branchId: "branch-1" },
    ready: true,
  }),
}));

import { useKitchenQueue } from "./feeds";

const SNAPSHOT = {
  branchId: "branch-1",
  dataAsOf: "2026-09-20T12:00:00.000Z",
  stations: [
    {
      stationId: "station-1",
      stationName: "Grill",
      displayColour: null,
      queueDepth: 1,
      tickets: [
        {
          id: "t1",
          stationId: "station-1",
          orderId: "o1",
          businessDay: "2026-09-20",
          orderNumber: "ORD-1",
          orderType: "dine_in",
          serviceReference: "Table 1",
          routedAt: "2026-09-20T11:59:00.000Z",
          elapsedSeconds: 60,
          targetReadyAt: null,
          status: "queued",
          firstViewedAt: null,
          startedAt: null,
          readyAt: null,
          bumpedAt: null,
          recalledAt: null,
          recallCount: 0,
          delayed: false,
          lines: [],
        },
      ],
    },
  ],
  totalActiveTickets: 1,
  averageWaitSeconds: 60,
};

/** Flush pending microtasks (promise resolutions) without touching fake timers. */
async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  branchQueueMock.mockReset();
  stationsMock.mockReset();
  branchQueueMock.mockResolvedValue(SNAPSHOT);
  stationsMock.mockResolvedValue({ rows: [], total: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useKitchenQueue — live mode data source (14)", () => {
  it("calls services.kitchen.branchQueue with the given branch, never the local device ticket store", async () => {
    const { result } = renderHook(() => useKitchenQueue("branch-1"));
    await flush();

    expect(branchQueueMock).toHaveBeenCalledWith("branch-1");
    expect(result.current.snapshot).toEqual(SNAPSHOT);
    expect(result.current.live).toBe(true);

    // The device fixture ticket must never appear — this is the real branch
    // queue's own snapshot, not a client-side merge with local state.
    const allTicketIds = result.current.snapshot!.stations.flatMap((s) => s.tickets.map((t) => t.id));
    expect(allTicketIds).not.toContain(DEVICE_TICKET.id);
  });
});

describe("useKitchenQueue — no branch selected (16)", () => {
  it("branchId null never calls the service and returns a null snapshot", async () => {
    const { result } = renderHook(() => useKitchenQueue(null));
    await flush();

    expect(branchQueueMock).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });
});

describe("useKitchenQueue — polling (22)", () => {
  it("re-fetches on an interval, and stops entirely on unmount (no leaked timer)", async () => {
    const { result, unmount } = renderHook(() => useKitchenQueue("branch-1"));
    await flush();
    expect(branchQueueMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(branchQueueMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(branchQueueMock).toHaveBeenCalledTimes(3);
    expect(result.current.snapshot).toEqual(SNAPSHOT);

    unmount();

    const callsAtUnmount = branchQueueMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    await flush();
    expect(branchQueueMock.mock.calls.length).toBe(callsAtUnmount);
  });

  it("never applies a stale response that resolves after a later request has already settled", async () => {
    const { result } = renderHook(() => useKitchenQueue("branch-1"));
    await flush();
    expect(branchQueueMock).toHaveBeenCalledTimes(1);

    // The FIRST poll tick's request is held open (slow network)...
    let resolveStale!: (value: typeof SNAPSHOT) => void;
    branchQueueMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStale = resolve;
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(branchQueueMock).toHaveBeenCalledTimes(2);

    // ...while the SECOND poll tick's request resolves first, with fresh data.
    const fresh = { ...SNAPSHOT, totalActiveTickets: 7 };
    branchQueueMock.mockResolvedValueOnce(fresh);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(result.current.snapshot?.totalActiveTickets).toBe(7);

    // The stale first request now resolves — it must be ignored, not
    // overwrite the newer, already-applied result.
    await act(async () => {
      resolveStale(SNAPSHOT);
    });
    await flush();
    expect(result.current.snapshot?.totalActiveTickets).toBe(7);
  });
});
