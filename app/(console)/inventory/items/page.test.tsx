import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-001 — the "New stock item" drawer used to ask a human to type a raw
 * `inventory.uom` UUID into a text field, with a hint admitting the API
 * published no catalogue to pick from. `GET /inventory/uoms` now exists and
 * `StockItemsScreen` fetches it: the base unit is a real, human-readable
 * pick list, and only the picked option's `id` is ever sent as `baseUnitId`.
 *
 * `Select` (components/console/ui.tsx) is a custom listbox, not a native
 * `<select>` — the trigger is a `<button>` showing only the current
 * selection's text, and options only exist in the DOM once opened. A
 * required `Field` appends `*` to the visible label, so lookups here use a
 * regex rather than an exact string (see `app/(console)/operations/stations
 * /page.test.tsx` for the established pattern).
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/console/providers`. `StockItemsScreen` is the real component.
 */

const itemsList = vi.fn();
const itemsCreate = vi.fn();
const unitsOfMeasure = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    inventory: {
      items: {
        list: (...args: unknown[]) => itemsList(...args),
        create: (...args: unknown[]) => itemsCreate(...args),
      },
      unitsOfMeasure: (...args: unknown[]) => unitsOfMeasure(...args),
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
}));

import { StockItemsScreen } from "./page";

const UOM_GRAM = { id: "uom-g-real-uuid", code: "g", name: "Gram", dimension: "mass" };
const UOM_KG = { id: "uom-kg-real-uuid", code: "kg", name: "Kilogram", dimension: "mass" };

const ITEM_FLOUR = {
  id: "item-flour",
  tenantId: "t1",
  sku: "FLR-001",
  name: { en: "Flour" },
  category: { en: "Dry goods" },
  baseUnit: "kg",
  baseUnitId: UOM_KG.id,
  purchaseUnit: "kg",
  purchaseConversion: 1,
  costingMethod: "weighted_average",
  batchTracked: false,
  expiryTracked: false,
  storage: "ambient",
  shelfLifeDays: null,
  defaultSupplierId: null,
  allergens: [],
  unitCost: { amount: 0, currency: "EGP" },
  active: true,
};

async function openNewItemDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /common\.new/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  itemsList.mockResolvedValue({ rows: [ITEM_FLOUR], total: 1 });
  unitsOfMeasure.mockResolvedValue([UOM_GRAM, UOM_KG]);
});

afterEach(() => {
  cleanup();
});

describe("Stock items — base unit selection (FR-INV-001)", () => {
  it("fetches the unit-of-measure catalogue on mount", async () => {
    render(<StockItemsScreen />);
    await waitFor(() => expect(unitsOfMeasure).toHaveBeenCalled());
  });

  it("never renders a raw base-unit-id text field", async () => {
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await screen.findByLabelText(/inv\.baseUnit/);
    expect(screen.queryByText("inv.baseUnitId")).not.toBeInTheDocument();
    expect(screen.queryByText("inv.baseUnitIdHint")).not.toBeInTheDocument();
  });

  it("lets the user pick a human-readable unit and submits its real id as baseUnitId", async () => {
    itemsCreate.mockResolvedValue({ ...ITEM_FLOUR, id: "item-new" });
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await user.type(await screen.findByLabelText(/common\.name/), "Sugar");
    await user.type(screen.getByLabelText(/inv\.sku/), "SUG-001");

    const unitTrigger = screen.getByLabelText(/inv\.baseUnit/);
    await user.click(unitTrigger);
    await user.click(screen.getByRole("option", { name: "Kilogram" }));
    expect(unitTrigger).toHaveTextContent("Kilogram");

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(itemsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ baseUnitId: UOM_KG.id }),
      ),
    );
  });

  it("blocks stock item creation while no unit catalogue is available (empty)", async () => {
    unitsOfMeasure.mockResolvedValue([]);
    render(<StockItemsScreen />);

    await screen.findByText("inv.noUnitsConfigured");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /common\.new/ })).toBeDisabled(),
    );
    expect(itemsCreate).not.toHaveBeenCalled();
  });

  it("surfaces a unit-catalogue fetch error via the existing error pattern, with no UUID fallback", async () => {
    unitsOfMeasure.mockRejectedValue(new Error("Could not reach the unit catalogue."));
    render(<StockItemsScreen />);

    await screen.findByText("Could not reach the unit catalogue.");
    expect(screen.getByRole("button", { name: /common\.new/ })).toBeDisabled();
    expect(screen.queryByLabelText(/inv\.baseUnitId/)).not.toBeInTheDocument();
  });

  it("does not offer any base-unit edit control from the read-only item detail view (BR-INV-002 immutability unaffected)", async () => {
    const user = userEvent.setup();
    render(<StockItemsScreen />);

    await user.click(await screen.findByText("Flour"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("kg").length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: /inv\.baseUnit/ })).not.toBeInTheDocument();
  });
});

/*
 * D-INV-03 / ck_standard_cost_present — production 500 fix. `costingMethod:
 * "standard"` with no cost crashed the backend with a raw constraint
 * violation; the drawer never offered a place to enter one at all. The
 * Standard Cost field is conditional (`visibleWhen`) so weighted_average/fifo
 * are completely unaffected — see the "still works" test below.
 */
describe("Stock items — standard costing requires a standard cost (D-INV-03)", () => {
  // The page's own filter toolbar also has a "costingMethod" field, so the
  // lookup is scoped to the open drawer to avoid matching both.
  async function selectCostingMethod(user: ReturnType<typeof userEvent.setup>, label: string) {
    const dialog = screen.getByRole("dialog");
    const trigger = within(dialog).getByLabelText(/inv\.costingMethod/);
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: label }));
  }

  // Base Unit has no seeded default (a required field with no safe default
  // to guess), so every submitting test picks one explicitly — same
  // convention as the existing base-unit-selection tests above.
  async function selectBaseUnit(user: ReturnType<typeof userEvent.setup>, label: string) {
    const trigger = screen.getByLabelText(/inv\.baseUnit\b/);
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: label }));
  }

  it("hides the Standard Cost field until Standard costing is selected", async () => {
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    expect(screen.queryByLabelText("inv.standardCost")).not.toBeInTheDocument();
  });

  it("shows the Standard Cost field once Standard costing is selected", async () => {
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await selectCostingMethod(user, "inv.costingStandard");
    expect(await screen.findByLabelText("inv.standardCost")).toBeInTheDocument();
  });

  it("blocks submission when Standard is selected but no cost is entered", async () => {
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await user.type(screen.getByLabelText(/common\.name/), "Truffle oil");
    await user.type(screen.getByLabelText(/inv\.sku/), "TRF-001");
    await selectCostingMethod(user, "inv.costingStandard");
    await screen.findByLabelText("inv.standardCost");

    expect(screen.getByRole("button", { name: "common.create" })).toBeDisabled();
    expect(itemsCreate).not.toHaveBeenCalled();
  });

  it("sends a valid Standard Cost as the exact minor-unit integer string, never re-parsed through a JS Number", async () => {
    itemsCreate.mockResolvedValue({ ...ITEM_FLOUR, id: "item-new" });
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await user.type(screen.getByLabelText(/common\.name/), "Truffle oil");
    await user.type(screen.getByLabelText(/inv\.sku/), "TRF-001");
    await selectBaseUnit(user, "Gram");
    await selectCostingMethod(user, "inv.costingStandard");
    await user.type(await screen.findByLabelText("inv.standardCost"), "12.50");

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(itemsCreate).toHaveBeenCalledWith(expect.objectContaining({ standardCost: "1250" })),
    );
  });

  it("omits Standard Cost entirely when switching back to Weighted Average", async () => {
    itemsCreate.mockResolvedValue({ ...ITEM_FLOUR, id: "item-new" });
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await user.type(screen.getByLabelText(/common\.name/), "Truffle oil");
    await user.type(screen.getByLabelText(/inv\.sku/), "TRF-001");
    await selectBaseUnit(user, "Gram");
    await selectCostingMethod(user, "inv.costingStandard");
    await user.type(await screen.findByLabelText("inv.standardCost"), "12.50");
    await selectCostingMethod(user, "inv.costingWeighted");

    expect(screen.queryByLabelText("inv.standardCost")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalled());
    const [payload] = itemsCreate.mock.calls[0]!;
    expect(payload).not.toHaveProperty("standardCost");
    expect(payload.costingMethod).toBe("weighted_average");
  });

  it("the weighted_average create flow is unaffected — no Standard Cost field, create still works", async () => {
    itemsCreate.mockResolvedValue({ ...ITEM_FLOUR, id: "item-new" });
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await user.type(screen.getByLabelText(/common\.name/), "Sugar");
    await user.type(screen.getByLabelText(/inv\.sku/), "SUG-002");
    await selectBaseUnit(user, "Gram");
    // costingMethod defaults to weighted_average; no Standard Cost field.
    expect(screen.queryByLabelText("inv.standardCost")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(itemsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ costingMethod: "weighted_average" }),
      ),
    );
    const [payload] = itemsCreate.mock.calls[0]!;
    expect(payload).not.toHaveProperty("standardCost");
  });

  it("surfaces the backend's 4xx validation message instead of a generic failure", async () => {
    itemsCreate.mockRejectedValue(new Error("Standard costing requires a standard cost."));
    const user = userEvent.setup();
    render(<StockItemsScreen />);
    await openNewItemDrawer(user);

    await user.type(screen.getByLabelText(/common\.name/), "Truffle oil");
    await user.type(screen.getByLabelText(/inv\.sku/), "TRF-001");
    await selectBaseUnit(user, "Gram");
    await selectCostingMethod(user, "inv.costingStandard");
    await user.type(await screen.findByLabelText("inv.standardCost"), "12.50");

    await user.click(screen.getByRole("button", { name: "common.create" }));

    await screen.findByText("Standard costing requires a standard cost.");
    expect(screen.queryByText(/internal server error/i)).not.toBeInTheDocument();
  });
});
