import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CountryPack, MenuItem } from "@/lib/console/types";

/*
 * FRONTEND-ITEM-TAX-CLASS-EDITOR-P0
 *
 * The ticket that asked for this asserted a `GET
 * /catalogue/branches/{branchId}/tax-classes` endpoint returning `{id, code,
 * names}` and a PATCH that expects a tax-class UUID. Neither exists: the
 * committed `api/openapi.json` (148 real paths) has no tax-related path at
 * all, and `UpdateMenuItemDto.taxClassId`/`CreateMenuItemDto.taxClassId` are
 * documented "recorded only... never resolved" (C-04) — there is no backend
 * UUID registry to validate against. `TaxClassField` (./page.tsx) already
 * reflects that: it sources options from the active Country Pack's
 * `taxClasses` (code-keyed: standard/reduced/zero/exempt, no UUID) and saves
 * that code as `taxClassId`, never a fabricated fallback. These tests prove
 * that contract, not the ticket's unverified one.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `ItemDrawer`/`NewItemDrawer` are the real
 * components.
 */

const itemsGet = vi.fn();
const itemsUpdate = vi.fn();
const itemsCreate = vi.fn();
const countryPacksList = vi.fn();
const modifierGroupsList = vi.fn();

vi.mock("@/lib/console/services", () => ({
  // `describeError` (lib/console/actions.ts) does `caught instanceof
  // ServiceError` — needs a real export here even though these tests only
  // ever throw plain `Error`s, which fall through to the `Error` branch.
  ServiceError: class ServiceError extends Error {},
  services: {
    catalogue: {
      items: {
        get: (...args: unknown[]) => itemsGet(...args),
        update: (...args: unknown[]) => itemsUpdate(...args),
        create: (...args: unknown[]) => itemsCreate(...args),
      },
      modifierGroups: {
        list: (...args: unknown[]) => modifierGroupsList(...args),
      },
    },
    platform: {
      countryPacks: {
        list: (...args: unknown[]) => countryPacksList(...args),
      },
    },
  },
}));

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({ scope: { tenantId: "t1", brandId: null, branchId: null } }),
  usePermission: () => true,
}));

import { ItemDrawer, NewItemDrawer } from "./page";

const TAX_STANDARD = { code: "standard" as const, rate: 14, label: { en: "Standard", ar: "قياسي" } };
const TAX_ZERO = { code: "zero" as const, rate: 0, label: { en: "Zero", ar: "صفري" } };

const ACTIVE_PACK: CountryPack = {
  code: "EG",
  name: { en: "Egypt", ar: "مصر" },
  version: "1.0.0",
  effectiveFrom: "2026-01-01",
  status: "active",
  signed: true,
  currency: "EGP",
  currencyExponent: 2,
  taxEngine: "eta",
  pricingMode: "tax_inclusive",
  roundingMode: "HALF_UP",
  computationLevel: "line",
  taxClasses: [TAX_STANDARD, TAX_ZERO],
  fiscalProvider: "eta_egypt",
  fiscalMode: "e_receipt",
  weekStart: "saturday",
  weekend: ["friday"],
  standardWeeklyHours: 48,
  overtimeMultiplier: 1.35,
  dataRetentionYears: 5,
  branchCount: 1,
  conformancePassed: true,
};

const BASE_ITEM: MenuItem = {
  id: "item-1",
  tenantId: "tenant-1",
  categoryId: "cat-1",
  name: { en: "Test maqloba", ar: "مقلوبة اختبار" },
  kitchenName: { en: "MAQLOBA", ar: "مقلوبة" },
  receiptName: { en: "Test maqloba", ar: "مقلوبة اختبار" },
  description: { en: "", ar: "" },
  taxClassId: null,
  stationType: "cold",
  prepTimeSeconds: 60,
  variants: [],
  allergens: [],
  isCombo: false,
  isOpenPrice: false,
  isWeighed: false,
  available: true,
  unavailableReason: null,
  remainingSellable: null,
  sortOrder: 1,
  colour: "#ffffff",
  imageEmoji: "🍽️",
};

function itemWith(patch: Partial<MenuItem>): MenuItem {
  return { ...BASE_ITEM, ...patch };
}

async function openTaxClassOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^menu\.taxClass / }));
}

beforeEach(() => {
  itemsGet.mockReset();
  itemsUpdate.mockReset();
  itemsCreate.mockReset();
  countryPacksList.mockReset();
  modifierGroupsList.mockReset();

  countryPacksList.mockResolvedValue({ rows: [ACTIVE_PACK], total: 1 });
  modifierGroupsList.mockResolvedValue({ rows: [], total: 0 });
  itemsUpdate.mockResolvedValue(BASE_ITEM);
  itemsCreate.mockResolvedValue(BASE_ITEM);
});

afterEach(() => {
  cleanup();
});

describe("ItemDrawer — Tax Class editing", () => {
  it("is clickable/selectable and lists human-friendly labels loaded from the active country pack, not a hardcoded 'zero'", async () => {
    const item = itemWith({ taxClassId: null });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    await openTaxClassOptions(user);

    expect(screen.getByRole("option", { name: /Standard/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Zero/ })).toBeInTheDocument();
    // Not just a single hardcoded "zero" entry — every pack tax class is offered.
    expect(screen.queryAllByRole("option")).toHaveLength(3); // placeholder + standard + zero
  });

  it("preselects the item's existing taxClassId on open", async () => {
    const item = itemWith({ taxClassId: "standard" });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^menu\.taxClass / })).toHaveTextContent(/Standard/),
    );
  });

  it("selecting Zero sends its code as taxClassId, not the display label", async () => {
    const item = itemWith({ taxClassId: "standard" });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await waitFor(() => expect(itemsUpdate).toHaveBeenCalledTimes(1));
    const [id, patch] = itemsUpdate.mock.calls[0];
    expect(id).toBe(item.id);
    expect(patch.taxClassId).toBe("zero");
    expect(patch.taxClassId).not.toBe("Zero");
    expect(patch.taxClassId).not.toMatch(/—/);
  });

  it("saving a tax class change sends only { taxClassId }, never unrelated item fields", async () => {
    const item = itemWith({ taxClassId: "standard", name: { en: "Untouched name", ar: "اسم" } });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await waitFor(() => expect(itemsUpdate).toHaveBeenCalledTimes(1));
    const patch = itemsUpdate.mock.calls[0][1];
    expect(Object.keys(patch)).toEqual(["taxClassId"]);
    expect(patch).not.toHaveProperty("name");
    expect(patch).not.toHaveProperty("categoryId");
  });

  it("an item with no tax class is shown as unclassified and never auto-saves a fallback", async () => {
    const item = itemWith({ taxClassId: null });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    expect(screen.getByText("menu.taxClassNotConfigured")).toBeInTheDocument();
    expect(itemsUpdate).not.toHaveBeenCalled();
  });

  it("shows the unavailable callout instead of crashing when the pack has no tax classes", async () => {
    countryPacksList.mockResolvedValue({
      rows: [{ ...ACTIVE_PACK, taxClasses: [] }],
      total: 1,
    });
    const item = itemWith({ taxClassId: null });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    expect(screen.getByText("menu.taxClassUnavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^menu\.taxClass / })).not.toBeInTheDocument();
  });

  it("surfaces a backend validation error on save without crashing the editor", async () => {
    const item = itemWith({ taxClassId: "standard" });
    itemsGet.mockResolvedValue(item);
    itemsUpdate.mockRejectedValueOnce(new Error("tax class rejected"));
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await waitFor(() => expect(screen.getByText("tax class rejected")).toBeInTheDocument());
    // Drawer stays up and usable — one failed save doesn't crash the editor.
    expect(screen.getByRole("button", { name: /^menu\.taxClass / })).toBeInTheDocument();
  });
});

describe("NewItemDrawer — Tax Class on create", () => {
  it("exposes the same Tax Class selector on the create form", async () => {
    const user = userEvent.setup();
    render(<NewItemDrawer open categories={[]} onClose={vi.fn()} onCreated={vi.fn()} />);

    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    await openTaxClassOptions(user);
    expect(screen.getByRole("option", { name: /Zero/ })).toBeInTheDocument();
  });

  it("creating without picking a tax class omits taxClassId — no automatic zero default", async () => {
    const user = userEvent.setup();
    render(<NewItemDrawer open categories={[]} onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText(/common\.name/), "Test maqloba");
    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalledTimes(1));
    const payload = itemsCreate.mock.calls[0][0];
    expect(payload.taxClassId).toBeUndefined();
    expect(payload.taxClassId).not.toBe("zero");
  });

  it("picking Zero on create sends its code in the create payload", async () => {
    const user = userEvent.setup();
    render(<NewItemDrawer open categories={[]} onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText(/common\.name/), "Test maqloba");
    await waitFor(() => expect(countryPacksList).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalledTimes(1));
    const payload = itemsCreate.mock.calls[0][0];
    expect(payload.taxClassId).toBe("zero");
  });
});
