import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Direct variant pricing — no Price List concept anywhere in this workspace.
 *
 * Proves the acceptance test the removal of Price Lists is built around:
 *
 *   Add Item -> enter item details + price in the same form -> Save once
 *   -> the item is immediately sellable at that price.
 *
 * Also proves an existing variant's price is edited directly, in place, and
 * that no Price List picker/drawer/copy renders anywhere in this workspace.
 */

const menusList = vi.fn();
const itemsList = vi.fn();
const itemsGet = vi.fn();
const itemsCreate = vi.fn();
const placeItem = vi.fn();
const addVariant = vi.fn();
const updateVariantPrice = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  services: {
    catalogue: {
      menus: {
        list: (...args: unknown[]) => menusList(...args),
        create: vi.fn(),
        get: (id: string) =>
          Promise.resolve({ id, name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: [], branchIds: [], active: true }),
      },
      setMenuActive: vi.fn(),
      assignMenuToBranch: vi.fn(),
      unassignMenuFromBranch: vi.fn(),
      resolveBranchMenus: vi.fn().mockResolvedValue({ menus: [], ambiguous: false, warning: null }),
      toggleAvailability: vi.fn(),
      items: {
        list: (...args: unknown[]) => itemsList(...args),
        get: (...args: unknown[]) => itemsGet(...args),
        create: (...args: unknown[]) => itemsCreate(...args),
        update: vi.fn(),
        remove: vi.fn(),
      },
      placeItem: (...args: unknown[]) => placeItem(...args),
      addVariant: (...args: unknown[]) => addVariant(...args),
      updateVariantPrice: (...args: unknown[]) => updateVariantPrice(...args),
      modifierGroups: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      addModifier: vi.fn(),
    },
  },
}));

const listMenuCategoriesMock = vi.fn();
const createMenuCategoryMock = vi.fn();
const listItemsWithPlacementsMock = vi.fn();

vi.mock("@/lib/console/menu-management/live-adapter", () => ({
  listMenuCategories: (...args: unknown[]) => listMenuCategoriesMock(...args),
  createMenuCategory: (...args: unknown[]) => createMenuCategoryMock(...args),
  listItemsWithPlacements: (...args: unknown[]) => listItemsWithPlacementsMock(...args),
}));

vi.mock("@/components/console/catalogue/tax-class-field", () => ({
  TaxClassField: () => null,
  useTaxClassLabel: () => ({ text: "—", tone: "muted" as const }),
}));

const granted = new Set<string>(["menu.item.manage", "menu.availability.toggle", "menu.price.read", "menu.price.change"]);

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) => (typeof value === "string" ? value : ((value as { en?: string })?.en ?? "")),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  usePermission: (perm: string) => granted.has(perm),
  useSession: () => ({
    scope: { tenantId: "t1", brandId: null, branchId: null },
    availableBranches: [{ id: "br1", name: { en: "Downtown", ar: "" }, brandId: "b1" }],
    tenant: { id: "t1", name: { en: "Acme", ar: "أكمي" }, baseCurrency: "EGP" },
    brand: null,
    branch: null,
  }),
}));

import LiveMenuManagement from "./live-menu-management";

const menu = () => ({
  id: "m1",
  name: { en: "Lunch", ar: "غداء" },
  priority: 10,
  orderTypes: [],
  branchIds: [],
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
});

const category = () => ({
  id: "c1",
  menuId: "m1",
  name: { en: "Mains", ar: "" },
  parentId: null,
  sortOrder: 0,
  colour: "#111",
  itemCount: 0,
  active: true,
  tenantId: "t1",
});

describe("Live Menu Management — direct variant pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });
    listMenuCategoriesMock.mockResolvedValue([category()]);
    listItemsWithPlacementsMock.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("creates an item with its price entered in the SAME form, in one Save — no Price List step", async () => {
    itemsCreate.mockResolvedValue({
      id: "item-1",
      variants: [{ id: "variant-1", name: { en: "Burger", ar: "Burger" }, basePrice: { amount: 1250, currency: "EGP" } }],
    });

    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    await user.click(await screen.findByRole("button", { name: "menu.newItem" }));
    await user.type(screen.getByLabelText(/common\.name/), "Burger");
    await user.click(screen.getByLabelText(/common\.category/));
    await user.click(screen.getByRole("option", { name: "Mains" }));
    await user.type(screen.getByLabelText(/menu\.price/), "12.50");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(itemsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { en: "Burger", ar: "Burger" },
          variants: [
            {
              name: { en: "Burger", ar: "Burger" },
              price: { amount: 1250, currency: "EGP" },
            },
          ],
        }),
      ),
    );
    // C-02 placement is a separate call, but part of the SAME user action —
    // no second workflow, no intermediate "unpriced" state was ever shown.
    await waitFor(() => expect(placeItem).toHaveBeenCalledWith("item-1", "c1"));
  });

  it("edits an existing variant's price directly — no Price List to open first", async () => {
    itemsList.mockResolvedValue({ rows: [], total: 0 });
    listItemsWithPlacementsMock.mockResolvedValue([
      {
        id: "item-1",
        name: { en: "Burger", ar: "" },
        kitchenName: { en: "", ar: "" },
        description: { en: "", ar: "" },
        categoryId: "c1",
        available: true,
        unavailableReason: null,
        autoReenableAt: null,
        variants: [],
        placements: [{ categoryId: "c1" }],
      },
    ]);
    itemsGet.mockResolvedValue({
      id: "item-1",
      name: { en: "Burger", ar: "" },
      kitchenName: { en: "", ar: "" },
      description: { en: "", ar: "" },
      categoryId: "c1",
      available: true,
      unavailableReason: null,
      autoReenableAt: null,
      variants: [{ id: "variant-1", name: { en: "Regular", ar: "" }, basePrice: { amount: 1000, currency: "EGP" } }],
    });
    updateVariantPrice.mockResolvedValue({
      id: "variant-1",
      name: { en: "Regular", ar: "" },
      basePrice: { amount: 1500, currency: "EGP" },
    });

    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    await user.click(await screen.findByText("Burger"));
    const variantRow = (await screen.findByText("Regular")).closest("li")!;

    await user.click(within(variantRow).getByRole("button", { name: "common.edit" }));
    await user.type(within(variantRow).getByLabelText(/menu\.price/), "15.00");
    await user.click(within(variantRow).getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(updateVariantPrice).toHaveBeenCalledWith("variant-1", { amount: 1500, currency: "EGP" }));
  });

  it("never renders a Price List picker, drawer, or copy anywhere in this workspace", async () => {
    render(<LiveMenuManagement />);

    await screen.findByText("Lunch");
    expect(screen.queryByText(/price list/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new.*price.*list/i })).not.toBeInTheDocument();
  });
});
