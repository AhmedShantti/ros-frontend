import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveComboCard, LiveItemCard, type VariantIndex } from "./live-cards";
import type { LiveItem } from "@/lib/console/menu-management/live-adapter";
import { consoleEn } from "@/content/console/en";

/*
 * Reference-style row menu (`.dots-wrap`/`.row-menu`), populated with ONLY
 * real, canonically-supported actions — Edit, 86/restore, and Deactivate
 * (a click-to-confirm, since there is no hard-delete endpoint). No
 * "Duplicate", no "Hidden" — neither exists on this backend.
 */

afterEach(cleanup);

const fmt = { locale: "en" as const };
const tx = (v: { en: string; ar: string }) => v.en;
const t = (key: string) => (consoleEn as Record<string, string>)[key] ?? key;

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
      { id: "var-1", name: { en: "Regular", ar: "عادي" }, basePrice: { amount: 1000, currency: "EGP" }, barcode: null, recipeId: null, available: true },
    ],
    allergens: [],
    isCombo: false,
    isOpenPrice: false,
    isWeighed: false,
    isActive: true,
    available: true,
    unavailableReason: null,
    autoReenableAt: null,
    remainingSellable: null,
    sortOrder: 0,
    colour: "#000",
    imageEmoji: "",
    placements: [],
    modifierGroups: [],
    ...overrides,
  };
}

describe("LiveItemCard row menu", () => {
  it("offers only Edit, availability toggle, and Deactivate — never Duplicate or Hidden", async () => {
    render(
      <LiveItemCard
        item={mkItem()}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        onDeactivate={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByText(t("menu.rowMenuShowAs"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark unavailable/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^deactivate$/i })).toBeInTheDocument();
    expect(screen.queryByText(/duplicate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden|hide from menu/i)).not.toBeInTheDocument();
  });

  it("Deactivate requires a second click to confirm before firing", async () => {
    const onDeactivate = vi.fn();
    render(
      <LiveItemCard
        item={mkItem()}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        onDeactivate={onDeactivate}
        canToggleAvailability
        canManage
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    await userEvent.click(screen.getByRole("button", { name: /^deactivate$/i }));
    expect(onDeactivate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /click again to deactivate/i }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("hides the row menu entirely for a caller with neither permission", () => {
    render(
      <LiveItemCard
        item={mkItem()}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        canToggleAvailability={false}
        canManage={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();
  });

  it("a deactivated item (isActive=false, no 86 rule) shows Deactivated and offers Activate — never conflated with a manual 86", async () => {
    render(
      <LiveItemCard
        item={mkItem({ isActive: false, available: false, unavailableReason: null })}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        onDeactivate={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText(t("menu.deactivated"))).toBeInTheDocument();
    expect(screen.queryByText(t("menu.eightySixed"))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("button", { name: t("common.activate") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("menu.toggleAvailable") })).not.toBeInTheDocument();
  });

  it("a manually-86'd item (isActive=true, unavailableReason set) shows the 86 label and offers Restore — never Activate", async () => {
    render(
      <LiveItemCard
        item={mkItem({ isActive: true, available: false, unavailableReason: "manual_86" })}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        onDeactivate={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText(t("menu.eightySixed"))).toBeInTheDocument();
    expect(screen.queryByText(t("menu.deactivated"))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("button", { name: t("menu.toggleAvailable") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("common.activate") })).not.toBeInTheDocument();
  });

  it("a deactivated item that ALSO still carries a stale 86 rule (compound state) is truthfully Deactivated, not 86'd — isActive takes priority", async () => {
    render(
      <LiveItemCard
        item={mkItem({ isActive: false, available: false, unavailableReason: "manual_86" })}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        onDeactivate={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText(t("menu.deactivated"))).toBeInTheDocument();
    expect(screen.queryByText(t("menu.eightySixed"))).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("button", { name: t("common.activate") })).toBeInTheDocument();
  });

  it("shows the item's real attached customization groups as chips — the reference's modifier-chips block", () => {
    render(
      <LiveItemCard
        item={mkItem({ modifierGroups: [{ id: "g1", tenantId: "t", name: { en: "Sauces", ar: "" }, minSelections: 0, maxSelections: 1, required: false, allowRepeat: false, freeQuantityThreshold: null, modifiers: [], attachedItemCount: 0 }] })}
        currency="EGP"
        fmt={fmt}
        tx={tx}
        t={t}
        onEdit={() => {}}
        onToggle86={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText("Sauces")).toBeInTheDocument();
  });
});

describe("LiveComboCard — real slot detail", () => {
  const fries = { id: "fries-var", name: { en: "Fries", ar: "" }, basePrice: { amount: 300, currency: "EGP" as const }, barcode: null, recipeId: null, available: true };
  const modifier = (over: Partial<{ linkedVariantId: string | null; isDefault: boolean; name: string }> = {}) => ({
    id: `mod-${Math.random()}`,
    name: { en: over.name ?? "Fries", ar: "" },
    kind: "addition" as const,
    priceDelta: { amount: 0, currency: "EGP" as const },
    recipeDelta: [],
    isDefault: over.isDefault ?? true,
    linkedVariantId: over.linkedVariantId ?? "fries-var",
    comboComponentPriceOverride: null,
  });
  const group = (options: ReturnType<typeof modifier>[]) => ({
    id: "g1",
    tenantId: "t",
    name: { en: "Side", ar: "" },
    minSelections: 1,
    maxSelections: 1,
    required: true,
    allowRepeat: false,
    freeQuantityThreshold: null,
    modifiers: options,
    attachedItemCount: 0,
  });
  const comboVariant = { id: "combo-var", name: { en: "Meal Deal", ar: "" }, basePrice: { amount: 3000, currency: "EGP" as const }, barcode: null, recipeId: null, available: true, comboPricingStrategy: "fixed" as const };

  it("shows a real slot summary line built from linked variant names", () => {
    const index: VariantIndex = new Map([["fries-var", { available: true, price: fries.basePrice, name: "Fries" }]]);
    render(
      <LiveComboCard
        item={mkItem({ id: "combo-1", isCombo: true, variants: [comboVariant], modifierGroups: [group([modifier()])] })}
        fmt={fmt}
        tx={tx}
        t={t}
        variantIndex={index}
        onEdit={() => {}}
        onToggle86={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText("Side: Fries")).toBeInTheDocument();
  });

  it("shows a real \"can't be ordered\" warning when a slot's only linked item is unavailable — never fabricated", () => {
    const index: VariantIndex = new Map([["fries-var", { available: false, price: fries.basePrice, name: "Fries" }]]);
    render(
      <LiveComboCard
        item={mkItem({ id: "combo-1", isCombo: true, variants: [comboVariant], modifierGroups: [group([modifier()])] })}
        fmt={fmt}
        tx={tx}
        t={t}
        variantIndex={index}
        onEdit={() => {}}
        onToggle86={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText(t("menu.comboCantBeOrdered"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t("menu.comboNoAvailableItemIn")))).toBeInTheDocument();
  });

  it("shows a real savings badge computed from the default option's real linked price vs the combo's real price — never a fabricated number", () => {
    const index: VariantIndex = new Map([["fries-var", { available: true, price: fries.basePrice, name: "Fries" }]]);
    render(
      <LiveComboCard
        item={mkItem({
          id: "combo-1",
          isCombo: true,
          variants: [{ ...comboVariant, basePrice: { amount: 200, currency: "EGP" } }],
          modifierGroups: [group([modifier()])],
        })}
        fmt={fmt}
        tx={tx}
        t={t}
        variantIndex={index}
        onEdit={() => {}}
        onToggle86={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.getByText(new RegExp(t("menu.comboSaveLabel")))).toBeInTheDocument();
  });

  it("shows no savings badge when the combo price is not actually cheaper than the real components", () => {
    const index: VariantIndex = new Map([["fries-var", { available: true, price: fries.basePrice, name: "Fries" }]]);
    render(
      <LiveComboCard
        item={mkItem({ id: "combo-1", isCombo: true, variants: [comboVariant], modifierGroups: [group([modifier()])] })}
        fmt={fmt}
        tx={tx}
        t={t}
        variantIndex={index}
        onEdit={() => {}}
        onToggle86={() => {}}
        canToggleAvailability
        canManage
      />,
    );
    expect(screen.queryByText(new RegExp(t("menu.comboSaveLabel")))).not.toBeInTheDocument();
  });
});
