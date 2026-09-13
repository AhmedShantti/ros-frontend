"use client";

/**
 * The parts of a menu item the API has no field for — FR-MNU-004, FR-MNU-005.
 *
 * `PATCH /catalogue/items/{id}` carries the menu name, kitchen name,
 * aggregator name, description, allergens, dietary tags, PLU, colour, sort
 * order, account code and tax class. It has no POS button label, no receipt
 * name and no image. Those three are kept here, per item, and laid over the
 * item wherever it is shown, so the editor can offer all four surfaces the
 * SRS asks for without writing any of them into a field that means something
 * else.
 *
 * Images are downscaled to a 256-pixel data URL before they are stored: a
 * phone photo is several megabytes and browser storage is not a CDN.
 */

import type { Id, Localised, MenuItem } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export interface MenuItemProfile {
  itemId: Id;
  posName: Localised | null;
  receiptName: Localised | null;
  image: string | null;
  updatedAt: string;
}

const store = localCollection<MenuItemProfile>(
  {
    name: "menu-item-profiles",
    idOf: (row) => row.itemId,
    factory: (input) =>
      ({ itemId: input.itemId ?? "", posName: null, receiptName: null, image: null, updatedAt: nowIso(), ...input }) as MenuItemProfile,
  },
  () => getActiveTenantId(),
);

export interface MenuProfileService {
  all(): Promise<MenuItemProfile[]>;
  get(itemId: Id): Promise<MenuItemProfile | null>;
  save(profile: Omit<MenuItemProfile, "updatedAt">): Promise<MenuItemProfile>;
}

export const menuProfileService: MenuProfileService = {
  async all() {
    return store.all();
  },
  async get(itemId) {
    return store.get(itemId);
  },
  async save(profile) {
    const existing = await store.get(profile.itemId);
    const next = { ...profile, updatedAt: nowIso() };
    return existing ? store.update(profile.itemId, next) : store.create(next);
  },
};

function filled(value: Localised | null | undefined): value is Localised {
  return Boolean(value && (value.en.trim() || value.ar.trim()));
}

/** The item as every surface should see it, with the overlay applied. */
export function withProfile(item: MenuItem, profile: MenuItemProfile | null | undefined): MenuItem {
  if (!profile) return item;
  return {
    ...item,
    posName: filled(profile.posName) ? profile.posName : (item.posName ?? null),
    receiptName: filled(profile.receiptName) ? profile.receiptName : item.receiptName,
    imageUrl: profile.image ?? item.imageUrl ?? null,
  };
}

/** Shrink an image file to a square-ish thumbnail data URL. */
export async function thumbnailFrom(file: File, max = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not an image this browser can read."));
      element.src = url;
    });
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize images.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
