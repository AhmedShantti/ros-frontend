import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-3-AVAILABILITY-MODIFIERS — Arabic / RTL.
 *
 * Every Phase 3 string (availability/86, auto-reenable, deactivated,
 * Customizations, modifier groups/modifiers) must come through
 * `content/console/{en,ar}.ts`, never be hard-coded in English. This pins
 * every key Phase 3 uses exists in BOTH catalogues with a distinct, real
 * Arabic value, and separately renders the real toolbar/drawer through the
 * REAL Arabic catalogue.
 */

const PHASE3_KEYS = [
  "menu.toggle86",
  "menu.toggleAvailable",
  "menu.86Reason",
  "menu.86ReasonHint",
  "menu.86Placeholder",
  "menu.restored",
  "menu.eightySixed",
  "menu.eightySixedNotice",
  "menu.unavailable",
  "menu.available",
  "menu.autoReenableAt",
  "menu.autoReenableHint",
  "menu.autoReenableActive",
  "menu.deactivated",
  "menu.deactivatedNotice",
  "common.deactivate",
  "menu.customizations",
  "menu.customizationsHint",
  "menu.newGroup",
  "menu.groupCreated",
  "menu.groupUpdated",
  "menu.noModifierGroups",
  "menu.selectionRuleError",
  "menu.requiredMinError",
  "menu.required",
  "menu.allowRepeat",
  "menu.minSelections",
  "menu.maxSelections",
  "nav.modifiers",
  "menu.newModifier",
  "menu.modifierAdded",
  "menu.noModifiers",
  "menu.modifierKind",
  "menu.modifierKindHint",
  "menu.priceDelta",
  "menu.priceDeltaExtra",
  "menu.priceDeltaDiscount",
  "menu.priceDeltaNone",
  "menu.existingModifiersNote",
] as const;

const ARABIC_SCRIPT = /[؀-ۿ]/;

const menusList = vi.fn();
const modifierGroupsList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
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
      priceLists: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      modifierGroups: {
        list: (...args: unknown[]) => modifierGroupsList(...args),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      addModifier: vi.fn(),
      setPrice: vi.fn(),
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

vi.mock("@/lib/console/providers", async () => {
  const { consoleAr } = await import("@/content/console/ar");
  const catalogue = consoleAr as Record<string, string>;
  return {
    useI18n: () => ({
      t: (key: string) => catalogue[key] ?? `MISSING:${key}`,
      tx: (value: unknown) => (typeof value === "string" ? value : ((value as { ar?: string })?.ar ?? "")),
      locale: "ar",
      dir: "rtl",
      fmt: { locale: "ar", arabicIndicNumerals: false },
    }),
    usePermission: () => true,
    useSession: () => ({
      scope: { tenantId: "t1", brandId: null, branchId: null },
      availableBranches: [],
      tenant: { id: "t1", name: { en: "Acme", ar: "أكمي" }, baseCurrency: "EGP" },
      brand: null,
      branch: null,
    }),
  };
});

import { consoleAr } from "@/content/console/ar";
import { consoleEn } from "@/content/console/en";
import LiveMenuManagement from "./live-menu-management";

function group() {
  return {
    id: "g1",
    tenantId: "t1",
    name: { en: "Sauces", ar: "صلصات" },
    minSelections: 0,
    maxSelections: 1,
    required: false,
    allowRepeat: false,
    freeQuantityThreshold: null,
    modifiers: [],
    attachedItemCount: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  menusList.mockResolvedValue({ rows: [{ id: "m1", name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: [], branchIds: [], active: true, createdAt: "2026-01-01T00:00:00Z" }], total: 1 });
  modifierGroupsList.mockResolvedValue({ rows: [group()], total: 1 });
});
afterEach(() => cleanup());

describe("Phase 3 — localization", () => {
  it("every key Phase 3 uses exists in BOTH catalogues, and the Arabic is real Arabic (not the English copied)", () => {
    for (const key of PHASE3_KEYS) {
      const en = (consoleEn as Record<string, string>)[key];
      const ar = (consoleAr as Record<string, string>)[key];
      expect(en, `en ${key}`).toBeTruthy();
      expect(ar, `ar ${key}`).toBeTruthy();
      expect(ar, `ar ${key} script`).toMatch(ARABIC_SCRIPT);
      expect(ar, `ar ${key} differs`).not.toBe(en);
    }
  });

  it("the Customizations button and drawer render in Arabic through the real catalogue — no MISSING key, no stray English", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    const button = await screen.findByRole("button", { name: consoleAr["menu.customizations"] });
    await user.click(button);

    expect(await screen.findByText("صلصات")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("MISSING:");
  });

  it("the New Modifier Group form renders Arabic labels, and the numeric selection fields stay LTR under an RTL locale", async () => {
    modifierGroupsList.mockResolvedValue({ rows: [], total: 0 });
    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    await user.click(await screen.findByRole("button", { name: consoleAr["menu.customizations"] }));
    await user.click(await screen.findByRole("button", { name: consoleAr["menu.newGroup"] }));

    expect(screen.getByText(consoleAr["menu.minSelections"])).toBeInTheDocument();
    expect(screen.getByText(consoleAr["menu.maxSelections"])).toBeInTheDocument();

    const numericInputs = document.querySelectorAll('input[inputmode="numeric"]');
    expect(numericInputs.length).toBeGreaterThan(0);
    numericInputs.forEach((el) => expect(el).toHaveAttribute("dir", "ltr"));
  });
});
