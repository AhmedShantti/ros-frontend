import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Precision trace for Stock Item `standardCost` (D-INV-03).
 *
 * The wire contract (`CreateStockItemDto.standardCost?: string`, backend
 * regex `^-?\d{1,18}$`, Prisma `BigInt?`) accepts up to 18 integer digits —
 * well past `Number.MAX_SAFE_INTEGER` (16 digits). `stockItems.create()`
 * used to build a `Money` object (`{ amount: Number(values.standardCost) }`)
 * and re-derive the wire string via `map.toMinorUnitString`, round-tripping
 * an already-exact minor-unit string through a JS `Number` twice for no
 * reason. It now passes the string straight through, smuggled past
 * `Partial<StockItem>` the same way `costingMethod` already is (`as never`)
 * — this proves that path is wire-exact for any digit count the UI's own
 * money field could ever produce, and beyond.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`,
 * `@/lib/api/session`), same pattern as `http.recipe-completeness.test.ts` —
 * the real `http.ts` module runs.
 */

const createItem = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      createItem: (...args: unknown[]) => createItem(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

const WIRE_ROW = (standardCost: string | null) => ({
  id: "item-1",
  sku: "SKU-1",
  names: { en: "Item" },
  baseUnitId: "uom-1",
  recipeUnitId: null,
  categoryId: null,
  costingMethod: "standard" as const,
  isBatchTracked: false,
  expiryTracked: false,
  shelfLifeDays: null,
  isActive: true,
  standardCost,
});

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ httpServices } = await import("./http"));
});

describe("stockItems.create() — standardCost precision (D-INV-03)", () => {
  it("sends a normal minor-unit value unchanged", async () => {
    createItem.mockResolvedValue(WIRE_ROW("1250"));
    await httpServices.inventory.items.create({
      sku: "SUG-001",
      baseUnitId: "uom-1",
      costingMethod: "standard",
      standardCost: "1250",
    } as never);
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ standardCost: "1250" }));
  });

  it("preserves a value at the backend's 18-digit limit exactly — no rounding, no scientific notation, no digit loss", async () => {
    const eighteenNines = "999999999999999999"; // 18 digits — the DTO's own max, well past 2^53-1.
    createItem.mockResolvedValue(WIRE_ROW(eighteenNines));
    await httpServices.inventory.items.create({
      sku: "SUG-002",
      baseUnitId: "uom-1",
      costingMethod: "standard",
      standardCost: eighteenNines,
    } as never);
    const [body] = createItem.mock.calls[0]! as [{ standardCost?: string }];
    expect(body.standardCost).toBe(eighteenNines);
    // Never coerced through a JS Number anywhere on this path: that would
    // either round to 1e18 (scientific notation) or silently lose the low
    // digits once past Number.MAX_SAFE_INTEGER.
    expect(body.standardCost).not.toMatch(/e/i);
    expect(body.standardCost?.length).toBe(18);
  });

  it("omits standardCost entirely for weighted_average — no accidental 0 or stale value", async () => {
    createItem.mockResolvedValue(WIRE_ROW(null));
    await httpServices.inventory.items.create({
      sku: "SUG-003",
      baseUnitId: "uom-1",
      costingMethod: "weighted_average" as never,
    });
    const [body] = createItem.mock.calls[0]! as [{ standardCost?: string }];
    expect(body.standardCost).toBeUndefined();
  });

  it("still sends the real selected Uom.id as baseUnitId, unaffected by the standardCost change", async () => {
    createItem.mockResolvedValue(WIRE_ROW(null));
    await httpServices.inventory.items.create({
      sku: "SUG-004",
      baseUnitId: "uom-kg-real-uuid",
      costingMethod: "weighted_average" as never,
    });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ baseUnitId: "uom-kg-real-uuid" }),
    );
  });
});
