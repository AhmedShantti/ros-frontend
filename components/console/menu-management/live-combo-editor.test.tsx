import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LiveCategory, LiveItem } from "@/lib/console/menu-management/live-adapter";
import { consoleEn } from "@/content/console/en";

/*
 * Create Combo — real component identity (FR-POS-030/031/032), wired to the
 * live canonical combo backend: MenuItem.isCombo + one priced variant
 * carrying the pricing-strategy definition metadata, real ModifierGroup
 * "slots", real Modifier "options" each with linkedVariantId pointing at an
 * ACTUAL existing variant — never a lookalike label. No mock data.
 */

const itemsCreate = vi.fn();
const itemsUpdate = vi.fn();
const placeItem = vi.fn();
const modifierGroupsCreate = vi.fn();
const modifierGroupsUpdate = vi.fn();
const linkModifierGroup = vi.fn();
const addModifier = vi.fn();
const listItemModifierGroups = vi.fn();
const updateVariantPrice = vi.fn();

vi.mock("@/lib/console/services", () => ({
  services: {
    catalogue: {
      items: {
        create: (...args: unknown[]) => itemsCreate(...args),
        update: (...args: unknown[]) => itemsUpdate(...args),
      },
      placeItem: (...args: unknown[]) => placeItem(...args),
      modifierGroups: {
        create: (...args: unknown[]) => modifierGroupsCreate(...args),
        update: (...args: unknown[]) => modifierGroupsUpdate(...args),
      },
      linkModifierGroup: (...args: unknown[]) => linkModifierGroup(...args),
      addModifier: (...args: unknown[]) => addModifier(...args),
      listItemModifierGroups: (...args: unknown[]) => listItemModifierGroups(...args),
      updateVariantPrice: (...args: unknown[]) => updateVariantPrice(...args),
    },
  },
}));

import LiveComboEditor from "./live-combo-editor";

afterEach(cleanup);

const fmt = { locale: "en" as const };
const tx = (v: { en: string; ar: string }) => v.en;
const t = (key: string) => (consoleEn as Record<string, string>)[key] ?? key;

const category: LiveCategory = {
  id: "cat-1",
  tenantId: "t",
  name: { en: "Combos", ar: "وجبات" },
  parentId: null,
  sortOrder: 0,
  colour: "#000",
  itemCount: 0,
  active: true,
  menuId: "menu-1",
};

function mkStandalone(id: string, name: string, priceMinor: number): LiveItem {
  return {
    id,
    tenantId: "t",
    categoryId: "cat-1",
    name: { en: name, ar: name },
    kitchenName: { en: "", ar: "" },
    receiptName: { en: "", ar: "" },
    description: { en: "", ar: "" },
    taxClassId: null,
    stationType: "grill",
    prepTimeSeconds: 0,
    variants: [
      {
        id: `${id}-var`,
        name: { en: name, ar: name },
        basePrice: { amount: priceMinor, currency: "EGP" },
        barcode: null,
        recipeId: null,
        available: true,
      },
    ],
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
    placements: [],
  };
}

const burger = mkStandalone("item-burger", "Burger", 5000);
const fries = mkStandalone("item-fries", "Fries", 2000);
const cola = mkStandalone("item-cola", "Cola", 1500);

beforeEach(() => {
  itemsCreate.mockReset().mockResolvedValue({ id: "combo-1" });
  itemsUpdate.mockReset().mockResolvedValue(undefined);
  placeItem.mockReset().mockResolvedValue(undefined);
  modifierGroupsCreate.mockReset().mockResolvedValue({ id: "group-1" });
  modifierGroupsUpdate.mockReset().mockResolvedValue(undefined);
  linkModifierGroup.mockReset().mockResolvedValue(undefined);
  addModifier.mockReset().mockResolvedValue(undefined);
  listItemModifierGroups.mockReset().mockResolvedValue([]);
  updateVariantPrice.mockReset().mockResolvedValue(undefined);
});

function mkExistingCombo(overrides: Partial<LiveItem> = {}): LiveItem {
  return {
    ...mkStandalone("combo-existing", "Existing Meal", 8000),
    isCombo: true,
    placements: [{ categoryId: "cat-1", menuId: "menu-1" }],
    variants: [
      {
        id: "combo-existing-var",
        name: { en: "Existing Meal", ar: "Existing Meal" },
        basePrice: { amount: 8000, currency: "EGP" },
        barcode: null,
        recipeId: null,
        available: true,
        comboPricingStrategy: "fixed",
        comboDiscountBps: undefined,
        comboAllocationBasis: "equal",
      },
    ],
    ...overrides,
  };
}

async function addOptionToSlot(slotHeading: RegExp, itemName: string) {
  const placeholderOption = screen.getByText(new RegExp(`add an item to "${slotHeading.source}"`, "i"));
  const select = placeholderOption.closest("select") as HTMLSelectElement;
  const option = within(select).getByRole("option", { name: new RegExp(itemName) });
  await userEvent.selectOptions(select, option);
}

describe("LiveComboEditor", () => {
  it("blocks creation until a name, category, and at least one option exist", async () => {
    render(
      <LiveComboEditor
        categories={[category]}
        nonComboItems={[burger, fries, cola]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /create combo/i })).toBeDisabled();
  });

  it("fixed price: creates the combo, links one slot per non-empty part, and each option as a real linkedVariantId modifier", async () => {
    render(
      <LiveComboEditor
        categories={[category]}
        nonComboItems={[burger, fries, cola]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/chicken meal/i), "Value Meal");
    await addOptionToSlot(/Main/, "Burger");
    await addOptionToSlot(/Side/, "Fries");

    await userEvent.type(screen.getByPlaceholderText("0.00"), "90");
    await userEvent.click(screen.getByRole("button", { name: /create combo/i }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalledTimes(1));
    expect(itemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        isCombo: true,
        variants: [
          expect.objectContaining({
            price: { amount: 9000, currency: "EGP" },
            comboPricingStrategy: "fixed",
            comboAllocationBasis: "equal",
          }),
        ],
      }),
    );
    expect(placeItem).toHaveBeenCalledWith("combo-1", "cat-1");
    // Only the two filled slots (Main, Side) become groups — "Drink" was left empty.
    expect(modifierGroupsCreate).toHaveBeenCalledTimes(2);
    expect(linkModifierGroup).toHaveBeenCalledTimes(2);
    expect(addModifier).toHaveBeenCalledWith(
      "group-1",
      expect.objectContaining({ linkedVariantId: "item-burger-var", isDefault: true }),
    );
  });

  it("component_price_override: sends comboComponentPriceOverride only on each slot's default option", async () => {
    render(
      <LiveComboEditor
        categories={[category]}
        nonComboItems={[burger, fries]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/chicken meal/i), "Override Meal");
    await addOptionToSlot(/Main/, "Burger");
    await userEvent.click(screen.getByRole("button", { name: /component override/i }));

    const overrideInputs = screen.getAllByPlaceholderText("price");
    await userEvent.type(overrideInputs[0]!, "70");
    await userEvent.click(screen.getByRole("button", { name: /create combo/i }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalledTimes(1));
    expect(itemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        variants: [expect.objectContaining({ price: { amount: 7000, currency: "EGP" }, comboPricingStrategy: "component_price_override" })],
      }),
    );
    expect(addModifier).toHaveBeenCalledWith(
      "group-1",
      expect.objectContaining({
        linkedVariantId: "item-burger-var",
        isDefault: true,
        comboComponentPriceOverride: { amount: 7000, currency: "EGP" },
      }),
    );
  });

  it("edit mode: reopening an existing combo prefills basic info/strategy/price and shows its real saved parts read-only", async () => {
    listItemModifierGroups.mockResolvedValue([
      {
        id: "existing-group-1",
        tenantId: "t",
        name: { en: "Main", ar: "Main" },
        minSelections: 1,
        maxSelections: 1,
        required: true,
        allowRepeat: false,
        freeQuantityThreshold: null,
        attachedItemCount: 1,
        modifiers: [
          {
            id: "existing-mod-1",
            name: { en: "Burger", ar: "Burger" },
            kind: "addition",
            priceDelta: { amount: 0, currency: "EGP" },
            recipeDelta: [],
            isDefault: true,
            linkedVariantId: burger.variants[0]!.id,
            comboComponentPriceOverride: null,
          },
        ],
      },
    ]);

    render(
      <LiveComboEditor
        existingItem={mkExistingCombo()}
        categories={[category]}
        nonComboItems={[burger, fries]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    expect(screen.getByText(/edit combo/i)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Existing Meal")).toBeInTheDocument();
    await waitFor(() => expect(listItemModifierGroups).toHaveBeenCalledWith("combo-existing"));
    expect(await screen.findByText("Burger")).toBeInTheDocument();
    expect(screen.getAllByText(/default/i).length).toBeGreaterThan(0);
    // An existing option carries no remove control — it cannot be deleted here.
    expect(screen.queryByRole("button", { name: /remove burger/i })).not.toBeInTheDocument();
  });

  it("edit mode: saves basic-info/price changes and a newly added alternate option, WITHOUT recreating the existing default", async () => {
    listItemModifierGroups.mockResolvedValue([
      {
        id: "existing-group-1",
        tenantId: "t",
        name: { en: "Main", ar: "Main" },
        minSelections: 1,
        maxSelections: 1,
        required: true,
        allowRepeat: false,
        freeQuantityThreshold: null,
        attachedItemCount: 1,
        modifiers: [
          {
            id: "existing-mod-1",
            name: { en: "Burger", ar: "Burger" },
            kind: "addition",
            priceDelta: { amount: 0, currency: "EGP" },
            recipeDelta: [],
            isDefault: true,
            linkedVariantId: burger.variants[0]!.id,
            comboComponentPriceOverride: null,
          },
        ],
      },
    ]);

    render(
      <LiveComboEditor
        existingItem={mkExistingCombo()}
        categories={[category]}
        nonComboItems={[burger, fries]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    await screen.findByText("Burger");
    // Add a NEW alternate option to the already-existing "Main" part.
    await addOptionToSlot(/Main/, "Fries");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(itemsUpdate).toHaveBeenCalledTimes(1));
    expect(itemsUpdate).toHaveBeenCalledWith(
      "combo-existing",
      expect.objectContaining({ name: { en: "Existing Meal", ar: "Existing Meal" } }),
    );
    // Same category as before -> no re-placement call.
    expect(placeItem).not.toHaveBeenCalled();
    expect(updateVariantPrice).toHaveBeenCalledWith(
      "combo-existing-var",
      { amount: 8000, currency: "EGP" },
      expect.objectContaining({ comboPricingStrategy: "fixed", comboAllocationBasis: "equal" }),
    );
    // The existing part is UPDATED, never re-created or re-linked.
    expect(modifierGroupsCreate).not.toHaveBeenCalled();
    expect(linkModifierGroup).not.toHaveBeenCalled();
    expect(modifierGroupsUpdate).toHaveBeenCalledWith("existing-group-1", expect.objectContaining({ required: true }));
    // Only the NEW option is created; the pre-existing default is never re-sent.
    expect(addModifier).toHaveBeenCalledTimes(1);
    expect(addModifier).toHaveBeenCalledWith(
      "existing-group-1",
      expect.objectContaining({ linkedVariantId: "item-fries-var", isDefault: false }),
    );
  });

  it("never exposes a part with no items as a saved slot (empty parts are skipped, not sent)", async () => {
    render(
      <LiveComboEditor
        categories={[category]}
        nonComboItems={[burger]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText(/chicken meal/i), "Solo Meal");
    await addOptionToSlot(/Main/, "Burger");
    await userEvent.type(screen.getByPlaceholderText("0.00"), "50");
    await userEvent.click(screen.getByRole("button", { name: /create combo/i }));

    await waitFor(() => expect(modifierGroupsCreate).toHaveBeenCalledTimes(1));
    expect(linkModifierGroup).toHaveBeenCalledTimes(1);
  });
});
