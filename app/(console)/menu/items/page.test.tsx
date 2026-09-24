import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MenuItem } from "@/lib/console/types";

/*
 * FRONTEND-TAX-CONTRACT-ROOT-FIX-P0
 *
 * Root-cause fix over the previous session's DEMO-TAX-CLASS-CONTRACT-P0
 * work: the checked-in OpenAPI contract was stale — the real, canonical
 * backend (`ros-worktrees/lane-d/kitchen-kit/backend`, confirmed against its
 * committed `docs/api/openapi.json` and `catalogue.controller.ts`) exposes
 *
 *   GET /catalogue/branches/{branchId}/tax-classes -> [{ id, code, names }]
 *   PATCH /catalogue/items/{itemId} { taxClassId: "<id>" }
 *
 * `id` — a real `fiscal.tax_classes` UUID this tenant holds — is the only
 * value the backend accepts back as `MenuItem.taxClassId`. `TaxClassField`
 * (./page.tsx) now sources options from `services.catalogue
 * .listTaxClassesForBranch(branchId)`, never `services.platform
 * .countryPacks` (a Country Pack describes rate configuration, not a
 * tenant's provisioned identities — it carries no `id` at all). These tests
 * prove that: `services.platform` is deliberately absent from the service
 * mock below, so any lingering Country Pack read would throw, not silently
 * pass.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `ItemDrawer`/`NewItemDrawer` are the real
 * components; `branchId` is passed the same way `MenuItemsScreen` passes it
 * — from `useSession().scope.branchId`, as a prop — so these tests drive it
 * directly rather than through a mocked session.
 */

const itemsGet = vi.fn();
const itemsUpdate = vi.fn();
const itemsCreate = vi.fn();
const listTaxClassesForBranch = vi.fn();
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
      listTaxClassesForBranch: (...args: unknown[]) => listTaxClassesForBranch(...args),
    },
    // Deliberately no `platform` — a Country Pack fallback would throw
    // "Cannot read properties of undefined", not silently supply options.
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

const BRANCH_ID = "branch-cairo-1";

// Real backend ids are UUIDs; these are shaped like one but kept readable —
// the point of the tests is that these exact opaque strings, never "zero"
// or "standard", are what gets read and written.
const TAX_STANDARD = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66aaaa",
  code: "standard",
  names: { en: "Standard", ar: "قياسي" },
};
const TAX_ZERO = {
  id: "3fa85f64-5717-4562-b3fc-2c963f66zero",
  code: "zero",
  names: { en: "Zero", ar: "صفري" },
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
  autoReenableAt: null,
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
  listTaxClassesForBranch.mockReset();
  modifierGroupsList.mockReset();

  listTaxClassesForBranch.mockResolvedValue([TAX_STANDARD, TAX_ZERO]);
  modifierGroupsList.mockResolvedValue({ rows: [], total: 0 });
  itemsUpdate.mockResolvedValue(BASE_ITEM);
  itemsCreate.mockResolvedValue(BASE_ITEM);
});

afterEach(() => {
  cleanup();
});

describe("ItemDrawer — Tax Class editing", () => {
  it("loads tax classes for the active branch, keyed by the real backend UUID", async () => {
    const item = itemWith({ taxClassId: null });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalledWith(BRANCH_ID));
    await openTaxClassOptions(user);

    expect(screen.getByRole("option", { name: /Standard/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Zero/ })).toBeInTheDocument();
    // Every branch tax class is offered — not just a single hardcoded "zero".
    expect(screen.queryAllByRole("option")).toHaveLength(3); // placeholder + standard + zero
  });

  it("preselects the item's existing taxClassId UUID on open", async () => {
    const item = itemWith({ taxClassId: TAX_STANDARD.id });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
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

  it("selecting Zero sends the backend UUID as taxClassId — never the code \"zero\"", async () => {
    const item = itemWith({ taxClassId: TAX_STANDARD.id });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await waitFor(() => expect(itemsUpdate).toHaveBeenCalledTimes(1));
    const [id, patch] = itemsUpdate.mock.calls[0];
    expect(id).toBe(item.id);
    expect(patch.taxClassId).toBe(TAX_ZERO.id);
    expect(patch.taxClassId).not.toBe("zero");
    expect(patch.taxClassId).not.toBe("Zero");
  });

  it("save sends only { taxClassId: <uuid> }, never unrelated item fields", async () => {
    const item = itemWith({ taxClassId: TAX_STANDARD.id, name: { en: "Untouched name", ar: "اسم" } });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await waitFor(() => expect(itemsUpdate).toHaveBeenCalledTimes(1));
    const patch = itemsUpdate.mock.calls[0][1];
    expect(Object.keys(patch)).toEqual(["taxClassId"]);
    expect(patch).not.toHaveProperty("name");
    expect(patch).not.toHaveProperty("categoryId");
  });

  it("never falls back to a Country Pack — services.platform is not on the mocked registry at all", async () => {
    const item = itemWith({ taxClassId: TAX_STANDARD.id });
    itemsGet.mockResolvedValue(item);
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    // If any code path still reached for `services.platform.countryPacks`,
    // this render (or the click below) would throw — it never does.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^menu\.taxClass / })).toHaveTextContent(/Standard/),
    );
    await openTaxClassOptions(user);
    expect(screen.getByRole("option", { name: /Zero/ })).toBeInTheDocument();
  });

  it("an item with no tax class is shown as unclassified and never auto-saves a fallback", async () => {
    const item = itemWith({ taxClassId: null });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalled());
    expect(screen.getByText("menu.taxClassNotConfigured")).toBeInTheDocument();
    expect(itemsUpdate).not.toHaveBeenCalled();
  });

  it("with no active branch selected, shows that state and does not fetch", async () => {
    const item = itemWith({ taxClassId: TAX_STANDARD.id });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={null}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("menu.taxClassNoBranch")).toBeInTheDocument();
    expect(listTaxClassesForBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^menu\.taxClass / })).not.toBeInTheDocument();
  });

  it("shows the unavailable callout instead of crashing when the branch has no tax classes provisioned", async () => {
    listTaxClassesForBranch.mockResolvedValue([]);
    const item = itemWith({ taxClassId: null });
    itemsGet.mockResolvedValue(item);

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalled());
    expect(screen.getByText("menu.taxClassUnavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^menu\.taxClass / })).not.toBeInTheDocument();
  });

  it("surfaces a backend validation error on save without crashing the editor", async () => {
    const item = itemWith({ taxClassId: TAX_STANDARD.id });
    itemsGet.mockResolvedValue(item);
    itemsUpdate.mockRejectedValueOnce(new Error("tax class rejected"));
    const user = userEvent.setup();

    render(
      <ItemDrawer
        item={item}
        canToggle={false}
        categories={[]}
        branchId={BRANCH_ID}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRequest86={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await waitFor(() => expect(screen.getByText("tax class rejected")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^menu\.taxClass / })).toBeInTheDocument();
  });
});

describe("NewItemDrawer — Tax Class on create", () => {
  it("exposes the same branch-scoped Tax Class selector on the create form", async () => {
    const user = userEvent.setup();
    render(
      <NewItemDrawer open categories={[]} branchId={BRANCH_ID} currency="EGP" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalledWith(BRANCH_ID));
    await openTaxClassOptions(user);
    expect(screen.getByRole("option", { name: /Zero/ })).toBeInTheDocument();
  });

  it("creating without picking a tax class omits taxClassId — null stays possible", async () => {
    const user = userEvent.setup();
    render(
      <NewItemDrawer open categories={[]} branchId={BRANCH_ID} currency="EGP" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/common\.name/), "Test maqloba");
    await user.type(screen.getByLabelText(/menu\.price/), "12.50");
    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalledTimes(1));
    const payload = itemsCreate.mock.calls[0][0];
    expect(payload.taxClassId).toBeUndefined();
    expect(payload.taxClassId).not.toBe("zero");
    expect(payload.variants).toEqual([
      { name: { en: "Test maqloba", ar: "Test maqloba" }, price: { amount: 1250, currency: "EGP" } },
    ]);
  });

  it("picking Zero on create sends the backend UUID in the create payload", async () => {
    const user = userEvent.setup();
    render(
      <NewItemDrawer open categories={[]} branchId={BRANCH_ID} currency="EGP" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/common\.name/), "Test maqloba");
    await user.type(screen.getByLabelText(/menu\.price/), "12.50");
    await waitFor(() => expect(listTaxClassesForBranch).toHaveBeenCalled());
    await openTaxClassOptions(user);
    await user.click(screen.getByRole("option", { name: /Zero/ }));

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalledTimes(1));
    const payload = itemsCreate.mock.calls[0][0];
    expect(payload.taxClassId).toBe(TAX_ZERO.id);
    expect(payload.taxClassId).not.toBe("zero");
  });

  it("with no active branch selected, shows that state and never calls create with a guessed tax class", async () => {
    render(
      <NewItemDrawer open categories={[]} branchId={null} currency="EGP" onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    expect(await screen.findByText("menu.taxClassNoBranch")).toBeInTheDocument();
    expect(listTaxClassesForBranch).not.toHaveBeenCalled();
  });
});
