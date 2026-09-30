import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-040 — a Storage Area is a physical subdivision inside an Inventory
 * Location (Main Store -> Walk-in Chiller, Dry Store, Freezer). This is the
 * smallest Stock Levels control for it: show the current area by readable
 * name, let a Manager assign/clear it from the row's own Location, and an
 * inline "New storage area" affordance — never a Storage Area management
 * page, never a raw UUID.
 *
 * `Select` (components/console/ui.tsx) is a custom listbox, not a native
 * `<select>` — same interaction pattern as `app/(console)/inventory/counts
 * /page.test.tsx` and `app/(console)/operations/stations/page.test.tsx`.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `StockLevelsScreen` is the real component.
 */

const levelsList = vi.fn();
const lowStock = vi.fn();
const negativeStock = vi.fn();
const reconciliation = vi.fn();
const setReorderConfig = vi.fn();
const storageAreas = vi.fn();
const createStorageArea = vi.fn();
const setStorageAreaAssignment = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    inventory: {
      levels: {
        list: (...args: unknown[]) => levelsList(...args),
      },
      lowStock: (...args: unknown[]) => lowStock(...args),
      negativeStock: (...args: unknown[]) => negativeStock(...args),
      reconciliation: (...args: unknown[]) => reconciliation(...args),
      setReorderConfig: (...args: unknown[]) => setReorderConfig(...args),
      storageAreas: (...args: unknown[]) => storageAreas(...args),
      createStorageArea: (...args: unknown[]) => createStorageArea(...args),
      setStorageAreaAssignment: (...args: unknown[]) => setStorageAreaAssignment(...args),
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

import { StockLevelsScreen } from "./page";

const LOCATION_A_ID = "loc-a";
const AREA_CHILLER = { id: "area-chiller", locationId: LOCATION_A_ID, name: "Walk-in Chiller" };
const AREA_DRY = { id: "area-dry", locationId: LOCATION_A_ID, name: "Dry Store" };

const LEVEL_ROW = {
  itemId: "item-flour",
  itemName: { en: "Flour" },
  sku: "FLR-001",
  locationId: LOCATION_A_ID,
  locationName: { en: "Downtown" },
  onHand: { value: "120.000", unit: "kg" },
  allocated: { value: "0", unit: "kg" },
  onOrder: { value: "0", unit: "kg" },
  reorderPoint: 20,
  reorderQuantity: 50,
  parLevel: 100,
  unitCost: { amount: 10, currency: "EGP" },
  value: { amount: 1200, currency: "EGP" },
  daysOfCover: null,
  lastCountedAt: null,
  status: "ok" as const,
  storageAreaId: null as string | null,
};

async function openDrawer(user: ReturnType<typeof userEvent.setup>, itemName = "Flour") {
  await user.click(await screen.findByText(itemName));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  levelsList.mockResolvedValue({ rows: [LEVEL_ROW], total: 1 });
  lowStock.mockResolvedValue([]);
  negativeStock.mockResolvedValue([]);
  reconciliation.mockResolvedValue({ reconciled: true, note: null, divergences: [] });
  storageAreas.mockResolvedValue([AREA_CHILLER, AREA_DRY]);
});

afterEach(() => {
  cleanup();
});

describe("Stock levels — storage area assignment (FR-INV-040)", () => {
  it("shows the current area by readable name, never a raw UUID", async () => {
    levelsList.mockResolvedValue({
      rows: [{ ...LEVEL_ROW, storageAreaId: AREA_CHILLER.id }],
      total: 1,
    });
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    expect(within(dialog).getByText("Walk-in Chiller")).toBeInTheDocument();
    expect(within(dialog).queryByText(AREA_CHILLER.id)).not.toBeInTheDocument();
  });

  it("shows no area selected when the item has never been assigned one", async () => {
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    const select = within(dialog).getByLabelText("inv.storageArea");
    expect(select).toHaveTextContent("common.none");
  });

  it("fetches the area picker's options for this row's own location only", async () => {
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    await openDrawer(user);

    await waitFor(() => expect(storageAreas).toHaveBeenCalledWith(LOCATION_A_ID));
  });

  it("picking an area saves the real assignment and never closes the drawer", async () => {
    setStorageAreaAssignment.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    const select = within(dialog).getByLabelText("inv.storageArea");
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Walk-in Chiller" }));

    await waitFor(() =>
      expect(setStorageAreaAssignment).toHaveBeenCalledWith("item-flour", {
        locationId: LOCATION_A_ID,
        storageAreaId: AREA_CHILLER.id,
      }),
    );
    // Still open — a dropdown pick is not a form submission.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clearing the area sends storageAreaId: null, not an empty string or the previous id", async () => {
    levelsList.mockResolvedValue({
      rows: [{ ...LEVEL_ROW, storageAreaId: AREA_CHILLER.id }],
      total: 1,
    });
    setStorageAreaAssignment.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    const select = within(dialog).getByLabelText("inv.storageArea");
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "common.none" }));

    await waitFor(() =>
      expect(setStorageAreaAssignment).toHaveBeenCalledWith("item-flour", {
        locationId: LOCATION_A_ID,
        storageAreaId: null,
      }),
    );
  });

  it("an honest empty picker — never a fake area — when the location has no storage areas yet", async () => {
    storageAreas.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    const select = within(dialog).getByLabelText("inv.storageArea");
    await user.click(select);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "common.none" })).toBeInTheDocument();
  });

  it("the inline 'New storage area' affordance creates one by name and assigns it immediately", async () => {
    const created = { id: "area-new", locationId: LOCATION_A_ID, name: "Freezer" };
    createStorageArea.mockResolvedValue(created);
    setStorageAreaAssignment.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    await user.click(within(dialog).getByRole("button", { name: "inv.addStorageArea" }));
    await user.type(within(dialog).getByLabelText(/^inv\.storageAreaName/), "Freezer");
    await user.click(within(dialog).getByRole("button", { name: "inv.addStorageArea" }));

    await waitFor(() =>
      expect(createStorageArea).toHaveBeenCalledWith({ locationId: LOCATION_A_ID, name: "Freezer" }),
    );
    await waitFor(() =>
      expect(setStorageAreaAssignment).toHaveBeenCalledWith("item-flour", {
        locationId: LOCATION_A_ID,
        storageAreaId: created.id,
      }),
    );
  });

  it("never asks for a Location on the new-area form — it inherits this row's own Location", async () => {
    const user = userEvent.setup();
    render(<StockLevelsScreen />);
    const dialog = await openDrawer(user);

    await user.click(within(dialog).getByRole("button", { name: "inv.addStorageArea" }));

    expect(within(dialog).queryByLabelText(/^common\.location$/)).not.toBeInTheDocument();
  });
});
