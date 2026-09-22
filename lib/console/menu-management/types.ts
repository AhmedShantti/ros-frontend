/**
 * Menu Management — data shapes.
 *
 * These are the shapes the Menu Management workspace (`/menu/management`)
 * reads and writes through `MenuManagementApi` (see `./api.ts`). The wire
 * contract a backend should serve is documented in
 * `docs/MENU_MANAGEMENT_API.md`; these types mirror it one-to-one.
 *
 * Deliberately separate from the catalogue types in `lib/console/types.ts`:
 * this workspace is a second, self-contained take on menu editing, kept side
 * by side with the existing `/menu/*` screens so the two can be compared.
 */

export type MmId = string | number;

export type MmStatus = "available" | "unavailable" | "hidden";
export type MmPricingMode = "single" | "channel" | "size";
export type MmChannel = "dineIn" | "takeaway" | "delivery";

export interface MmBrand {
  id: MmId;
  name: string;
}

export interface MmBranch {
  id: MmId;
  name: string;
  brandId: MmId | null;
}

export interface MmMenu {
  id: MmId;
  name: string;
  description: string;
  brandId: MmId | null;
  /** Empty = all branches. */
  branchIds: MmId[];
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
}

export interface MmSize {
  id: MmId;
  name: string;
  price: number | string;
}

export interface MmItem {
  id: MmId;
  categoryId: MmId;
  name: string;
  kitchenName: string;
  description: string;
  status: MmStatus;
  pricingMode: MmPricingMode;
  price: number | string;
  /** Only used when pricingMode = "channel"; null/"" = same as `price`. */
  channelPrices: { takeaway: number | string | null; delivery: number | string | null };
  /** Only used when pricingMode = "size". */
  sizes: MmSize[];
  modifierGroupIds: MmId[];
  position?: number;
}

/** An item as listed in the workspace, joined with its category. */
export interface MmListedItem extends MmItem {
  categoryName: string;
}

export interface MmCategory {
  id: MmId;
  menuId: MmId;
  name: string;
  position?: number;
  items: MmItem[];
}

export type MmComboPricing = "fixed" | "discount";

export interface MmComboSlot {
  id: MmId;
  label: string;
  /** Customer picks one; the first is the default. */
  itemIds: MmId[];
}

export interface MmCombo {
  id: MmId;
  menuId?: MmId;
  name: string;
  description: string;
  status: MmStatus;
  pricing: MmComboPricing;
  price: number | string | null;
  discountPercent: number | string | null;
  slots: MmComboSlot[];
}

export interface MmModifierOption {
  id: MmId;
  name: string;
  /** Extra charge. */
  price: number | string;
}

export interface MmModifierGroup {
  id: MmId;
  name: string;
  required: boolean;
  multiple: boolean;
  maxSelections: number | string | null;
  options: MmModifierOption[];
}

export interface MmMenuContent {
  categories: MmCategory[];
  combos: MmCombo[];
}

/* ----- Request payloads (ids omitted; server assigns them) ----- */

export interface MmCreateMenuInput {
  name: string;
  description: string;
  brandId: MmId | null;
  branchIds: MmId[];
}

export type MmItemInput = Omit<MmItem, "id" | "position">;
export type MmComboInput = Omit<MmCombo, "id" | "menuId">;
export type MmModifierGroupInput = Omit<MmModifierGroup, "id">;
