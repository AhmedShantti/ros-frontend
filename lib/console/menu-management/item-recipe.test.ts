import { describe, expect, it } from "vitest";

/*
 * The item recipe data layer, run against the in-memory demo services (no
 * backend is configured under test, so `services` is the mock registry), plus
 * the unit rules against a catalogue shaped like the backend's
 * `GET /inventory/uoms` (UUID ids, arbitrary codes).
 */

import { services } from "@/lib/console/services";
import { menuItems, recipes } from "@/lib/console/mock/catalogue";
import { stockItems } from "@/lib/console/mock/stock-items";
import type { StockItem } from "@/lib/console/types";
import {
  EMPTY_RECIPE,
  RecipeLineError,
  catalogueFrom,
  defaultUnitFor,
  factorToBase,
  ingredientProblem,
  ingredientsChanged,
  loadStockItems,
  loadUnitCatalogue,
  loadVariantRecipe,
  matchesSearch,
  measureOfItem,
  newKey,
  saveVariantRecipe,
  toLineInputs,
  unitsFor,
} from "./item-recipe";

const byName = (en: string) => stockItems.find((item) => item.name.en === en)!;
const stockMap = new Map(stockItems.map((item) => [item.id, item]));

// A backend-shaped catalogue: ids are UUIDs, the codes are whatever the server holds.
const G = "8d516af7-1765-443f-bf60-f603b875751f";
const KG = "bc318042-5a32-474e-b9d6-e0da6b7a62c4";
const ML = "88d2e260-87e9-45a8-b071-37f6e13437cf";
const L = "f461ecf7-4bf0-4e11-818a-16d7d072f5c7";
const PC = "768a5087-0586-4362-a706-8a70f2f18a00";
const BOX = "11111111-2222-3333-4444-555555555555";
const live = catalogueFrom({
  units: [
    { id: PC, code: "pc", dimension: "count", baseUnitOfDimension: true },
    { id: G, code: "g", dimension: "mass", baseUnitOfDimension: true },
    { id: KG, code: "kg", dimension: "mass", baseUnitOfDimension: false },
    { id: ML, code: "ml", dimension: "volume", baseUnitOfDimension: true },
    { id: L, code: "l", dimension: "volume", baseUnitOfDimension: false },
    { id: BOX, code: "box", dimension: "count", baseUnitOfDimension: false },
  ],
  conversions: [
    { fromUnitId: KG, toUnitId: G, factor: "1000.0000000000", stockItemId: null },
    { fromUnitId: G, toUnitId: KG, factor: "0.0010000000", stockItemId: null },
    { fromUnitId: L, toUnitId: ML, factor: "1000.0000000000", stockItemId: null },
    // Eggs come 30 to a box — a conversion for that one item only.
    { fromUnitId: BOX, toUnitId: PC, factor: "30", stockItemId: "egg" },
  ],
});
const liveItem = (id: string, baseUnitId: string, code: StockItem["baseUnit"]): StockItem => ({
  ...stockItems[0]!,
  id,
  name: { en: id, ar: id },
  baseUnit: code,
  baseUnitId,
});
const chicken = liveItem("chicken", G, "g");
const flour = liveItem("flour", KG, "kg");
const oil = liveItem("oil", ML, "ml");
const egg = liveItem("egg", PC, "pc");
const bun = liveItem("bun", PC, "pc");

describe("item recipe — units from the server", () => {
  it("reads how a stock item is counted from its base unit's dimension", () => {
    expect(measureOfItem(live, chicken)).toBe("weight");
    expect(measureOfItem(live, flour)).toBe("weight");
    expect(measureOfItem(live, oil)).toBe("volume");
    expect(measureOfItem(live, bun)).toBe("count");
  });

  it("finds the piece unit a menu-item recipe yields in", () => {
    expect(live.pieceUnitId).toBe(PC);
    expect(catalogueFrom({ units: [], conversions: [] }).pieceUnitId).toBeNull();
  });

  it("offers the base unit plus every unit that converts into it", () => {
    expect(unitsFor(live, chicken).map((u) => u.code)).toEqual(["g", "kg"]);
    expect(unitsFor(live, flour).map((u) => u.code)).toEqual(["kg", "g"]);
    expect(unitsFor(live, oil).map((u) => u.code)).toEqual(["ml", "l"]);
    expect(unitsFor(live, bun).map((u) => u.code)).toEqual(["pc"]);
    // An item-specific conversion applies to that item only.
    expect(unitsFor(live, egg).map((u) => u.code)).toEqual(["pc", "box"]);
  });

  it("starts weights in grams and volumes in millilitres", () => {
    expect(defaultUnitFor(live, chicken)).toBe(G);
    expect(defaultUnitFor(live, flour)).toBe(G);
    expect(defaultUnitFor(live, oil)).toBe(ML);
    expect(defaultUnitFor(live, bun)).toBe(PC);
  });

  it("converts to the base unit with the server's factors", () => {
    expect(factorToBase(live, chicken, KG)).toBe(1000);
    expect(factorToBase(live, flour, G)).toBe(0.001);
    expect(factorToBase(live, egg, BOX)).toBe(30);
    expect(factorToBase(live, bun, BOX)).toBeNull();
  });

  it("saves every line in the stock item's base unit id", () => {
    const lines = toLineInputs(
      [
        { key: "1", stockItemId: "chicken", amount: "0.15", unitId: KG },
        { key: "2", stockItemId: "flour", amount: "250", unitId: G },
        { key: "3", stockItemId: "oil", amount: "10", unitId: ML },
        { key: "4", stockItemId: "egg", amount: "0.5", unitId: BOX },
      ],
      [],
      new Map([chicken, flour, oil, egg].map((item) => [item.id, item])),
      live,
    );
    expect(lines.map((l) => [l.stockItemId, l.quantity, l.unitId])).toEqual([
      ["chicken", "150", G],
      ["flour", "0.25", KG],
      ["oil", "10", ML],
      ["egg", "15", PC],
    ]);
  });

  it("refuses a unit that doesn't convert rather than saving a wrong amount", () => {
    expect(() =>
      toLineInputs([{ key: "1", stockItemId: "bun", amount: "1", unitId: KG }], [], new Map([["bun", bun]]), live),
    ).toThrow(RecipeLineError);
  });
});

describe("item recipe — validation", () => {
  it("rejects an empty, zero or negative amount", () => {
    const line = { key: "k", stockItemId: "x", unitId: "g" };
    expect(ingredientProblem({ ...line, amount: "" })).toBe("amount");
    expect(ingredientProblem({ ...line, amount: "0" })).toBe("amount");
    expect(ingredientProblem({ ...line, amount: "-3" })).toBe("amount");
    expect(ingredientProblem({ ...line, amount: "150" })).toBeNull();
  });

  it("notices a change in item, amount or unit, not in keys", () => {
    const a = [{ key: "1", stockItemId: "s", amount: "150", unitId: "g" }];
    expect(ingredientsChanged(a, [{ ...a[0]!, key: "2" }])).toBe(false);
    expect(ingredientsChanged(a, [{ ...a[0]!, amount: "150.0" }])).toBe(false);
    expect(ingredientsChanged(a, [{ ...a[0]!, amount: "160" }])).toBe(true);
    expect(ingredientsChanged(a, [{ ...a[0]!, unitId: "kg" }])).toBe(true);
    expect(ingredientsChanged(a, [])).toBe(true);
  });
});

describe("item recipe — stock item picker", () => {
  it("lists active stock items A–Z", async () => {
    const rows = await loadStockItems();
    expect(rows.length).toBeGreaterThan(10);
    const names = rows.map((row) => row.name.en);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("searches by English name, Arabic name or SKU", () => {
    const item = byName("Chicken breast");
    expect(matchesSearch(item, "chick")).toBe(true);
    expect(matchesSearch(item, "دجاج")).toBe(true);
    expect(matchesSearch(item, "pro-001")).toBe(true);
    expect(matchesSearch(item, "salmon")).toBe(false);
  });
});

describe("item recipe — save and load (demo data)", async () => {
  const units = await loadUnitCatalogue();

  it("uses the unit codes as ids in demo mode", () => {
    expect(units.pieceUnitId).toBe("pc");
    expect(measureOfItem(units, byName("Chicken breast"))).toBe("weight");
    expect(measureOfItem(units, byName("Fresh milk"))).toBe("volume");
    expect(measureOfItem(units, byName("Burger bun"))).toBe("count");
  });

  it("creates a recipe for a size that has none, and reads it back per portion", async () => {
    const created = await services.catalogue.items.create({
      name: { en: "Test wrap", ar: "Test wrap" },
      variants: [{ name: { en: "Test wrap", ar: "Test wrap" }, price: { amount: 5000, currency: "EGP" } }],
    });
    const variantId = created.variants[0]!.id;

    expect(await loadVariantRecipe(variantId)).toEqual(EMPTY_RECIPE);

    const breast = byName("Chicken breast");
    const bread = byName("Saj bread");
    const result = await saveVariantRecipe({
      variantId,
      name: { en: "Test wrap", ar: "Test wrap" },
      loaded: EMPTY_RECIPE,
      ingredients: [
        { key: newKey(), stockItemId: breast.id, amount: "0.15", unitId: "kg" },
        { key: newKey(), stockItemId: bread.id, amount: "1", unitId: "pc" },
      ],
      stockItems: stockMap,
      units,
      publish: true,
    });
    expect(result.published).toBe(true);

    const loaded = await loadVariantRecipe(variantId);
    expect(loaded.recipeId).toBe(result.recipeId);
    expect(loaded.version?.status).toBe("published");
    // Stored in the stock item's base unit: 0.15 kg → 150 g.
    expect(loaded.ingredients.map((l) => [l.stockItemId, l.amount, l.unitId])).toEqual([
      [breast.id, "150", "g"],
      [bread.id, "1", "pc"],
    ]);

    // The Recipes page's row follows the published version, costed.
    const row = recipes.find((r) => r.id === result.recipeId)!;
    expect(row.status).toBe("published");
    expect(row.complete).toBe(true);
    expect(row.computedCost.amount).toBe(Math.round(150 * breast.unitCost.amount) + bread.unitCost.amount);
  });

  it("saves an edit as a new version and keeps the old one for past orders", async () => {
    const created = await services.catalogue.items.create({
      name: { en: "Test salad", ar: "Test salad" },
      variants: [{ name: { en: "Test salad", ar: "Test salad" }, price: { amount: 4000, currency: "EGP" } }],
    });
    const variantId = created.variants[0]!.id;
    const lettuce = byName("Iceberg lettuce");
    const first = await saveVariantRecipe({
      variantId,
      name: { en: "Test salad", ar: "Test salad" },
      loaded: EMPTY_RECIPE,
      ingredients: [{ key: newKey(), stockItemId: lettuce.id, amount: "80", unitId: "g" }],
      stockItems: stockMap,
      units,
      publish: true,
    });

    const loaded = await loadVariantRecipe(variantId);
    const second = await saveVariantRecipe({
      variantId,
      name: { en: "Test salad", ar: "Test salad" },
      loaded,
      ingredients: [{ ...loaded.ingredients[0]!, amount: "100" }],
      stockItems: stockMap,
      units,
      publish: true,
    });

    expect(second.version).toBe(first.version + 1);
    const versions = await services.production.versions(first.recipeId);
    expect(versions.find((v) => v.version === first.version)?.status).toBe("superseded");
    expect(versions.find((v) => v.version === second.version)?.status).toBe("published");
    expect((await loadVariantRecipe(variantId)).ingredients[0]!.amount).toBe("100");
  });

  it("leaves the new version as a draft without the publish permission, and edits that draft next time", async () => {
    const created = await services.catalogue.items.create({
      name: { en: "Test juice", ar: "Test juice" },
      variants: [{ name: { en: "Test juice", ar: "Test juice" }, price: { amount: 3000, currency: "EGP" } }],
    });
    const variantId = created.variants[0]!.id;
    const orange = byName("Fresh orange");
    const saved = await saveVariantRecipe({
      variantId,
      name: { en: "Test juice", ar: "Test juice" },
      loaded: EMPTY_RECIPE,
      ingredients: [{ key: newKey(), stockItemId: orange.id, amount: "300", unitId: "g" }],
      stockItems: stockMap,
      units,
      publish: false,
    });
    expect(saved.published).toBe(false);
    const loaded = await loadVariantRecipe(variantId);
    expect(loaded.version?.status).toBe("draft");
    expect(loaded.ingredients).toHaveLength(1);

    const again = await saveVariantRecipe({
      variantId,
      name: { en: "Test juice", ar: "Test juice" },
      loaded,
      ingredients: [{ ...loaded.ingredients[0]!, amount: "320" }],
      stockItems: stockMap,
      units,
      publish: false,
    });
    expect(again.version).toBe(saved.version);
    expect((await loadVariantRecipe(variantId)).ingredients[0]!.amount).toBe("320");
  });

  it("keeps prep-item (sub-recipe) lines of an existing recipe untouched", async () => {
    const withSub = recipes.find(
      (r) => r.recipeType === "menu_item" && r.status === "published" && r.lines.some((l) => l.componentType === "sub_recipe"),
    )!;
    const variantId = withSub.targetId!;
    const item = menuItems.find((m) => m.variants.some((v) => v.id === variantId))!;

    const loaded = await loadVariantRecipe(variantId);
    expect(loaded.kept.length).toBeGreaterThan(0);

    await saveVariantRecipe({
      variantId,
      name: item.name,
      loaded,
      ingredients: loaded.ingredients.slice(1),
      stockItems: stockMap,
      units,
      publish: true,
    });

    const after = await loadVariantRecipe(variantId);
    expect(after.ingredients).toHaveLength(loaded.ingredients.length - 1);
    expect(after.kept.map((l) => l.componentId)).toEqual(loaded.kept.map((l) => l.componentId));
  });

  it("refuses to save without a piece unit to yield in", async () => {
    await expect(
      saveVariantRecipe({
        variantId: "v",
        name: { en: "x", ar: "x" },
        loaded: EMPTY_RECIPE,
        ingredients: [],
        stockItems: stockMap,
        units: { ...units, pieceUnitId: null },
        publish: true,
      }),
    ).rejects.toThrow(RecipeLineError);
  });
});
