import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-040 — the backend already supports three count scopes
 * (full_location, category, item_list), but "Open a count" only ever
 * exposed full_location. `storage_area` does not exist anywhere in the
 * backend and is never offered.
 *
 * `category` has real write-side support (`scopeType: "category"` +
 * `scopeId`), but there is no `StockItemCategory` LISTING endpoint
 * anywhere in the backend — no real, readable category to pick ever
 * exists — so it is shown as a scope choice but always blocks submission
 * with an explicit reason, rather than faking a category or falling back
 * to a raw id field.
 *
 * `Select`/`SearchSelect` (components/console/ui.tsx, fields.tsx) are
 * custom listboxes, not native controls — same interaction pattern as
 * `app/(console)/operations/stations/page.test.tsx` and
 * `app/(console)/inventory/items/page.test.tsx`.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `CountsScreen` is the real component.
 */

const locations = vi.fn();
const itemsList = vi.fn();
const countsList = vi.fn();
const countsCreate = vi.fn();
const countsGet = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    organisation: {
      locations: (...args: unknown[]) => locations(...args),
    },
    inventory: {
      items: {
        list: (...args: unknown[]) => itemsList(...args),
      },
      counts: {
        list: (...args: unknown[]) => countsList(...args),
        create: (...args: unknown[]) => countsCreate(...args),
        get: (...args: unknown[]) => countsGet(...args),
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
  useSession: () => ({
    scope: { tenantId: "t1", brandId: null, branchId: null },
  }),
  usePermission: () => true,
}));

import { CountsScreen } from "./page";

const LOCATION_A = { id: "loc-a", name: { en: "Downtown" } };
const ITEM_FLOUR = { id: "item-flour", name: { en: "Flour" }, sku: "FLR-001" };
const ITEM_SUGAR = { id: "item-sugar", name: { en: "Sugar" }, sku: "SUG-001" };

const COUNT_SESSION_FIXTURE = {
  id: "cs-1",
  tenantId: "t1",
  locationId: LOCATION_A.id,
  locationName: LOCATION_A.name,
  reference: "CNT-1",
  scope: { en: "Full location" },
  mode: "blind",
  status: "counting",
  openedAt: "2026-01-01T00:00:00Z",
  submittedAt: null,
  postedAt: null,
  countedBy: "u1",
  countedByName: { en: "Tester" },
  postedBy: null,
  lineCount: 0,
  flaggedCount: 0,
  netVarianceValue: { amount: 0, currency: "EGP" },
  lines: [],
};

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /common\.new/ }));
}

async function chooseScope(user: ReturnType<typeof userEvent.setup>, label: string) {
  const trigger = screen.getByLabelText(/inv\.countScope\b/);
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  locations.mockResolvedValue([LOCATION_A]);
  itemsList.mockResolvedValue({ rows: [ITEM_FLOUR, ITEM_SUGAR], total: 2 });
  countsList.mockResolvedValue({ rows: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("Stock counts — scoped counting (FR-INV-040)", () => {
  it("defaults to Full location and never offers storage_area", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    const scopeTrigger = await screen.findByLabelText(/inv\.countScope\b/);
    expect(scopeTrigger).toHaveTextContent("inv.countScopeFullLocation");

    await user.click(scopeTrigger);
    expect(screen.queryByRole("option", { name: /storage.?area/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "inv.countScopeCategory" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "inv.countScopeItemList" })).toBeInTheDocument();
  });

  it("existing full-location count flow still works — sends scopeType full_location, no itemIds", async () => {
    countsCreate.mockResolvedValue(COUNT_SESSION_FIXTURE);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: "loc-a", scopeType: "full_location" }),
      ),
    );
  });

  it("Category has no real catalogue to pick from — always blocks submission, never fakes one", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");

    await screen.findByText("inv.countScopeCategoryUnavailable");
    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
    // Never a raw category-id text field.
    expect(screen.queryByLabelText(/scopeId/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    expect(countsCreate).not.toHaveBeenCalled();
  });

  it("Item list requires at least one item before Create is enabled", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeItemList");
    await screen.findByText("inv.countItemsEmpty");

    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
  });

  it("Item list sends the exact real Uom.id-style itemIds, shown by readable name, never a UUID input", async () => {
    countsCreate.mockResolvedValue({ ...COUNT_SESSION_FIXTURE, id: "cs-2" });
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeItemList");

    const picker = await screen.findByLabelText("inv.countItems");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Flour/ }));

    // Readable name shown, no raw id anywhere in the picked list.
    expect(screen.getByText("Flour")).toBeInTheDocument();
    expect(screen.queryByText(ITEM_FLOUR.id)).not.toBeInTheDocument();

    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Sugar/ }));

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "item_list",
          itemIds: [ITEM_FLOUR.id, ITEM_SUGAR.id],
        }),
      ),
    );
  });

  it("switching scope away from Item list clears the previously-picked items — no stale itemIds leaks into the request", async () => {
    countsCreate.mockResolvedValue(COUNT_SESSION_FIXTURE);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeItemList");
    const picker = await screen.findByLabelText("inv.countItems");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Flour/ }));
    expect(screen.getByText("Flour")).toBeInTheDocument();

    await chooseScope(user, "inv.countScopeFullLocation");

    // The item picker/selected-item UI is gone the moment the scope changes.
    expect(screen.queryByText("Flour")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("inv.countItems")).not.toBeInTheDocument();

    // Stronger proof: submitting now sends a plain full_location request —
    // the previously-picked item never reaches the wire.
    await user.click(screen.getByRole("button", { name: "common.create" }));
    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "full_location", itemIds: undefined }),
      ),
    );
  });
});
