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
import { getTenantId } from "@/lib/api/session";
import { localised, toNameMap } from "@/lib/console/services/map";
import { services } from "@/lib/console/services";
import type { Scope } from "@/lib/console/services";
import type { Id, MenuCategory, MenuItem } from "@/lib/console/types";

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
  const rows = await api.catalogue.listCategories(menuId);
  return rows.map(toLiveCategory).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** `POST /catalogue/menus/{menuId}/categories` — no delete/deactivate exists on this backend. */
export async function createMenuCategory(
  menuId: Id,
  input: { name: string; sortOrder?: number },
): Promise<LiveCategory> {
  const row = await api.catalogue.createCategory(menuId, {
    name: toNameMap(input.name),
    sortOrder: input.sortOrder,
  });
  return toLiveCategory(row);
}

export interface LiveItem extends MenuItem {
  /** Every category (across every menu) this item is placed in. */
  placements: { categoryId: Id; menuId: Id }[];
}

/**
 * Every tenant item, with its real category placements resolved.
 *
 * `services.catalogue.items.list()` is the source of the item rows
 * themselves (name, tax class, availability, sort order — everything that is
 * NOT placement); this only adds what `list()` cannot carry.
 */
export async function listItemsWithPlacements(scope: Scope): Promise<LiveItem[]> {
  const page = await services.catalogue.items.list({ limit: 500, scope });
  const placements = await Promise.all(
    page.rows.map((item) => api.catalogue.listPlacements(item.id).catch(() => [])),
  );
  return page.rows.map((item, index) => {
    const rows = placements[index] ?? [];
    return { ...item, categoryId: rows[0]?.categoryId ?? "", placements: rows };
  });
}
