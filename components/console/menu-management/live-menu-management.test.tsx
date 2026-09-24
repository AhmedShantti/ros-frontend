import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * MENU-MANAGEMENT-CANONICAL-INTEGRATION-P0 — the LIVE (production) Menu
 * Management workspace, rendered when DATA_MODE === "http". Proves:
 *
 *  1. It loads menus/categories/items through the real, canonical
 *     `services.catalogue` registry — never the memory adapter, never a
 *     `/menu-management/*` call (mocking only `services.catalogue` and the
 *     live-adapter module and asserting on THOSE calls is the proof: there
 *     is no other data path this component could have used).
 *  2. Menu create persists through `services.catalogue.menus.create`.
 *  3. The fake "Published ✓ / dirty" model is gone — activation reflects
 *     `Menu.active` via `setMenuActive`, and no "Publish" control exists.
 *  4. Category create persists via the menu-scoped live-adapter call, and no
 *     delete control is rendered for a category (the backend has none).
 *  5. A read-only session (no `menu.item.manage`) cannot see any mutating
 *     control.
 */

const menusList = vi.fn();
const menusCreate = vi.fn();
const setMenuActive = vi.fn();
const assignMenuToBranch = vi.fn();
const itemsToggleAvailability = vi.fn();

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
        create: (...args: unknown[]) => menusCreate(...args),
        get: (id: string) =>
          Promise.resolve({ id, name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: [], branchIds: [], active: true }),
      },
      setMenuActive: (...args: unknown[]) => setMenuActive(...args),
      assignMenuToBranch: (...args: unknown[]) => assignMenuToBranch(...args),
      unassignMenuFromBranch: vi.fn(),
      resolveBranchMenus: vi.fn().mockResolvedValue({ menus: [], ambiguous: false, warning: null }),
      toggleAvailability: (...args: unknown[]) => itemsToggleAvailability(...args),
      items: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      addVariant: vi.fn(),
      updateVariantPrice: vi.fn(),
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

let granted = new Set<string>(["menu.item.manage", "menu.availability.toggle"]);

/** Mutable so a test can move brand/branch context mid-render and assert the
 * live workspace reads it live, without remounting the component. */
let session = {
  scope: { tenantId: "t1", brandId: null as string | null, branchId: null as string | null },
  availableBranches: [{ id: "br1", name: { en: "Downtown", ar: "" }, brandId: "b1" }],
  tenant: { id: "t1", name: { en: "Acme", ar: "أكمي" }, baseCurrency: "EGP" },
  brand: null as { id: string; name: { en: string; ar: string } } | null,
  branch: null as { id: string; name: { en: string; ar: string }; currency: string } | null,
};

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) => (typeof value === "string" ? value : ((value as { en?: string })?.en ?? "")),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  usePermission: (perm: string) => granted.has(perm),
  useSession: () => session,
}));

import LiveMenuManagement from "./live-menu-management";

const menu = (patch: Partial<{ id: string; name: { en: string; ar: string }; active: boolean; branchIds: string[] }> = {}) => ({
  id: "m1",
  name: { en: "Lunch", ar: "غداء" },
  priority: 10,
  orderTypes: [],
  branchIds: [],
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("Live Menu Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    granted = new Set(["menu.item.manage", "menu.availability.toggle"]);
    session = {
      scope: { tenantId: "t1", brandId: null, branchId: null },
      availableBranches: [{ id: "br1", name: { en: "Downtown", ar: "" }, brandId: "b1" }],
      tenant: { id: "t1", name: { en: "Acme", ar: "أكمي" }, baseCurrency: "EGP" },
      brand: null,
      branch: null,
    };
    listMenuCategoriesMock.mockResolvedValue([]);
    listItemsWithPlacementsMock.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("loads real canonical menus and shows no fake Publish/dirty control", async () => {
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });

    render(<LiveMenuManagement />);

    expect(await screen.findByText("Lunch")).toBeInTheDocument();
    expect(menusList).toHaveBeenCalledWith(expect.objectContaining({ scope: { tenantId: "t1", brandId: null, branchId: null } }));
    expect(screen.queryByText(/Publish/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Published ✓")).not.toBeInTheDocument();
  });

  it("creates a menu through the canonical create call, not a local fake id", async () => {
    menusList.mockResolvedValueOnce({ rows: [], total: 0 }).mockResolvedValue({ rows: [menu({ id: "m2", name: { en: "Dinner", ar: "" } })], total: 1 });
    menusCreate.mockResolvedValue(menu({ id: "m2", name: { en: "Dinner", ar: "" } }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    await user.click(await screen.findByRole("button", { name: "menu.newMenu" }));
    await user.type(screen.getByLabelText(/common\.name/), "Dinner");
    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(menusCreate).toHaveBeenCalledWith(expect.objectContaining({ name: { en: "Dinner", ar: "Dinner" } })));
  });

  it("activates/deactivates through setMenuActive — truthful lifecycle, not a client-side flag", async () => {
    menusList.mockResolvedValue({ rows: [menu({ active: false })], total: 1 });
    setMenuActive.mockResolvedValue(menu({ active: true }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    expect(await screen.findByText("common.inactive")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.activate" }));

    expect(setMenuActive).toHaveBeenCalledWith("m1", true);
  });

  it("creates a category via the menu-scoped live-adapter call and renders no delete control", async () => {
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });
    listMenuCategoriesMock
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "c1", menuId: "m1", name: { en: "Mains", ar: "" }, parentId: null, sortOrder: 0, colour: "#111", itemCount: 0, active: true, tenantId: "t1" }]);
    createMenuCategoryMock.mockResolvedValue({ id: "c1", menuId: "m1", name: { en: "Mains", ar: "" } });

    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    await screen.findByText("Lunch");
    await user.click(await screen.findByRole("button", { name: /menu.newCategory/ }));
    const input = await screen.findByPlaceholderText("menu.categoryNamePlaceholder");
    await user.type(input, "Mains");
    await user.click(screen.getByRole("button", { name: "common.add" }));

    await waitFor(() => expect(createMenuCategoryMock).toHaveBeenCalledWith("m1", { name: "Mains", sortOrder: 0 }));
    await screen.findByText("Mains");
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("hides every mutating control for a read-only session", async () => {
    granted = new Set(); // no menu.item.manage, no menu.availability.toggle
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });

    render(<LiveMenuManagement />);

    await screen.findByText("Lunch");
    expect(screen.queryByRole("button", { name: "menu.newMenu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.activate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.deactivate" })).not.toBeInTheDocument();
    expect(within(document.body).queryByRole("button", { name: /menu.newCategory/ })).not.toBeInTheDocument();
  });
});
