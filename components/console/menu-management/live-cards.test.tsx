import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveItemCard } from "./live-cards";
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
    available: true,
    unavailableReason: null,
    autoReenableAt: null,
    remainingSellable: null,
    sortOrder: 0,
    colour: "#000",
    imageEmoji: "",
    placements: [],
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
    await userEvent.click(screen.getByRole("button", { name: /click again to confirm/i }));
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
});
