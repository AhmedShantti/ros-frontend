import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Production regression — "Location not found." on every Inventory screen
 * that lets a caller pick a location (Counts, Transfers, Adjustments,
 * Waste, Batches). `organisation.locations()` used to synthesize a
 * `StockLocation` straight from `GET /org/branches`/`GET /org/warehouses`,
 * using the Branch/Warehouse's OWN id as `StockLocation.id`. Inventory's
 * `locationId` (POST /inventory/counts and friends) is validated against
 * `org.locations` — a SEPARATE registry table with its own id — so a
 * Branch's id is a different, unrelated UUID that the backend's
 * authorization-target resolver can never find, and rejects with 404
 * "Location not found."
 *
 * Fixed by sourcing `organisation.locations()` from the real registry
 * (`GET /org/locations`, `id`/`locationType`/`refId`) and resolving a
 * readable name client-side by joining `refId` against the already-fetched
 * Branch/Warehouse/CentralKitchen catalogues — never inventing a name, and
 * never substituting a Branch id for the registry's own id.
 *
 * Mocked only at the transport boundary (`@/lib/api/endpoints`,
 * `@/lib/api/session`), same pattern as `http.stock-item-standard-cost.test.ts` —
 * the real `http.ts` module runs.
 */

const listLocations = vi.fn();
const listBranches = vi.fn();
const listWarehouses = vi.fn();
const listCentralKitchens = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    organisation: {
      listLocations: (...args: unknown[]) => listLocations(...args),
      listBranches: (...args: unknown[]) => listBranches(...args),
      listWarehouses: (...args: unknown[]) => listWarehouses(...args),
      listCentralKitchens: (...args: unknown[]) => listCentralKitchens(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

const BRANCH_MAIN = {
  id: "branch-main-real-uuid",
  brandId: "brand-1",
  name: { en: "Main" },
  code: "MAIN",
  countryCode: "EG",
  baseCurrency: "EGP",
  timezone: "Africa/Cairo",
  createdAt: "2026-01-01T00:00:00Z",
  status: "active" as const,
  address: {},
};

const WAREHOUSE_1 = {
  id: "warehouse-1-real-uuid",
  name: { en: "Central Store" },
  warehouseType: "branch" as const,
  branchId: null,
};

const CENTRAL_KITCHEN_1 = {
  id: "ck-1-real-uuid",
  name: { en: "Commissary" },
};

const LOCATION_FOR_BRANCH = {
  id: "location-branch-real-uuid",
  locationType: "branch" as const,
  refId: BRANCH_MAIN.id,
  createdAt: "2026-01-02T00:00:00Z",
};

const LOCATION_FOR_WAREHOUSE = {
  id: "location-warehouse-real-uuid",
  locationType: "warehouse" as const,
  refId: WAREHOUSE_1.id,
  createdAt: "2026-01-02T00:00:00Z",
};

const LOCATION_FOR_CENTRAL_KITCHEN = {
  id: "location-ck-real-uuid",
  locationType: "central_kitchen" as const,
  refId: CENTRAL_KITCHEN_1.id,
  createdAt: "2026-01-02T00:00:00Z",
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listLocations.mockResolvedValue([]);
  listBranches.mockResolvedValue([]);
  listWarehouses.mockResolvedValue([]);
  listCentralKitchens.mockResolvedValue([]);
  ({ httpServices } = await import("./http"));
});

describe("organisation.locations() — Inventory location registry (production regression)", () => {
  it("returns the registry row's OWN id, never the underlying Branch id", async () => {
    listLocations.mockResolvedValue([LOCATION_FOR_BRANCH]);
    listBranches.mockResolvedValue([BRANCH_MAIN]);

    const rows = await httpServices.organisation.locations();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(LOCATION_FOR_BRANCH.id);
    expect(rows[0]!.id).not.toBe(BRANCH_MAIN.id);
  });

  it("resolves a readable branch name against the branch catalogue", async () => {
    listLocations.mockResolvedValue([LOCATION_FOR_BRANCH]);
    listBranches.mockResolvedValue([BRANCH_MAIN]);

    const rows = await httpServices.organisation.locations();

    expect(rows[0]!.name).toEqual({ en: "Main", ar: "Main" });
    expect(rows[0]!.kind).toBe("branch");
  });

  it("resolves a readable warehouse name against the warehouse catalogue, with the registry's own id", async () => {
    listLocations.mockResolvedValue([LOCATION_FOR_WAREHOUSE]);
    listWarehouses.mockResolvedValue([WAREHOUSE_1]);

    const rows = await httpServices.organisation.locations();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(LOCATION_FOR_WAREHOUSE.id);
    expect(rows[0]!.id).not.toBe(WAREHOUSE_1.id);
    expect(rows[0]!.name).toEqual({ en: "Central Store", ar: "Central Store" });
  });

  it("resolves a readable central kitchen name against the central kitchen catalogue, with the registry's own id", async () => {
    listLocations.mockResolvedValue([LOCATION_FOR_CENTRAL_KITCHEN]);
    listCentralKitchens.mockResolvedValue([CENTRAL_KITCHEN_1]);

    const rows = await httpServices.organisation.locations();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(LOCATION_FOR_CENTRAL_KITCHEN.id);
    expect(rows[0]!.id).not.toBe(CENTRAL_KITCHEN_1.id);
    expect(rows[0]!.kind).toBe("central_kitchen");
  });

  it("drops a registry row whose referenced entity cannot be resolved, rather than fabricating a name", async () => {
    listLocations.mockResolvedValue([LOCATION_FOR_BRANCH]);
    listBranches.mockResolvedValue([]); // the branch this row points at is not visible/returned

    const rows = await httpServices.organisation.locations();

    expect(rows).toHaveLength(0);
  });

  it("an empty registry returns an empty list, never a fabricated location", async () => {
    listLocations.mockResolvedValue([]);
    listBranches.mockResolvedValue([BRANCH_MAIN]);

    const rows = await httpServices.organisation.locations();

    expect(rows).toHaveLength(0);
  });

  it("handles branches, warehouses and central kitchens together, each with the registry's own id", async () => {
    listLocations.mockResolvedValue([
      LOCATION_FOR_BRANCH,
      LOCATION_FOR_WAREHOUSE,
      LOCATION_FOR_CENTRAL_KITCHEN,
    ]);
    listBranches.mockResolvedValue([BRANCH_MAIN]);
    listWarehouses.mockResolvedValue([WAREHOUSE_1]);
    listCentralKitchens.mockResolvedValue([CENTRAL_KITCHEN_1]);

    const rows = await httpServices.organisation.locations();

    expect(rows.map((r) => r.id).sort()).toEqual(
      [LOCATION_FOR_BRANCH.id, LOCATION_FOR_WAREHOUSE.id, LOCATION_FOR_CENTRAL_KITCHEN.id].sort(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(BRANCH_MAIN.id);
    expect(ids).not.toContain(WAREHOUSE_1.id);
    expect(ids).not.toContain(CENTRAL_KITCHEN_1.id);
  });
});
