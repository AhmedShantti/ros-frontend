import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LiveCategory, LiveItem } from "@/lib/console/menu-management/live-adapter";
import { consoleEn } from "@/content/console/en";

/*
 * Read-only Customer Preview — mostly pure props in, DOM out; a combo's real
 * parts/options are READ (never written, never fabricated) via
 * `services.catalogue.listItemModifierGroups`, the same read
 * `live-combo-editor.tsx` uses to reopen a combo for editing.
 */

const listItemModifierGroups = vi.fn();

vi.mock("@/lib/console/services", () => ({
  services: {
    catalogue: {
      listItemModifierGroups: (...args: unknown[]) => listItemModifierGroups(...args),
    },
  },
}));

import LiveMenuPreview from "./live-menu-preview";

afterEach(cleanup);

beforeEach(() => {
  listItemModifierGroups.mockReset().mockResolvedValue([]);
});

const fmt = { locale: "en" as const };
const tx = (v: { en: string; ar: string }) => v.en;
const t = (key: string) => (consoleEn as Record<string, string>)[key] ?? key;

function mkCategory(overrides: Partial<LiveCategory> = {}): LiveCategory {
  return {
    id: "cat-1",
    tenantId: "t",
    name: { en: "Burgers", ar: "برغر" },
    parentId: null,
    sortOrder: 0,
    colour: "#000",
    itemCount: 1,
    active: true,
    menuId: "menu-1",
    ...overrides,
  };
}

function mkItem(overrides: Partial<LiveItem> = {}): LiveItem {
  return {
    id: "item-1",
    tenantId: "t",
    categoryId: "cat-1",
    name: { en: "Cheeseburger", ar: "تشيزبرغر" },
    kitchenName: { en: "", ar: "" },
    receiptName: { en: "", ar: "" },
    description: { en: "", ar: "" },
    taxClassId: null,
    stationType: "grill",
    prepTimeSeconds: 0,
    variants: [
      {
        id: "var-1",
        name: { en: "Regular", ar: "عادي" },
        basePrice: { amount: 1000, currency: "EGP" },
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
    placements: [{ categoryId: "cat-1", menuId: "menu-1" }],
    ...overrides,
  };
}

describe("LiveMenuPreview", () => {
  it("renders items grouped by category, with price and description", () => {
    render(
      <LiveMenuPreview
        menuName="Lunch"
        categories={[mkCategory()]}
        items={[mkItem()]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Burgers")).toBeInTheDocument();
    expect(screen.getByText("Cheeseburger")).toBeInTheDocument();
    expect(screen.getByText(/10\.00|EGP/i)).toBeInTheDocument();
  });

  it("marks an unavailable item as Sold out, never hides it silently", () => {
    render(
      <LiveMenuPreview
        menuName="Lunch"
        categories={[mkCategory()]}
        items={[mkItem({ available: false })]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  it("renders combos in their own section, separate from category items", () => {
    const combo = mkItem({
      id: "combo-1",
      name: { en: "Meal Deal", ar: "وجبة" },
      isCombo: true,
      placements: [],
      variants: [
        {
          id: "combo-var-1",
          name: { en: "Meal Deal", ar: "وجبة" },
          basePrice: { amount: 2500, currency: "EGP" },
          barcode: null,
          recipeId: null,
          available: true,
        },
      ],
    });
    render(
      <LiveMenuPreview
        menuName="Lunch"
        categories={[mkCategory()]}
        items={[combo]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Combos")).toBeInTheDocument();
    expect(screen.getByText("Meal Deal")).toBeInTheDocument();
  });

  it("shows a combo's REAL parts/options, read via listItemModifierGroups — never fabricated", async () => {
    const fries = mkItem({ id: "item-fries", name: { en: "Fries", ar: "Fries" }, variants: [
      { id: "fries-var", name: { en: "Fries", ar: "Fries" }, basePrice: { amount: 300, currency: "EGP" }, barcode: null, recipeId: null, available: true },
    ] });
    const combo = mkItem({
      id: "combo-1",
      name: { en: "Meal Deal", ar: "وجبة" },
      isCombo: true,
      placements: [],
      variants: [
        { id: "combo-var-1", name: { en: "Meal Deal", ar: "وجبة" }, basePrice: { amount: 2500, currency: "EGP" }, barcode: null, recipeId: null, available: true },
      ],
    });
    listItemModifierGroups.mockResolvedValue([
      {
        id: "group-1",
        tenantId: "t",
        name: { en: "Side", ar: "Side" },
        minSelections: 1,
        maxSelections: 1,
        required: true,
        allowRepeat: false,
        freeQuantityThreshold: null,
        attachedItemCount: 1,
        modifiers: [
          {
            id: "mod-1",
            name: { en: "Fries", ar: "Fries" },
            kind: "addition",
            priceDelta: { amount: 0, currency: "EGP" },
            recipeDelta: [],
            isDefault: true,
            linkedVariantId: "fries-var",
            comboComponentPriceOverride: null,
          },
        ],
      },
    ]);

    render(
      <LiveMenuPreview
        menuName="Lunch"
        categories={[mkCategory()]}
        items={[combo, fries]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(listItemModifierGroups).toHaveBeenCalledWith("combo-1"));
    expect(await screen.findByText(/Side/)).toBeInTheDocument();
    expect(screen.getAllByText(/Fries/).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there is nothing to preview", () => {
    render(
      <LiveMenuPreview
        menuName="Empty Menu"
        categories={[]}
        items={[]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/nothing to show yet/i)).toBeInTheDocument();
  });

  it("calls onClose from the close button", async () => {
    const onClose = () => onCloseSpy();
    let calls = 0;
    const onCloseSpy = () => { calls += 1; };
    render(
      <LiveMenuPreview
        menuName="Lunch"
        categories={[]}
        items={[]}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /close preview/i }));
    expect(calls).toBe(1);
  });
});
