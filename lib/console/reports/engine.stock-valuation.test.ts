import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-015 — the `stock-valuation` report builder (`runReport`) must read
 * ONLY `services.inventory.valuation()` and map the backend's response
 * faithfully: `totalValue` from the backend's own `totalValue` (never
 * re-summed locally), group rows from the backend's own rows, and an
 * honest "uncategorized" label only when the backend itself says
 * `categoryId: null` — never fabricated quantity/value for a
 * location/category row.
 *
 * `services.inventory` is mocked wholesale so this proves the BUILDER's
 * mapping, independent of the HTTP-boundary proof in
 * `services/http.inventory-valuation.test.ts`.
 */

const valuation = vi.fn();

vi.mock("@/lib/console/services", () => ({
  services: {
    inventory: { valuation: (...args: unknown[]) => valuation(...args) },
  },
}));

let runReport: typeof import("./engine")["runReport"];

const SCOPE = { tenantId: "t1", brandId: null, branchId: null };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ runReport } = await import("./engine"));
});

describe("runReport('stock-valuation') — FR-INV-015 builder mapping", () => {
  it("calls services.inventory.valuation with the groupBy and asOf from params, not a date range", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      totalValue: { amount: 1000, currency: "EGP" },
      rows: [],
    });

    await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "location",
      compare: false,
      locale: "en",
      asOf: "2026-06-01T00:00:00.000Z",
    });

    expect(valuation).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: "location", asOf: "2026-06-01T00:00:00.000Z" }),
    );
  });

  it("renders totals.value from the backend's totalValue, not a local re-sum of the rows", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      totalValue: { amount: 500000, currency: "EGP" },
      rows: [
        { locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: { amount: 1, currency: "EGP" } },
      ],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "location",
      compare: false,
      locale: "en",
    });

    expect(result.totals?.value).toBe(500000);
  });

  it("maps location rows with a readable label and the backend's own value", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      totalValue: { amount: 700, currency: "EGP" },
      rows: [
        { locationId: "loc-1", locationName: { en: "Main", ar: "الرئيسي" }, value: { amount: 700, currency: "EGP" } },
      ],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "location",
      compare: false,
      locale: "en",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.id).toBe("loc-1");
    expect(result.rows[0]!.label).toBe("Main");
    expect(result.rows[0]!.values.value).toBe(700);
  });

  it("maps a real category row with its own name, never a null/undefined label", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "category",
      totalValue: { amount: 300, currency: "EGP" },
      rows: [{ categoryId: "cat-1", categoryName: "Dairy", value: { amount: 300, currency: "EGP" } }],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "category",
      compare: false,
      locale: "en",
    });

    expect(result.rows[0]!.label).toBe("Dairy");
  });

  it("labels an uncategorized row honestly, only when the backend itself says categoryId is null", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "category",
      totalValue: { amount: 50, currency: "EGP" },
      rows: [{ categoryId: null, categoryName: undefined, value: { amount: 50, currency: "EGP" } }],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "category",
      compare: false,
      locale: "en",
    });

    expect(result.rows[0]!.id).toBe("uncategorized");
    expect(result.rows[0]!.label).toBe("Uncategorized");
  });

  it("maps item rows with label, backend value, and a pre-formatted quantity column — never a fabricated quantity for location/category rows", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "item",
      totalValue: { amount: 400, currency: "EGP" },
      rows: [
        {
          stockItemId: "item-1",
          itemName: { en: "Milk", ar: "حليب" },
          value: { amount: 400, currency: "EGP" },
          quantity: { value: "10", unit: "l" },
        },
      ],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "item",
      compare: false,
      locale: "en",
    });

    expect(result.rows[0]!.values.value).toBe(400);
    expect(typeof result.rows[0]!.values.quantity).toBe("string");
    expect(result.columns.some((c) => c.key === "quantity")).toBe(true);
  });

  it("drops the quantity column entirely for location/category groupings", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      totalValue: { amount: 100, currency: "EGP" },
      rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: { amount: 100, currency: "EGP" } }],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "location",
      compare: false,
      locale: "en",
    });

    expect(result.columns.some((c) => c.key === "quantity")).toBe(false);
    expect(result.rows[0]!.values.quantity).toBeUndefined();
  });

  it("surfaces an API failure as an honest unavailable state, never a fallback to levels()×standardCost", async () => {
    valuation.mockRejectedValue(new Error("403 Forbidden"));

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "location",
      compare: false,
      locale: "en",
    });

    expect(result.unavailable).toBe("403 Forbidden");
    expect(result.rows).toEqual([]);
  });

  it("is never partial — a point-in-time snapshot has no unfinished period", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      totalValue: { amount: 0, currency: "EGP" },
      rows: [],
    });

    const result = await runReport("stock-valuation", {
      from: "2026-01-01",
      to: "2026-06-01",
      scope: SCOPE,
      groupBy: "location",
      compare: false,
      locale: "en",
    });

    expect(result.partial).toBe(false);
  });
});
