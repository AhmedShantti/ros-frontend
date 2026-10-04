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
 * Money arrives as a minor-unit integer STRING (never `Money.amount:
 * number` — a tenant's total can exceed `Number.MAX_SAFE_INTEGER`, which
 * `Number(text)` would silently round), so `values.value`/`totals.value`
 * here are pre-formatted display strings from `formatExactMoney()`, not
 * raw numbers. A 403 from the backend must surface as `permissionDenied`,
 * distinct from any other failure.
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
let ServiceError: typeof import("../services/types")["ServiceError"];

const SCOPE = { tenantId: "t1", brandId: null, branchId: null };

const BASE_PARAMS = {
  from: "2026-01-01",
  to: "2026-06-01",
  scope: SCOPE,
  compare: false,
  locale: "en" as const,
};

/** `Intl.NumberFormat` currency output uses a non-breaking space (ICU's own choice, not ours) between symbol and amount — normalize before comparing against a plain-space literal. */
const plain = (value: unknown): string => String(value).replace(/\s/g, " ");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ runReport } = await import("./engine"));
  ({ ServiceError } = await import("../services/types"));
});

describe("runReport('stock-valuation') — FR-INV-015 builder mapping", () => {
  it("calls services.inventory.valuation with the groupBy and asOf from params, not a date range", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      currency: "EGP",
      totalValue: "1000",
      rows: [],
    });

    await runReport("stock-valuation", {
      ...BASE_PARAMS,
      groupBy: "location",
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
      currency: "EGP",
      totalValue: "500000",
      rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: "1" }],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

    expect(plain(result.totals?.value)).toBe("EGP 5,000.00");
  });

  it("maps location rows with a readable label and the backend's own value", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      currency: "EGP",
      totalValue: "700",
      rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "الرئيسي" }, value: "700" }],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.id).toBe("loc-1");
    expect(result.rows[0]!.label).toBe("Main");
    expect(plain(result.rows[0]!.values.value)).toBe("EGP 7.00");
  });

  it("maps a real category row with its own name, never a null/undefined label", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "category",
      currency: "EGP",
      totalValue: "300",
      rows: [{ categoryId: "cat-1", categoryName: "Dairy", value: "300" }],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "category" });

    expect(result.rows[0]!.label).toBe("Dairy");
  });

  it("labels an uncategorized row honestly, only when the backend itself says categoryId is null", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "category",
      currency: "EGP",
      totalValue: "50",
      rows: [{ categoryId: null, categoryName: undefined, value: "50" }],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "category" });

    expect(result.rows[0]!.id).toBe("uncategorized");
    expect(result.rows[0]!.label).toBe("Uncategorized");
  });

  it("maps item rows with label, backend value, and a pre-formatted quantity column — never a fabricated quantity for location/category rows", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "item",
      currency: "EGP",
      totalValue: "400",
      rows: [
        {
          stockItemId: "item-1",
          itemName: { en: "Milk", ar: "حليب" },
          value: "400",
          quantity: { value: "10", unit: "l" },
        },
      ],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "item" });

    expect(plain(result.rows[0]!.values.value)).toBe("EGP 4.00");
    expect(typeof result.rows[0]!.values.quantity).toBe("string");
    expect(result.columns.some((c) => c.key === "quantity")).toBe(true);
  });

  it("drops the quantity column entirely for location/category groupings", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      currency: "EGP",
      totalValue: "100",
      rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: "100" }],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

    expect(result.columns.some((c) => c.key === "quantity")).toBe(false);
    expect(result.rows[0]!.values.quantity).toBeUndefined();
  });

  it("is never partial — a point-in-time snapshot has no unfinished period", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      currency: "EGP",
      totalValue: "0",
      rows: [],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

    expect(result.partial).toBe(false);
  });

  it("never emits a chart — a bar chart can only plot a Number, which this report's value must not become", async () => {
    valuation.mockResolvedValue({
      asOf: "2026-06-01T00:00:00.000Z",
      groupBy: "location",
      currency: "EGP",
      totalValue: "100",
      rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: "100" }],
    });

    const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

    expect(result.chart).toBeUndefined();
  });

  describe("403 UX — permission denial vs. every other failure", () => {
    it("backend 403 -> permissionDenied, with the honest-empty shape", async () => {
      valuation.mockRejectedValue(new ServiceError("FORBIDDEN", "403 Forbidden", 403));

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(result.permissionDenied).toBe(true);
      expect(result.rows).toEqual([]);
    });

    it("backend 500 -> generic unavailable state, NOT permissionDenied", async () => {
      valuation.mockRejectedValue(new ServiceError("INTERNAL", "500 Internal Server Error", 500));

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(result.permissionDenied).toBeFalsy();
      expect(result.unavailable).toBe("500 Internal Server Error");
    });

    it("a network/non-ServiceError failure -> generic unavailable state, NOT permissionDenied", async () => {
      valuation.mockRejectedValue(new Error("network error"));

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(result.permissionDenied).toBeFalsy();
      expect(result.unavailable).toBe("network error");
    });

    it("a 401 (session, not permission) -> generic unavailable state, NOT swallowed as permissionDenied", async () => {
      valuation.mockRejectedValue(new ServiceError("UNAUTHORIZED", "401 Unauthorized", 401));

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(result.permissionDenied).toBeFalsy();
      expect(result.unavailable).toBe("401 Unauthorized");
    });

    it("success leaves permissionDenied unset", async () => {
      valuation.mockResolvedValue({
        asOf: "2026-06-01T00:00:00.000Z",
        groupBy: "location",
        currency: "EGP",
        totalValue: "100",
        rows: [],
      });

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(result.permissionDenied).toBeFalsy();
      expect(result.unavailable).toBeUndefined();
    });
  });

  describe("money precision — past Number.MAX_SAFE_INTEGER", () => {
    const BIG = "9007199254740993"; // Number(BIG) would round to ...992.

    it("the mapped row and total values retain every digit, through to the final display string", async () => {
      valuation.mockResolvedValue({
        asOf: "2026-06-01T00:00:00.000Z",
        groupBy: "location",
        currency: "EGP",
        totalValue: BIG,
        rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: BIG }],
      });

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      // 9007199254740993 minor units, exponent 2 -> 90071992547409.93 exactly.
      expect(plain(result.rows[0]!.values.value)).toBe("EGP 90,071,992,547,409.93");
      expect(plain(result.totals?.value)).toBe("EGP 90,071,992,547,409.93");
      // The assertion that would fail if Number()/parseFloat() were
      // reintroduced anywhere on this path: ...409.93, never ...409.92.
      expect(result.rows[0]!.values.value).not.toContain("409.92");
      expect(result.totals?.value).not.toContain("409.92");
    });

    it("a negative large value keeps its sign and every digit", async () => {
      const negative = `-${BIG}`;
      valuation.mockResolvedValue({
        asOf: "2026-06-01T00:00:00.000Z",
        groupBy: "location",
        currency: "EGP",
        totalValue: negative,
        rows: [{ locationId: "loc-1", locationName: { en: "Main", ar: "Main" }, value: negative }],
      });

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(plain(result.rows[0]!.values.value)).toBe("-EGP 90,071,992,547,409.93");
      expect(plain(result.totals?.value)).toBe("-EGP 90,071,992,547,409.93");
    });

    it("sorts rows by exact magnitude, not by a lossy Number() comparison", async () => {
      // A value just under, and a value just over, the point where
      // `Number(a) - Number(b)` would start lying.
      const justOver = "9007199254740995";
      const justUnder = "9007199254740990";
      valuation.mockResolvedValue({
        asOf: "2026-06-01T00:00:00.000Z",
        groupBy: "location",
        currency: "EGP",
        totalValue: "0",
        rows: [
          { locationId: "loc-small", locationName: { en: "Small", ar: "Small" }, value: justUnder },
          { locationId: "loc-big", locationName: { en: "Big", ar: "Big" }, value: justOver },
        ],
      });

      const result = await runReport("stock-valuation", { ...BASE_PARAMS, groupBy: "location" });

      expect(result.rows.map((r) => r.id)).toEqual(["loc-big", "loc-small"]);
    });
  });
});
