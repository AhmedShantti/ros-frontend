/**
 * Menu Management over HTTP — implements `MenuManagementApi` against the
 * endpoints proposed in `docs/MENU_MANAGEMENT_API.md`, through the console's
 * own `lib/api/client` (base URL, bearer token, refresh, error model).
 *
 * All paths sit under `MENU_MANAGEMENT_BASE` so they cannot collide with the
 * existing `/catalogue/*` routes. Change the base or individual paths here if
 * the backend lands them elsewhere — nothing else in the workspace knows URLs.
 */

import { http } from "@/lib/api/client";
import type { MenuManagementApi } from "./api";

export const MENU_MANAGEMENT_BASE = "/menu-management";
const p = (path: string) => `${MENU_MANAGEMENT_BASE}${path}`;
const id = (value: string | number) => encodeURIComponent(String(value));

export const httpMenuManagementApi: MenuManagementApi = {
  listBrands: () => http.get(p("/brands")),
  listBranches: () => http.get(p("/branches")),

  listMenus: () => http.get(p("/menus")),
  createMenu: (data) => http.post(p("/menus"), { body: data }),
  publishMenu: (menuId) => http.post(p(`/menus/${id(menuId)}/publish`)),

  getMenuContent: (menuId) => http.get(p(`/menus/${id(menuId)}/content`)),

  createCategory: (menuId, data) => http.post(p(`/menus/${id(menuId)}/categories`), { body: data }),

  createItem: (menuId, data) => http.post(p(`/menus/${id(menuId)}/items`), { body: data }),
  updateItem: (itemId, data) => http.put(p(`/items/${id(itemId)}`), { body: data }),
  setItemStatus: (itemId, status) => http.patch(p(`/items/${id(itemId)}`), { body: { status } }),
  deleteItem: (itemId) => http.delete(p(`/items/${id(itemId)}`)),

  createCombo: (menuId, data) => http.post(p(`/menus/${id(menuId)}/combos`), { body: data }),
  updateCombo: (comboId, data) => http.put(p(`/combos/${id(comboId)}`), { body: data }),
  setComboStatus: (comboId, status) => http.patch(p(`/combos/${id(comboId)}`), { body: { status } }),
  deleteCombo: (comboId) => http.delete(p(`/combos/${id(comboId)}`)),

  listModifierGroups: () => http.get(p("/modifier-groups")),
  createModifierGroup: (data) => http.post(p("/modifier-groups"), { body: data }),
  updateModifierGroup: (groupId, data) => http.put(p(`/modifier-groups/${id(groupId)}`), { body: data }),
  deleteModifierGroup: (groupId) => http.delete(p(`/modifier-groups/${id(groupId)}`)),
};
