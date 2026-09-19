import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FRONTEND-REAL-UX-BATCH-1A — POS Open Orders/Resume.
 *
 * `services.operations.openOrders` already existed (used by the console's
 * own `/operations/open-orders` page) and already filters `GET /orders` to
 * the resumable states before this batch — this proves that filter
 * directly at the wire level, since `LivePos`'s new Open Orders picker now
 * depends on it too: `completed`/`cancelled` orders must never come back as
 * resumable, only `draft`/`open`/`held`/`parked`/`partially_paid` do.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`), same
 * pattern as `http.test.ts` — the real `http.ts` logic runs.
 */

const { listBranches, getAccessibleScope, salesList, salesCancel } = vi.hoisted(() => ({
  listBranches: vi.fn(),
  getAccessibleScope: vi.fn(),
  salesList: vi.fn(),
  salesCancel: vi.fn(),
}));

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    organisation: {
      listBranches: (...args: unknown[]) => listBranches(...args),
      getAccessibleScope: (...args: unknown[]) => getAccessibleScope(...args),
    },
    sales: {
      list: (...args: unknown[]) => salesList(...args),
      cancel: (...args: unknown[]) => salesCancel(...args),
    },
  },
}));

import * as Session from "@/lib/api/session";
import type { ServiceRegistry } from "./types";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";

function wireOrder(id: string, state: string) {
  return {
    id,
    branchId: BRANCH_ID,
    terminalId: null,
    orderNumber: `ORD-${id}`,
    businessDay: "2026-09-19",
    orderType: "takeaway",
    channel: "pos",
    state,
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
  };
}

let httpServices: ServiceRegistry;

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
    ],
  });
  listBranches.mockResolvedValue([]);
  ({ httpServices } = await import("./http"));
});

afterEach(() => {
  Session.setTenantId(null);
});

describe("http.ts — operations.openOrders (POS Open Orders/Resume)", () => {
  it("lists only resumable states — completed and cancelled orders never appear", async () => {
    salesList.mockResolvedValue({
      orders: [
        wireOrder("1", "draft"),
        wireOrder("2", "open"),
        wireOrder("3", "held"),
        wireOrder("4", "parked"),
        wireOrder("5", "partially_paid"),
        wireOrder("6", "completed"),
        wireOrder("7", "cancelled"),
      ],
      nextCursor: null,
    });

    const page = await httpServices.operations.openOrders({
      scope: { tenantId: TENANT_ID, brandId: null, branchId: BRANCH_ID },
    });

    expect(page.rows.map((row) => row.id).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(page.rows.some((row) => row.state === "completed")).toBe(false);
    expect(page.rows.some((row) => row.state === "cancelled")).toBe(false);
  });

  it("newest-first sort (-openedAt) puts today's orders ahead of stale ones, not buried behind them", async () => {
    salesList.mockResolvedValue({
      orders: [
        { ...wireOrder("old", "draft"), businessDay: "2026-09-10", openedAt: "2026-09-10T09:00:00.000Z" },
        { ...wireOrder("new", "open"), businessDay: "2026-09-19", openedAt: "2026-09-19T09:00:00.000Z" },
      ],
      nextCursor: null,
    });

    const page = await httpServices.operations.openOrders({
      scope: { tenantId: TENANT_ID, brandId: null, branchId: BRANCH_ID },
      sort: "-openedAt",
    });

    expect(page.rows.map((row) => row.id)).toEqual(["new", "old"]);
  });
});

describe("http.ts — orders.mutations.cancel (Open Orders — abandoned Draft cancellation)", () => {
  it("calls the real POST /orders/{day}/{id}/cancel with only reasonCodeId, never fabricating manager/disposition fields", async () => {
    salesCancel.mockResolvedValue({
      order: wireOrder("9", "cancelled"),
      postFireVoidRecords: [],
    });

    const result = await httpServices.sales.mutations.cancel(
      "2026-09-19",
      "9",
      { reasonCodeId: "reason-1" },
      { ifMatch: 3 },
    );

    expect(salesCancel).toHaveBeenCalledWith(
      "2026-09-19",
      "9",
      { reasonCodeId: "reason-1" },
      { ifMatch: 3 },
    );
    expect(result.state).toBe("cancelled");
  });
});
