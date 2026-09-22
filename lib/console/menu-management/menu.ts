/**
 * Menu Management — pure helpers (no React, no network).
 * Pricing, status labels and currency formatting for the workspace.
 */

import type { MmCategory, MmChannel, MmCombo, MmItem, MmModifierGroup, MmStatus } from "./types";

export const CHANNELS: { key: MmChannel; label: string }[] = [
  { key: "dineIn", label: "Dine-in" },
  { key: "takeaway", label: "Takeaway" },
  { key: "delivery", label: "Delivery" },
];

export const STATUS: Record<MmStatus, { label: string; badge: string; help: string }> = {
  available: { label: "Available", badge: "Available", help: "Shown on the menu and can be ordered." },
  unavailable: { label: "Unavailable", badge: "Sold out", help: "Still shown, marked “Sold out”. Customers can't order it." },
  hidden: { label: "Hidden", badge: "Hidden", help: "Not shown to customers at all." },
};

/** Display currency. Set NEXT_PUBLIC_MENU_CURRENCY / NEXT_PUBLIC_MENU_LOCALE to override. */
const CURRENCY = process.env.NEXT_PUBLIC_MENU_CURRENCY || "USD";
const LOCALE = process.env.NEXT_PUBLIC_MENU_LOCALE || "en-US";
const formatter = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY });

export const CURRENCY_SYMBOL =
  formatter.formatToParts(0).find((p) => p.type === "currency")?.value || CURRENCY;

/** Temporary client-side id for nested rows (sizes, options, slots) before the server assigns one. */
export function tempId(prefix = "tmp"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function hasValue(v: unknown): boolean {
  return v !== "" && v !== null && v !== undefined && Number.isFinite(parseFloat(String(v)));
}

export function money(value: unknown): string {
  return formatter.format(num(value));
}

/** Fill in defaults so the UI can rely on every field existing. */
export function normalizeItem(i: Partial<MmItem> & { id: MmItem["id"] }): MmItem {
  return {
    categoryId: "",
    name: "",
    kitchenName: "",
    description: "",
    modifierGroupIds: [],
    price: 0,
    ...i,
    status: i.status || "available",
    pricingMode: i.pricingMode || "single",
    channelPrices: { takeaway: null, delivery: null, ...(i.channelPrices || {}) },
    sizes: i.sizes || [],
  };
}

/** Price of an item for a channel (sizes → cheapest size). */
export function channelPrice(item: MmItem, channel: MmChannel = "dineIn"): number {
  if (item.pricingMode === "size" && item.sizes?.length) return Math.min(...item.sizes.map((s) => num(s.price)));
  if (item.pricingMode === "channel" && channel !== "dineIn" && hasValue(item.channelPrices?.[channel])) {
    return num(item.channelPrices[channel]);
  }
  return num(item.price);
}

export function priceSummary(item: MmItem): { main: string; sub?: string } {
  if (item.pricingMode === "size" && item.sizes?.length) {
    const min = Math.min(...item.sizes.map((s) => num(s.price)));
    return {
      main: item.sizes.length > 1 ? `From ${money(min)}` : money(min),
      sub: `${item.sizes.length} size${item.sizes.length > 1 ? "s" : ""}`,
    };
  }
  if (item.pricingMode === "channel") {
    const overrides = CHANNELS.filter((c) => c.key !== "dineIn" && hasValue(item.channelPrices?.[c.key as "takeaway" | "delivery"])).length;
    return {
      main: money(item.price),
      sub: overrides ? `+${overrides} channel price${overrides > 1 ? "s" : ""}` : "Same on all channels",
    };
  }
  return { main: money(item.price) };
}

export function ruleText(g: Pick<MmModifierGroup, "required" | "multiple" | "maxSelections">): string {
  const need = g.required ? "Required" : "Optional";
  const pick = g.multiple
    ? hasValue(g.maxSelections) && num(g.maxSelections) > 0
      ? `up to ${num(g.maxSelections)}`
      : "any number"
    : "choose 1";
  return `${need} · ${pick}`;
}

export type ItemIndex = Record<string, MmItem | undefined>;

export function comboRegularPrice(combo: Pick<MmCombo, "slots">, itemById: ItemIndex, channel: MmChannel = "dineIn"): number {
  return combo.slots.reduce((sum, s) => {
    const first = s.itemIds.map((id) => itemById[String(id)]).find(Boolean);
    return sum + (first ? channelPrice(first, channel) : 0);
  }, 0);
}

export function comboPrice(
  combo: Pick<MmCombo, "slots" | "pricing" | "price" | "discountPercent">,
  itemById: ItemIndex,
  channel: MmChannel = "dineIn",
): number {
  if (combo.pricing === "fixed") return num(combo.price);
  const regular = comboRegularPrice(combo, itemById, channel);
  return Math.max(0, regular * (1 - num(combo.discountPercent) / 100));
}

/** A combo can be ordered only if every slot still has at least one orderable item. */
export function comboBlockedSlots(combo: Pick<MmCombo, "slots">, itemById: ItemIndex) {
  return combo.slots.filter((s) => !s.itemIds.some((id) => itemById[String(id)]?.status === "available"));
}

/** Strip client-only fields before sending an item to the API. */
export function toItemPayload(item: MmItem & { categoryName?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, categoryName, ...rest } = item;
  return rest;
}

export function normalizeCategory(c: Partial<MmCategory> & { id: MmCategory["id"] }): MmCategory {
  return {
    menuId: "",
    name: "",
    ...c,
    items: (c.items || []).map((i) => normalizeItem({ ...i, categoryId: i.categoryId ?? c.id })),
  };
}
