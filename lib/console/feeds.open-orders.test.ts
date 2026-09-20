import { describe, expect, it, vi } from "vitest";

/*
 * ORDERS-HISTORY-LIMIT-CONTRACT-FIX-P0.
 *
 * `fetchAllOpenOrders` (the walk-to-exhaustion pagination `useOpenOrderFeed`
 * runs against `GET /orders/history?state=open`) — pulled out of the hook
 * so it is directly unit-testable, mocked only at the service-registry
 * boundary (`@/lib/console/services`), same pattern as `http.*.test.ts`
 * mocking `@/lib/api/endpoints` one layer down.
 *
 * Proves:
 *   - every single request this function ever issues carries limit <= 100
 *     (the backend's own `ListOrdersQueryDto` cap) and state: "open" —
 *     never the old client-side-filter shape;
 *   - a still-open order sitting behind more than one page of OTHER open
 *     orders is not lost — the walk continues until the server reports
 *     `nextCursor: null`, not after one page;
 *   - it never asks for a second page once the server reports none —
 *     the walk is real cursor pagination, not a fixed page count;
 *   - it does not run away: `MAX_OPEN_ORDER_PAGES` bounds a pathological
 *     server response that never stops offering a `nextCursor`.
 */

const { listOrderHistoryPage } = vi.hoisted(() => ({
  listOrderHistoryPage: vi.fn(),
}));

vi.mock("@/lib/console/services", () => ({
  services: {
    sales: {
      listOrderHistoryPage: (...args: unknown[]) => listOrderHistoryPage(...args),
    },
  },
}));

import { fetchAllOpenOrders } from "./feeds";
import type { Order } from "./types";

function wireOrder(id: string): Order {
  return {
    id,
    branchId: "branch-1",
    branchName: { en: "Branch" },
    orderNumber: `ORD-${id}`,
    businessDay: "2026-09-19",
    orderType: "takeaway",
    channel: "pos",
    state: "open",
    tableId: null,
    tableLabel: null,
    guestCount: null,
    openedBy: "user-1",
    openedByName: { en: "User" },
    terminalName: "Terminal 1",
    currency: "EGP",
    subtotal: { amount: 0, currency: "EGP" },
    discountTotal: { amount: 0, currency: "EGP" },
    serviceChargeTotal: { amount: 0, currency: "EGP" },
    taxTotal: { amount: 0, currency: "EGP" },
    roundingAdjustment: { amount: 0, currency: "EGP" },
    grandTotal: { amount: 1000, currency: "EGP" },
    paidTotal: { amount: 0, currency: "EGP" },
    tipTotal: { amount: 0, currency: "EGP" },
    cogsTotal: { amount: 0, currency: "EGP" },
    lines: [],
    payments: [],
    discounts: [],
    openedAt: "2026-09-19T10:00:00.000Z",
    firstFiredAt: null,
    completedAt: null,
    syncedAt: null,
    syncState: "synced",
    notes: null,
    version: 1,
  } as unknown as Order;
}

describe("fetchAllOpenOrders", () => {
  it("every page request carries limit <= 100 and state: 'open'", async () => {
    listOrderHistoryPage.mockResolvedValueOnce({
      orders: [wireOrder("a")],
      nextCursor: null,
    });

    await fetchAllOpenOrders("branch-1");

    expect(listOrderHistoryPage).toHaveBeenCalledTimes(1);
    const call = listOrderHistoryPage.mock.calls[0]![0] as {
      branchId?: string;
      state?: string;
      limit?: number;
    };
    expect(call.branchId).toBe("branch-1");
    expect(call.state).toBe("open");
    expect(call.limit).toBeLessThanOrEqual(100);
  });

  it("walks every page to real exhaustion — an open order on a later page is not lost", async () => {
    listOrderHistoryPage
      .mockResolvedValueOnce({
        orders: [wireOrder("page1-a"), wireOrder("page1-b")],
        nextCursor: { businessDay: "2026-09-19", id: "page1-b" },
      })
      .mockResolvedValueOnce({
        orders: [wireOrder("page2-a")],
        nextCursor: { businessDay: "2026-09-18", id: "page2-a" },
      })
      .mockResolvedValueOnce({
        orders: [wireOrder("page3-oldest-still-open")],
        nextCursor: null,
      });

    const rows = await fetchAllOpenOrders("branch-1");

    expect(listOrderHistoryPage).toHaveBeenCalledTimes(3);
    expect(rows.map((o) => o.id)).toEqual([
      "page1-a",
      "page1-b",
      "page2-a",
      "page3-oldest-still-open",
    ]);
    // Every request after the first carries the PRIOR page's own cursor —
    // proving real server-side keyset pagination, not a re-fetch of page 1.
    expect(
      (listOrderHistoryPage.mock.calls[1]![0] as { cursor: unknown }).cursor,
    ).toEqual({ businessDay: "2026-09-19", id: "page1-b" });
    expect(
      (listOrderHistoryPage.mock.calls[2]![0] as { cursor: unknown }).cursor,
    ).toEqual({ businessDay: "2026-09-18", id: "page2-a" });
  });

  it("stops at exactly one request once the server reports no further pages", async () => {
    listOrderHistoryPage.mockResolvedValueOnce({
      orders: [wireOrder("only")],
      nextCursor: null,
    });

    await fetchAllOpenOrders(undefined);

    expect(listOrderHistoryPage).toHaveBeenCalledTimes(1);
  });

  it("a pathological server that always returns a nextCursor is bounded, never an infinite loop", async () => {
    listOrderHistoryPage.mockImplementation(async () => ({
      orders: [wireOrder("x")],
      nextCursor: { businessDay: "2026-09-19", id: "x" },
    }));

    const rows = await fetchAllOpenOrders("branch-1");

    // Bounded by MAX_OPEN_ORDER_PAGES (50), never runs forever.
    expect(listOrderHistoryPage.mock.calls.length).toBeLessThanOrEqual(50);
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});
