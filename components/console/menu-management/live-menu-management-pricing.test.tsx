import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatMoney } from "@/lib/console/format";

/**
 * `Intl.NumberFormat` puts a U+00A0 (non-breaking space) between "EGP" and
 * the amount. RTL's default text normalizer collapses that to a plain space
 * on the DOM side but does NOT touch a plain-string matcher, so comparing
 * the raw `formatMoney()` output against rendered text always misses —
 * normalize it the same way before using it as a `getByText` matcher.
 */
function moneyText(amount: number, currency: "EGP" | "SAR" | "AED"): string {
  return formatMoney({ amount, currency }, { locale: "en" }).replace(/ /g, " ");
}

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-2-PRICING — canonical PriceList/PriceEntry
 * pricing inside the live Menu Management workspace. Proves:
 *
 *  1. Price lists load through `services.catalogue.priceLists`, gated by
 *     `menu.price.read` (never requested without it).
 *  2. `menu.price.change` gates every mutation — create, edit — while read
 *     access alone renders read-only.
 *  3. The migrated WIP scope behaviors: tenant omits scopeId; brand/branch
 *     send the real, LIVE session id; a missing brand/branch blocks create;
 *     the scope name shown is human-readable, not a raw id; context changes
 *     are read live, without a remount.
 *  4. No Edit/Activate/Deactivate Price List controls exist (no HTTP route).
 *  5. `scheduled` price lists render as eligible, not disabled.
 *  6. Variant pricing: one real variant reads as a single price row, no
 *     variants blocks pricing with a truthful message and creates nothing,
 *     several variants render one row each.
 *  7. Canonical `orderType` values only — never `Sales.channel`.
 *  8. The canonical currency (branch, falling back to tenant) is what gets
 *     written, never `NEXT_PUBLIC_MENU_CURRENCY` or a hardcoded code.
 *  9. A 409 (or any) create/write failure never fakes success and never
 *     clobbers the last known-good price.
 */

const menusList = vi.fn();
const itemsGet = vi.fn();
const priceListsList = vi.fn();
const priceListsGet = vi.fn();
const priceListsCreate = vi.fn();
const setPrice = vi.fn();

const { MockServiceError } = vi.hoisted(() => ({
  MockServiceError: class MockServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("@/lib/console/services", () => ({
  ServiceError: MockServiceError,
  services: {
    catalogue: {
      menus: {
        list: (...args: unknown[]) => menusList(...args),
        create: vi.fn(),
        get: (id: string) => Promise.resolve({ id, name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: [], branchIds: [], active: true }),
      },
      setMenuActive: vi.fn(),
      assignMenuToBranch: vi.fn(),
      unassignMenuFromBranch: vi.fn(),
      resolveBranchMenus: vi.fn().mockResolvedValue({ menus: [], ambiguous: false, warning: null }),
      toggleAvailability: vi.fn(),
      items: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        get: (...args: unknown[]) => itemsGet(...args),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      priceLists: {
        list: (...args: unknown[]) => priceListsList(...args),
        get: (...args: unknown[]) => priceListsGet(...args),
        create: (...args: unknown[]) => priceListsCreate(...args),
        update: vi.fn(),
        remove: vi.fn(),
      },
      setPrice: (...args: unknown[]) => setPrice(...args),
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

let granted = new Set<string>(["menu.item.manage", "menu.availability.toggle", "menu.price.read", "menu.price.change"]);

let session = {
  scope: { tenantId: "t1", brandId: null as string | null, branchId: null as string | null },
  availableBranches: [{ id: "br1", name: { en: "Downtown", ar: "" }, brandId: "b1" }],
  tenant: { id: "t1", name: { en: "Acme", ar: "أكمي" }, baseCurrency: "EGP" },
  brand: null as { id: string; name: { en: string; ar: string } } | null,
  branch: null as { id: string; name: { en: string; ar: string }; currency: string } | null,
};

// Every OTHER key is identity-mocked (`t(key) === key`) so tests can assert
// on the key itself. These two are the sole exception: the component calls
// `.replace("{name}", ...)` on their result, so the mock has to return real
// template text — matching `content/console/en.ts` — for that to do anything.
const INTERPOLATED_KEYS: Record<string, string> = {
  "menu.priceListScopeBrandActive": "Current brand: {name}",
  "menu.priceListScopeBranchActive": "Current branch: {name}",
};

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => INTERPOLATED_KEYS[key] ?? key,
    tx: (value: unknown) => (typeof value === "string" ? value : ((value as { en?: string })?.en ?? "")),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  usePermission: (perm: string) => granted.has(perm),
  useSession: () => session,
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
  itemCount: 1,
  active: true,
  tenantId: "t1",
});

function liveItem(overrides: { id: string; name: string; variants: { id: string; name: string; amount: number; currency: string }[] }) {
  return {
    id: overrides.id,
    tenantId: "t1",
    categoryId: "c1",
    name: { en: overrides.name, ar: overrides.name },
    kitchenName: { en: "", ar: "" },
    receiptName: { en: "", ar: "" },
    description: { en: "", ar: "" },
    taxClassId: null,
    stationType: "kitchen",
    prepTimeSeconds: 0,
    variants: overrides.variants.map((v) => ({
      id: v.id,
      name: { en: v.name, ar: v.name },
      basePrice: { amount: v.amount, currency: v.currency },
      barcode: null,
      recipeId: null,
      available: true,
    })),
    allergens: [],
    isCombo: false,
    isOpenPrice: false,
    isWeighed: false,
    available: true,
    unavailableReason: null,
    remainingSellable: null,
    sortOrder: 0,
    colour: "#000",
    imageEmoji: "",
    placements: [{ categoryId: "c1", menuId: "m1" }],
  };
}

function priceList(overrides: Partial<{ id: string; name: string; scope: string; scopeId: string | null; status: "scheduled" | "active" | "expired"; entries: { variantId: string; amount: number; currency: string }[] }> = {}) {
  return {
    id: overrides.id ?? "pl1",
    tenantId: "t1",
    name: { en: overrides.name ?? "Standard", ar: overrides.name ?? "قياسي" },
    scope: overrides.scope ?? "tenant",
    scopeId: overrides.scopeId ?? null,
    orderTypes: [],
    priority: 10,
    validFrom: null,
    validTo: null,
    recurrence: null,
    entryCount: overrides.entries?.length ?? 0,
    entries: (overrides.entries ?? []).map((e) => ({
      menuItemId: "",
      variantId: e.variantId,
      itemName: { en: "", ar: "" },
      price: { amount: e.amount, currency: e.currency },
      previousPrice: null,
    })),
    status: overrides.status ?? "active",
    active: (overrides.status ?? "active") === "active",
  };
}

async function openItemEditor(user: ReturnType<typeof userEvent.setup>, itemName: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(itemName) }));
}

/** The "Price in selected price list" section, scoped so its rows never get
 * confused with the general (unrelated) Variants section above it — both
 * legitimately show the same variant name. */
async function pricingSection(): Promise<HTMLElement> {
  const heading = await screen.findByText("menu.priceInSelectedList");
  return heading.closest("section") as HTMLElement;
}

describe("Live Menu Management — pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    granted = new Set(["menu.item.manage", "menu.availability.toggle", "menu.price.read", "menu.price.change"]);
    session = {
      scope: { tenantId: "t1", brandId: null, branchId: null },
      availableBranches: [{ id: "br1", name: { en: "Downtown", ar: "" }, brandId: "b1" }],
      tenant: { id: "t1", name: { en: "Acme", ar: "أكمي" }, baseCurrency: "EGP" },
      brand: null,
      branch: null,
    };
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });
    listMenuCategoriesMock.mockResolvedValue([category()]);
    listItemsWithPlacementsMock.mockResolvedValue([]);
    priceListsList.mockResolvedValue({ rows: [priceList()], total: 1 });
    priceListsGet.mockResolvedValue(priceList());
    priceListsCreate.mockResolvedValue(priceList({ id: "pl-new", name: "Weekend" }));
    setPrice.mockResolvedValue({ variantId: "v1", price: { amount: 6000, currency: "EGP" } });
    itemsGet.mockResolvedValue(null);
  });
  afterEach(() => cleanup());

  // -- 1/2: visibility & mutation gating ------------------------------------

  it("loads price lists through the canonical catalogue service, gated by menu.price.read", async () => {
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");

    await waitFor(() => expect(priceListsList).toHaveBeenCalled());
    expect(await screen.findByText("Standard")).toBeInTheDocument();
  });

  it("never requests price lists, and hides all pricing UI, without menu.price.read", async () => {
    granted = new Set(["menu.item.manage", "menu.availability.toggle"]);
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");

    expect(priceListsList).not.toHaveBeenCalled();
    expect(screen.queryByText("menu.priceListLabel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "menu.newPriceList" })).not.toBeInTheDocument();
  });

  it("with menu.price.read but not menu.price.change: pricing is read-only, no New price list button", async () => {
    granted = new Set(["menu.item.manage", "menu.availability.toggle", "menu.price.read"]);
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Burger", variants: [{ id: "v1", name: "Regular", amount: 5000, currency: "EGP" }] })]);
    priceListsGet.mockResolvedValue(priceList({ entries: [{ variantId: "v1", amount: 5000, currency: "EGP" }] }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");

    expect(screen.queryByRole("button", { name: "menu.newPriceList" })).not.toBeInTheDocument();

    await openItemEditor(user, "Burger");
    expect(await screen.findByText("menu.priceReadOnly")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.edit" })).not.toBeInTheDocument();
  });

  // -- 3: migrated WIP scope behaviors ---------------------------------------

  describe("New Price List — scope behaviors migrated from the WIP", () => {
    async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
      render(<LiveMenuManagement />);
      await screen.findByText("Lunch");
      await user.click(await screen.findByRole("button", { name: "menu.newPriceList" }));
      await screen.findByRole("dialog").catch(() => {});
      return screen.getByLabelText(/common\.name/i);
    }

    it("tenant scope omits scopeId from the create payload entirely", async () => {
      const user = userEvent.setup();
      const nameField = await openDrawer(user);
      await user.type(nameField, "Weekend");
      await user.click(screen.getByRole("button", { name: "common.create" }));

      await waitFor(() => expect(priceListsCreate).toHaveBeenCalled());
      const [payload] = priceListsCreate.mock.calls[0]!;
      expect(payload.scope).toBe("tenant");
      expect("scopeId" in payload).toBe(false);
    });

    it("brand scope sends the real, live session brand id", async () => {
      session.brand = { id: "brand-9", name: { en: "North", ar: "شمال" } };
      const user = userEvent.setup();
      const nameField = await openDrawer(user);
      await user.type(nameField, "Weekend");

      await user.click(screen.getByLabelText(/menu\.scope\b/i));
      await user.click(await screen.findByRole("option", { name: "menu.priceListScopeBrand" }));

      await user.click(screen.getByRole("button", { name: "common.create" }));
      await waitFor(() => expect(priceListsCreate).toHaveBeenCalled());
      const [payload] = priceListsCreate.mock.calls[0]!;
      expect(payload.scope).toBe("brand");
      expect(payload.scopeId).toBe("brand-9");
    });

    it("branch scope sends the real, live session branch id", async () => {
      session.branch = { id: "branch-9", name: { en: "Giza", ar: "الجيزة" }, currency: "EGP" };
      const user = userEvent.setup();
      const nameField = await openDrawer(user);
      await user.type(nameField, "Weekend");

      await user.click(screen.getByLabelText(/menu\.scope\b/i));
      await user.click(await screen.findByRole("option", { name: "menu.priceListScopeBranch" }));

      await user.click(screen.getByRole("button", { name: "common.create" }));
      await waitFor(() => expect(priceListsCreate).toHaveBeenCalled());
      const [payload] = priceListsCreate.mock.calls[0]!;
      expect(payload.scope).toBe("branch");
      expect(payload.scopeId).toBe("branch-9");
    });

    it("blocks create when brand scope is chosen with no active brand", async () => {
      const user = userEvent.setup();
      const nameField = await openDrawer(user);
      await user.type(nameField, "Weekend");

      await user.click(screen.getByLabelText(/menu\.scope\b/i));
      await user.click(await screen.findByRole("option", { name: "menu.priceListScopeBrand" }));

      expect(await screen.findByText("menu.priceListScopeNeedsBrand")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
      expect(priceListsCreate).not.toHaveBeenCalled();
    });

    it("blocks create when branch scope is chosen with no active branch", async () => {
      const user = userEvent.setup();
      const nameField = await openDrawer(user);
      await user.type(nameField, "Weekend");

      await user.click(screen.getByLabelText(/menu\.scope\b/i));
      await user.click(await screen.findByRole("option", { name: "menu.priceListScopeBranch" }));

      expect(await screen.findByText("menu.priceListScopeNeedsBranch")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
      expect(priceListsCreate).not.toHaveBeenCalled();
    });

    it("shows the human-readable brand name, never the raw brand id", async () => {
      session.brand = { id: "brand-9", name: { en: "North", ar: "شمال" } };
      const user = userEvent.setup();
      await openDrawer(user);

      await user.click(screen.getByLabelText(/menu\.scope\b/i));
      await user.click(await screen.findByRole("option", { name: "menu.priceListScopeBrand" }));

      expect(screen.queryByText("brand-9")).not.toBeInTheDocument();
      expect(screen.getByText(/North/)).toBeInTheDocument();
    });

    it("reads a brand/branch switch live, without remounting the workspace", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<LiveMenuManagement />);
      await screen.findByText("Lunch");
      await user.click(await screen.findByRole("button", { name: "menu.newPriceList" }));

      await user.click(screen.getByLabelText(/menu\.scope\b/i));
      await user.click(await screen.findByRole("option", { name: "menu.priceListScopeBrand" }));
      expect(await screen.findByText("menu.priceListScopeNeedsBrand")).toBeInTheDocument();

      // The context changes underneath the mounted component — no new render() call.
      session = { ...session, brand: { id: "brand-9", name: { en: "North", ar: "شمال" } } };
      rerender(<LiveMenuManagement />);

      // Still the SAME drawer instance (open state survived — proof of no remount),
      // now reading the new brand id live.
      expect(screen.queryByText("menu.priceListScopeNeedsBrand")).not.toBeInTheDocument();
      expect(screen.getByText(/North/)).toBeInTheDocument();
    });
  });

  // -- 4/5: no fake controls, scheduled is eligible --------------------------

  it("renders no Activate/Deactivate/Edit control anywhere in the price-list picker", async () => {
    priceListsList.mockResolvedValue({ rows: [priceList({ id: "pl1", name: "Standard" }), priceList({ id: "pl2", name: "Ramadan", status: "scheduled" })], total: 2 });
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");

    await user.click(await screen.findByText("Standard"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("shows a scheduled price list as selectable, labelled 'scheduled' — never disabled", async () => {
    priceListsList.mockResolvedValue({ rows: [priceList({ id: "pl1", name: "Standard" }), priceList({ id: "pl2", name: "Ramadan", status: "scheduled" })], total: 2 });
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");

    await user.click(await screen.findByText("Standard"));
    const option = await screen.findByRole("option", { name: /Ramadan/ });
    expect(option).not.toHaveAttribute("aria-disabled", "true");
    expect(within(option).getByText("menu.priceListStatusScheduled")).toBeInTheDocument();

    await user.click(option);
    await waitFor(() => expect(priceListsGet).toHaveBeenCalledWith("pl2"));
  });

  // -- 6: variant pricing UX --------------------------------------------------

  it("a single real variant renders one price row — the 'one price' presentation", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Burger", variants: [{ id: "v1", name: "Regular", amount: 5000, currency: "EGP" }] })]);
    priceListsGet.mockResolvedValue(priceList({ entries: [{ variantId: "v1", amount: 5000, currency: "EGP" }] }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await openItemEditor(user, "Burger");

    const section = await pricingSection();
    expect(within(section).getAllByText("Regular")).toHaveLength(1);
    expect(within(section).getByText(moneyText(5000, "EGP"))).toBeInTheDocument();
  });

  it("an item with no variants shows the truthful gap and creates no hidden variant", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Sauce", variants: [] })]);

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await openItemEditor(user, "Sauce");

    expect(await screen.findByText("menu.priceNeedsVariant")).toBeInTheDocument();
    expect(setPrice).not.toHaveBeenCalled();
  });

  it("several real variants render one price row each", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([
      liveItem({
        id: "i2",
        name: "Pizza",
        variants: [
          { id: "v2a", name: "Small", amount: 8000, currency: "EGP" },
          { id: "v2b", name: "Large", amount: 12000, currency: "EGP" },
        ],
      }),
    ]);
    priceListsGet.mockResolvedValue(
      priceList({
        entries: [
          { variantId: "v2a", amount: 8000, currency: "EGP" },
          { variantId: "v2b", amount: 12000, currency: "EGP" },
        ],
      }),
    );

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await openItemEditor(user, "Pizza");

    const section = await pricingSection();
    expect(within(section).getByText("Small")).toBeInTheDocument();
    expect(within(section).getByText("Large")).toBeInTheDocument();
  });

  it("no price list selected shows the truthful gap, not a synthesized default list", async () => {
    priceListsList.mockResolvedValue({ rows: [], total: 0 });
    priceListsGet.mockResolvedValue(null);
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Burger", variants: [{ id: "v1", name: "Regular", amount: 5000, currency: "EGP" }] })]);

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    expect(await screen.findByText("menu.noPriceLists")).toBeInTheDocument();

    await openItemEditor(user, "Burger");
    expect(await screen.findByText("menu.priceNeedsPriceList")).toBeInTheDocument();
    expect(priceListsCreate).not.toHaveBeenCalled();
  });

  // -- 7: order type is canonical, not Sales.channel --------------------------

  it("New Price List order-type picker offers only the six canonical values, never a Sales.channel value", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await user.click(await screen.findByRole("button", { name: "menu.newPriceList" }));

    await user.click(screen.getByLabelText(/menu\.priceListOrderType/i));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    // "Any" + the 6 canonical order types.
    expect(options).toHaveLength(7);
    for (const forbidden of [/^pos$/i, /^kiosk$/i, /^qr$/i, /^phone$/i, /^api$/i]) {
      expect(within(listbox).queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  // -- 8: canonical currency ---------------------------------------------------

  it("writes the price in the current BRANCH currency when a branch is active", async () => {
    session.branch = { id: "branch-9", name: { en: "Giza", ar: "الجيزة" }, currency: "SAR" };
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Burger", variants: [{ id: "v1", name: "Regular", amount: 5000, currency: "EGP" }] })]);
    priceListsGet.mockResolvedValue(priceList({ entries: [] }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await openItemEditor(user, "Burger");
    const section = await pricingSection();

    await user.click(within(section).getByRole("button", { name: "common.edit" }));
    await user.type(within(section).getByRole("textbox"), "60");
    await user.click(within(section).getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(setPrice).toHaveBeenCalledWith("pl1", "v1", { amount: 6000, currency: "SAR" }));
  });

  it("falls back to the TENANT base currency when no branch is active", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Burger", variants: [{ id: "v1", name: "Regular", amount: 5000, currency: "EGP" }] })]);
    priceListsGet.mockResolvedValue(priceList({ entries: [] }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await openItemEditor(user, "Burger");
    const section = await pricingSection();

    await user.click(within(section).getByRole("button", { name: "common.edit" }));
    await user.type(within(section).getByRole("textbox"), "60");
    await user.click(within(section).getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(setPrice).toHaveBeenCalledWith("pl1", "v1", { amount: 6000, currency: "EGP" }));
  });

  it("never reads NEXT_PUBLIC_MENU_CURRENCY — the live workspace never touches that env var", () => {
    const source = readFileSync(join(__dirname, "live-menu-management.tsx"), "utf8");
    expect(source).not.toContain("process.env.NEXT_PUBLIC_MENU_CURRENCY");
    expect(source).not.toMatch(/from ["']@\/lib\/console\/menu-management\/menu["']/);
  });

  // -- 9: no fake success, no clobbering a known-good price --------------------

  it("a 409 conflict on create shows the real error and never fakes a created price list", async () => {
    priceListsCreate.mockRejectedValue(new MockServiceError("CONFLICT", "Overlapping price list.", 409));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await user.click(await screen.findByRole("button", { name: "menu.newPriceList" }));
    await user.type(screen.getByLabelText(/common\.name/i), "Weekend");
    await user.click(screen.getByRole("button", { name: "common.create" }));

    expect(await screen.findByText("Overlapping price list.")).toBeInTheDocument();
    expect(screen.queryByText("menu.priceListCreated")).not.toBeInTheDocument();
    // The drawer is still open with what was typed — no silent close, no fake success.
    expect(screen.getByLabelText(/common\.name/i)).toHaveValue("Weekend");
    expect(priceListsList).toHaveBeenCalledTimes(1); // the initial load only — no reload chased a fake success
  });

  it("a failed price write preserves the last known-good price — no optimistic clobber", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ id: "i1", name: "Burger", variants: [{ id: "v1", name: "Regular", amount: 5000, currency: "EGP" }] })]);
    priceListsGet.mockResolvedValue(priceList({ entries: [{ variantId: "v1", amount: 5000, currency: "EGP" }] }));
    setPrice.mockRejectedValue(new MockServiceError("VALIDATION", "That price could not be saved.", 400));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");
    await openItemEditor(user, "Burger");
    const section = await pricingSection();

    const oldLabel = moneyText(5000, "EGP");
    expect(within(section).getByText(oldLabel)).toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "common.edit" }));
    await user.type(within(section).getByRole("textbox"), "999");
    await user.click(within(section).getByRole("button", { name: "common.save" }));

    expect(await screen.findByText("That price could not be saved.")).toBeInTheDocument();
    // The old price is still what's rendered as "the" price — no fake update.
    expect(within(section).getByText(oldLabel)).toBeInTheDocument();
    expect(priceListsGet).toHaveBeenCalledTimes(1); // no reconcile reload happened after a failure
  });
});
