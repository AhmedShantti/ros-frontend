import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * MENU-MANAGEMENT-CANONICAL-INTEGRATION-P0 — the live workspace's data
 * layer. Proves it composes real `/catalogue/*` endpoints (never an invented
 * `/menu-management/*` path) and correctly resolves the two shapes
 * `services.catalogue`'s generic collections do not carry: which menu a
 * category belongs to, and which category an item is placed in.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`) and the
 * service registry (`@/lib/console/services`) — same pattern as
 * `lib/console/services/http.platform.test.ts`.
 */

const listCategories = vi.fn();
const createCategory = vi.fn();
const listPlacements = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    catalogue: {
      listCategories: (...args: unknown[]) => listCategories(...args),
      createCategory: (...args: unknown[]) => createCategory(...args),
      listPlacements: (...args: unknown[]) => listPlacements(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

const itemsList = vi.fn();
vi.mock("@/lib/console/services", () => ({
  services: { catalogue: { items: { list: (...args: unknown[]) => itemsList(...args) } } },
}));

import { createMenuCategory, listItemsWithPlacements, listMenuCategories } from "./live-adapter";

describe("live-adapter — menus-scoped categories", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the menu-scoped canonical endpoint, never a tenant-wide or invented one", async () => {
    listCategories.mockResolvedValue([
      { id: "c2", menuId: "m1", parentCategoryId: null, name: { en: "Drinks", ar: "مشروبات" }, sortOrder: 1, colour: null },
      { id: "c1", menuId: "m1", parentCategoryId: null, name: { en: "Mains", ar: "أطباق" }, sortOrder: 0, colour: "#111" },
    ]);

    const rows = await listMenuCategories("m1");

    expect(listCategories).toHaveBeenCalledWith("m1");
    expect(rows.map((r) => r.id)).toEqual(["c1", "c2"]); // sorted by sortOrder
    expect(rows[0]).toMatchObject({ menuId: "m1", tenantId: "t1", name: { en: "Mains", ar: "أطباق" } });
  });

  it("creates a category against the selected menu, with a localised name", async () => {
    createCategory.mockResolvedValue({
      id: "c3", menuId: "m1", parentCategoryId: null, name: { en: "Sides", ar: "Sides" }, sortOrder: 2, colour: null,
    });

    const row = await createMenuCategory("m1", { name: "Sides", sortOrder: 2 });

    expect(createCategory).toHaveBeenCalledWith("m1", { name: { en: "Sides", ar: "Sides" }, sortOrder: 2 });
    expect(row).toMatchObject({ id: "c3", menuId: "m1" });
  });
});

describe("live-adapter — items with resolved placements", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves each item's real category placements via a per-item fan-out, never a fabricated categoryId", async () => {
    itemsList.mockResolvedValue({
      rows: [
        { id: "i1", categoryId: "", name: { en: "Kofta", ar: "كفتة" } },
        { id: "i2", categoryId: "", name: { en: "Cola", ar: "كولا" } },
      ],
      total: 2,
    });
    listPlacements.mockImplementation((itemId: string) =>
      Promise.resolve(itemId === "i1" ? [{ categoryId: "cat-mains", menuId: "m1" }] : []),
    );

    const scope = { tenantId: "t1", brandId: null, branchId: null };
    const rows = await listItemsWithPlacements(scope);

    expect(listPlacements).toHaveBeenCalledWith("i1");
    expect(listPlacements).toHaveBeenCalledWith("i2");
    expect(rows.find((r) => r.id === "i1")).toMatchObject({
      categoryId: "cat-mains",
      placements: [{ categoryId: "cat-mains", menuId: "m1" }],
    });
    expect(rows.find((r) => r.id === "i2")).toMatchObject({ categoryId: "", placements: [] });
  });

  it("never fails the whole list when one item's placements call errors", async () => {
    itemsList.mockResolvedValue({ rows: [{ id: "i1", categoryId: "", name: { en: "Kofta", ar: "" } }], total: 1 });
    listPlacements.mockRejectedValue(new Error("network"));

    const scope = { tenantId: "t1", brandId: null, branchId: null };
    const rows = await listItemsWithPlacements(scope);

    expect(rows).toEqual([expect.objectContaining({ id: "i1", categoryId: "", placements: [] })]);
  });
});
