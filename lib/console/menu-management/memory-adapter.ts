/**
 * Offline stand-in for the backend: the same `MenuManagementApi` as the HTTP
 * adapter, backed by an EMPTY in-memory store. No demo data. Everything is
 * lost on refresh. It mirrors the server rules in `docs/MENU_MANAGEMENT_API.md`
 * so the workspace behaves the same way it will against a real backend.
 */

import { ServiceError } from "@/lib/console/services/types";
import type { MenuManagementApi } from "./api";
import type { MmCategory, MmCombo, MmId, MmItem, MmMenu, MmModifierGroup } from "./types";

type StoredCategory = Omit<MmCategory, "items"> & { position: number };
type StoredItem = MmItem & { position: number };
type StoredCombo = MmCombo & { menuId: MmId };

const db = {
  menus: [] as MmMenu[],
  categories: [] as StoredCategory[],
  items: [] as StoredItem[],
  combos: [] as StoredCombo[],
  groups: [] as MmModifierGroup[],
};

let seq = 1;
const newId = () => seq++;
const clone = <T,>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
const delay = <T,>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(clone(value)), 120));
const notFound = (): Promise<never> => Promise.reject(new ServiceError("NOT_FOUND", "Not found", 404));

/** The server assigns real ids to nested rows that still carry temporary (string) ids. */
const fixIds = <T extends { id: MmId }>(rows: T[] | undefined): T[] =>
  (rows || []).map((row) => ({ ...row, id: typeof row.id === "number" ? row.id : newId() }));

const touch = (menuId: MmId | undefined) => {
  const menu = db.menus.find((m) => m.id === menuId);
  if (menu) menu.hasUnpublishedChanges = true;
};
const menuOfCategory = (categoryId: MmId) => db.categories.find((c) => c.id === categoryId)?.menuId;
const touchMenusUsingGroup = (groupId: MmId) =>
  db.items.filter((i) => (i.modifierGroupIds || []).includes(groupId)).forEach((i) => touch(menuOfCategory(i.categoryId)));

export const memoryMenuManagementApi: MenuManagementApi = {
  listBrands: () => delay([]),
  listBranches: () => delay([]),

  listMenus: () => delay(db.menus),
  createMenu: (data) => {
    const menu: MmMenu = {
      id: newId(),
      name: data.name,
      description: data.description || "",
      brandId: data.brandId ?? null,
      branchIds: data.branchIds || [],
      hasUnpublishedChanges: true,
      publishedAt: null,
    };
    db.menus.push(menu);
    return delay(menu);
  },
  publishMenu: (menuId) => {
    const menu = db.menus.find((m) => m.id === menuId);
    if (!menu) return notFound();
    menu.hasUnpublishedChanges = false;
    menu.publishedAt = new Date().toISOString();
    return delay(menu);
  },

  getMenuContent: (menuId) => {
    const categories = db.categories
      .filter((c) => c.menuId === menuId)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ ...c, items: db.items.filter((i) => i.categoryId === c.id).sort((a, b) => a.position - b.position) }));
    return delay({ categories, combos: db.combos.filter((c) => c.menuId === menuId) });
  },

  createCategory: (menuId, data) => {
    const category: StoredCategory = {
      id: newId(),
      menuId,
      name: data.name,
      position: db.categories.filter((c) => c.menuId === menuId).length,
    };
    db.categories.push(category);
    touch(menuId);
    return delay({ ...category, items: [] });
  },

  createItem: (menuId, data) => {
    const item: StoredItem = {
      ...data,
      id: newId(),
      sizes: fixIds(data.sizes),
      position: db.items.filter((i) => i.categoryId === data.categoryId).length,
    };
    db.items.push(item);
    touch(menuId);
    return delay(item);
  },
  updateItem: (itemId, data) => {
    const idx = db.items.findIndex((i) => i.id === itemId);
    if (idx === -1) return notFound();
    db.items[idx] = { ...db.items[idx]!, ...data, id: itemId, sizes: fixIds(data.sizes) };
    touch(menuOfCategory(db.items[idx]!.categoryId));
    return delay(db.items[idx]!);
  },
  setItemStatus: (itemId, status) => {
    const item = db.items.find((i) => i.id === itemId);
    if (!item) return notFound();
    item.status = status;
    touch(menuOfCategory(item.categoryId));
    return delay(item);
  },
  deleteItem: (itemId) => {
    const item = db.items.find((i) => i.id === itemId);
    if (!item) return notFound();
    db.items = db.items.filter((i) => i.id !== itemId);
    db.combos.forEach((c) => c.slots.forEach((s) => { s.itemIds = s.itemIds.filter((x) => x !== itemId); }));
    touch(menuOfCategory(item.categoryId));
    return delay(undefined);
  },

  createCombo: (menuId, data) => {
    const combo: StoredCombo = { ...data, id: newId(), menuId, slots: fixIds(data.slots) };
    db.combos.push(combo);
    touch(menuId);
    return delay(combo);
  },
  updateCombo: (comboId, data) => {
    const idx = db.combos.findIndex((c) => c.id === comboId);
    if (idx === -1) return notFound();
    db.combos[idx] = { ...db.combos[idx]!, ...data, id: comboId, slots: fixIds(data.slots) };
    touch(db.combos[idx]!.menuId);
    return delay(db.combos[idx]!);
  },
  setComboStatus: (comboId, status) => {
    const combo = db.combos.find((c) => c.id === comboId);
    if (!combo) return notFound();
    combo.status = status;
    touch(combo.menuId);
    return delay(combo);
  },
  deleteCombo: (comboId) => {
    const combo = db.combos.find((c) => c.id === comboId);
    db.combos = db.combos.filter((c) => c.id !== comboId);
    if (combo) touch(combo.menuId);
    return delay(undefined);
  },

  listModifierGroups: () => delay(db.groups),
  createModifierGroup: (data) => {
    const group: MmModifierGroup = { ...data, id: newId(), options: fixIds(data.options) };
    db.groups.push(group);
    return delay(group);
  },
  updateModifierGroup: (groupId, data) => {
    const idx = db.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return notFound();
    db.groups[idx] = { ...data, id: groupId, options: fixIds(data.options) };
    touchMenusUsingGroup(groupId);
    return delay(db.groups[idx]!);
  },
  deleteModifierGroup: (groupId) => {
    touchMenusUsingGroup(groupId);
    db.groups = db.groups.filter((g) => g.id !== groupId);
    db.items.forEach((i) => { i.modifierGroupIds = (i.modifierGroupIds || []).filter((x) => x !== groupId); });
    return delay(undefined);
  },
};

/** Test helper — wipes the in-memory store. */
export function resetMemoryMenuManagementStore(): void {
  db.menus = [];
  db.categories = [];
  db.items = [];
  db.combos = [];
  db.groups = [];
  seq = 1;
}
