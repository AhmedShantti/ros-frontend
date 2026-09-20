import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * ORDERS-MODULE-COMPREHENSIVE-P0 / ACCEPTANCE-CORRECTION-P0
 *
 * `services.sales.findOrderByReference` / `searchOrdersByNumber` /
 * `listOrderHistoryPage` against the real `http.ts` logic — mocked only at
 * the transport boundary (`@/lib/api/endpoints`), same pattern as
 * `http.open-orders.test.ts`. Proves:
 *   - exact Order Reference lookup maps the real wire shape correctly;
 *   - a 404 (order absent, another tenant's, or — per ACCEPTANCE-
 *     CORRECTION-P0 BLOCKER B — a real order outside the caller's
 *     authorized branch scope; the backend folds all three into the same
 *     404 now) becomes `null`, never a thrown error the caller has to
 *     specifically catch;
 *   - a 403 (the caller lacks `pos.order.view_history` entirely) is NOT
 *     swallowed — it propagates, because that is a genuine permission
 *     failure, not "not found";
 *   - Order Number search never assumes one match — every match the
 *     backend returns comes back mapped;
 *   - `listOrderHistoryPage` calls `GET /orders/history`
 *     (`pos.order.view_history`) — NEVER `GET /orders` (`pos.order.create`,
 *     `orders.list`'s own route, which the POS terminal's Resume/Open-
 *     Orders picker also calls) — and passes the real keyset cursor
 *     through both ways.
 */

const {
  salesByReference,
  salesSearch,
  salesList,
  salesHistory,
  listBranches,
  getAccessibleScope,
} = vi.hoisted(() => ({
  salesByReference: vi.fn(),
  salesSearch: vi.fn(),
  salesList: vi.fn(),
  salesHistory: vi.fn(),
  listBranches: vi.fn(),
  getAccessibleScope: vi.fn(),
}));

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    organisation: {
      listBranches: (...args: unknown[]) => listBranches(...args),
      getAccessibleScope: (...args: unknown[]) => getAccessibleScope(...args),
    },
    sales: {
      byReference: (...args: unknown[]) => salesByReference(...args),
      search: (...args: unknown[]) => salesSearch(...args),
      list: (...args: unknown[]) => salesList(...args),
      history: (...args: unknown[]) => salesHistory(...args),
    },
  },
}));

import * as Session from "@/lib/api/session";
import type { ServiceError as ServiceErrorType, ServiceRegistry } from "./types";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";
const BRANCH_2_ID = "branch-2";

function wireOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    branchId: BRANCH_ID,
    terminalId: null,
    orderNumber: "MAIN-7",
    businessDay: "2026-09-19",
    orderType: "takeaway",
    channel: "pos",
    state: "open",
    tableId: null,
    guestCount: null,
    openedBy: "user-1",
    currency: "EGP",
    subtotal: "0",
    discountTotal: "0",
    serviceChargeTotal: "0",
    taxTotal: "0",
    roundingAdjustment: "0",
    grandTotal: "1000",
    paidTotal: "0",
    tipTotal: "0",
    lines: [],
    openedAt: "2026-09-19T10:00:00.000Z",
    firstFiredAt: null,
    completedAt: null,
    notes: null,
    version: 1,
    ...overrides,
  };
}

let httpServices: ServiceRegistry;
let ServiceError: typeof ServiceErrorType;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  Session.setTenantId(TENANT_ID);
  getAccessibleScope.mockResolvedValue({
    tenantId: TENANT_ID,
    brands: [],
    branches: [
      {
        id: BRANCH_ID,
        brandId: "brand-1",
        name: { en: "Front Branch" },
        code: "FRONT",
        countryCode: "EG",
        baseCurrency: "EGP",
        timezone: "Africa/Cairo",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        address: {},
      },
      {
        id: BRANCH_2_ID,
        brandId: "brand-1",
        name: { en: "Second Branch" },
        code: "SECOND",
        countryCode: "EG",
        baseCurrency: "EGP",
        timezone: "Africa/Cairo",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        address: {},
      },
    ],
  });
  listBranches.mockResolvedValue([]);
  ({ httpServices } = await import("./http"));
  ({ ServiceError } = await import("./types"));
});

afterEach(() => {
  Session.setTenantId(null);
});

describe("http.ts — sales.findOrderByReference", () => {
  it("maps the exact Order Reference lookup to a real Order, id kept distinct from orderNumber", async () => {
    salesByReference.mockResolvedValue(wireOrder());

    const order = await httpServices.sales.findOrderByReference("01ARZ3NDEKTSV4RRFFQ69G5FAV");

    expect(salesByReference).toHaveBeenCalledWith({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(order?.id).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(order?.orderNumber).toBe("MAIN-7");
  });

  it("a 404 (absent, or another tenant's) resolves to null — never a thrown error the caller must specifically catch", async () => {
    salesByReference.mockRejectedValue(new ServiceError("NOT_FOUND", "Order not found.", 404));

    const order = await httpServices.sales.findOrderByReference("does-not-exist");

    expect(order).toBeNull();
  });

  it("a 403 (the caller holds no pos.order.view_history grant at all) propagates — NOT converted to null", async () => {
    salesByReference.mockRejectedValue(
      new ServiceError("FORBIDDEN", "'pos.order.view_history' is required.", 403),
    );

    await expect(httpServices.sales.findOrderByReference("no-permission")).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("http.ts — sales.searchOrdersByNumber", () => {
  it("never assumes one match — every order the backend returns for an ambiguous number comes back mapped", async () => {
    salesSearch.mockResolvedValue([
      wireOrder({ id: "order-day-1", businessDay: "2026-09-10" }),
      wireOrder({ id: "order-day-2", businessDay: "2026-09-19" }),
    ]);

    const matches = await httpServices.sales.searchOrdersByNumber("MAIN-7");

    expect(salesSearch).toHaveBeenCalledWith({ orderNumber: "MAIN-7", branchId: undefined });
    expect(matches.map((m) => m.id).sort()).toEqual(["order-day-1", "order-day-2"]);
    expect(new Set(matches.map((m) => m.businessDay)).size).toBe(2);
  });

  it("passes a branch filter through when the caller narrows the search", async () => {
    salesSearch.mockResolvedValue([wireOrder({ branchId: BRANCH_2_ID })]);

    const matches = await httpServices.sales.searchOrdersByNumber("MAIN-7", BRANCH_2_ID);

    expect(salesSearch).toHaveBeenCalledWith({ orderNumber: "MAIN-7", branchId: BRANCH_2_ID });
    expect(matches).toHaveLength(1);
  });
});

describe("http.ts — sales.listOrderHistoryPage", () => {
  it("calls GET /orders/history (pos.order.view_history), NEVER GET /orders (pos.order.create) — BLOCKER A", async () => {
    salesHistory.mockResolvedValue({
      orders: [wireOrder({ id: "a" }), wireOrder({ id: "b" })],
      nextCursor: { businessDay: "2026-09-01", id: "b" },
    });

    const page = await httpServices.sales.listOrderHistoryPage({
      branchId: BRANCH_ID,
      cursor: { businessDay: "2026-09-19", id: "z" },
      limit: 50,
    });

    expect(salesHistory).toHaveBeenCalledWith({
      branchId: BRANCH_ID,
      limit: 50,
      cursorId: "z",
      cursorBusinessDay: "2026-09-19",
    });
    expect(salesList).not.toHaveBeenCalled();
    expect(page.orders.map((o) => o.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toEqual({ businessDay: "2026-09-01", id: "b" });
  });

  it("a null nextCursor from the server means exhausted — never fabricated as more available", async () => {
    salesHistory.mockResolvedValue({ orders: [wireOrder()], nextCursor: null });

    const page = await httpServices.sales.listOrderHistoryPage({});

    expect(page.nextCursor).toBeNull();
  });
});
