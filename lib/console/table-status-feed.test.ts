import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/*
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — `useTableStatus` (`lib/console/feeds.ts`).
 *
 * Page-level rendering is covered separately by
 * `app/(console)/operations/table-status/page.test.tsx`; this proves the
 * hook's own contract:
 *
 *   - the ONLY live source is `services.sales.tableStatus(branchId)`, called
 *     immediately, and never the device store;
 *   - `branchId === null` ("All branches") sends nothing;
 *   - it re-polls every 15s (the Kitchen Queue's cadence), never stacks a
 *     request on top of one still in flight, and leaves NO timer behind on
 *     unmount or branch change;
 *   - switching branch never shows the previous branch's rows or error, and a
 *     late response for the previous branch is ignored;
 *   - a failure yields `rows: null` + the error — never an empty or
 *     all-available list — and the next good poll recovers.
 *
 * `vi.useFakeTimers()` is in effect throughout, so microtasks are flushed with
 * `act(async () => { await Promise.resolve() })` (not `waitFor`).
 */

const tableStatusMock = vi.fn();
// Live mode never reads the device store; this only proves it is not surfaced.
const liveState = { branchId: "branch-1", orders: {} };

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
    sales: { tableStatus: (...args: unknown[]) => tableStatusMock(...args) },
    operations: { stations: vi.fn().mockResolvedValue({ rows: [], total: 0 }) },
  },
}));

vi.mock("./live/store", () => ({
  useLive: () => ({ state: liveState, ready: true }),
}));

import { ServiceError } from "./services";
import { useTableStatus } from "./feeds";

const row = (id: string, label: string, occupancy = "available") => ({
  id,
  label,
  section: null,
  seatCapacity: 4,
  occupancy,
  activeOrder: null,
  conflictingOrders: [],
});
const BRANCH_1_ROWS = [row("b1-t1", "1"), row("b1-t2", "2", "occupied")];
const BRANCH_2_ROWS = [row("b2-t1", "A")];

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function tick(ms = 15_000) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  tableStatusMock.mockReset();
  tableStatusMock.mockImplementation(async (branchId: string) =>
    branchId === "branch-2" ? BRANCH_2_ROWS : BRANCH_1_ROWS,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useTableStatus — source and branch", () => {
  it("fetches immediately with the given branch, and exposes the backend's rows untouched", async () => {
    const { result } = renderHook(() => useTableStatus("branch-1"));
    await flush();

    expect(tableStatusMock).toHaveBeenCalledTimes(1);
    expect(tableStatusMock).toHaveBeenCalledWith("branch-1");
    expect(result.current.rows).toEqual(BRANCH_1_ROWS);
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.live).toBe(true);
  });

  it("is not ready (rows null) until the first response arrives — no premature empty/all-available floor", async () => {
    tableStatusMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTableStatus("branch-1"));
    await flush();

    expect(result.current.ready).toBe(false);
    expect(result.current.rows).toBeNull();
  });

  it("branchId null ('All branches') sends NOTHING and returns no rows", async () => {
    const { result } = renderHook(() => useTableStatus(null));
    await flush();
    await tick(60_000);

    expect(tableStatusMock).not.toHaveBeenCalled();
    expect(result.current.rows).toBeNull();
  });
});

describe("useTableStatus — polling", () => {
  it("re-fetches every 15s and leaves no timer behind on unmount", async () => {
    const { unmount } = renderHook(() => useTableStatus("branch-1"));
    await flush();
    expect(tableStatusMock).toHaveBeenCalledTimes(1);

    await tick();
    expect(tableStatusMock).toHaveBeenCalledTimes(2);
    await tick();
    expect(tableStatusMock).toHaveBeenCalledTimes(3);

    unmount();
    const atUnmount = tableStatusMock.mock.calls.length;
    await tick(120_000);
    expect(tableStatusMock.mock.calls.length).toBe(atUnmount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never stacks a request on one still in flight — a slow read makes the next tick a no-op, then polling resumes", async () => {
    let finish!: (rows: unknown) => void;
    tableStatusMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderHook(() => useTableStatus("branch-1"));
    await flush();
    expect(tableStatusMock).toHaveBeenCalledTimes(1);

    // Two full intervals pass while the first read is still open: no overlap.
    await tick();
    await tick();
    expect(tableStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => finish(BRANCH_1_ROWS));
    await flush();
    await tick();
    expect(tableStatusMock).toHaveBeenCalledTimes(2);
  });

  it("applies fresh data from a later poll", async () => {
    const { result } = renderHook(() => useTableStatus("branch-1"));
    await flush();
    tableStatusMock.mockResolvedValue([row("b1-t1", "1", "occupied")]);

    await tick();

    expect(result.current.rows?.[0].occupancy).toBe("occupied");
  });
});

describe("useTableStatus — branch change (stale-data protection)", () => {
  it("shows NO rows for the new branch until ITS response arrives, then fetches the new branch and stops polling the old one", async () => {
    const { result, rerender } = renderHook(({ branch }) => useTableStatus(branch), {
      initialProps: { branch: "branch-1" as string | null },
    });
    await flush();
    expect(result.current.rows).toEqual(BRANCH_1_ROWS);

    // Branch 2's first response is held open.
    let finish2!: (rows: unknown) => void;
    tableStatusMock.mockReturnValueOnce(new Promise((resolve) => (finish2 = resolve)));
    rerender({ branch: "branch-2" });
    await flush();

    // The very render for branch 2 already hides branch 1's tables.
    expect(result.current.rows).toBeNull();
    expect(result.current.ready).toBe(false);
    expect(tableStatusMock).toHaveBeenLastCalledWith("branch-2");

    await act(async () => finish2(BRANCH_2_ROWS));
    await flush();
    expect(result.current.rows).toEqual(BRANCH_2_ROWS);

    // Only branch 2 is polled now: exactly one call per tick, with branch 2.
    tableStatusMock.mockClear();
    await tick();
    expect(tableStatusMock).toHaveBeenCalledTimes(1);
    expect(tableStatusMock).toHaveBeenCalledWith("branch-2");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a slow response for the PREVIOUS branch that lands after the switch is ignored", async () => {
    let finish1!: (rows: unknown) => void;
    tableStatusMock.mockReturnValueOnce(new Promise((resolve) => (finish1 = resolve)));
    const { result, rerender } = renderHook(({ branch }) => useTableStatus(branch), {
      initialProps: { branch: "branch-1" as string | null },
    });
    await flush();

    rerender({ branch: "branch-2" });
    await flush();
    expect(result.current.rows).toEqual(BRANCH_2_ROWS);

    await act(async () => finish1(BRANCH_1_ROWS));
    await flush();

    expect(result.current.rows).toEqual(BRANCH_2_ROWS);
  });

  it("a previous branch's error does not linger on the new branch", async () => {
    tableStatusMock.mockRejectedValueOnce(new ServiceError("FORBIDDEN", "no", 403));
    const { result, rerender } = renderHook(({ branch }) => useTableStatus(branch), {
      initialProps: { branch: "branch-1" as string | null },
    });
    await flush();
    expect(result.current.error).toMatchObject({ status: 403 });

    tableStatusMock.mockReturnValueOnce(new Promise(() => {}));
    rerender({ branch: "branch-2" });

    expect(result.current.error).toBeNull();
    expect(result.current.rows).toBeNull();
  });
});

describe("useTableStatus — failure is never rendered as 'all available'", () => {
  it.each([
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [0, "NETWORK_UNREACHABLE"],
  ])("a %i gives rows null + the error (no stale list, no empty list), and the next good poll recovers", async (status, code) => {
    tableStatusMock.mockRejectedValueOnce(new ServiceError(code, "refused", status));
    const { result } = renderHook(() => useTableStatus("branch-1"));
    await flush();

    expect(result.current.rows).toBeNull();
    expect(result.current.error).toMatchObject({ status, code });
    expect(result.current.ready).toBe(true);

    await tick();
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toEqual(BRANCH_1_ROWS);
  });

  it("a failed poll REPLACES the previously good rows with the error (no stale tables shown as current)", async () => {
    const { result } = renderHook(() => useTableStatus("branch-1"));
    await flush();
    expect(result.current.rows).toEqual(BRANCH_1_ROWS);

    tableStatusMock.mockRejectedValueOnce(new ServiceError("NETWORK_UNREACHABLE", "down", 0));
    await tick();

    expect(result.current.rows).toBeNull();
    expect(result.current.error).toMatchObject({ status: 0 });
  });

  it("reload() (Retry) re-reads immediately", async () => {
    tableStatusMock.mockRejectedValueOnce(new ServiceError("NETWORK_UNREACHABLE", "down", 0));
    const { result } = renderHook(() => useTableStatus("branch-1"));
    await flush();
    expect(result.current.error).not.toBeNull();

    await act(async () => result.current.reload());
    await flush();

    expect(tableStatusMock).toHaveBeenCalledTimes(2);
    expect(result.current.rows).toEqual(BRANCH_1_ROWS);
  });
});
