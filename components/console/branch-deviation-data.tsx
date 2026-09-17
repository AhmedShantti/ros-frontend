"use client";

/**
 * The rows the brand-standard deviation report (FR-BRN-006/007) and the
 * franchisor compliance view (FR-BRN-037) both read. Loaded once here so the
 * two screens compute deviation from exactly the same inputs.
 */

import type { Branch, Id, Menu, PriceList, Recipe } from "@/lib/console/types";
import {
  menuDeviations,
  priceDeviations,
  recipeDeviations,
  type BrandStandard,
  type MenuDeviation,
  type PriceDeviation,
  type RecipeDeviation,
  type RecipeOverride,
} from "@/lib/console/branch-network";
import type { FranchiseAgreement } from "@/lib/console/franchise";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";

export interface DeviationInputs {
  menus: Menu[];
  priceLists: PriceList[];
  recipes: Recipe[];
  overrides: RecipeOverride[];
  standards: BrandStandard[];
  agreements: FranchiseAgreement[];
}

async function withEntries(lists: PriceList[]): Promise<PriceList[]> {
  // The live list endpoint returns headers only; entries come per list.
  return Promise.all(
    lists.map(async (list) => {
      if (list.entries.length > 0) return list;
      const entries = await services.catalogue.priceEntries(list.id).catch(() => []);
      return { ...list, entries };
    }),
  );
}

export function useDeviationInputs(reloadKey: unknown = 0) {
  return useAsync<DeviationInputs>(async () => {
    const [menus, lists, recipes, overrides, standards, agreements] = await Promise.all([
      services.catalogue.menus.list({ limit: 500 }).then((page) => page.rows),
      services.catalogue.priceLists.list({ limit: 500 }).then((page) => page.rows),
      services.catalogue.recipes.list({ limit: 1000 }).then((page) => page.rows),
      services.branchNetwork.recipeOverrides.all(),
      services.branchNetwork.standards.all(),
      services.branchNetwork.franchiseAgreements.all(),
    ]);
    return { menus, priceLists: await withEntries(lists), recipes, overrides, standards, agreements };
  }, [reloadKey]);
}

export interface BranchDeviation {
  branch: Branch;
  standard: BrandStandard | null;
  menu: MenuDeviation | null;
  prices: PriceDeviation[];
  recipes: RecipeDeviation[];
}

/** FR-BRN-006 / FR-BRN-007 — each branch measured against its own brand's standard. */
export function deviationsFor(branches: Branch[], inputs: DeviationInputs): BranchDeviation[] {
  const standardByBrand = new Map(inputs.standards.map((row) => [row.brandId, row]));
  return branches.map((branch) => {
    const standard = standardByBrand.get(branch.brandId) ?? null;
    const ids: Id[] = [branch.id];
    return {
      branch,
      standard,
      menu: menuDeviations(ids, standard, inputs.menus)[0] ?? null,
      prices: priceDeviations(ids, standard, inputs.priceLists),
      recipes: recipeDeviations(ids, inputs.overrides, inputs.recipes),
    };
  });
}
