import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-015 — `inventory.valuation()` must call the real
 * `GET /inventory/valuation` endpoint with the full query contract
 * (`asOf`, `groupBy`, `locationId`, `categoryId`, `stockItemId`), and must
 * NEVER fall back to `GET /inventory/levels` (the old
 * `services.inventory.levels.list() + StockItem.standardCost`
 * approximation this report used before the real backend endpoint
 * existed — wrong for FIFO/weighted-average and incapable of a historical
 * date).
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`,
 * `@/lib/api/session`), same pattern as `http.inventory-locations.test.ts` —
 * the real `http.ts` module runs, so this proves the actual outgoing
 * request/query, not just a report-engine mock.
 */

const valuation = vi.fn();
const levels = vi.fn();
const listItems = vi.fn();
const listCategories = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listWarehouses = vi.fn();
const listCentralKitchens = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      valuation: (...args: unknown[]) => valuation(...args),
      levels: (...args: unknown[]) => levels(...args),
      listItems: (...args: unknown[]) => listItems(...args),
      listCategories: (...args: unknown[]) => listCategories(...args),
    },
    organisation: {
      listLocations: (...args: unknown[]) => listLocations(...args),
      listBranches: (...args: unknown[]) => listBranches(...args),
      listWarehouses: (...args: unknown[]) => listWarehouses(...args),
      listCentralKitchens: (...args: unknown[]) => listCentralKitchens(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

const LOCATION_FOR_BRANCH = {
  id: "loc-1",
  locationType: "branch" as const,
  refId: "branch-1",
  createdAt: "2026-01-01T00:00:00Z",
};

const BRANCH_1 = {
  id: "branch-1",
  brandId: "brand-1",
  name: { en: "Main" },
  code: "MAIN",
  countryCode: "EG",
  baseCurrency: "EGP",
  timezone: "Africa/Cairo",
  createdAt: "2026-01-01T00:00:00Z",
  status: "active" as const,
  address: {},
};

const CATEGORY_1 = { id: "cat-1", name: "Dairy", parentId: null };

const ITEM_1 = {
  id: "item-1",
  sku: "SKU-1",
  names: { en: "Milk" },
  baseUnitId: "uom-1",
  recipeUnitId: null,
  categoryId: "cat-1",
  costingMethod: "weighted_average" as const,
  isBatchTracked: false,
  expiryTracked: false,
  shelfLifeDays: null,
  isActive: true,
  standardCost: null,
};

const BASE_RESPONSE = {
  asOf: "2026-06-01T12:00:00.000Z",
  groupBy: "location" as const,
  totalValue: "500000",
  rows: [{ locationId: LOCATION_FOR_BRANCH.id, value: "500000" }],
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  valuation.mockResolvedValue(BASE_RESPONSE);
  levels.mockResolvedValue([]);
  listItems.mockResolvedValue([ITEM_1]);
  listCategories.mockResolvedValue([CATEGORY_1]);
  listLocations.mockResolvedValue([LOCATION_FOR_BRANCH]);
  listBranches.mockResolvedValue([BRANCH_1]);
  listWarehouses.mockResolvedValue([]);
  listCentralKitchens.mockResolvedValue([]);
  ({ httpServices } = await import("./http"));
});

describe("inventory.valuation() — FR-INV-015 HTTP boundary", () => {
  it("calls GET /inventory/valuation, never GET /inventory/levels", async () => {
    await httpServices.inventory.valuation({ groupBy: "location" });

    expect(valuation).toHaveBeenCalledTimes(1);
    expect(levels).not.toHaveBeenCalled();
  });

  it("sends no asOf (defaults to now server-side) when the caller omits it", async () => {
    await httpServices.inventory.valuation({ groupBy: "location" });

    expect(valuation).toHaveBeenCalledWith(
      expect.objectContaining({ asOf: undefined, groupBy: "location" }),
    );
  });

  it("sends an explicit historical asOf through unchanged, as ISO", async () => {
    const historical = "2025-01-15T09:30:00.000Z";
    await httpServices.inventory.valuation({ groupBy: "location", asOf: historical });

    expect(valuation).toHaveBeenCalledWith(expect.objectContaining({ asOf: historical }));
  });

  it("passes groupBy=location, category and item through unchanged", async () => {
    for (const groupBy of ["location", "category", "item"] as const) {
      valuation.mockClear();
      await httpServices.inventory.valuation({ groupBy });
      expect(valuation).toHaveBeenCalledWith(expect.objectContaining({ groupBy }));
    }
  });

  it("passes optional locationId/categoryId/stockItemId filters through unchanged", async () => {
    await httpServices.inventory.valuation({
      groupBy: "item",
      locationId: "loc-1",
      categoryId: "cat-1",
      stockItemId: "item-1",
    });

    expect(valuation).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: "loc-1",
        categoryId: "cat-1",
        stockItemId: "item-1",
      }),
    );
  });

  it("renders totalValue from the backend's own totalValue, not a local re-sum", async () => {
    valuation.mockResolvedValue({ ...BASE_RESPONSE, totalValue: "999900" });

    const result = await httpServices.inventory.valuation({ groupBy: "location" });

    expect(result.totalValue.amount).toBe(999900);
  });

  it("renders each group row's value from the backend row, unmodified", async () => {
    valuation.mockResolvedValue({
      ...BASE_RESPONSE,
      rows: [{ locationId: LOCATION_FOR_BRANCH.id, value: "123456" }],
    });

    const result = await httpServices.inventory.valuation({ groupBy: "location" });

    expect(result.rows[0]!.value.amount).toBe(123456);
  });

  it("resolves a readable location name for groupBy=location", async () => {
    const result = await httpServices.inventory.valuation({ groupBy: "location" });

    expect(result.rows[0]!.locationName).toEqual({ en: "Main", ar: "Main" });
  });

  it("resolves a readable category name for groupBy=category", async () => {
    valuation.mockResolvedValue({
      asOf: BASE_RESPONSE.asOf,
      groupBy: "category" as const,
      totalValue: "500000",
      rows: [{ categoryId: CATEGORY_1.id, value: "500000" }],
    });

    const result = await httpServices.inventory.valuation({ groupBy: "category" });

    expect(result.rows[0]!.categoryName).toBe("Dairy");
  });

  it("is honest about an uncategorized row — categoryName is undefined, never fabricated", async () => {
    valuation.mockResolvedValue({
      asOf: BASE_RESPONSE.asOf,
      groupBy: "category" as const,
      totalValue: "500000",
      rows: [{ categoryId: null, value: "500000" }],
    });

    const result = await httpServices.inventory.valuation({ groupBy: "category" });

    expect(result.rows[0]!.categoryId).toBeNull();
    expect(result.rows[0]!.categoryName).toBeUndefined();
  });

  it("resolves item name, SKU-backed id and base-unit quantity for groupBy=item", async () => {
    valuation.mockResolvedValue({
      asOf: BASE_RESPONSE.asOf,
      groupBy: "item" as const,
      totalValue: "500000",
      rows: [{ stockItemId: ITEM_1.id, value: "500000", quantity: "12.5" }],
    });

    const result = await httpServices.inventory.valuation({ groupBy: "item" });

    expect(result.rows[0]!.itemName).toEqual({ en: "Milk", ar: "Milk" });
    // No UOM catalogue is mocked here, so the base unit falls back to "pc" —
    // only the quantity VALUE (the thing this test is really about) matters.
    expect(result.rows[0]!.quantity).toEqual({ value: "12.5", unit: "pc" });
  });

  it("propagates a 403 (insufficient inventory.cost.view) without falling back to levels()", async () => {
    valuation.mockRejectedValue(new Error("403 Forbidden"));

    await expect(httpServices.inventory.valuation({ groupBy: "location" })).rejects.toThrow(
      "403 Forbidden",
    );
    expect(levels).not.toHaveBeenCalled();
  });

  it("propagates any other API failure without falling back to levels()", async () => {
    valuation.mockRejectedValue(new Error("network error"));

    await expect(httpServices.inventory.valuation({ groupBy: "location" })).rejects.toThrow(
      "network error",
    );
    expect(levels).not.toHaveBeenCalled();
  });

  it("converts a large minor-unit integer string without precision loss", async () => {
    const big = "9007199254740900"; // well past a float's safe-integer boundary if mishandled
    valuation.mockResolvedValue({ ...BASE_RESPONSE, totalValue: big });

    const result = await httpServices.inventory.valuation({ groupBy: "location" });

    expect(result.totalValue.amount).toBe(Number(big));
  });
});
