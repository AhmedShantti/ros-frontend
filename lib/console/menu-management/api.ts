/**
 * Menu Management demo sandbox — the ONLY place the DEMO workspace
 * (`./menu-management.tsx`) talks to data.
 *
 * MENU-MANAGEMENT-CANONICAL-INTEGRATION-P0 — this used to pick between an
 * HTTP adapter calling invented `/menu-management/*` endpoints (removed —
 * no such routes exist on the backend, see `docs/MENU_MANAGEMENT_API.md`'s
 * rewrite) and this in-memory store, gated on a bespoke
 * `NEXT_PUBLIC_MENU_MANAGEMENT_API` env var. That switch is gone.
 *
 * `menuManagementApi` is now unconditionally the in-memory demo store: the
 * production/live implementation is a SEPARATE component,
 * `components/console/menu-management/live-menu-management.tsx`, built
 * directly on `services.catalogue` (the app's real, canonical, already
 * `DATA_MODE`-aware service registry) — never on this file. Which one
 * renders is decided once, in `app/(console)/menu/management/page.tsx`, by
 * `DATA_MODE` itself (`lib/api/config.ts`), the same switch every other
 * console screen already uses — not by anything declared here.
 */

import { memoryMenuManagementApi } from "./memory-adapter";
import type {
  MmBrand,
  MmBranch,
  MmCategory,
  MmCombo,
  MmComboInput,
  MmCreateMenuInput,
  MmId,
  MmItem,
  MmItemInput,
  MmMenu,
  MmMenuContent,
  MmModifierGroup,
  MmModifierGroupInput,
  MmStatus,
} from "./types";

export interface MenuManagementApi {
  // Scope (used when creating a menu)
  listBrands(): Promise<MmBrand[]>;
  listBranches(): Promise<MmBranch[]>;

  // Menus
  listMenus(): Promise<MmMenu[]>;
  createMenu(data: MmCreateMenuInput): Promise<MmMenu>;
  publishMenu(menuId: MmId): Promise<MmMenu>;

  /** Everything inside one menu: categories (with their items) + combos. */
  getMenuContent(menuId: MmId): Promise<MmMenuContent>;

  // Categories
  createCategory(menuId: MmId, data: { name: string }): Promise<MmCategory>;

  // Items
  createItem(menuId: MmId, data: MmItemInput): Promise<MmItem>;
  updateItem(itemId: MmId, data: MmItemInput): Promise<MmItem>;
  setItemStatus(itemId: MmId, status: MmStatus): Promise<MmItem>;
  deleteItem(itemId: MmId): Promise<void>;

  // Combos
  createCombo(menuId: MmId, data: MmComboInput): Promise<MmCombo>;
  updateCombo(comboId: MmId, data: MmComboInput): Promise<MmCombo>;
  setComboStatus(comboId: MmId, status: MmStatus): Promise<MmCombo>;
  deleteCombo(comboId: MmId): Promise<void>;

  // Customization (modifier) groups — shared across menus
  listModifierGroups(): Promise<MmModifierGroup[]>;
  createModifierGroup(data: MmModifierGroupInput): Promise<MmModifierGroup>;
  updateModifierGroup(groupId: MmId, data: MmModifierGroupInput): Promise<MmModifierGroup>;
  deleteModifierGroup(groupId: MmId): Promise<void>;
}

export const menuManagementApi: MenuManagementApi = memoryMenuManagementApi;
