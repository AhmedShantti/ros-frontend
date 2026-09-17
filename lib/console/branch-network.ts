/**
 * Multi-branch structure — SRS ch.17.
 *
 * Pure types and computations shared by the organisation screens:
 *
 *   - branch groups (FR-BRN-005): regions, clusters, franchise territories,
 *     used to filter reports and to narrow a permission scope;
 *   - the brand standard and per-branch deviation from it (FR-BRN-006/007):
 *     which menus a branch serves, what it charges, how it makes a dish,
 *     compared with what the brand says it should;
 *   - central-kitchen transfer pricing (FR-BRN-030): what a branch is charged
 *     for what the kitchen sends it, which decides whether the kitchen is
 *     read as a cost centre or a profit centre.
 *
 * Nothing here talks to a service. The screens load the rows and hand them
 * in, so the same deviation arithmetic serves the deviation report and the
 * franchisor compliance view (FR-BRN-037).
 */

import type { Currency, Id, IsoDate, IsoDateTime, Localised, Menu, Money, PriceList, Recipe } from "./types";

// ---------------------------------------------------------------------------
// Branch groups — FR-BRN-005
// ---------------------------------------------------------------------------

export type BranchGroupKind = "region" | "cluster" | "franchise_territory";

export const BRANCH_GROUP_KINDS: BranchGroupKind[] = ["region", "cluster", "franchise_territory"];

export interface BranchGroup {
  id: Id;
  name: Localised;
  kind: BranchGroupKind;
  code: string;
  branchIds: Id[];
  /** Optional parent — a cluster inside a region. */
  parentId: Id | null;
  notes: string;
  updatedAt: IsoDateTime;
}

/** Every branch in a group, including those of its child groups. */
export function branchesInGroup(groups: BranchGroup[], groupId: Id, seen = new Set<Id>()): Id[] {
  if (seen.has(groupId)) return [];
  seen.add(groupId);
  const group = groups.find((row) => row.id === groupId);
  if (!group) return [];
  const children = groups.filter((row) => row.parentId === groupId);
  return [...new Set([...group.branchIds, ...children.flatMap((child) => branchesInGroup(groups, child.id, seen))])];
}

/** Refusal message for a group about to be saved, or null. */
export function groupProblem(group: Pick<BranchGroup, "id" | "code" | "kind" | "branchIds" | "parentId">, all: BranchGroup[]): string | null {
  if (!group.code.trim()) return "A group needs a code.";
  const clash = all.find((row) => row.id !== group.id && row.code.trim().toLowerCase() === group.code.trim().toLowerCase());
  if (clash) return `The code "${group.code}" is already used by another group.`;
  // A parent chain that returns to this group would make membership infinite.
  let cursor = group.parentId;
  const visited = new Set<Id>([group.id]);
  while (cursor) {
    if (visited.has(cursor)) return "That parent would make the group contain itself.";
    visited.add(cursor);
    cursor = all.find((row) => row.id === cursor)?.parentId ?? null;
  }
  // A branch belongs to at most one franchise territory — royalties and
  // franchise scoping would otherwise double-count it.
  if (group.kind === "franchise_territory") {
    for (const branchId of group.branchIds) {
      const other = all.find(
        (row) => row.id !== group.id && row.kind === "franchise_territory" && row.branchIds.includes(branchId),
      );
      if (other) return `A branch can sit in only one franchise territory; one of these is already in "${other.code}".`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Brand standard and deviations — FR-BRN-006, FR-BRN-007
// ---------------------------------------------------------------------------

export interface BrandStandard {
  /** One per brand; the id is the brand id. */
  id: Id;
  brandId: Id;
  /** The menus every branch of the brand is meant to serve. */
  menuIds: Id[];
  /** The brand-level price list branch prices are compared with. */
  priceListId: Id | null;
  /** A branch price more than this far from standard is a deviation. */
  priceTolerancePercent: number;
  updatedAt: IsoDateTime;
}

export type OverrideStatus = "pending" | "approved" | "rejected";

/** FR-BRN-007 — one branch's change to one line of a centrally managed recipe. */
export interface RecipeOverrideLine {
  lineId: Id;
  componentName: Localised;
  unit: string;
  standardQuantity: string;
  /** "0" removes the component at this branch. */
  branchQuantity: string;
}

export interface RecipeOverride {
  id: Id;
  branchId: Id;
  recipeId: Id;
  recipeName: Localised;
  /** The published version the override was written against. */
  recipeVersion: number;
  lines: RecipeOverrideLine[];
  reason: string;
  status: OverrideStatus;
  requestedBy: string | null;
  requestedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
}

export interface MenuDeviation {
  branchId: Id;
  /** Standard menus the branch does not serve. */
  missing: Menu[];
  /** Menus served that are not part of the standard. */
  extra: Menu[];
}

export function menuDeviations(branchIds: Id[], standard: BrandStandard | null, menus: Menu[]): MenuDeviation[] {
  if (!standard) return [];
  const standardSet = new Set(standard.menuIds);
  return branchIds
    .map((branchId) => {
      const served = menus.filter((menu) => menu.active && menu.branchIds.includes(branchId));
      return {
        branchId,
        missing: menus.filter((menu) => standardSet.has(menu.id) && !menu.branchIds.includes(branchId)),
        extra: served.filter((menu) => !standardSet.has(menu.id)),
      };
    })
    .filter((row) => row.missing.length > 0 || row.extra.length > 0);
}

export interface PriceDeviation {
  branchId: Id;
  priceListId: Id;
  priceListName: Localised;
  menuItemId: Id;
  variantId: Id;
  itemName: Localised;
  standard: Money;
  branch: Money;
  /** Branch − standard, minor units. */
  difference: number;
  percent: number;
  beyondTolerance: boolean;
}

/**
 * FR-BRN-006 — every branch-scoped price that differs from the brand's
 * standard list. A branch-scoped price list *is* the override; a branch with
 * none charges the standard and has nothing to report.
 */
export function priceDeviations(branchIds: Id[], standard: BrandStandard | null, lists: PriceList[]): PriceDeviation[] {
  if (!standard?.priceListId) return [];
  const base = lists.find((row) => row.id === standard.priceListId);
  if (!base) return [];
  const standardByVariant = new Map(base.entries.map((entry) => [entry.variantId, entry]));
  const out: PriceDeviation[] = [];
  for (const list of lists) {
    if (list.scope !== "branch" || !list.scopeId || !branchIds.includes(list.scopeId) || !list.active) continue;
    for (const entry of list.entries) {
      const reference = standardByVariant.get(entry.variantId);
      if (!reference || reference.price.currency !== entry.price.currency) continue;
      const difference = entry.price.amount - reference.price.amount;
      if (difference === 0) continue;
      const percent = reference.price.amount === 0 ? 100 : (difference / reference.price.amount) * 100;
      out.push({
        branchId: list.scopeId,
        priceListId: list.id,
        priceListName: list.name,
        menuItemId: entry.menuItemId,
        variantId: entry.variantId,
        itemName: entry.itemName,
        standard: reference.price,
        branch: entry.price,
        difference,
        percent,
        beyondTolerance: Math.abs(percent) > standard.priceTolerancePercent,
      });
    }
  }
  return out;
}

export interface RecipeDeviation {
  override: RecipeOverride;
  /** The central recipe moved on since the override was written. */
  stale: boolean;
  changedLines: number;
}

export function recipeDeviations(branchIds: Id[], overrides: RecipeOverride[], recipes: Recipe[]): RecipeDeviation[] {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  return overrides
    .filter((row) => branchIds.includes(row.branchId) && row.status !== "rejected")
    .map((override) => ({
      override,
      stale: (byId.get(override.recipeId)?.version ?? override.recipeVersion) !== override.recipeVersion,
      changedLines: override.lines.filter((line) => line.branchQuantity !== line.standardQuantity).length,
    }));
}

// ---------------------------------------------------------------------------
// Central-kitchen transfer pricing — FR-BRN-030
// ---------------------------------------------------------------------------

export type TransferPricingMethod = "cost" | "cost_plus" | "fixed";

export interface TransferPricingPolicy {
  /** One per kitchen; the id is the kitchen id. */
  id: Id;
  kitchenId: Id;
  method: TransferPricingMethod;
  /** cost_plus only — markup on production cost, percent. */
  markupPercent: number;
  /** fixed only — price per unit by stock item id, minor units. */
  fixedPrices: Record<Id, number>;
  currency: Currency;
  /** The tenant's reading of the kitchen. Derived from `method` but stated. */
  evaluatedAs: "cost_centre" | "profit_centre";
  effectiveFrom: IsoDate;
  updatedAt: IsoDateTime;
}

export function evaluationFor(method: TransferPricingMethod): TransferPricingPolicy["evaluatedAs"] {
  return method === "cost" ? "cost_centre" : "profit_centre";
}

/**
 * The per-unit price a branch is charged, in minor units. `null` for a fixed
 * policy with no price set for that item — the kitchen cannot invoice what
 * nobody priced, and inventing cost as a fallback would hide the gap.
 */
export function transferUnitPrice(policy: TransferPricingPolicy | null, itemId: Id, unitCostMinor: number): number | null {
  if (!policy || policy.method === "cost") return unitCostMinor;
  if (policy.method === "cost_plus") return Math.round(unitCostMinor * (1 + policy.markupPercent / 100));
  const fixed = policy.fixedPrices[itemId];
  return typeof fixed === "number" ? fixed : null;
}

export interface TransferCharge {
  distributionId: Id;
  number: string;
  branchId: Id;
  branchName: Localised;
  itemId: Id;
  itemName: Localised;
  quantity: string;
  unitCostMinor: number;
  unitPriceMinor: number | null;
  costMinor: number;
  chargeMinor: number | null;
  /** Kitchen margin on this line; null when unpriced. */
  marginMinor: number | null;
  dispatchedAt: IsoDateTime | null;
}

/** Decimal-string quantity × minor unit price, rounded half-up once. */
export function extend(quantity: string, unitMinor: number): number {
  const [whole, fraction = ""] = quantity.trim().split(".");
  const digits = fraction.length;
  const scaled = BigInt(`${whole || "0"}${fraction}`);
  const product = scaled * BigInt(unitMinor);
  const divisor = 10n ** BigInt(digits);
  return Number((product * 2n + divisor) / (divisor * 2n));
}
