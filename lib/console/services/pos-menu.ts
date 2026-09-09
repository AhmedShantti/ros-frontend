/**
 * View model for `GET /catalogue/pos-menu` (DEMO-POS-MENU-BACKEND-P0) — the
 * only POS-safe catalogue read. It derives the branch from the caller's own
 * terminal binding and returns an already-resolved sellable menu, so this is
 * deliberately its own set of shapes rather than the admin `MenuItem` /
 * `ModifierGroup` in `lib/console/types`: a price is already resolved per
 * variant, availability is already resolved per item/variant, and money
 * deltas arrive as minor units (not the decimal strings the tenant-wide
 * catalogue admin endpoints send) — mixing the two shapes would either lose
 * that resolution or misprice by 100x.
 *
 * DEMO-POS-MENU-FRONTEND-INTEGRATION-P0 — the live POS reads this and
 * nothing else for its menu; see `components/terminal/pos-live.tsx`.
 */

import type { Id, Localised, Money } from "../types";
import { localised, minorMoney } from "./map";
import type * as S from "@/lib/api/schema";

export interface PosMenuModifier {
  id: Id;
  name: Localised;
  kind: "addition" | "removal" | "substitution" | null;
  /** Minor-unit delta; may be negative (a substitution credit). */
  priceDelta: Money;
  isDefault: boolean;
  sortOrder: number;
}

export interface PosMenuModifierGroup {
  id: Id;
  name: Localised;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  allowRepeat: boolean;
  freeQuantityThreshold: number;
  modifiers: PosMenuModifier[];
}

export interface PosMenuVariant {
  id: Id;
  name: Localised;
  barcode: string | null;
  sortOrder: number;
  /** FR-MNU-030/031 — false when this variant is manually 86'd. */
  isAvailable: boolean;
  /** FR-POS-040 — the resolved price at this branch/order type, or null when none applies. */
  price: Money | null;
  /** SRS §7.3 #10 — two price lists tie; price is null and this is why. */
  priceAmbiguous: boolean;
}

export interface PosMenuItem {
  id: Id;
  name: Localised;
  description: Localised | null;
  allergens: string[];
  dietaryTags: string[];
  sortOrder: number;
  colour: string | null;
  barcodePlu: string | null;
  isOpenPrice: boolean;
  isWeighed: boolean;
  /** FR-MNU-030/031 — false when this item is manually 86'd. */
  isAvailable: boolean;
  variants: PosMenuVariant[];
  modifierGroups: PosMenuModifierGroup[];
}

export interface PosMenuCategory {
  id: Id;
  menuId: Id;
  parentCategoryId: Id | null;
  name: Localised;
  sortOrder: number;
  colour: string | null;
  itemIds: Id[];
}

export interface PosMenu {
  branchId: Id;
  orderType: string | null;
  categories: PosMenuCategory[];
  items: PosMenuItem[];
  /** FR-MNU-003 — two active menus tie on priority for this branch. */
  ambiguousMenuPriority: boolean;
  warning: string | null;
}

type WireResponse = S.CatalogueController_getPosMenuResponse;
type WireItem = WireResponse["items"][number];
type WireVariant = WireItem["variants"][number];
type WireModifierGroup = WireItem["modifierGroups"][number];
type WireModifier = WireModifierGroup["modifiers"][number];
type WireCategory = WireResponse["categories"][number];

function bySortOrder<T extends { sortOrder: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
}

function toPosModifier(row: WireModifier): PosMenuModifier {
  return {
    id: row.id,
    name: localised(row.name),
    kind: row.kind,
    priceDelta: minorMoney(row.priceDelta),
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
  };
}

function toPosModifierGroup(row: WireModifierGroup): PosMenuModifierGroup {
  return {
    id: row.id,
    name: localised(row.name),
    minSelections: row.minSelections,
    maxSelections: row.maxSelections,
    isRequired: row.isRequired,
    allowRepeat: row.allowRepeat,
    freeQuantityThreshold: row.freeQuantityThreshold,
    modifiers: bySortOrder(row.modifiers).map(toPosModifier),
  };
}

function toPosVariant(row: WireVariant): PosMenuVariant {
  return {
    id: row.id,
    name: localised(row.name),
    barcode: row.barcode,
    sortOrder: row.sortOrder,
    isAvailable: row.isAvailable,
    price: row.price ? minorMoney(row.price.amountMinorUnits, row.price.currency) : null,
    priceAmbiguous: row.priceAmbiguous,
  };
}

function toPosMenuItem(row: WireItem): PosMenuItem {
  return {
    id: row.id,
    name: localised(row.names),
    description: row.description ? localised(row.description) : null,
    allergens: row.allergens,
    dietaryTags: row.dietaryTags,
    sortOrder: row.sortOrder,
    colour: row.colour,
    barcodePlu: row.barcodePlu,
    isOpenPrice: row.isOpenPrice,
    isWeighed: row.isWeighed,
    isAvailable: row.isAvailable,
    variants: bySortOrder(row.variants).map(toPosVariant),
    modifierGroups: row.modifierGroups.map(toPosModifierGroup),
  };
}

function toPosCategory(row: WireCategory): PosMenuCategory {
  return {
    id: row.id,
    menuId: row.menuId,
    parentCategoryId: row.parentCategoryId,
    name: localised(row.name),
    sortOrder: row.sortOrder,
    colour: row.colour,
    itemIds: row.itemIds,
  };
}

export function toPosMenu(response: WireResponse): PosMenu {
  return {
    branchId: response.branchId,
    orderType: response.orderType,
    categories: bySortOrder(response.categories).map(toPosCategory),
    items: bySortOrder(response.items).map(toPosMenuItem),
    ambiguousMenuPriority: response.ambiguousMenuPriority,
    warning: response.ambiguousMenuPriority ? (response.warning ?? null) : null,
  };
}
