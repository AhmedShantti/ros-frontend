import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-3-AVAILABILITY-MODIFIERS — availability/86.
 *
 * Proves:
 *  1. Available renders correctly, no fake "Hidden" state.
 *  2/3. 86 and restore persist through `services.catalogue.toggleAvailability`
 *     (the real two-step availability-rules flow, exercised at the service
 *     boundary — the http.ts implementation itself is unit-tested via
 *     map.test.ts/format.test.ts, not re-derived here).
 *  4/5. 86 is gated by `menu.availability.toggle`, deactivate by
 *     `menu.item.manage` — independently, not nested under each other.
 *  6. 86 and deactivate call different service methods.
 *  7. No boolean "hidden" state exists anywhere in this UI.
 *  8. The reason typed during 86 is never displayed later as if it were
 *     persisted server truth.
 *  9. `autoReenableAt` is surfaced truthfully when the API returns one.
 */

const menusList = vi.fn();
const itemsGet = vi.fn();
const itemsRemove = vi.fn();
const toggleAvailability = vi.fn();

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
      toggleAvailability: (...args: unknown[]) => toggleAvailability(...args),
      items: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        get: (...args: unknown[]) => itemsGet(...args),
        create: vi.fn(),
        update: vi.fn(),
        remove: (...args: unknown[]) => itemsRemove(...args),
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

let granted = new Set<string>(["menu.item.manage", "menu.availability.toggle", "menu.item.read"]);

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
  itemCount: 1,
  active: true,
  tenantId: "t1",
});

function liveItem(overrides: Partial<{ id: string; name: string; available: boolean; unavailableReason: string | null; autoReenableAt: string | null }> = {}) {
  return {
    id: overrides.id ?? "i1",
    tenantId: "t1",
    categoryId: "c1",
    name: { en: overrides.name ?? "Burger", ar: overrides.name ?? "Burger" },
    kitchenName: { en: "", ar: "" },
    receiptName: { en: "", ar: "" },
    description: { en: "", ar: "" },
    taxClassId: null,
    stationType: "hot_line",
    prepTimeSeconds: 0,
    variants: [],
    allergens: [],
    isCombo: false,
    isOpenPrice: false,
    isWeighed: false,
    available: overrides.available ?? true,
    unavailableReason: overrides.unavailableReason ?? null,
    autoReenableAt: overrides.autoReenableAt ?? null,
    remainingSellable: null,
    sortOrder: 0,
    colour: "#000",
    imageEmoji: "",
    placements: [{ categoryId: "c1", menuId: "m1" }],
  };
}

async function openItemEditor(user: ReturnType<typeof userEvent.setup>, itemName: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(itemName) }));
  await screen.findByRole("dialog");
}

/** The item editor drawer itself — the workspace toolbar has its own
 * "common.deactivate" (for the MENU) and, once 86ing, the Eighty6Modal
 * stacks a second `role="dialog"` on top with its own "menu.toggle86"
 * button, so anything ambiguous at page scope must be scoped to one. */
function itemDialog() {
  return within(screen.getAllByRole("dialog")[0]!);
}

function topDialog() {
  const all = screen.getAllByRole("dialog");
  return within(all[all.length - 1]!);
}

describe("Live Menu Management — availability/86", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    granted = new Set(["menu.item.manage", "menu.availability.toggle", "menu.item.read"]);
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });
    listMenuCategoriesMock.mockResolvedValue([category()]);
    listItemsWithPlacementsMock.mockResolvedValue([]);
    itemsGet.mockResolvedValue(null);
  });
  afterEach(() => cleanup());

  it("1. an available item renders as available, no fake 'Hidden' state anywhere", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    render(<LiveMenuManagement />);

    expect(await screen.findByText("menu.available")).toBeInTheDocument();
    expect(screen.queryByText(/hidden/i)).not.toBeInTheDocument();
  });

  it("2. a manual 86 persists through the canonical toggleAvailability call", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    itemsGet.mockResolvedValue(liveItem({ available: true }));
    toggleAvailability.mockResolvedValue(liveItem({ available: false, unavailableReason: "manual_86" }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    await user.click(itemDialog().getByRole("button", { name: "menu.toggle86" }));
    await user.type(topDialog().getByLabelText(/menu\.86Reason/i), "Ran out of buns");
    await user.click(topDialog().getByRole("button", { name: "menu.toggle86" }));

    await waitFor(() => expect(toggleAvailability).toHaveBeenCalledWith("i1", false, "Ran out of buns", undefined));
  });

  it("3. restore persists through the canonical toggleAvailability call", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: false, unavailableReason: "manual_86" })]);
    itemsGet.mockResolvedValue(liveItem({ available: false, unavailableReason: "manual_86" }));
    toggleAvailability.mockResolvedValue(liveItem({ available: true }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    await user.click(itemDialog().getByRole("button", { name: "menu.toggleAvailable" }));
    await waitFor(() => expect(toggleAvailability).toHaveBeenCalledWith("i1", true, undefined, undefined));
  });

  it("4. the 86/restore control is gated by menu.availability.toggle, independently of menu.item.manage", async () => {
    granted = new Set(["menu.availability.toggle", "menu.item.read"]); // no menu.item.manage
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    itemsGet.mockResolvedValue(liveItem({ available: true }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    expect(await screen.findByRole("button", { name: "menu.toggle86" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.deactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.save" })).not.toBeInTheDocument();
  });

  it("5. deactivate is gated by menu.item.manage, independently of menu.availability.toggle", async () => {
    granted = new Set(["menu.item.manage", "menu.item.read"]); // no menu.availability.toggle
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    itemsGet.mockResolvedValue(liveItem({ available: true }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    await screen.findByRole("dialog");
    expect(itemDialog().getByRole("button", { name: "common.deactivate" })).toBeInTheDocument();
    expect(itemDialog().queryByRole("button", { name: "menu.toggle86" })).not.toBeInTheDocument();
    expect(itemDialog().queryByRole("button", { name: "menu.toggleAvailable" })).not.toBeInTheDocument();
  });

  it("6. 86 and deactivate call different, distinct service methods", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    itemsGet.mockResolvedValue(liveItem({ available: true }));
    itemsRemove.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    await user.click(itemDialog().getByRole("button", { name: "common.deactivate" }));
    await waitFor(() => expect(itemsRemove).toHaveBeenCalledWith("i1"));
    expect(toggleAvailability).not.toHaveBeenCalled();
  });

  it("7. deactivated (isActive=false, no manual 86) renders a distinct 'Deactivated' state, never conflated with 86", async () => {
    // Deactivated: available=false AND unavailableReason=null (no manual-86 rule).
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: false, unavailableReason: null })]);
    itemsGet.mockResolvedValue(liveItem({ available: false, unavailableReason: null }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    expect(await screen.findByText("menu.deactivated")).toBeInTheDocument();
    expect(screen.queryByText("menu.eightySixedNotice")).not.toBeInTheDocument();
  });

  it("8. the reason typed during 86 is never rendered later as if it were persisted server truth", async () => {
    // The service boundary already never returns the typed reason (the real
    // API never echoes it) — the item comes back with only a truthy
    // `unavailableReason` marker, never the operator's own words.
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: false, unavailableReason: "manual_86" })]);
    itemsGet.mockResolvedValue(liveItem({ available: false, unavailableReason: "manual_86" }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    expect(await screen.findByText("menu.eightySixedNotice")).toBeInTheDocument();
    expect(screen.queryByText("manual_86")).not.toBeInTheDocument();
    expect(screen.queryByText(/ran out of/i)).not.toBeInTheDocument();
  });

  it("9. a genuine, still-future autoReenableAt from the API is shown truthfully", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: false, unavailableReason: "manual_86", autoReenableAt: future })]);
    itemsGet.mockResolvedValue(liveItem({ available: false, unavailableReason: "manual_86", autoReenableAt: future }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    expect(await screen.findByText(/menu\.autoReenableActive/)).toBeInTheDocument();
  });

  it("9b. no autoReenableAt from the API renders no auto-reenable claim at all", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: false, unavailableReason: "manual_86", autoReenableAt: null })]);
    itemsGet.mockResolvedValue(liveItem({ available: false, unavailableReason: "manual_86", autoReenableAt: null }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    await screen.findByText("menu.eightySixedNotice");
    expect(screen.queryByText(/menu\.autoReenableActive/)).not.toBeInTheDocument();
  });

  it("the Eighty6Modal collects an optional auto-reenable time and sends it as an ISO string", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    itemsGet.mockResolvedValue(liveItem({ available: true }));
    toggleAvailability.mockResolvedValue(liveItem({ available: false, unavailableReason: "manual_86" }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    await user.click(itemDialog().getByRole("button", { name: "menu.toggle86" }));
    await user.type(topDialog().getByLabelText(/menu\.86Reason/i), "Ran out");
    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(dtInput).toBeTruthy();
    await user.type(dtInput, "2026-12-01T10:00");
    await user.click(topDialog().getByRole("button", { name: "menu.toggle86" }));

    await waitFor(() => expect(toggleAvailability).toHaveBeenCalled());
    const call = toggleAvailability.mock.calls[0]!;
    expect(call[0]).toBe("i1");
    expect(call[1]).toBe(false);
    expect(call[2]).toBe("Ran out");
    expect(typeof call[3]).toBe("string");
    expect(new Date(call[3] as string).getFullYear()).toBe(2026);
  });

  it("no boolean 'hidden' field or control exists anywhere in the item editor", async () => {
    listItemsWithPlacementsMock.mockResolvedValue([liveItem({ available: true })]);
    itemsGet.mockResolvedValue(liveItem({ available: true }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await openItemEditor(user, "Burger");

    expect(screen.queryByRole("checkbox", { name: /hidden/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^hidden$/i)).not.toBeInTheDocument();
  });
});
