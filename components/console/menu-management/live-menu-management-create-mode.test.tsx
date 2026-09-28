import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * Add Item (CREATE mode) — the Availability and Pricing reference UX must be
 * visible from the moment "+ Add item" opens, BEFORE any save, not only once
 * the drawer is reopened in Edit mode. There is no fake "nothing to disclose
 * yet" exception: the drawer shows the same 3-card StatusPicker and the same
 * Price / "Variants" disclosure / prices-panel shell pre-save as post-save,
 * over unsaved local form state until Save applies the real mutation(s).
 */

const menusList = vi.fn();
const itemsCreate = vi.fn();
const itemsRemove = vi.fn();
const placeItem = vi.fn();
const toggleAvailability = vi.fn();

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
      toggleAvailability: (...args: unknown[]) => toggleAvailability(...args),
      items: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        get: vi.fn(),
        create: (...args: unknown[]) => itemsCreate(...args),
        update: vi.fn(),
        remove: (...args: unknown[]) => itemsRemove(...args),
      },
      placeItem: (...args: unknown[]) => placeItem(...args),
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
  useTaxClasses: () => ({ loading: false, noBranch: false, taxClasses: [] }),
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
    availableBrands: [],
    setBrandId: () => {},
    setBranchId: () => {},
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

async function openAddItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "menu.newItem" }));
  return screen.getByText("menu.newItem", { selector: "h2" }).closest(".drawer") as HTMLElement;
}

describe("Live Menu Management — Add Item (create mode) reference UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });
    listMenuCategoriesMock.mockResolvedValue([category()]);
    listItemsWithPlacementsMock.mockResolvedValue([]);
    itemsCreate.mockResolvedValue({
      id: "item-1",
      variants: [{ id: "variant-1", name: { en: "Burger", ar: "Burger" }, basePrice: { amount: 1250, currency: "EGP" } }],
    });
  });
  afterEach(() => cleanup());

  it("1. renders all 3 Availability cards immediately, before any save", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    expect(within(drawer).getByRole("button", { name: /menu\.available/ })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /menu\.unavailable/ })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /menu\.deactivated/ })).toBeInTheDocument();
    expect(itemsCreate).not.toHaveBeenCalled();
  });

  it("2. the Available card is chosen by default", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    expect(within(drawer).getByRole("button", { name: /menu\.available/ })).toHaveClass("chosen");
    expect(within(drawer).getByRole("button", { name: /menu\.unavailable/ })).not.toHaveClass("chosen");
    expect(within(drawer).getByRole("button", { name: /menu\.deactivated/ })).not.toHaveClass("chosen");
  });

  it("3. selecting Unavailable only changes unsaved create state — no API call until Save", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.click(within(drawer).getByRole("button", { name: /menu\.unavailable/ }));
    // Opens the real 86-reason prompt (a genuine 86 always requires one) —
    // confirming it only records local draft state pre-save.
    const topDialog = within(screen.getAllByRole("dialog")[screen.getAllByRole("dialog").length - 1]!);
    await user.type(topDialog.getByLabelText(/menu\.86Reason/i), "Not ready yet");
    await user.click(topDialog.getByRole("button", { name: "menu.toggle86" }));

    expect(toggleAvailability).not.toHaveBeenCalled();
    expect(itemsCreate).not.toHaveBeenCalled();
    expect(within(drawer).getByRole("button", { name: /menu\.unavailable/ })).toHaveClass("chosen");
  });

  it("4. selecting Deactivated only changes unsaved create state — no API call until Save", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.click(within(drawer).getByRole("button", { name: /menu\.deactivated/ }));

    expect(itemsRemove).not.toHaveBeenCalled();
    expect(itemsCreate).not.toHaveBeenCalled();
    expect(within(drawer).getByRole("button", { name: /menu\.deactivated/ })).toHaveClass("chosen");
  });

  it("5a. Save with the default Available choice creates the item with no extra availability mutation", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.type(within(drawer).getByLabelText("menu.itemNameLabel"), "Burger");
    await user.selectOptions(within(drawer).getByLabelText("common.category"), "c1");
    await user.type(within(drawer).getByLabelText(/menu\.price/), "12.50");
    await user.click(within(drawer).getByRole("button", { name: "menu.addItemButton" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalled());
    expect(toggleAvailability).not.toHaveBeenCalled();
    expect(itemsRemove).not.toHaveBeenCalled();
  });

  it("5b. Save with Deactivated chosen applies the real deactivate mutation right after create, in the same Save", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.type(within(drawer).getByLabelText("menu.itemNameLabel"), "Burger");
    await user.selectOptions(within(drawer).getByLabelText("common.category"), "c1");
    await user.type(within(drawer).getByLabelText(/menu\.price/), "12.50");
    await user.click(within(drawer).getByRole("button", { name: /menu\.deactivated/ }));
    await user.click(within(drawer).getByRole("button", { name: "menu.addItemButton" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalled());
    await waitFor(() => expect(itemsRemove).toHaveBeenCalledWith("item-1"));
  });

  it("5c. Save with Unavailable chosen applies the real 86 mutation right after create, in the same Save", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.type(within(drawer).getByLabelText("menu.itemNameLabel"), "Burger");
    await user.selectOptions(within(drawer).getByLabelText("common.category"), "c1");
    await user.type(within(drawer).getByLabelText(/menu\.price/), "12.50");

    await user.click(within(drawer).getByRole("button", { name: /menu\.unavailable/ }));
    const topDialog = within(screen.getAllByRole("dialog")[screen.getAllByRole("dialog").length - 1]!);
    await user.type(topDialog.getByLabelText(/menu\.86Reason/i), "Not ready yet");
    await user.click(topDialog.getByRole("button", { name: "menu.toggle86" }));

    await user.click(within(drawer).getByRole("button", { name: "menu.addItemButton" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalled());
    await waitFor(() => expect(toggleAvailability).toHaveBeenCalledWith("item-1", false, "Not ready yet", undefined));
  });

  it("6. renders the reference-style 'Variants' advanced-row disclosure before save", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    const row = within(drawer).getByRole("button", { name: /menu\.variants/ });
    expect(row).toHaveClass("advanced-row");
    expect(itemsCreate).not.toHaveBeenCalled();
  });

  it("7. expanding Variants before save opens the reference prices-panel shell", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.click(within(drawer).getByRole("button", { name: /menu\.variants/ }));

    expect(within(drawer).getByText("menu.defaultVariant")).toBeInTheDocument();
    expect(within(drawer).getByText("menu.defaultVariant").closest(".size-row")).toBeInTheDocument();
    expect(within(drawer).getByText("menu.defaultVariant").closest(".prices-panel")).toBeInTheDocument();
  });

  it("8/9. the default-variant row and the primary Price field share the SAME state and stay synchronized", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    const primaryInput = within(drawer).getByLabelText(/menu\.price/);
    await user.type(primaryInput, "12.50");

    await user.click(within(drawer).getByRole("button", { name: /menu\.variants/ }));
    const row = within(drawer).getByText("menu.defaultVariant").closest(".size-row") as HTMLElement;
    const rowInput = within(row).getByRole("spinbutton");

    expect(rowInput).toHaveValue(12.5);

    await user.clear(rowInput);
    await user.type(rowInput, "9.99");
    expect(primaryInput).toHaveValue(9.99);
  });

  it("10. no fake channel/size pricing controls exist anywhere in create mode", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const drawer = await openAddItem(user);

    await user.click(within(drawer).getByRole("button", { name: /menu\.variants/ }));

    expect(within(drawer).queryByText(/different prices/i)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/by channel/i)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/by size/i)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/channel pricing/i)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/price list/i)).not.toBeInTheDocument();
  });
});
