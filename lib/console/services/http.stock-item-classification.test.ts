import { beforeEach, describe, expect, it, vi } from "vitest";

const createItem = vi.fn();
const getItem = vi.fn();
const updateItemClassification = vi.fn();
const setItemAllergens = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      createItem: (...args: unknown[]) => createItem(...args),
      getItem: (...args: unknown[]) => getItem(...args),
      updateItemClassification: (...args: unknown[]) => updateItemClassification(...args),
      setItemAllergens: (...args: unknown[]) => setItemAllergens(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({ getTenantId: () => "tenant-1" }));

let httpServices: typeof import("./http")["httpServices"];

const wireItem = (overrides: Record<string, unknown> = {}) => ({
  id: "stock-item-1",
  sku: "WTR-001",
  names: { en: "Water", ar: "ماء" },
  categoryId: null,
  baseUnitId: "uom-piece",
  recipeUnitId: null,
  costingMethod: "weighted_average" as const,
  standardCost: null,
  isBatchTracked: false,
  expiryTracked: false,
  shelfLifeDays: null,
  densityGramsPerMillilitre: null,
  batchStrategy: "fifo" as const,
  isDirectlySellable: true,
  isProducedItem: false,
  accountingExportAccountCode: "REV-UNASSUMED",
  allergens: [],
  isActive: true,
  ...overrides,
});

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ httpServices } = await import("./http"));
});

describe("stock item classification — HTTP serialization and response mapping", () => {
  it("serializes create classifications and maps the API response", async () => {
    createItem.mockResolvedValue(wireItem());

    const created = await httpServices.inventory.items.create({
      sku: "WTR-001",
      name: { en: "Water", ar: "ماء" },
      baseUnitId: "uom-piece",
      isDirectlySellable: true,
      isProducedItem: false,
      accountingExportAccountCode: "REV-UNASSUMED",
    });

    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        isDirectlySellable: true,
        isProducedItem: false,
        accountingExportAccountCode: "REV-UNASSUMED",
      }),
    );
    expect(created).toMatchObject({
      isDirectlySellable: true,
      isProducedItem: false,
      accountingExportAccountCode: "REV-UNASSUMED",
    });
    expect(created).not.toHaveProperty("revenueAccountCode");
  });

  it("serializes explicit false and null updates without adding omitted fields, then maps the readback", async () => {
    updateItemClassification.mockResolvedValue(undefined);
    getItem.mockResolvedValue(
      wireItem({
        isDirectlySellable: false,
        isProducedItem: false,
        accountingExportAccountCode: null,
      }),
    );

    const updated = await httpServices.inventory.items.update("stock-item-1", {
      isDirectlySellable: false,
      accountingExportAccountCode: null,
    });

    expect(updateItemClassification).toHaveBeenCalledWith("stock-item-1", {
      isDirectlySellable: false,
      accountingExportAccountCode: null,
    });
    expect(updated).toMatchObject({
      isDirectlySellable: false,
      isProducedItem: false,
      accountingExportAccountCode: null,
    });
  });

  it("serializes stock-item allergen create values and maps allergen readback", async () => {
    createItem.mockResolvedValue(wireItem({ allergens: ["Gluten", "Milk"] }));
    const created = await httpServices.inventory.items.create({
      sku: "WTR-001",
      name: { en: "Water", ar: "ماء" },
      baseUnitId: "uom-piece",
      allergens: ["Gluten", "Milk"],
    });
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ allergens: ["Gluten", "Milk"] }),
    );
    expect(created.allergens).toEqual(["Gluten", "Milk"]);
  });

  it("supports allergen replacement and clear serialization with immediate response mapping", async () => {
    setItemAllergens.mockResolvedValue(wireItem({ allergens: [] }));
    const cleared = await httpServices.inventory.setItemAllergens("stock-item-1", []);
    expect(setItemAllergens).toHaveBeenCalledWith("stock-item-1", { allergens: [] });
    expect(cleared.allergens).toEqual([]);

    setItemAllergens.mockResolvedValue(wireItem({ allergens: ["Egg"] }));
    getItem.mockResolvedValue(wireItem({ allergens: ["Egg"] }));
    const replaced = await httpServices.inventory.items.update("stock-item-1", {
      allergens: ["Egg"],
    });
    expect(setItemAllergens).toHaveBeenLastCalledWith("stock-item-1", { allergens: ["Egg"] });
    expect(replaced.allergens).toEqual(["Egg"]);
  });
});
