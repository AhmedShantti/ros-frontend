import { beforeEach, describe, expect, it } from "vitest";
import { memoryMenuManagementApi as api, resetMemoryMenuManagementStore } from "./memory-adapter";
import type { MmItemInput } from "./types";

/*
 * MENU-MANAGEMENT — the in-memory store mirrors the server rules documented
 * in docs/MENU_MANAGEMENT_API.md, so the workspace behaves the same before
 * and after the backend lands.
 */

const itemInput = (categoryId: string | number, patch: Partial<MmItemInput> = {}): MmItemInput => ({
  categoryId,
  name: "Kofta",
  kitchenName: "Kofta",
  description: "",
  status: "available",
  pricingMode: "single",
  price: 90,
  channelPrices: { takeaway: null, delivery: null },
  sizes: [],
  modifierGroupIds: [],
  ...patch,
});

describe("memory menu-management store", () => {
  beforeEach(() => resetMemoryMenuManagementStore());

  it("starts empty — no demo data", async () => {
    expect(await api.listMenus()).toEqual([]);
    expect(await api.listModifierGroups()).toEqual([]);
  });

  it("flags unpublished changes and clears them on publish", async () => {
    const menu = await api.createMenu({ name: "Lunch", description: "", brandId: null, branchIds: [] });
    expect(menu.hasUnpublishedChanges).toBe(true);
    const published = await api.publishMenu(menu.id);
    expect(published.hasUnpublishedChanges).toBe(false);
    const category = await api.createCategory(menu.id, { name: "Mains" });
    await api.createItem(menu.id, itemInput(category.id));
    expect((await api.listMenus())[0]!.hasUnpublishedChanges).toBe(true);
  });

  it("replaces temporary size ids with real ones", async () => {
    const menu = await api.createMenu({ name: "Lunch", description: "", brandId: null, branchIds: [] });
    const category = await api.createCategory(menu.id, { name: "Pizza" });
    const saved = await api.createItem(
      menu.id,
      itemInput(category.id, { pricingMode: "size", sizes: [{ id: "size-tmp-1", name: "Small", price: 9 }] }),
    );
    expect(typeof saved.sizes[0]!.id).toBe("number");
  });

  it("removes a deleted item from every combo part", async () => {
    const menu = await api.createMenu({ name: "Lunch", description: "", brandId: null, branchIds: [] });
    const category = await api.createCategory(menu.id, { name: "Mains" });
    const kofta = await api.createItem(menu.id, itemInput(category.id));
    await api.createCombo(menu.id, {
      name: "Meal", description: "", status: "available", pricing: "fixed", price: 100, discountPercent: null,
      slots: [{ id: "slot-tmp", label: "Main", itemIds: [kofta.id] }],
    });
    await api.deleteItem(kofta.id);
    const content = await api.getMenuContent(menu.id);
    expect(content.combos[0]!.slots[0]!.itemIds).toEqual([]);
  });

  it("detaches a deleted customization group from items", async () => {
    const menu = await api.createMenu({ name: "Lunch", description: "", brandId: null, branchIds: [] });
    const category = await api.createCategory(menu.id, { name: "Mains" });
    const group = await api.createModifierGroup({ name: "Sauces", required: false, multiple: false, maxSelections: null, options: [{ id: "opt-tmp", name: "Tahini", price: 0 }] });
    await api.createItem(menu.id, itemInput(category.id, { modifierGroupIds: [group.id] }));
    await api.deleteModifierGroup(group.id);
    const content = await api.getMenuContent(menu.id);
    expect(content.categories[0]!.items[0]!.modifierGroupIds).toEqual([]);
  });
});
