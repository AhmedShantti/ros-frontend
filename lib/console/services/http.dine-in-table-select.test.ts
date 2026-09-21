import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * DINE-IN-TABLE-SELECTOR-RESUME-P0
 *
 * `services.sales.tables()` / `services.sales.selectTable()` against the real
 * `http.ts` logic — mocked only at the transport boundary
 * (`@/lib/api/endpoints`), same pattern as `http.orders-reference.test.ts`.
 * Proves:
 *   - `GET /orders/tables` occupancy is passed through untouched (available /
 *     occupied + activeOrder / ambiguous + conflictingOrders) — never derived;
 *   - `selectTable` is exactly ONE `POST /orders/tables/{id}/select` and never
 *     a direct `POST /orders` (`api.sales.create`), for created AND resumed;
 *   - a resumed order is mapped from the backend's Order (permanent id,
 *     MAIN-N, fired/pending lines with their real prices), not rebuilt;
 *   - 409 ambiguous / 403 / 404 / network failures propagate and no order is
 *     fabricated, and nothing falls back to `POST /orders`;
 *   - the Cashier path never reads `/org/branches` (BRANCH_READ).
 */

const { listTables, selectDineInTable, createOrder, listBranches, getAccessibleScope } = vi.hoisted(
  () => ({
    listTables: vi.fn(),
    selectDineInTable: vi.fn(),
    createOrder: vi.fn(),
    listBranches: vi.fn(),
    getAccessibleScope: vi.fn(),
  }),
);

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    organisation: {
      listBranches: (...args: unknown[]) => listBranches(...args),
      getAccessibleScope: (...args: unknown[]) => getAccessibleScope(...args),
    },
    sales: {
      listTables: (...args: unknown[]) => listTables(...args),
      selectDineInTable: (...args: unknown[]) => selectDineInTable(...args),
      create: (...args: unknown[]) => createOrder(...args),
    },
  },
}));

import * as Session from "@/lib/api/session";
import type { ServiceError as ServiceErrorType, ServiceRegistry } from "./types";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";
const ORDER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const activeOrderRef = {
  id: ORDER_ID,
  businessDay: "2026-09-19",
  orderNumber: "MAIN-10",
  state: "open",
  version: 4,
  guestCount: 2,
  openedAt: "2026-09-19T10:00:00.000Z",
  firstFiredAt: "2026-09-19T10:05:00.000Z",
};

function wireLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "line-burger",
    sequence: 1,
    menuItemId: "item-burger",
    variantId: "variant-1",
    itemNameSnapshot: { en: "Burger", ar: "برجر" },
    quantity: "2",
    unitPrice: "10000",
    modifierTotal: "0",
    lineDiscount: "0",
    lineSubtotal: "20000",
    taxAmount: "0",
    lineTotal: "20000",
    unitCostSnapshot: null,
    recipeVersionId: null,
    course: 1,
    seatNumber: null,
    state: "fired",
    firedAt: "2026-09-19T10:05:00.000Z",
    readyAt: null,
    isComp: false,
    notes: null,
    createdAt: "2026-09-19T10:01:00.000Z",
    ...overrides,
  };
}

function wireOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ORDER_ID,
    branchId: BRANCH_ID,
    terminalId: null,
    orderNumber: "MAIN-10",
    businessDay: "2026-09-19",
    orderType: "dine_in",
    channel: "pos",
    state: "open",
    tableId: "table-4",
    guestCount: 2,
    openedBy: "user-1",
    currency: "EGP",
    subtotal: "20000",
    discountTotal: "0",
    serviceChargeTotal: "0",
    taxTotal: "0",
    roundingAdjustment: "0",
    grandTotal: "20000",
    paidTotal: "0",
    tipTotal: "0",
    lines: [wireLine()],
    openedAt: "2026-09-19T10:00:00.000Z",
    firstFiredAt: "2026-09-19T10:05:00.000Z",
    completedAt: null,
    notes: null,
    version: 4,
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
    ],
  });
  ({ httpServices } = await import("./http"));
  ({ ServiceError } = await import("./types"));
});

afterEach(() => {
  Session.setTenantId(null);
});

describe("http.ts — sales.tables (GET /orders/tables)", () => {
  it("passes the backend's derived occupancy through untouched for every state", async () => {
    listTables.mockResolvedValue([
      {
        id: "table-1",
        label: "1",
        section: "Patio",
        seatCapacity: 4,
        occupancy: "available",
        activeOrder: null,
        conflictingOrders: [],
      },
      {
        id: "table-4",
        label: "4",
        section: "Patio",
        seatCapacity: null,
        occupancy: "occupied",
        activeOrder: activeOrderRef,
        conflictingOrders: [],
      },
      {
        id: "table-9",
        label: "9",
        section: null,
        seatCapacity: 2,
        occupancy: "ambiguous",
        activeOrder: null,
        conflictingOrders: [
          { ...activeOrderRef, id: "order-a", orderNumber: "MAIN-3" },
          { ...activeOrderRef, id: "order-b", orderNumber: "MAIN-8" },
        ],
      },
    ]);

    const rows = await httpServices.sales.tables();

    expect(rows.map((r) => [r.label, r.occupancy])).toEqual([
      ["1", "available"],
      ["4", "occupied"],
      ["9", "ambiguous"],
    ]);
    expect(rows[0]).toMatchObject({ seatCapacity: 4, activeOrder: null, conflictingOrders: [] });
    expect(rows[1].activeOrder).toMatchObject({ id: ORDER_ID, orderNumber: "MAIN-10", version: 4 });
    expect(rows[1].seatCapacity).toBeNull();
    expect(rows[2].activeOrder).toBeNull();
    expect(rows[2].conflictingOrders.map((o) => o.orderNumber)).toEqual(["MAIN-3", "MAIN-8"]);
  });

  it("never reads /org/branches — a Cashier holds no BRANCH_READ", async () => {
    listTables.mockResolvedValue([]);
    await httpServices.sales.tables();
    expect(listBranches).not.toHaveBeenCalled();
  });
});

describe("http.ts — sales.selectTable (POST /orders/tables/{id}/select)", () => {
  it("outcome created: one select call, the returned order mapped, and NEVER a direct POST /orders", async () => {
    selectDineInTable.mockResolvedValue({
      outcome: "created",
      table: { id: "table-1", label: "1", section: null, seatCapacity: 4 },
      order: wireOrder({ tableId: "table-1", orderNumber: "MAIN-11", lines: [], version: 1 }),
    });

    const result = await httpServices.sales.selectTable("table-1");

    expect(selectDineInTable).toHaveBeenCalledTimes(1);
    expect(selectDineInTable.mock.calls[0][0]).toBe("table-1");
    expect(selectDineInTable.mock.calls[0][1]).toMatchObject({ channel: "pos" });
    // No guest count on a new Dine-In order: not sent, not defaulted.
    expect(JSON.parse(JSON.stringify(selectDineInTable.mock.calls[0][1]))).not.toHaveProperty("guestCount");
    expect(typeof selectDineInTable.mock.calls[0][1].originDeviceTime).toBe("string");
    expect(typeof selectDineInTable.mock.calls[0][1].id).toBe("string");
    expect(createOrder).not.toHaveBeenCalled();

    expect(result.outcome).toBe("created");
    expect(result.order).toMatchObject({ orderNumber: "MAIN-11", tableId: "table-1", lines: [] });
  });

  it("outcome resumed: maps the SAME backend order — permanent id, MAIN-N, state, version and its fired line", async () => {
    selectDineInTable.mockResolvedValue({
      outcome: "resumed",
      table: { id: "table-4", label: "4", section: null, seatCapacity: 4 },
      order: wireOrder(),
    });

    const { outcome, order } = await httpServices.sales.selectTable("table-4");

    expect(outcome).toBe("resumed");
    expect(order.id).toBe(ORDER_ID);
    expect(order.orderNumber).toBe("MAIN-10");
    expect(order.state).toBe("open");
    expect(order.tableId).toBe("table-4");
    expect(order.businessDay).toBe("2026-09-19");
    expect(order.version).toBe(4);
    expect(order.firstFiredAt).toBe("2026-09-19T10:05:00.000Z");
    expect(order.grandTotal.amount).toBe(20000);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({
      id: "line-burger",
      state: "fired",
      quantity: 2,
      firedAt: "2026-09-19T10:05:00.000Z",
    });
    expect(order.lines[0].itemNameSnapshot).toEqual({ en: "Burger", ar: "برجر" });
    expect(order.lines[0].lineTotal.amount).toBe(20000);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("resume sends no guestCount on the wire, and the server's own guestCount is what comes back", async () => {
    selectDineInTable.mockResolvedValue({
      outcome: "resumed",
      table: { id: "table-4", label: "4", section: null, seatCapacity: 4 },
      order: wireOrder({ guestCount: 2 }),
    });

    const { order } = await httpServices.sales.selectTable("table-4");

    // JSON is what actually goes on the wire: an omitted option leaves no key.
    const body = JSON.parse(JSON.stringify(selectDineInTable.mock.calls[0][1]));
    expect(body).not.toHaveProperty("guestCount");
    expect(order.guestCount).toBe(2);
  });

  it("never reads /org/branches while selecting — branch identity is the POS session's own", async () => {
    selectDineInTable.mockResolvedValue({
      outcome: "resumed",
      table: { id: "table-4", label: "4", section: null, seatCapacity: 4 },
      order: wireOrder(),
    });
    await httpServices.sales.selectTable("table-4");
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("409 DINE_IN_TABLE_AMBIGUOUS propagates; no order is fabricated and there is no fallback create", async () => {
    selectDineInTable.mockRejectedValue(
      new ServiceError("DINE_IN_TABLE_AMBIGUOUS", "This table has more than one active dine-in order.", 409),
    );

    await expect(httpServices.sales.selectTable("table-9")).rejects.toMatchObject({
      status: 409,
      code: "DINE_IN_TABLE_AMBIGUOUS",
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
  ])("a %i propagates and creates nothing", async (status, code) => {
    selectDineInTable.mockRejectedValue(new ServiceError(code, "refused", status));

    await expect(httpServices.sales.selectTable("table-x")).rejects.toMatchObject({ status });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("a network failure propagates — the outcome is not guessed", async () => {
    selectDineInTable.mockRejectedValue(new ServiceError("NETWORK_UNREACHABLE", "The backend did not answer.", 0));

    await expect(httpServices.sales.selectTable("table-4")).rejects.toMatchObject({ status: 0 });
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe("http.ts — sales.mutations.open (direct POST /orders: Takeaway / Pickup)", () => {
  it.each(["takeaway", "pickup"] as const)(
    "%s: the body carries no guestCount key — none typed, none defaulted",
    async (orderType) => {
      createOrder.mockResolvedValue(
        wireOrder({ orderType, tableId: null, lines: [], orderNumber: "MAIN-40", version: 1 }),
      );

      const order = await httpServices.sales.mutations.open({ orderType, channel: "pos" });

      expect(createOrder).toHaveBeenCalledTimes(1);
      const body = JSON.parse(JSON.stringify(createOrder.mock.calls[0][0]));
      expect(body).not.toHaveProperty("guestCount");
      expect(body).toMatchObject({ orderType, channel: "pos" });
      expect(body).not.toHaveProperty("tableId");
      expect(selectDineInTable).not.toHaveBeenCalled();
      expect(order.orderNumber).toBe("MAIN-40");
    },
  );
});
