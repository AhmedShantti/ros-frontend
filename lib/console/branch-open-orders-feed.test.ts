import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/*
 * LIVE-OPERATIONS-P0 — `useBranchOpenOrders` (`lib/console/feeds.ts`).
 *
 * Page-level rendering is covered separately by
 * `app/(console)/operations/live/page.test.tsx`; this proves the hook's own
 * contract:
 *
 *   - the ONLY live source is `services.sales.listOrderHistoryPage`, walked
 *     to exhaustion via the SAME `fetchAllOpenOrders` function
 *     `/operations/open-orders` runs — never a second, competing query;
 *   - `branchId === null` ("All branches") sends nothing;
 *   - it re-polls every 15s (Table Status's and the Kitchen Queue's own
 *     cadence), never stacks a request on one still in flight, and leaves NO
 *     timer behind on unmount or branch change;
 *   - switching branch never shows the previous branch's rows or error, and a
 *     late response for the previous branch is ignored;
 *   - a failure yields `rows: null` + the error — never an empty list, which
 *     would read as "zero open orders" — and the next good poll recovers.
 *
 * `vi.useFakeTimers()` is in effect throughout, so microtasks are flushed with
 * `act(async () => { await Promise.resolve() })` (not `waitFor`).
 */

const listOrderHistoryPageMock = vi.fn();
const liveState = { branchId: "branch-1", orderIds: [], orders: {} };

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
    sales: {
      listOrderHistoryPage: (...args: unknown[]) => listOrderHistoryPageMock(...args),
    },
  },
}));

vi.mock("./live/store", () => ({
  useLive: () => ({ state: liveState, ready: true }),
}));

import { ServiceError } from "./services";
import { useBranchOpenOrders } from "./feeds";

const order = (id: string, state = "open") => ({ id, orderNumber: `MAIN-${id}`, state });
const BRANCH_1_ORDERS = [order("1"), order("2", "partially_paid")];
const BRANCH_2_ORDERS = [order("a")];

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
  listOrderHistoryPageMock.mockReset();
  listOrderHistoryPageMock.mockImplementation(async ({ branchId }: { branchId?: string }) => ({
    orders: branchId === "branch-2" ? BRANCH_2_ORDERS : BRANCH_1_ORDERS,
    nextCursor: null,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useBranchOpenOrders — source and branch", () => {
  it("fetches immediately for the given branch via the canonical open-orders walk, state: 'open'", async () => {
    const { result } = renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();

    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(1);
    expect(listOrderHistoryPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: "branch-1", state: "open" }),
    );
    expect(result.current.rows).toEqual(BRANCH_1_ORDERS);
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.live).toBe(true);
  });

  it("is not ready (rows null) until the first response arrives — no premature zero count", async () => {
    listOrderHistoryPageMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();

    expect(result.current.ready).toBe(false);
    expect(result.current.rows).toBeNull();
  });

  it("branchId null ('All branches') sends NOTHING and returns no rows", async () => {
    const { result } = renderHook(() => useBranchOpenOrders(null));
    await flush();
    await tick(60_000);

    expect(listOrderHistoryPageMock).not.toHaveBeenCalled();
    expect(result.current.rows).toBeNull();
  });
});

describe("useBranchOpenOrders — polling", () => {
  it("re-fetches every 15s and leaves no timer behind on unmount", async () => {
    const { unmount } = renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(1);

    await tick();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(2);
    await tick();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(3);

    unmount();
    const atUnmount = listOrderHistoryPageMock.mock.calls.length;
    await tick(120_000);
    expect(listOrderHistoryPageMock.mock.calls.length).toBe(atUnmount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never stacks a request on one still in flight", async () => {
    let finish!: (value: unknown) => void;
    listOrderHistoryPageMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(1);

    await tick();
    await tick();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(1);

    await act(async () => finish({ orders: BRANCH_1_ORDERS, nextCursor: null }));
    await flush();
    await tick();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(2);
  });
});

describe("useBranchOpenOrders — branch change (stale-data protection)", () => {
  it("shows NO rows for the new branch until ITS response arrives, and stops polling the old branch", async () => {
    const { result, rerender } = renderHook(({ branch }) => useBranchOpenOrders(branch), {
      initialProps: { branch: "branch-1" as string | null },
    });
    await flush();
    expect(result.current.rows).toEqual(BRANCH_1_ORDERS);

    let finish2!: (value: unknown) => void;
    listOrderHistoryPageMock.mockReturnValueOnce(new Promise((resolve) => (finish2 = resolve)));
    rerender({ branch: "branch-2" });
    await flush();

    expect(result.current.rows).toBeNull();
    expect(result.current.ready).toBe(false);
    expect(listOrderHistoryPageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ branchId: "branch-2" }),
    );

    await act(async () => finish2({ orders: BRANCH_2_ORDERS, nextCursor: null }));
    await flush();
    expect(result.current.rows).toEqual(BRANCH_2_ORDERS);

    listOrderHistoryPageMock.mockClear();
    await tick();
    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(1);
    expect(listOrderHistoryPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: "branch-2" }),
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a slow response for the PREVIOUS branch that lands after the switch is ignored", async () => {
    let finish1!: (value: unknown) => void;
    listOrderHistoryPageMock.mockReturnValueOnce(new Promise((resolve) => (finish1 = resolve)));
    const { result, rerender } = renderHook(({ branch }) => useBranchOpenOrders(branch), {
      initialProps: { branch: "branch-1" as string | null },
    });
    await flush();

    rerender({ branch: "branch-2" });
    await flush();
    expect(result.current.rows).toEqual(BRANCH_2_ORDERS);

    await act(async () => finish1({ orders: BRANCH_1_ORDERS, nextCursor: null }));
    await flush();

    expect(result.current.rows).toEqual(BRANCH_2_ORDERS);
  });
});

describe("useBranchOpenOrders — failure is never rendered as zero open orders", () => {
  it.each([
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [0, "NETWORK_UNREACHABLE"],
  ])("a %i gives rows null + the error (never an empty/zero list), and the next good poll recovers", async (status, code) => {
    listOrderHistoryPageMock.mockRejectedValueOnce(new ServiceError(code, "refused", status));
    const { result } = renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();

    expect(result.current.rows).toBeNull();
    expect(result.current.error).toMatchObject({ status, code });
    expect(result.current.ready).toBe(true);

    await tick();
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toEqual(BRANCH_1_ORDERS);
  });

  it("a failed poll REPLACES previously good rows with the error (no stale count shown as current)", async () => {
    const { result } = renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();
    expect(result.current.rows).toEqual(BRANCH_1_ORDERS);

    listOrderHistoryPageMock.mockRejectedValueOnce(new ServiceError("NETWORK_UNREACHABLE", "down", 0));
    await tick();

    expect(result.current.rows).toBeNull();
    expect(result.current.error).toMatchObject({ status: 0 });
  });

  it("reload() re-reads immediately", async () => {
    listOrderHistoryPageMock.mockRejectedValueOnce(new ServiceError("NETWORK_UNREACHABLE", "down", 0));
    const { result } = renderHook(() => useBranchOpenOrders("branch-1"));
    await flush();
    expect(result.current.error).not.toBeNull();

    await act(async () => result.current.reload());
    await flush();

    expect(listOrderHistoryPageMock).toHaveBeenCalledTimes(2);
    expect(result.current.rows).toEqual(BRANCH_1_ORDERS);
  });
});
