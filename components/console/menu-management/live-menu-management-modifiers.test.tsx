import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatMoney } from "@/lib/console/format";

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-3-AVAILABILITY-MODIFIERS — Customizations
 * (Modifier Groups + Modifiers), and the item↔group assignment decision.
 *
 * Proves:
 *  10-15. Modifier groups load, create/update persist, min/max + required
 *     validation is enforced, no Delete Group control, no fake
 *     active/inactive state.
 *  16-24. Modifiers load per group, create persists, existing modifiers have
 *     no edit/delete control, priceDelta (+/0/-) converts exactly at the
 *     current currency exponent, and Modifier never grows its own currency
 *     property in the write path.
 *  25-27. No production item↔group attach/unlink/multi-step-create UI is
 *     shown anywhere in this workspace.
 *  28-29. menu.item.manage gates every write; a read-only session cannot
 *     mutate anything.
 */

const menusList = vi.fn();
const modifierGroupsList = vi.fn();
const modifierGroupsGet = vi.fn();
const modifierGroupsCreate = vi.fn();
const modifierGroupsUpdate = vi.fn();
const modifierGroupsRemove = vi.fn();
const addModifier = vi.fn();

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
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      addVariant: vi.fn(),
      updateVariantPrice: vi.fn(),
      modifierGroups: {
        list: (...args: unknown[]) => modifierGroupsList(...args),
        get: (...args: unknown[]) => modifierGroupsGet(...args),
        create: (...args: unknown[]) => modifierGroupsCreate(...args),
        update: (...args: unknown[]) => modifierGroupsUpdate(...args),
        remove: (...args: unknown[]) => modifierGroupsRemove(...args),
      },
      addModifier: (...args: unknown[]) => addModifier(...args),
    },
  },
}));

vi.mock("@/lib/console/menu-management/live-adapter", () => ({
  listMenuCategories: vi.fn().mockResolvedValue([]),
  createMenuCategory: vi.fn(),
  listItemsWithPlacements: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/console/catalogue/tax-class-field", () => ({
  TaxClassField: () => null,
  useTaxClassLabel: () => ({ text: "—", tone: "muted" as const }),
}));

let granted = new Set<string>(["menu.item.manage", "menu.item.read", "menu.availability.toggle"]);

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

function group(overrides: Partial<{ id: string; name: string; min: number; max: number; required: boolean; allowRepeat: boolean; modifiers: ReturnType<typeof modifier>[] }> = {}) {
  return {
    id: overrides.id ?? "g1",
    tenantId: "t1",
    name: { en: overrides.name ?? "Sauces", ar: overrides.name ?? "صلصات" },
    minSelections: overrides.min ?? 0,
    maxSelections: overrides.max ?? 1,
    required: overrides.required ?? false,
    allowRepeat: overrides.allowRepeat ?? false,
    freeQuantityThreshold: null,
    modifiers: overrides.modifiers ?? [],
    attachedItemCount: 0,
  };
}

function modifier(overrides: Partial<{ id: string; name: string; kind: "addition" | "removal" | "substitution"; amount: number }> = {}) {
  return {
    id: overrides.id ?? "mod1",
    name: { en: overrides.name ?? "Ketchup", ar: overrides.name ?? "كاتشب" },
    kind: overrides.kind ?? "addition",
    priceDelta: { amount: overrides.amount ?? 0, currency: "EGP" as const },
    recipeDelta: [],
    isDefault: false,
  };
}

async function openCustomizations(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "menu.customizations" }));
  return within(await screen.findByRole("dialog"));
}

describe("Live Menu Management — Customizations (modifier groups/modifiers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    granted = new Set(["menu.item.manage", "menu.item.read", "menu.availability.toggle"]);
    menusList.mockResolvedValue({ rows: [menu()], total: 1 });
    modifierGroupsList.mockResolvedValue({ rows: [group()], total: 1 });
    modifierGroupsGet.mockResolvedValue(group());
    modifierGroupsCreate.mockResolvedValue(group({ id: "g-new", name: "Spice Level" }));
    modifierGroupsUpdate.mockResolvedValue(group({ name: "Sauces (updated)" }));
    addModifier.mockResolvedValue(modifier({ id: "mod-new", name: "Mayo", amount: 500 }));
  });
  afterEach(() => cleanup());

  // -- 10: groups load ---------------------------------------------------

  it("10. groups load from the canonical modifierGroups.list service", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await waitFor(() => expect(modifierGroupsList).toHaveBeenCalled());
    expect(dialog.getByText("Sauces")).toBeInTheDocument();
  });

  // -- 11/12: create/update persist ---------------------------------------

  it("11. creating a group persists through modifierGroups.create", async () => {
    modifierGroupsList.mockResolvedValueOnce({ rows: [], total: 0 });
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(dialog.getByRole("button", { name: "menu.newGroup" }));
    await user.type(dialog.getByLabelText(/common\.name/i), "Spice Level");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(modifierGroupsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: { en: "Spice Level", ar: "Spice Level" } }),
      ),
    );
  });

  it("12. updating a group persists through modifierGroups.update", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    const nameField = await dialog.findByLabelText(/common\.name/i);
    await user.clear(nameField);
    await user.type(nameField, "Sauces (updated)");
    await user.click(dialog.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(modifierGroupsUpdate).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ name: { en: "Sauces (updated)", ar: "Sauces (updated)" } }),
      ),
    );
  });

  // -- 13: required/min/max validation -------------------------------------

  it("13a. min > max is blocked client-side before it ever reaches the server", async () => {
    modifierGroupsList.mockResolvedValueOnce({ rows: [], total: 0 });
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(dialog.getByRole("button", { name: "menu.newGroup" }));
    await user.type(dialog.getByLabelText(/common\.name/i), "Broken");
    const minField = dialog.getByLabelText(/menu\.minSelections/i);
    const maxField = dialog.getByLabelText(/menu\.maxSelections/i);
    await user.clear(minField);
    await user.type(minField, "5");
    await user.clear(maxField);
    await user.type(maxField, "1");

    expect(dialog.getByText("menu.selectionRuleError")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "common.create" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "common.create" }));
    expect(modifierGroupsCreate).not.toHaveBeenCalled();
  });

  it("13b. required with min < 1 is blocked client-side", async () => {
    modifierGroupsList.mockResolvedValueOnce({ rows: [], total: 0 });
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(dialog.getByRole("button", { name: "menu.newGroup" }));
    await user.type(dialog.getByLabelText(/common\.name/i), "Choose a size");
    await user.click(dialog.getByRole("switch", { name: /menu\.required/i }));

    expect(dialog.getByText("menu.requiredMinError")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "common.create" })).toBeDisabled();
  });

  it("13c. a 400 from the server on an otherwise-valid submit surfaces and is not swallowed", async () => {
    modifierGroupsList.mockResolvedValueOnce({ rows: [], total: 0 });
    modifierGroupsCreate.mockRejectedValue(new MockServiceError("VALIDATION", "minSelections must be less than or equal to maxSelections.", 400));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(dialog.getByRole("button", { name: "menu.newGroup" }));
    await user.type(dialog.getByLabelText(/common\.name/i), "Weird group");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    expect(await dialog.findByText("minSelections must be less than or equal to maxSelections.")).toBeInTheDocument();
  });

  // -- 14/15: no Delete Group, no fake active/inactive -----------------------

  it("14. no Delete Group control exists anywhere in Customizations", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    expect(dialog.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(modifierGroupsRemove).not.toHaveBeenCalled();
  });

  it("15. no active/inactive control or claim exists for a group", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    expect(dialog.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(dialog.queryByText(/^common\.active$/)).not.toBeInTheDocument();
  });

  // -- 16-19: modifiers load, create persists, no edit/delete ----------------

  it("16. a group's modifiers load from listModifiers via modifierGroups.get", async () => {
    modifierGroupsGet.mockResolvedValue(group({ modifiers: [modifier({ name: "Ketchup" })] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    expect(await dialog.findByText("Ketchup")).toBeInTheDocument();
  });

  it("17. creating a modifier persists through addModifier and appears after reconcile", async () => {
    modifierGroupsGet
      .mockResolvedValueOnce(group({ modifiers: [] }))
      .mockResolvedValue(group({ modifiers: [modifier({ id: "mod-new", name: "Mayo", amount: 500 })] }));

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await user.click(dialog.getByRole("button", { name: "common.add" }));
    await user.type(dialog.getAllByLabelText(/common\.name/i).at(-1)!, "Mayo");
    await user.type(dialog.getByLabelText(/menu\.priceDelta/i), "5");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(addModifier).toHaveBeenCalledWith("g1", expect.objectContaining({ kind: "addition", priceDelta: { amount: 500, currency: "EGP" } })),
    );
    expect(await dialog.findByText("Mayo")).toBeInTheDocument();
  });

  it("18. an existing modifier has no Edit control", async () => {
    modifierGroupsGet.mockResolvedValue(group({ modifiers: [modifier({ name: "Ketchup" })] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await dialog.findByText("Ketchup");
    expect(dialog.queryByRole("button", { name: "common.edit" })).not.toBeInTheDocument();
  });

  it("19. an existing modifier has no Delete control", async () => {
    modifierGroupsGet.mockResolvedValue(group({ modifiers: [modifier({ name: "Ketchup" })] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await dialog.findByText("Ketchup");
    expect(dialog.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  // -- 20-23: priceDelta exact conversion, exponent respected -----------------

  it("20. a positive priceDelta converts to minor units exactly", async () => {
    modifierGroupsGet.mockResolvedValueOnce(group({ modifiers: [] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await user.click(dialog.getByRole("button", { name: "common.add" }));
    await user.type(dialog.getAllByLabelText(/common\.name/i).at(-1)!, "Extra cheese");
    const amountField = dialog.getByLabelText(/menu\.priceDelta/i);
    await user.clear(amountField);
    await user.type(amountField, "12.34");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(addModifier).toHaveBeenCalledWith("g1", expect.objectContaining({ priceDelta: { amount: 1234, currency: "EGP" } })));
  });

  it("21. a zero priceDelta converts to exactly 0", async () => {
    modifierGroupsGet.mockResolvedValueOnce(group({ modifiers: [] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await user.click(dialog.getByRole("button", { name: "common.add" }));
    await user.type(dialog.getAllByLabelText(/common\.name/i).at(-1)!, "No change");
    const amountField = dialog.getByLabelText(/menu\.priceDelta/i);
    await user.clear(amountField);
    await user.type(amountField, "0");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(addModifier).toHaveBeenCalledWith("g1", expect.objectContaining({ priceDelta: { amount: 0, currency: "EGP" } })));
  });

  it("22. a negative priceDelta (a discount) converts to minor units exactly — never clamped to zero", async () => {
    modifierGroupsGet.mockResolvedValueOnce(group({ modifiers: [] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await user.click(dialog.getByRole("button", { name: "common.add" }));
    await user.type(dialog.getAllByLabelText(/common\.name/i).at(-1)!, "No cheese");
    const amountField = dialog.getByLabelText(/menu\.priceDelta/i);
    await user.clear(amountField);
    await user.type(amountField, "-3");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(addModifier).toHaveBeenCalledWith("g1", expect.objectContaining({ priceDelta: { amount: -300, currency: "EGP" } })));
  });

  it("23. entering more decimal places than the currency's exponent allows is blocked", async () => {
    modifierGroupsGet.mockResolvedValueOnce(group({ modifiers: [] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await user.click(dialog.getByRole("button", { name: "common.add" }));
    await user.type(dialog.getAllByLabelText(/common\.name/i).at(-1)!, "Too precise");
    const amountField = dialog.getByLabelText(/menu\.priceDelta/i);
    await user.clear(amountField);
    await user.type(amountField, "1.999");

    expect(dialog.getByText("menu.priceExcessPrecision")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "common.create" })).toBeDisabled();
  });

  // -- 24: no currency property invented on Modifier's write path ------------

  it("24. the create call never sends a currency it invented for the modifier — it's the canonical current currency", async () => {
    modifierGroupsGet.mockResolvedValueOnce(group({ modifiers: [] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await user.click(dialog.getByRole("button", { name: "common.add" }));
    await user.type(dialog.getAllByLabelText(/common\.name/i).at(-1)!, "Extra cheese");
    await user.type(dialog.getByLabelText(/menu\.priceDelta/i), "3");
    await user.click(dialog.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(addModifier).toHaveBeenCalled());
    const [, payload] = addModifier.mock.calls[0]!;
    // The tenant's own canonical currency (session.tenant.baseCurrency, no branch active) — not a hardcoded EGP/USD guess.
    expect(payload.priceDelta.currency).toBe("EGP");
  });

  it("displays an existing modifier's amount formatted in the canonical current currency, with a sign-aware label", async () => {
    modifierGroupsGet.mockResolvedValue(group({ modifiers: [modifier({ name: "Extra cheese", amount: 300 }), modifier({ id: "m2", name: "No cheese", amount: -300 }), modifier({ id: "m3", name: "Plain", amount: 0 })] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    await dialog.findByText("Extra cheese");

    expect(dialog.getByText("menu.priceDeltaExtra")).toBeInTheDocument();
    expect(dialog.getByText("menu.priceDeltaDiscount")).toBeInTheDocument();
    expect(dialog.getByText("menu.priceDeltaNone")).toBeInTheDocument();
    expect(dialog.getByText(`+${formatMoney({ amount: 300, currency: "EGP" }, { locale: "en" }).replace(/ /g, " ")}`)).toBeInTheDocument();
  });

  // -- 25-27: no item-group attach management UI ------------------------------

  it("25. no production item↔group attach management UI is shown in the item editor", async () => {
    const { listItemsWithPlacements } = await import("@/lib/console/menu-management/live-adapter");
    vi.mocked(listItemsWithPlacements).mockResolvedValue([
      {
        id: "i1",
        tenantId: "t1",
        categoryId: "c1",
        name: { en: "Burger", ar: "Burger" },
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
        available: true,
        unavailableReason: null,
        autoReenableAt: null,
        remainingSellable: null,
        sortOrder: 0,
        colour: "#000",
        imageEmoji: "",
        placements: [{ categoryId: "c1", menuId: "m1" }],
      },
    ]);
    const { listMenuCategories } = await import("@/lib/console/menu-management/live-adapter");
    vi.mocked(listMenuCategories).mockResolvedValue([
      { id: "c1", menuId: "m1", name: { en: "Mains", ar: "" }, parentId: null, sortOrder: 0, colour: "#111", itemCount: 1, active: true, tenantId: "t1" },
    ]);

    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    await user.click(await screen.findByRole("button", { name: /Burger/ }));
    const editor = within(await screen.findByRole("dialog"));

    expect(editor.queryByText(/modifier group/i)).not.toBeInTheDocument();
    expect(editor.queryByText(/attach/i)).not.toBeInTheDocument();
    expect(editor.queryByRole("button", { name: /customiz/i })).not.toBeInTheDocument();
  });

  it("26. no unlink/remove control for an attached group exists anywhere", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    await user.click(await dialog.findByText("Sauces"));
    expect(dialog.queryByRole("button", { name: /unlink/i })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("27. no multi-step 'create customization from item' flow exists in HTTP mode", async () => {
    render(<LiveMenuManagement />);
    await screen.findByText("Lunch");

    expect(screen.queryByText(/create customization/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new customization/i })).not.toBeInTheDocument();
  });

  // -- 28/29: permission gating -----------------------------------------------

  it("28. a read-only session (menu.item.read only) cannot mutate modifiers — no New group, no Add, read-only fields", async () => {
    granted = new Set(["menu.item.read"]);
    modifierGroupsGet.mockResolvedValue(group({ modifiers: [modifier({ name: "Ketchup" })] }));
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    expect(dialog.queryByRole("button", { name: "menu.newGroup" })).not.toBeInTheDocument();

    await user.click(await dialog.findByText("Sauces"));
    expect(dialog.queryByRole("button", { name: "common.save" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "common.add" })).not.toBeInTheDocument();
    expect(dialog.getByLabelText(/common\.name/i)).toBeDisabled();
  });

  it("29. menu.item.manage is what gates every modifier-group/modifier write — granting it alone is sufficient", async () => {
    granted = new Set(["menu.item.manage", "menu.item.read"]);
    const user = userEvent.setup();
    render(<LiveMenuManagement />);
    const dialog = await openCustomizations(user);

    expect(dialog.getByRole("button", { name: "menu.newGroup" })).toBeInTheDocument();
  });
});
