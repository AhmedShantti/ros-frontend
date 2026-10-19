import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const list = vi.fn();
const create = vi.fn();
const configuredWorklist = vi.fn();
const legacyExpiring = vi.fn();
vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      expiryWorklist: () => configuredWorklist(),
      expiring: (...args: unknown[]) => legacyExpiring(...args),
      listItems: async () => [],
    },
    organisation: {
      listLocations: async () => [],
      listBranches: async () => [],
      listWarehouses: async () => [],
      listCentralKitchens: async () => [],
    },
  },
}));
vi.mock("@/lib/console/services", () => ({
  ServiceError: class extends Error {},
  services: {
    organisation: { locations: async () => [] },
    inventory: {
      monitoring: async () => ({
        schedulerEnabled: false,
        delivery: "unavailable",
        findings: [],
        jobs: [],
      }),
      expiryCategories: async () => [],
      reasonCodes: async () => [],
      batches: { list: (...args: unknown[]) => list(...args) },
      waste: { create: (...args: unknown[]) => create(...args) },
      transfers: { create: (...args: unknown[]) => create(...args) },
    },
    crm: { promotions: { create: (...args: unknown[]) => create(...args) } },
  },
}));
vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    tx: (v: unknown) =>
      typeof v === "string" ? v : ((v as { en?: string })?.en ?? ""),
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  usePermission: () => true,
  useSession: () => ({
    scope: { tenantId: "t1", branchId: null },
    canAny: () => true,
  }),
}));
import ExpiryPage from "./page";
beforeEach(() => {
  list.mockResolvedValue({
    rows: [
      {
        id: "b1",
        itemId: "i1",
        itemName: { en: "Milk" },
        locationId: "l1",
        locationName: { en: "Store" },
        batchNumber: "EXPIRED-LOT",
        productionDate: null,
        expiryDate: "2026-10-18",
        quantity: { value: "1.25", unit: "kg" },
        unitCost: { amount: 101, currency: "EGP" },
        value: { amount: 126, currency: "EGP" },
        supplierId: null,
        supplierName: null,
        daysToExpiry: -1,
        status: "expired",
      },
    ],
    total: 1,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Expiry action worklist", () => {
  it("requests the configured backend worklist and does not offer unsafe lot actions", async () => {
    render(<ExpiryPage />);
    expect(await screen.findByText("Milk")).toBeInTheDocument();
    expect(
      screen.getByText("inv.expiryActionsUnavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "inv.transferAction" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "inv.writeOff" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "inv.markdownAction" }),
    ).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ expiryWorklist: "true" }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("does not present a failed worklist read as a clear healthy expiry state", async () => {
    list.mockRejectedValue(Error("Expiry read unavailable"));
    render(<ExpiryPage />);
    await waitFor(() =>
      expect(screen.getByText("Expiry read unavailable")).toBeInTheDocument(),
    );
    expect(screen.queryByText("inv.expiryClear")).not.toBeInTheDocument();
  });
});

describe("Expiry worklist permanent mode", () => {
  it("keeps the configured API, backend dates and valuation after applying and clearing user filters", async () => {
    const { httpServices } = await import("@/lib/console/services/http");
    configuredWorklist.mockResolvedValue([
      {
        batchId: "configured-batch",
        stockItemId: "configured-item",
        locationId: "configured-location",
        itemName: { en: "Configured Milk" },
        baseUnit: "kg",
        batchNumber: "CATEGORY-14-DAYS",
        productionDate: null,
        expiryDate: "2026-11-02T00:00:00.000Z",
        quantityRemaining: "1.250000",
        unitCost: "101",
        value: "126",
        daysToExpiry: 10,
        horizon: 14,
        timezone: "Pacific/Auckland",
        status: "approaching_expiry",
        usable: true,
        actions: {},
        categoryId: "dairy",
      },
    ]);
    legacyExpiring.mockRejectedValue(
      new Error("Legacy expiry API must not be called by this page"),
    );
    list.mockImplementation((query) =>
      httpServices.inventory.batches.list(query),
    );
    const user = userEvent.setup();
    render(<ExpiryPage />);
    expect(await screen.findByText("Configured Milk")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "common.clearFilters" }),
    ).not.toBeInTheDocument();
    expect(configuredWorklist).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /common.status/ }));
    await user.click(await screen.findByRole("option", { name: "Expiring" }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: { status: "expiring", expiryWorklist: "true" },
        }),
      ),
    );
    await waitFor(() => expect(configuredWorklist).toHaveBeenCalledTimes(2));
    await user.click(
      screen.getByRole("button", { name: "common.clearFilters" }),
    );
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: { expiryWorklist: "true" },
          search: undefined,
          offset: 0,
        }),
      ),
    );
    await waitFor(() => expect(configuredWorklist).toHaveBeenCalledTimes(3));
    expect(
      screen.queryByRole("button", { name: "common.clearFilters" }),
    ).not.toBeInTheDocument();
    const lastPage = await list.mock.results.at(-1)!.value;
    expect(lastPage.rows[0]).toMatchObject({
      batchNumber: "CATEGORY-14-DAYS",
      daysToExpiry: 10,
      expiryDate: "2026-11-02",
      quantity: { value: "1.250000", unit: "kg" },
      value: { amount: 126 },
      unitCost: { amount: 101 },
    });
    expect(legacyExpiring).not.toHaveBeenCalled();
  });
});

describe("Unchanged shared collection behavior", () => {
  it("clears another consumer's user filters without imposing expiry worklist mode", async () => {
    const { useCollection } = await import("@/lib/console/hooks");
    const fetcher = vi.fn().mockResolvedValue({ rows: [], total: 0 });
    const { result } = renderHook(() =>
      useCollection(fetcher, { initialFilters: { status: "expired" } }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        expect.objectContaining({ filters: { status: "expired" } }),
      ),
    );
    act(() => result.current.clearFilters());
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: {} }),
      ),
    );
    expect(result.current.filters).toEqual({});
    expect(result.current.filtered).toBe(false);
  });
});
