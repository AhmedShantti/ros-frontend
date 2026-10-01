import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-040 — the backend supports four count scopes (full_location,
 * category, storage_area, item_list). A Storage Area is a physical
 * subdivision inside an Inventory Location (Main Store -> Walk-in Chiller,
 * Dry Store, Freezer) — never a dining section, temperature classification,
 * or bin/shelf/aisle hierarchy.
 *
 * `category` and `storage_area` both have real write-side support
 * (`scopeType` + a generic `scopeId`) and a real listing endpoint each, so
 * both are shown as scope choices with a real, readable catalogue to pick
 * from — never a raw id field, never a fabricated entry when the catalogue
 * is empty.
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
const categories = vi.fn();
const storageAreas = vi.fn();

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
      categories: (...args: unknown[]) => categories(...args),
      storageAreas: (...args: unknown[]) => storageAreas(...args),
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
const CATEGORY_DAIRY = { id: "cat-dairy", name: "Dairy", parentId: null };
const CATEGORY_PRODUCE = { id: "cat-produce", name: "Produce", parentId: null };
const AREA_CHILLER = { id: "area-chiller", locationId: LOCATION_A.id, name: "Walk-in Chiller" };
const AREA_DRY = { id: "area-dry", locationId: LOCATION_A.id, name: "Dry Store" };

const COUNT_SESSION_FIXTURE = {
  id: "cs-1",
  tenantId: "t1",
  locationId: LOCATION_A.id,
  locationName: LOCATION_A.name,
  reference: "CNT-1",
  scope: { en: "Full location" },
  scopeId: null,
  mode: "blind",
  status: "counting",
  openedAt: "2026-01-01T00:00:00Z",
  submittedAt: null,
  postedAt: null,
  countedBy: "u1",
  countedByName: { en: "Tester" },
  postedBy: null,
  requiresApproval: false,
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
  categories.mockResolvedValue([CATEGORY_DAIRY, CATEGORY_PRODUCE]);
  storageAreas.mockResolvedValue([AREA_CHILLER, AREA_DRY]);
});

afterEach(() => {
  cleanup();
});

describe("Stock counts — location picker (production regression: \"Location not found.\")", () => {
  it("shows the real location's readable name, and the location select uses services.organisation.locations()", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Downtown")).toBeInTheDocument();
    await waitFor(() => expect(locations).toHaveBeenCalled());
  });

  it("submits the exact locationId services.organisation.locations() returned, never a raw UUID typed by a person", async () => {
    countsCreate.mockResolvedValue(COUNT_SESSION_FIXTURE);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: LOCATION_A.id }),
      ),
    );
  });

  it("honestly blocks submission — never a fabricated location — when the tenant has no inventory locations", async () => {
    locations.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await screen.findByText("inv.noLocationsConfigured");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/common\.location/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    expect(countsCreate).not.toHaveBeenCalled();
  });
});

describe("Stock counts — scoped counting (FR-INV-040)", () => {
  it("defaults to Full location and offers all four scopes", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    const scopeTrigger = await screen.findByLabelText(/inv\.countScope\b/);
    expect(scopeTrigger).toHaveTextContent("inv.countScopeFullLocation");

    await user.click(scopeTrigger);
    expect(screen.getByRole("option", { name: "inv.countScopeCategory" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "inv.countScopeStorageArea" })).toBeInTheDocument();
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

  it("Category requires a category to be chosen before Create is enabled", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");
    await screen.findByLabelText("inv.countScopeCategory");

    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
    // Never a raw category-id text field.
    expect(screen.queryByLabelText(/scopeId/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    expect(countsCreate).not.toHaveBeenCalled();
  });

  it("Category sends the real category id as scopeId, shown by readable name, never a UUID input", async () => {
    countsCreate.mockResolvedValue({ ...COUNT_SESSION_FIXTURE, id: "cs-3" });
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");
    const picker = await screen.findByLabelText("inv.countScopeCategory");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Dairy/ }));

    expect(screen.getByText("Dairy")).toBeInTheDocument();
    expect(screen.queryByText(CATEGORY_DAIRY.id)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "category",
          scopeId: CATEGORY_DAIRY.id,
          itemIds: undefined,
        }),
      ),
    );
  });

  it("switching scope away from Category clears the previously-picked category — no stale scopeId leaks into the request", async () => {
    countsCreate.mockResolvedValue(COUNT_SESSION_FIXTURE);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");
    const picker = await screen.findByLabelText("inv.countScopeCategory");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Dairy/ }));
    expect(screen.getByText("Dairy")).toBeInTheDocument();

    await chooseScope(user, "inv.countScopeFullLocation");

    expect(screen.queryByText("Dairy")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("inv.countScopeCategory")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "full_location", scopeId: undefined }),
      ),
    );
  });

  it("shows an honest empty state — never a fake category — when the tenant has no categories yet", async () => {
    categories.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");

    await screen.findByText("inv.countScopeCategoryEmpty");
    expect(screen.queryByLabelText("inv.countScopeCategory")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    expect(countsCreate).not.toHaveBeenCalled();
  });

  it("category options come from the real category catalogue, not the stock item list", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");
    const picker = await screen.findByLabelText("inv.countScopeCategory");
    await user.click(picker);

    expect(screen.getByRole("option", { name: /Dairy/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Produce/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Flour/ })).not.toBeInTheDocument();
  });

  it("does not flash the empty-category state before the catalogue has loaded", async () => {
    let resolveCategories: (rows: (typeof CATEGORY_DAIRY)[]) => void = () => {};
    categories.mockReturnValue(
      new Promise<(typeof CATEGORY_DAIRY)[]>((resolve) => {
        resolveCategories = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeCategory");
    expect(screen.queryByText("inv.countScopeCategoryEmpty")).not.toBeInTheDocument();

    resolveCategories([CATEGORY_DAIRY]);
    await screen.findByLabelText("inv.countScopeCategory");
    expect(screen.queryByText("inv.countScopeCategoryEmpty")).not.toBeInTheDocument();
  });

  it("Storage area requires an area to be chosen before Create is enabled", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeStorageArea");
    await screen.findByLabelText("inv.countScopeStorageArea");

    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
    // Never a raw storage-area-id text field.
    expect(screen.queryByLabelText(/scopeId/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    expect(countsCreate).not.toHaveBeenCalled();
  });

  it("Storage area sends the real area id as scopeId, shown by readable name, never a UUID input", async () => {
    countsCreate.mockResolvedValue({ ...COUNT_SESSION_FIXTURE, id: "cs-4" });
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeStorageArea");
    const picker = await screen.findByLabelText("inv.countScopeStorageArea");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Walk-in Chiller/ }));

    expect(screen.getByText("Walk-in Chiller")).toBeInTheDocument();
    expect(screen.queryByText(AREA_CHILLER.id)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "storage_area",
          scopeId: AREA_CHILLER.id,
          itemIds: undefined,
        }),
      ),
    );
  });

  it("storage area options come from the real catalogue for the selected location, not the stock item list", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_A.id));

    await chooseScope(user, "inv.countScopeStorageArea");
    const picker = await screen.findByLabelText("inv.countScopeStorageArea");
    await user.click(picker);

    expect(screen.getByRole("option", { name: /Walk-in Chiller/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Dry Store/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Flour/ })).not.toBeInTheDocument();
  });

  it("shows an honest empty state — never a fake area — when the location has no storage areas yet", async () => {
    storageAreas.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeStorageArea");

    await screen.findByText(/inv\.countScopeStorageAreaEmpty/);
    expect(screen.queryByLabelText("inv.countScopeStorageArea")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    expect(countsCreate).not.toHaveBeenCalled();
  });

  it("names the selected Location in the empty state — production diagnosis for 'the area I just created doesn't show up'", async () => {
    storageAreas.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);
    const dialog = await screen.findByRole("dialog");
    // Wait for the location default to actually land before switching scope
    // — otherwise the location is still "" and the hint has nothing to show.
    await within(dialog).findByText("Downtown");

    await chooseScope(user, "inv.countScopeStorageArea");
    expect(await screen.findByText(/inv\.countScopeStorageAreaEmpty.*Downtown/)).toBeInTheDocument();
  });

  it("names the selected Location as a hint on the loaded picker too", async () => {
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Downtown");

    await chooseScope(user, "inv.countScopeStorageArea");
    await screen.findByLabelText("inv.countScopeStorageArea");
    expect(screen.getByText(/inv\.countScopeStorageAreaFor Downtown/)).toBeInTheDocument();
  });

  describe("production workflow — not an isolated mock that pre-seeds the final options", () => {
    const LOCATION_MAIN = { id: "loc-main-registry-id", name: { en: "Main" } };
    const LOCATION_WAREHOUSE = { id: "loc-wh-registry-id", name: { en: "Warehouse" } };
    const AREA_UNDER_MAIN = { id: "area-under-main", locationId: LOCATION_MAIN.id, name: "Walk-in Chiller" };

    beforeEach(() => {
      // The real backend only ever returns areas for the EXACT locationId
      // asked for (proven by the backend's own e2e suite) — a mock that
      // ignores its argument would hide a real identity mismatch, so this
      // one enforces it the same way the live service does.
      storageAreas.mockImplementation((locationId: string) =>
        Promise.resolve(locationId === LOCATION_MAIN.id ? [AREA_UNDER_MAIN] : []),
      );
    });

    it("Location first, then Storage area scope: the area created under Main appears once Main is selected", async () => {
      locations.mockResolvedValue([LOCATION_WAREHOUSE, LOCATION_MAIN]);
      const user = userEvent.setup();
      render(<CountsScreen />);
      await openDrawer(user);
      const dialog = await screen.findByRole("dialog");

      // Auto-default picks the first registry row (Warehouse), not Main.
      await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_WAREHOUSE.id));

      const locationTrigger = within(dialog).getByLabelText(/common\.location\b/);
      await user.click(locationTrigger);
      await user.click(screen.getByRole("option", { name: /Main/ }));

      await chooseScope(user, "inv.countScopeStorageArea");
      await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_MAIN.id));

      const picker = await screen.findByLabelText("inv.countScopeStorageArea");
      await user.click(picker);
      await user.click(await screen.findByRole("option", { name: /Walk-in Chiller/ }));

      await user.click(screen.getByRole("button", { name: "common.create" }));
      await waitFor(() =>
        expect(countsCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            locationId: LOCATION_MAIN.id,
            scopeType: "storage_area",
            scopeId: AREA_UNDER_MAIN.id,
            itemIds: undefined,
          }),
        ),
      );
    });

    it("Storage area scope first, then Location: the catalogue still resolves to the picked Location", async () => {
      locations.mockResolvedValue([LOCATION_WAREHOUSE, LOCATION_MAIN]);
      const user = userEvent.setup();
      render(<CountsScreen />);
      await openDrawer(user);
      const dialog = await screen.findByRole("dialog");

      await chooseScope(user, "inv.countScopeStorageArea");

      const locationTrigger = within(dialog).getByLabelText(/common\.location\b/);
      await user.click(locationTrigger);
      await user.click(screen.getByRole("option", { name: /Main/ }));

      await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_MAIN.id));
      const picker = await screen.findByLabelText("inv.countScopeStorageArea");
      await user.click(picker);
      expect(await screen.findByRole("option", { name: /Walk-in Chiller/ })).toBeInTheDocument();
    });

    it("picking Main, then an area, then switching to Warehouse clears the area and reloads an empty catalogue for Warehouse", async () => {
      locations.mockResolvedValue([LOCATION_MAIN, LOCATION_WAREHOUSE]);
      const user = userEvent.setup();
      render(<CountsScreen />);
      await openDrawer(user);
      const dialog = await screen.findByRole("dialog");

      await chooseScope(user, "inv.countScopeStorageArea");
      await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_MAIN.id));
      const picker = await screen.findByLabelText("inv.countScopeStorageArea");
      await user.click(picker);
      await user.click(await screen.findByRole("option", { name: /Walk-in Chiller/ }));
      expect(within(dialog).getByText("Walk-in Chiller")).toBeInTheDocument();

      const locationTrigger = within(dialog).getByLabelText(/common\.location\b/);
      await user.click(locationTrigger);
      await user.click(screen.getByRole("option", { name: /Warehouse/ }));

      await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_WAREHOUSE.id));
      expect(within(dialog).queryByText("Walk-in Chiller")).not.toBeInTheDocument();
      await screen.findByText(/inv\.countScopeStorageAreaEmpty/);
    });
  });

  it("switching scope away from Storage area clears the previously-picked area — no stale scopeId leaks into the request", async () => {
    countsCreate.mockResolvedValue(COUNT_SESSION_FIXTURE);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);

    await chooseScope(user, "inv.countScopeStorageArea");
    const picker = await screen.findByLabelText("inv.countScopeStorageArea");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Walk-in Chiller/ }));
    expect(screen.getByText("Walk-in Chiller")).toBeInTheDocument();

    await chooseScope(user, "inv.countScopeFullLocation");

    expect(screen.queryByText("Walk-in Chiller")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("inv.countScopeStorageArea")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));
    await waitFor(() =>
      expect(countsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "full_location", scopeId: undefined }),
      ),
    );
  });

  it("switching the Location clears a previously-picked storage area — it belongs to exactly one Location", async () => {
    const LOCATION_B = { id: "loc-b", name: { en: "Uptown" } };
    locations.mockResolvedValue([LOCATION_A, LOCATION_B]);
    const user = userEvent.setup();
    render(<CountsScreen />);
    await openDrawer(user);
    const dialog = await screen.findByRole("dialog");

    await chooseScope(user, "inv.countScopeStorageArea");
    const picker = await screen.findByLabelText("inv.countScopeStorageArea");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Walk-in Chiller/ }));
    expect(within(dialog).getByText("Walk-in Chiller")).toBeInTheDocument();

    const locationTrigger = within(dialog).getByLabelText(/common\.location\b/);
    await user.click(locationTrigger);
    await user.click(screen.getByRole("option", { name: /Uptown/ }));

    expect(within(dialog).queryByText("Walk-in Chiller")).not.toBeInTheDocument();
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

/*
 * FR-INV-050 — the index the backend had no route for. `CountsScreen`
 * (`useCollection` + `CollectionTable`/`CollectionToolbar`) was already
 * built to consume a real `Page<CountSession>`; only `services.inventory
 * .counts.list()` itself was ever hardcoded to `emptyPage()`. These tests
 * are at the service boundary — the same one every other test in this file
 * already mocks at — so they prove the PAGE's own consumption of a real
 * index, not `http.ts`'s translation of it (covered by
 * `http.inventory-locations.test.ts`-style unit tests and the backend's
 * own e2e suite).
 */
describe("Stock counts — count session history (FR-INV-050)", () => {
  const LIST_ROW_OPEN = {
    ...COUNT_SESSION_FIXTURE,
    id: "cs-open",
    reference: "CNT-OPEN",
    status: "counting" as const,
    openedAt: "2026-01-01T00:00:00Z",
    // Honestly unavailable from the index — never a fabricated zero.
    flaggedCount: null,
    netVarianceValue: null,
  };
  const LIST_ROW_POSTED = {
    ...COUNT_SESSION_FIXTURE,
    id: "cs-posted",
    reference: "CNT-POSTED",
    status: "posted" as const,
    openedAt: "2026-01-02T00:00:00Z",
    postedAt: "2026-01-02T01:00:00Z",
    postedBy: "u2",
    flaggedCount: null,
    netVarianceValue: null,
  };

  it("loads and displays real sessions from the index", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN, LIST_ROW_POSTED], total: 2 });
    render(<CountsScreen />);

    expect(await screen.findByText("CNT-OPEN")).toBeInTheDocument();
    expect(screen.getByText("CNT-POSTED")).toBeInTheDocument();
  });

  it("a posted session remains visible in the list, not hidden once posted", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_POSTED], total: 1 });
    render(<CountsScreen />);

    expect(await screen.findByText("CNT-POSTED")).toBeInTheDocument();
  });

  it("resolves a session's locationId to its readable name, never a raw id", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    render(<CountsScreen />);

    expect(await screen.findByText("Downtown")).toBeInTheDocument();
    expect(screen.queryByText(LOCATION_A.id)).not.toBeInTheDocument();
  });

  it("renders each session's real status", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_POSTED], total: 1 });
    render(<CountsScreen />);

    expect(await screen.findByText("Posted")).toBeInTheDocument();
  });

  it("renders each session's real mode", async () => {
    countsList.mockResolvedValue({ rows: [{ ...LIST_ROW_OPEN, mode: "open" as const }], total: 1 });
    render(<CountsScreen />);

    expect(await screen.findByText("Open")).toBeInTheDocument();
  });

  it("filters by location through the real query", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    const user = userEvent.setup();
    render(<CountsScreen />);
    await screen.findByText("CNT-OPEN");

    const trigger = screen.getByLabelText("common.location");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: /Downtown/ }));

    await waitFor(() =>
      expect(countsList).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ locationId: LOCATION_A.id }) }),
      ),
    );
  });

  it("filters by status through the real query", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_POSTED], total: 1 });
    const user = userEvent.setup();
    render(<CountsScreen />);
    await screen.findByText("CNT-POSTED");

    const trigger = screen.getByLabelText("common.status");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Posted" }));

    await waitFor(() =>
      expect(countsList).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ status: "posted" }) }),
      ),
    );
  });

  it("filters by mode through the real query", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    const user = userEvent.setup();
    render(<CountsScreen />);
    await screen.findByText("CNT-OPEN");

    const trigger = screen.getByLabelText("inv.mode");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Blind" }));

    await waitFor(() =>
      expect(countsList).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ mode: "blind" }) }),
      ),
    );
  });

  it("requests the index newest-first by default", async () => {
    countsList.mockResolvedValue({ rows: [], total: 0 });
    render(<CountsScreen />);

    await waitFor(() =>
      expect(countsList).toHaveBeenCalledWith(expect.objectContaining({ sort: "-openedAt" })),
    );
  });

  it("clicking a row opens the existing detail (session get)", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    countsGet.mockResolvedValue(COUNT_SESSION_FIXTURE);
    const user = userEvent.setup();
    render(<CountsScreen />);

    await user.click(await screen.findByText("CNT-OPEN"));

    await waitFor(() => expect(countsGet).toHaveBeenCalledWith(LIST_ROW_OPEN.id));
    await screen.findByRole("dialog");
  });

  it("never shows the old 'backend has no index' warning", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    render(<CountsScreen />);
    await screen.findByText("CNT-OPEN");

    expect(screen.queryByText(/no index of count sessions/i)).not.toBeInTheDocument();
  });

  it("shows the empty state only when the real index is actually empty", async () => {
    countsList.mockResolvedValue({ rows: [], total: 0 });
    const { unmount } = render(<CountsScreen />);
    expect(await screen.findByText("state.emptyTitle")).toBeInTheDocument();
    unmount();

    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    render(<CountsScreen />);
    await screen.findByText("CNT-OPEN");
    expect(screen.queryByText("state.emptyTitle")).not.toBeInTheDocument();
  });

  it("resolves a storage_area session's scopeId to its readable area name, never a raw UUID", async () => {
    const row = {
      ...LIST_ROW_OPEN,
      scope: { en: "Storage area" },
      scopeId: AREA_CHILLER.id,
    };
    countsList.mockResolvedValue({ rows: [row], total: 1 });
    render(<CountsScreen />);

    await screen.findByText("CNT-OPEN");
    expect(screen.getByText("Storage area — Walk-in Chiller")).toBeInTheDocument();
    expect(screen.queryByText(AREA_CHILLER.id)).not.toBeInTheDocument();
  });

  it("resolves a category session's scopeId to its readable category name, never a raw UUID", async () => {
    const row = {
      ...LIST_ROW_OPEN,
      scope: { en: "Category" },
      scopeId: CATEGORY_DAIRY.id,
    };
    countsList.mockResolvedValue({ rows: [row], total: 1 });
    render(<CountsScreen />);

    await screen.findByText("CNT-OPEN");
    expect(screen.getByText("Category — Dairy")).toBeInTheDocument();
    expect(screen.queryByText(CATEGORY_DAIRY.id)).not.toBeInTheDocument();
  });

  it("shows just the scope label, with no dangling separator, when a session has no scopeId (full_location/item_list)", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    render(<CountsScreen />);

    await screen.findByText("CNT-OPEN");
    expect(screen.getByText("Full location")).toBeInTheDocument();
  });

  it("shows the same resolved scope detail in the session detail drawer, not just the list", async () => {
    countsList.mockResolvedValue({ rows: [LIST_ROW_OPEN], total: 1 });
    countsGet.mockResolvedValue({
      ...COUNT_SESSION_FIXTURE,
      id: LIST_ROW_OPEN.id,
      scope: { en: "Storage area" },
      scopeId: AREA_CHILLER.id,
    });
    const user = userEvent.setup();
    render(<CountsScreen />);

    await user.click(await screen.findByText("CNT-OPEN"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Storage area — Walk-in Chiller")).toBeInTheDocument();
  });
});
