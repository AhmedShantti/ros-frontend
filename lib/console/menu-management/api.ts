/**
 * Menu Management — the ONLY place the workspace talks to data.
 *
 * `menuManagementApi` is chosen once, here:
 *
 *   NEXT_PUBLIC_MENU_MANAGEMENT_API=http   → `httpMenuManagementApi`
 *                                             (real backend, through the
 *                                             console's authenticated
 *                                             `lib/api/client`)
 *   anything else / unset                  → `memoryMenuManagementApi`
 *                                             (empty in-memory store; nothing
 *                                             is saved, resets on refresh)
 *
 * It defaults to memory even when NEXT_PUBLIC_API_URL is set, because the
 * endpoints in `docs/MENU_MANAGEMENT_API.md` are a proposal the backend does
 * not serve yet. Flip the flag once they exist.
 */

import { httpMenuManagementApi } from "./http-adapter";
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

export const MENU_MANAGEMENT_API_MODE: "http" | "memory" =
  process.env.NEXT_PUBLIC_MENU_MANAGEMENT_API === "http" ? "http" : "memory";

export const menuManagementApi: MenuManagementApi =
  MENU_MANAGEMENT_API_MODE === "http" ? httpMenuManagementApi : memoryMenuManagementApi;
