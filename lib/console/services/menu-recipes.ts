"use client";

/**
 * Recipe data the production API has no field for — FR-MNU-047, FR-MNU-050.
 *
 *  - **Nutrition facts per stock item.** The inventory item has no nutrition
 *    attributes, so they are kept here per item against a stated basis
 *    ("per 100 g"). The per-portion panel is computed from these by
 *    `lib/console/menu-nutrition.ts`.
 *  - **Why a branch deviates.** A branch-scoped recipe is real
 *    (`POST /recipes` with `scope: branch`), but the API carries no reason for
 *    the deviation, and a compliance report without the reason is a list of
 *    accusations. The reason is kept here, keyed by the branch recipe id.
 */

import type { Id, IsoDateTime, UnitCode } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export const NUTRIENTS = [
  "energyKcal",
  "proteinG",
  "fatG",
  "saturatedFatG",
  "carbohydrateG",
  "sugarsG",
  "fibreG",
  "sodiumMg",
] as const;

export type Nutrient = (typeof NUTRIENTS)[number];

/** Values are decimal strings; an empty string means "not supplied". */
export interface NutritionFacts {
  stockItemId: Id;
  basisQuantity: string;
  basisUnit: UnitCode;
  values: Record<Nutrient, string>;
  source: string;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export interface VariantNote {
  recipeId: Id;
  standardRecipeId: Id | null;
  reason: string;
  approvedBy: string | null;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export function emptyNutrients(): Record<Nutrient, string> {
  return Object.fromEntries(NUTRIENTS.map((key) => [key, ""])) as Record<Nutrient, string>;
}

const nutrition = localCollection<NutritionFacts>(
  {
    name: "menu-nutrition-facts",
    idOf: (row) => row.stockItemId,
    factory: (input) => ({
      stockItemId: input.stockItemId ?? "",
      basisQuantity: input.basisQuantity ?? "100",
      basisUnit: input.basisUnit ?? "g",
      values: { ...emptyNutrients(), ...(input.values ?? {}) },
      source: input.source ?? "",
      updatedBy: input.updatedBy ?? "",
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  () => getActiveTenantId(),
);

const notes = localCollection<VariantNote>(
  {
    name: "menu-recipe-variant-notes",
    idOf: (row) => row.recipeId,
    factory: (input) => ({
      recipeId: input.recipeId ?? "",
      standardRecipeId: input.standardRecipeId ?? null,
      reason: input.reason ?? "",
      approvedBy: input.approvedBy ?? null,
      updatedBy: input.updatedBy ?? "",
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  () => getActiveTenantId(),
);

export interface MenuRecipesService {
  nutrition: typeof nutrition;
  variantNotes: typeof notes;
  saveNutrition(facts: Omit<NutritionFacts, "updatedAt">): Promise<NutritionFacts>;
  saveVariantNote(note: Omit<VariantNote, "updatedAt">): Promise<VariantNote>;
}

export const menuRecipesService: MenuRecipesService = {
  nutrition,
  variantNotes: notes,
  async saveNutrition(facts) {
    const existing = await nutrition.get(facts.stockItemId);
    return existing ? nutrition.update(facts.stockItemId, facts) : nutrition.create(facts);
  },
  async saveVariantNote(note) {
    const existing = await notes.get(note.recipeId);
    return existing ? notes.update(note.recipeId, note) : notes.create(note);
  },
};
