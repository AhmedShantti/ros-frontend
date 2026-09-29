/**
 * Menu Management — LIVE data layer (production/HTTP mode).
 *
 * Composes the canonical `/catalogue/*` endpoints for the two shapes the
 * generic `services.catalogue` registry does not expose the way this
 * workspace needs:
 *
 *  - Categories hang off ONE menu on the backend (`GET/POST
 *    /catalogue/menus/{menuId}/categories`), but `services.catalogue.categories`
 *    flattens every menu's categories into one tenant-wide list and drops
 *    which menu each came from — the legacy `/menu/categories` screen never
 *    needed it, but this workspace is menu-first, so it calls the
 *    menu-scoped routes directly.
 *  - `services.catalogue.items.list()` returns every item's `categoryId` as
 *    `""` — the API only exposes placements per item
 *    (`GET /catalogue/items/{id}/placements`), never per category — so
 *    grouping the tenant's items by category means resolving each item's
 *    placements once, the same per-row fan-out `services.catalogue.menus.list()`
 *    already does for branch assignments.
 *
 * Everything else (menus, activation, branch assignment, resolution, item
 * create/update/status, tax classes, variants) goes straight through
 * `services.catalogue`, unchanged — see `live-menu-management.tsx`.
 */

import { api } from "@/lib/api/endpoints";
import { DATA_MODE } from "@/lib/api/config";
import { getTenantId } from "@/lib/api/session";
import { localised, toNameMap, toVariant } from "@/lib/console/services/map";
import { services } from "@/lib/console/services";
import type { Scope } from "@/lib/console/services";
import type { Id, MenuCategory, MenuItem, ModifierGroup } from "@/lib/console/types";

function toLiveCategory(row: {
  id: string;
  menuId: string;
  parentCategoryId: string | null;
  name: Record<string, unknown>;
  sortOrder: number;
  colour: string | null;
}): LiveCategory {
  return {
    id: row.id,
    tenantId: getTenantId() ?? "",
    menuId: row.menuId,
    name: localised(row.name),
    parentId: row.parentCategoryId,
    sortOrder: row.sortOrder,
    colour: row.colour || "#0f6f7a",
    itemCount: 0,
    // gap: categories carry no lifecycle column on this backend (C-09).
    active: true,
  };
}

export interface LiveCategory extends MenuCategory {
  menuId: Id;
}

/** `GET /catalogue/menus/{menuId}/categories` — this menu's categories only. */
export async function listMenuCategories(menuId: Id): Promise<LiveCategory[]> {
  if (DATA_MODE === "mock") return (await demoCategories()).map((category) => ({ ...category, menuId }));
  const rows = await api.catalogue.listCategories(menuId);
  return rows.map(toLiveCategory).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** `POST /catalogue/menus/{menuId}/categories` — no delete/deactivate exists on this backend. */
export async function createMenuCategory(
  menuId: Id,
  input: { name: string; sortOrder?: number },
): Promise<LiveCategory> {
  if (DATA_MODE === "mock") {
    const created = await services.catalogue.categories.create({
      name: { en: input.name, ar: input.name },
      sortOrder: input.sortOrder,
    });
    return { ...created, menuId };
  }
  const row = await api.catalogue.createCategory(menuId, {
    name: toNameMap(input.name),
    sortOrder: input.sortOrder,
  });
  return toLiveCategory(row);
}

export interface LiveItem extends MenuItem {
  /** Every category (across every menu) this item is placed in. */
  placements: { categoryId: Id; menuId: Id }[];
  /** This item's attached customization groups (reference's "modifier chips"/slot summary) — read via CONSOLE-COMBO-READ-P0. */
  modifierGroups: ModifierGroup[];
}

/**
 * Every tenant item, with its real category placements, variants, AND
 * attached modifier groups resolved.
 *
 * `services.catalogue.items.list()` is the source of the item rows
 * themselves (name, tax class, availability, sort order — everything that is
 * NOT placement, variant, or modifier-group attachment); this adds all
 * three, each its own `Promise.all` fan-out over the raw
 * `/catalogue/items/{id}/*` routes (not the heavier `items.get()`, which
 * would also redundantly re-fetch the tenant-wide 86 index once per item) —
 * the SAME N+1 shape this function already accepted for placements and
 * variants, extended by one more parallel wave rather than doubled.
 */
export async function listItemsWithPlacements(scope: Scope): Promise<LiveItem[]> {
  const page = await services.catalogue.items.list({ limit: 500, scope });
  if (DATA_MODE === "mock") return demoItems(page.rows);
  const [placements, variantRows, modifierGroupRows] = await Promise.all([
    Promise.all(page.rows.map((item) => api.catalogue.listPlacements(item.id).catch(() => []))),
    Promise.all(page.rows.map((item) => api.catalogue.listVariants(item.id).catch(() => []))),
    Promise.all(page.rows.map((item) => services.catalogue.listItemModifierGroups(item.id).catch(() => []))),
  ]);
  return page.rows.map((item, index) => {
    const rows = placements[index] ?? [];
    const variants = (variantRows[index] ?? []).map((row) => toVariant(row));
    const modifierGroups = modifierGroupRows[index] ?? [];
    return { ...item, categoryId: rows[0]?.categoryId ?? "", placements: rows, variants, modifierGroups };
  });
}

// ---------------------------------------------------------------------------
// Demo mode (no backend configured)
// ---------------------------------------------------------------------------

/*
 * The `/catalogue/*` routes above do not exist without a backend, so in demo
 * mode the same shapes are read from the in-memory service layer instead.
 * The demo catalogue has one tenant-wide set of categories (they carry no
 * menu), so every menu shows the same categories; each item's single
 * `categoryId` becomes its one placement, and its variants are already on
 * the item row.
 */

async function demoCategories(): Promise<MenuCategory[]> {
  const page = await services.catalogue.categories.list({ limit: 500 });
  return [...page.rows].sort((a, b) => a.sortOrder - b.sortOrder);
}

async function demoItems(rows: MenuItem[]): Promise<LiveItem[]> {
  const groups = await Promise.all(rows.map((item) => services.catalogue.listItemModifierGroups(item.id).catch(() => [])));
  return rows.map((item, index) => ({
    ...item,
    placements: item.categoryId ? [{ categoryId: item.categoryId, menuId: "" }] : [],
    modifierGroups: groups[index] ?? [],
  }));
}
