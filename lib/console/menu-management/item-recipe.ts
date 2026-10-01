/**
 * Menu Management — the recipe of one menu item size (SRS §10.6, §7.4.4).
 *
 * A recipe is what one sale of the item takes out of stock: a list of
 * ingredients, each a stock item from Inventory with an amount per portion.
 * How the amount is entered follows how the stock item is counted, which is
 * the dimension of its base unit:
 *
 *   - mass    → a weight per portion (g, kg, …)
 *   - volume  → a volume per portion (ml, L, …)
 *   - count   → a quantity per portion
 *
 * The units on offer for an ingredient are its base unit plus every unit with
 * a conversion INTO that base unit, generic or specific to the item — the
 * same conversions the backend applies. Whatever unit is typed, the line is
 * saved in the stock item's base unit (0.25 kg of an item kept in grams is
 * saved as 250 g), so a sale never depends on a conversion being configured.
 *
 * Units come from `GET /inventory/uoms` on the backend; in demo mode they are
 * the unit codes themselves. That endpoint is FR-INV-001's unit CATALOGUE
 * only — id/code/name/dimension, no conversion factors (`UomConversion` has
 * no read route yet) — so live mode builds its catalogue with an empty
 * conversion list. `unitsFor` below already degrades correctly for that: with
 * no conversions, the only unit it offers for an ingredient is that item's
 * own base unit, which is always exactly right and never needs one. Demo
 * mode keeps its own hand-written conversions, unrelated to this endpoint.
 *
 * Recipes are versioned (FR-MNU-045): a save never edits the version orders
 * were sold under. It writes a new version and, when the user may publish,
 * makes it the live one; past orders keep theirs. Without `recipe.publish`
 * the new version stays a draft for someone who can. A menu-item recipe
 * yields one piece — one portion — so its yield unit is the "piece" unit.
 */

import { api } from "@/lib/api/endpoints";
import { DATA_MODE } from "@/lib/api/config";
import { services } from "@/lib/console/services";
import { registerUnits } from "@/lib/console/services/map";
import type { RecipeLineInput } from "@/lib/console/services/types";
import type { Id, Localised, RecipeLine, StockItem, UnitCode } from "@/lib/console/types";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type Measure = "weight" | "volume" | "count";

export interface RecipeUnit {
  id: Id;
  code: string;
  /** "mass", "volume", "count", … as the backend names it. */
  dimension: string;
}

export interface UnitConversion {
  fromUnitId: Id;
  toUnitId: Id;
  /** Multiply a quantity in `fromUnitId` by this to get `toUnitId`. */
  factor: number;
  /** Null for a generic conversion; else it applies to this stock item only. */
  stockItemId: Id | null;
}

export interface UnitCatalogue {
  byId: Map<Id, RecipeUnit>;
  conversions: UnitConversion[];
  /** The unit a menu-item recipe yields in: one piece (one portion). */
  pieceUnitId: Id | null;
}

/** The units endpoint is missing on this backend — recipes can't be measured. */
export class UnitsUnavailableError extends Error {
  constructor() {
    super("Units of measure are not available from the server.");
    this.name = "UnitsUnavailableError";
  }
}

const KNOWN_CODES: readonly UnitCode[] = ["g", "kg", "ml", "l", "pc", "dozen", "case", "pack", "tray", "hour"];

export function isUnitCode(code: string): code is UnitCode {
  return (KNOWN_CODES as readonly string[]).includes(code);
}

/** Demo mode: units are codes all the way down, so the code is the id. */
function demoCatalogue(): UnitCatalogue {
  const dimension: Record<UnitCode, string> = {
    g: "mass",
    kg: "mass",
    ml: "volume",
    l: "volume",
    pc: "count",
    dozen: "count",
    case: "count",
    pack: "count",
    tray: "count",
    hour: "time",
  };
  const units = KNOWN_CODES.map((code) => ({ id: code, code, dimension: dimension[code] }));
  const generic = (fromUnitId: string, toUnitId: string, factor: number): UnitConversion => ({
    fromUnitId,
    toUnitId,
    factor,
    stockItemId: null,
  });
  return {
    byId: new Map(units.map((u) => [u.id, u])),
    conversions: [
      generic("kg", "g", 1000),
      generic("g", "kg", 0.001),
      generic("l", "ml", 1000),
      generic("ml", "l", 0.001),
      generic("dozen", "pc", 12),
    ],
    pieceUnitId: "pc",
  };
}

/** A unit catalogue from the backend's rows — also teaches the rest of the console their codes. */
export function catalogueFrom(rows: {
  units: { id: string; code: string; dimension: string; baseUnitOfDimension?: boolean }[];
  conversions: { fromUnitId: string; toUnitId: string; factor: string; stockItemId: string | null }[];
}): UnitCatalogue {
  const units = rows.units.map((u) => ({ id: u.id, code: u.code, dimension: u.dimension }));
  const piece =
    rows.units.find((u) => u.code.toLowerCase() === "pc") ??
    rows.units.find((u) => u.dimension === "count" && u.baseUnitOfDimension) ??
    null;
  return {
    byId: new Map(units.map((u) => [u.id, u])),
    conversions: rows.conversions
      .map((c) => ({ fromUnitId: c.fromUnitId, toUnitId: c.toUnitId, factor: Number(c.factor), stockItemId: c.stockItemId }))
      .filter((c) => Number.isFinite(c.factor) && c.factor > 0),
    pieceUnitId: piece?.id ?? null,
  };
}

export async function loadUnitCatalogue(): Promise<UnitCatalogue> {
  if (DATA_MODE === "mock") return demoCatalogue();
  let units: Awaited<ReturnType<typeof api.inventory.listUoms>>;
  try {
    units = await api.inventory.listUoms();
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) throw new UnitsUnavailableError();
    throw error;
  }
  // Other screens label quantities through the same registry.
  registerUnits(
    Object.fromEntries(units.filter((u) => isUnitCode(u.code)).map((u) => [u.id, u.code as UnitCode])),
  );
  // No conversions from this endpoint (see the module doc comment) — an
  // ingredient's only offered unit is therefore its own base unit, which
  // `unitsFor` already falls back to correctly with an empty list.
  return catalogueFrom({ units, conversions: [] });
}

/** The id of a stock item's base unit: the backend's id, or the demo's code. */
export function baseUnitIdOf(item: StockItem): Id {
  return item.baseUnitId ?? item.baseUnit;
}

export function measureOf(unit: RecipeUnit | undefined): Measure {
  if (unit?.dimension === "mass") return "weight";
  if (unit?.dimension === "volume") return "volume";
  return "count";
}

export function measureOfItem(catalogue: UnitCatalogue, item: StockItem): Measure {
  return measureOf(catalogue.byId.get(baseUnitIdOf(item)));
}

/**
 * Multiply an amount in `unitId` by this to get the stock item's base unit.
 * An item-specific conversion wins over a generic one; null when there is none.
 */
export function factorToBase(catalogue: UnitCatalogue, item: StockItem, unitId: Id): number | null {
  const base = baseUnitIdOf(item);
  if (unitId === base) return 1;
  const own = catalogue.conversions.find(
    (c) => c.fromUnitId === unitId && c.toUnitId === base && c.stockItemId === item.id,
  );
  const generic = catalogue.conversions.find(
    (c) => c.fromUnitId === unitId && c.toUnitId === base && c.stockItemId === null,
  );
  return (own ?? generic)?.factor ?? null;
}

/** The units an amount may be typed in: the base unit first, then every unit convertible into it, smallest first. */
export function unitsFor(catalogue: UnitCatalogue, item: StockItem): RecipeUnit[] {
  const baseId = baseUnitIdOf(item);
  const base = catalogue.byId.get(baseId) ?? { id: baseId, code: item.baseUnit, dimension: "count" };
  const others = [...catalogue.byId.values()]
    .map((unit) => ({ unit, factor: unit.id === baseId ? null : factorToBase(catalogue, item, unit.id) }))
    .filter((entry): entry is { unit: RecipeUnit; factor: number } => entry.factor !== null)
    .sort((a, b) => a.factor - b.factor)
    .map((entry) => entry.unit);
  return [base, ...others];
}

/** A new ingredient starts in its base unit — but an item kept in kg or L reads best per portion in g or ml. */
export function defaultUnitFor(catalogue: UnitCatalogue, item: StockItem): Id {
  const baseId = baseUnitIdOf(item);
  const code = catalogue.byId.get(baseId)?.code.toLowerCase();
  const preferred = code === "kg" ? "g" : code === "l" ? "ml" : null;
  return unitsFor(catalogue, item).find((unit) => unit.code.toLowerCase() === preferred)?.id ?? baseId;
}

/** Up to 6 decimal places, trailing zeros trimmed: 0.250000 → "0.25". */
export function trimDecimal(value: number): string {
  return String(Number(value.toFixed(6)));
}

// ---------------------------------------------------------------------------
// The editable shape
// ---------------------------------------------------------------------------

export interface IngredientDraft {
  /** Stable React key; not persisted. */
  key: string;
  stockItemId: Id;
  /** As typed. Validated by `ingredientProblem`. */
  amount: string;
  /** The unit the amount is typed in — one of `unitsFor(...)`. */
  unitId: Id;
}

export interface VariantRecipe {
  recipeId: Id | null;
  /** The version the editor opened from: the live one, else the newest draft. */
  version: { number: number; status: "draft" | "published" | "superseded" } | null;
  ingredients: IngredientDraft[];
  /**
   * Lines this editor does not author — prep items (sub-recipes), which are
   * built on the Recipes page. They are shown read-only and saved back
   * untouched, so editing the ingredients never drops them.
   */
  kept: RecipeLine[];
}

export const EMPTY_RECIPE: VariantRecipe = { recipeId: null, version: null, ingredients: [], kept: [] };

let keySeed = 0;
export function newKey(): string {
  keySeed += 1;
  return `ing_${keySeed}`;
}

export type IngredientProblem = "amount";

export function ingredientProblem(line: IngredientDraft): IngredientProblem | null {
  const value = Number(line.amount);
  if (!line.amount.trim() || !Number.isFinite(value) || value <= 0) return "amount";
  return null;
}

/** True when the ingredient list differs from what was loaded. */
export function ingredientsChanged(before: IngredientDraft[], after: IngredientDraft[]): boolean {
  const sig = (lines: IngredientDraft[]) =>
    JSON.stringify(lines.map((l) => [l.stockItemId, Number(l.amount), l.unitId]));
  return sig(before) !== sig(after);
}

/** The unit a stored line is in: the backend's id, or (demo) its code. */
function lineUnitId(line: RecipeLine): Id {
  return line.unitId ?? line.quantity.unit;
}

// ---------------------------------------------------------------------------
// Stock items (the ingredient picker)
// ---------------------------------------------------------------------------

/** Active stock items, A–Z by English name. */
export async function loadStockItems(): Promise<StockItem[]> {
  const page = await services.inventory.items.list({ limit: 1000 });
  return page.rows
    .filter((item) => item.active)
    .sort((a, b) => a.name.en.localeCompare(b.name.en));
}

/** Case-insensitive match on the English or Arabic name, or the SKU. */
export function matchesSearch(item: StockItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.name.en.toLowerCase().includes(q) ||
    item.name.ar.includes(query.trim()) ||
    item.sku.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * The recipe of one size (variant): its live version, or — if it was never
 * published — its newest draft, so half-finished work is not hidden.
 */
export async function loadVariantRecipe(variantId: Id): Promise<VariantRecipe> {
  const page = await services.catalogue.recipes.list({ limit: 1000 });
  const candidates = page.rows.filter((row) => row.recipeType === "menu_item" && row.targetId === variantId);
  const recipe = candidates.find((row) => row.status === "published") ?? candidates[0] ?? null;
  if (!recipe) return EMPTY_RECIPE;

  const versions = await services.production.versions(recipe.id);
  const chosen =
    versions.find((v) => v.status === "published") ??
    [...versions].sort((a, b) => b.version - a.version).find((v) => v.status === "draft") ??
    null;
  if (!chosen) return { ...EMPTY_RECIPE, recipeId: recipe.id };

  const ordered = [...chosen.lines].sort((a, b) => a.sequence - b.sequence);
  return {
    recipeId: recipe.id,
    version: { number: chosen.version, status: chosen.status },
    ingredients: ordered
      .filter((line) => line.componentType === "stock_item")
      .map((line) => ({
        key: newKey(),
        stockItemId: line.componentId,
        amount: trimDecimal(Number(line.quantity.value)),
        unitId: lineUnitId(line),
      })),
    kept: ordered.filter((line) => line.componentType !== "stock_item"),
  };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveRecipeInput {
  variantId: Id;
  /** Used only when the recipe does not exist yet (demo mode names it). */
  name: Localised;
  loaded: VariantRecipe;
  ingredients: IngredientDraft[];
  stockItems: Map<Id, StockItem>;
  units: UnitCatalogue;
  /** `recipe.publish` — make the new version live now. */
  publish: boolean;
}

export interface SaveRecipeResult {
  recipeId: Id;
  version: number;
  published: boolean;
}

/** An ingredient that can't be saved as typed — the UI should have prevented it. */
export class RecipeLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeLineError";
  }
}

export function toLineInputs(
  ingredients: IngredientDraft[],
  kept: RecipeLine[],
  stockItems: Map<Id, StockItem>,
  units: UnitCatalogue,
): RecipeLineInput[] {
  const lines: RecipeLineInput[] = ingredients.map((line, index) => {
    const item = stockItems.get(line.stockItemId);
    if (!item) throw new RecipeLineError(`Stock item ${line.stockItemId} is no longer available.`);
    const factor = factorToBase(units, item, line.unitId);
    if (factor === null) throw new RecipeLineError(`${item.name.en}: that unit can't be converted to its stock unit.`);
    return {
      sequence: index + 1,
      componentType: "stock_item",
      stockItemId: line.stockItemId,
      quantity: trimDecimal(Number(line.amount) * factor),
      unitId: baseUnitIdOf(item),
    };
  });
  kept.forEach((line, index) => {
    lines.push({
      sequence: ingredients.length + index + 1,
      componentType: line.componentType,
      subRecipeId: line.componentType === "sub_recipe" ? line.componentId : undefined,
      stockItemId: line.componentType === "stock_item" ? line.componentId : undefined,
      quantity: line.quantity.value,
      unitId: lineUnitId(line),
      wastagePercentage: line.wastagePercentage ? String(line.wastagePercentage) : undefined,
      isOptional: line.isOptional || undefined,
      substituteGroupId: line.substituteGroupId ?? undefined,
    });
  });
  return lines;
}

/**
 * Save one size's recipe as a new version.
 *
 * The draft the editor opened from (a recipe never published yet) is
 * overwritten rather than stacked on; otherwise a new version is created, so
 * someone else's unpublished draft is never touched. A menu-item recipe
 * yields one piece, so the amounts are per portion sold.
 */
export async function saveVariantRecipe(input: SaveRecipeInput): Promise<SaveRecipeResult> {
  if (!input.units.pieceUnitId) {
    throw new RecipeLineError("There is no piece unit on the server, which a menu item's recipe yields in.");
  }
  const lines = toLineInputs(input.ingredients, input.loaded.kept, input.stockItems, input.units);

  let recipeId = input.loaded.recipeId;
  if (!recipeId) {
    const created = await services.catalogue.recipes.create({
      name: input.name,
      recipeType: "menu_item",
      targetId: input.variantId,
    });
    recipeId = created.id;
  }

  let version: number;
  if (input.loaded.version?.status === "draft") {
    await services.production.replaceLines(recipeId, input.loaded.version.number, lines);
    version = input.loaded.version.number;
  } else {
    const created = await services.production.createVersion(recipeId, {
      yieldQuantity: "1",
      yieldUnitId: input.units.pieceUnitId,
      lines,
    });
    version = created.version;
  }

  if (input.publish) await services.production.publishVersion(recipeId, version);
  return { recipeId, version, published: input.publish };
}
