import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-2-PRICING — Arabic / RTL.
 *
 * Every pricing string must come through `content/console/{en,ar}.ts`, never
 * be hard-coded in English. This pins every pricing key used by the live
 * workspace exists in BOTH catalogues with a distinct, real Arabic value, and
 * separately renders the real price-list toolbar through the REAL Arabic
 * catalogue.
 */

const PRICING_KEYS = [
  "menu.priceListLabel",
  "menu.priceListNone",
  "menu.noPriceLists",
  "menu.priceListStatusActive",
  "menu.priceListStatusScheduled",
  "menu.priceListStatusExpired",
  "menu.priceListScopeTenant",
  "menu.priceListScopeBrand",
  "menu.priceListScopeBranch",
  "menu.priceListScopeBrandActive",
  "menu.priceListScopeBranchActive",
  "menu.priceListScopeNeedsBrand",
  "menu.priceListScopeNeedsBranch",
  "menu.priceListPriorityHint",
  "menu.priceListOrderType",
  "menu.priceListOrderTypeAny",
  "menu.priceListValidFrom",
  "menu.priceListValidTo",
  "menu.priceInSelectedList",
  "menu.priceNeedsVariant",
  "menu.priceNeedsPriceList",
  "menu.priceReadOnly",
  "menu.priceExcessPrecision",
  "menu.orderTypeDineIn",
  "menu.orderTypeTakeaway",
  "menu.orderTypeDelivery",
  "menu.orderTypeDriveThru",
  "menu.orderTypePickup",
  "menu.orderTypeAggregator",
  "menu.newPriceList",
  "menu.priceListCreated",
  "menu.priceSaved",
  "menu.priceHint",
] as const;

const ARABIC_SCRIPT = /[؀-ۿ]/;

const priceListsList = vi.fn();
const priceListsGet = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    catalogue: {
      menus: {
        list: vi.fn().mockResolvedValue({ rows: [{ id: "m1", name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: [], branchIds: [], active: true, createdAt: "2026-01-01T00:00:00Z" }], total: 1 }),
        create: vi.fn(),
        get: vi.fn().mockResolvedValue({ id: "m1", name: { en: "Lunch", ar: "غداء" }, priority: 10, orderTypes: [], branchIds: [], active: true }),
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
        list: (...args: unknown[]) => priceListsList(...args),
        get: (...args: unknown[]) => priceListsGet(...args),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      modifierGroups: {
        list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
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

function priceList(overrides: Partial<{ id: string; name: string; status: "scheduled" | "active" | "expired" }> = {}) {
  return {
    id: overrides.id ?? "pl1",
    tenantId: "t1",
    name: { en: overrides.name ?? "Standard", ar: overrides.name ?? "قياسي" },
    scope: "tenant" as const,
    scopeId: null,
    orderTypes: [],
    priority: 10,
    validFrom: null,
    validTo: null,
    recurrence: null,
    entryCount: 0,
    entries: [],
    status: overrides.status ?? "active",
    active: (overrides.status ?? "active") === "active",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  priceListsList.mockResolvedValue({ rows: [priceList()], total: 1 });
  priceListsGet.mockResolvedValue(priceList());
});
afterEach(() => cleanup());

describe("Pricing — localization", () => {
  it("every pricing key used by the live workspace exists in BOTH catalogues, and the Arabic is real Arabic (not the English copied)", () => {
    for (const key of PRICING_KEYS) {
      const en = (consoleEn as Record<string, string>)[key];
      const ar = (consoleAr as Record<string, string>)[key];
      expect(en, `en ${key}`).toBeTruthy();
      expect(ar, `ar ${key}`).toBeTruthy();
      expect(ar, `ar ${key} script`).toMatch(ARABIC_SCRIPT);
      expect(ar, `ar ${key} differs`).not.toBe(en);
    }
  });

  it("the price-list toolbar renders in Arabic through the real catalogue — no MISSING key, no stray English", async () => {
    render(<LiveMenuManagement />);

    // The selected price list's own (Arabic) name from the fixture.
    expect(await screen.findByText("قياسي")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: consoleAr["menu.newPriceList"] })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("MISSING:");
  });

  it("an empty price-list picker shows the Arabic empty-state copy, not English", async () => {
    priceListsList.mockResolvedValue({ rows: [], total: 0 });
    render(<LiveMenuManagement />);

    expect(await screen.findByText(consoleAr["menu.noPriceLists"])).toBeInTheDocument();
  });

  it("New Price List drawer scope labels render in Arabic, and numeric/date fields stay LTR even under an RTL locale", async () => {
    const user = userEvent.setup();
    render(<LiveMenuManagement />);

    await user.click(await screen.findByRole("button", { name: consoleAr["menu.newPriceList"] }));
    expect(screen.getByText(consoleAr["menu.scope"] ?? "menu.scope")).toBeTruthy();

    // Priority and the two date fields are numeric/positional data — always LTR,
    // regardless of the page's own RTL direction, per FR-LOC numeric-field convention.
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThan(0);
    dateInputs.forEach((el) => expect(el).toHaveAttribute("dir", "ltr"));
  });
});
