import { beforeEach, describe, expect, it, vi } from "vitest";

const createItem = vi.fn();
const setItemDensity = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: { inventory: { createItem: (...args: unknown[]) => createItem(...args), setItemDensity: (...args: unknown[]) => setItemDensity(...args) } },
}));
vi.mock("@/lib/api/session", () => ({ getTenantId: () => "t1" }));

let httpServices: typeof import("./http")["httpServices"];
const wireRow = (densityGramsPerMillilitre: string | null) => ({
  id: "item-density",
  sku: "DENS-1",
  names: { en: "Density item" },
  categoryId: null,
  baseUnitId: "uom-g",
  recipeUnitId: null,
  costingMethod: "weighted_average" as const,
  standardCost: null,
  isBatchTracked: false,
  expiryTracked: false,
  shelfLifeDays: null,
  densityGramsPerMillilitre,
  batchStrategy: "fifo" as const,
  isActive: true,
});

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ httpServices } = await import("./http"));
});

describe("FR-INV-004 density API mapping", () => {
  it("passes create density as its exact decimal string and reads it back", async () => {
    createItem.mockResolvedValue(wireRow("0.8123456789"));
    const item = await httpServices.inventory.items.create({
      sku: "DENS-1",
      baseUnitId: "uom-g",
      densityGramsPerMillilitre: "0.8123456789",
    } as never);
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ densityGramsPerMillilitre: "0.8123456789" }),
    );
    expect(item.densityGramsPerMillilitre).toBe("0.8123456789");
  });

  it("sends exact updates and represents clearing density with null", async () => {
    setItemDensity.mockResolvedValue(wireRow(null));
    const item = await httpServices.inventory.setItemDensity("item-density", null);
    expect(setItemDensity).toHaveBeenCalledWith("item-density", {
      densityGramsPerMillilitre: null,
    });
    expect(item.densityGramsPerMillilitre).toBeNull();
  });
});
