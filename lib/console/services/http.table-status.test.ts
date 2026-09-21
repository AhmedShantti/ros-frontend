import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * DASHBOARD-TABLE-STATUS-LIVE-P0
 *
 * `services.sales.tableStatus()` and the Dashboard's "Tables occupied" tile
 * against the real `http.ts` logic — mocked only at the transport boundary
 * (`@/lib/api/endpoints`), same pattern as `http.dine-in-table-select.test.ts`.
 * Proves:
 *   - `GET /orders/tables/status?branchId=<branch>` is the ONLY source, sent
 *     with exactly the branch asked for, in ONE request;
 *   - occupancy / activeOrder / conflictingOrders pass through untouched —
 *     nothing is derived from orders, and no richer state is invented;
 *   - it never touches the POS list (`GET /orders/tables`), the
 *     BRANCH_READ-gated `GET /org/branches/{id}/tables`, or `/org/branches`;
 *   - 403 / 404 / network failures propagate — never an empty or
 *     all-available list;
 *   - the Dashboard tile used to read 0 of N (the org table records'
 *     `state` is hard-coded "available"); it now reads the backend's
 *     occupancy for a CONCRETE branch, and is a dash (null) for "All
 *     branches" or any refusal — never a fabricated zero.
 */

const {
  tableStatus,
  posListTables,
  orgListTables,
  listBranches,
  getAccessibleScope,
  salesList,
} = vi.hoisted(() => ({
  tableStatus: vi.fn(),
  posListTables: vi.fn(),
  orgListTables: vi.fn(),
  listBranches: vi.fn(),
  getAccessibleScope: vi.fn(),
  salesList: vi.fn(),
}));

/**
 * `dashboard.get` fans out over many unrelated reads (all `.catch`ed inside
 * `http.ts` except the order list). Any endpoint this test does not name
 * rejects, so a stray call can never silently "succeed".
 */
vi.mock("@/lib/api/endpoints", () => {
  const rejecting = (path: string) => () => Promise.reject(new Error(`unmocked ${path}`));
  const group = (name: string, impl: Record<string, unknown>) =>
    new Proxy(impl, {
      get: (target, prop) =>
        prop in target ? target[prop as string] : rejecting(`${name}.${String(prop)}`),
    });
  const groups: Record<string, unknown> = {
    sales: group("sales", {
      tableStatus: (...args: unknown[]) => tableStatus(...args),
      listTables: (...args: unknown[]) => posListTables(...args),
      list: (...args: unknown[]) => salesList(...args),
    }),
    organisation: group("organisation", {
      listTables: (...args: unknown[]) => orgListTables(...args),
      listBranches: (...args: unknown[]) => listBranches(...args),
      getAccessibleScope: (...args: unknown[]) => getAccessibleScope(...args),
    }),
  };
  return {
    api: new Proxy(groups, {
      get: (target, prop) => (prop in target ? target[prop as string] : group(String(prop), {})),
    }),
  };
});

import * as Session from "@/lib/api/session";
import type { ServiceError as ServiceErrorType, ServiceRegistry } from "./types";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";
const BRANCH_2_ID = "branch-2";

const orderRef = (overrides: Record<string, unknown> = {}) => ({
  id: "order-1",
  businessDay: "2026-09-21",
  orderNumber: "MAIN-7",
  state: "open",
  version: 3,
  guestCount: null,
  openedAt: "2026-09-21T10:00:00.000Z",
  firstFiredAt: null,
  ...overrides,
});

const wireTable = (overrides: Record<string, unknown> = {}) => ({
  id: "t-1",
  label: "1",
  section: null,
  seatCapacity: 4,
  occupancy: "available",
  activeOrder: null,
  conflictingOrders: [],
  ...overrides,
});

const STATUS_ROWS = [
  wireTable({ id: "t-1", label: "1" }),
  wireTable({ id: "t-2", label: "2", occupancy: "occupied", activeOrder: orderRef() }),
  wireTable({
    id: "t-3",
    label: "3",
    occupancy: "ambiguous",
    conflictingOrders: [orderRef({ id: "a", orderNumber: "MAIN-3" }), orderRef({ id: "b", orderNumber: "MAIN-8" })],
  }),
];

let httpServices: ServiceRegistry;
let ServiceError: typeof ServiceErrorType;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  Session.setTenantId(TENANT_ID);
  getAccessibleScope.mockResolvedValue({ tenantId: TENANT_ID, brands: [], branches: [] });
  // The pre-existing dashboard fan-out reads the branch roster (`.catch`ed);
  // it is not what these tests are about and must simply not throw here.
  listBranches.mockResolvedValue([]);
  salesList.mockResolvedValue({ orders: [], nextCursor: null });
  ({ httpServices } = await import("./http"));
  ({ ServiceError } = await import("./types"));
});

afterEach(() => {
  Session.setTenantId(null);
});

describe("http.ts — sales.tableStatus (GET /orders/tables/status)", () => {
  it("sends exactly the requested branchId, in ONE request, and passes occupancy through untouched", async () => {
    tableStatus.mockResolvedValue(STATUS_ROWS);

    const rows = await httpServices.sales.tableStatus(BRANCH_ID);

    expect(tableStatus).toHaveBeenCalledTimes(1);
    expect(tableStatus).toHaveBeenCalledWith({ branchId: BRANCH_ID });
    expect(rows.map((r) => [r.label, r.occupancy])).toEqual([
      ["1", "available"],
      ["2", "occupied"],
      ["3", "ambiguous"],
    ]);
    expect(rows[0]).toMatchObject({ seatCapacity: 4, activeOrder: null, conflictingOrders: [] });
    expect(rows[1].activeOrder).toMatchObject({ id: "order-1", orderNumber: "MAIN-7", state: "open" });
    expect(rows[2].activeOrder).toBeNull();
    expect(rows[2].conflictingOrders.map((o) => o.orderNumber)).toEqual(["MAIN-3", "MAIN-8"]);
  });

  it("invents no richer state: a row carries only occupancy, never seated / food served / bill requested / needs cleaning", async () => {
    tableStatus.mockResolvedValue(STATUS_ROWS);

    const rows = await httpServices.sales.tableStatus(BRANCH_ID);

    for (const row of rows) {
      expect(["available", "occupied", "ambiguous"]).toContain(row.occupancy);
      expect(row).not.toHaveProperty("state");
      expect(row).not.toHaveProperty("seatedAt");
    }
  });

  it("uses NO other table source: not the POS list, not /org/branches/{id}/tables, not /org/branches", async () => {
    tableStatus.mockResolvedValue(STATUS_ROWS);

    await httpServices.sales.tableStatus(BRANCH_ID);

    expect(posListTables).not.toHaveBeenCalled();
    expect(orgListTables).not.toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it.each([
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [0, "NETWORK_UNREACHABLE"],
  ])("a %i propagates as a ServiceError — never an empty or all-available list", async (status, code) => {
    tableStatus.mockRejectedValue(new ServiceError(code, "refused", status));

    await expect(httpServices.sales.tableStatus(BRANCH_ID)).rejects.toMatchObject({ status, code });
    expect(posListTables).not.toHaveBeenCalled();
    expect(orgListTables).not.toHaveBeenCalled();
  });
});

describe("http.ts — Dashboard 'Tables occupied' tile (dashboard.get)", () => {
  const scope = (branchId: string | null) => ({ tenantId: TENANT_ID, brandId: null, branchId });

  it("a concrete branch: occupied / total come from the backend's occupancy (not-available counts as occupied, conflict included)", async () => {
    tableStatus.mockResolvedValue(STATUS_ROWS);

    const data = await httpServices.dashboard.get(scope(BRANCH_ID));

    expect(tableStatus).toHaveBeenCalledTimes(1);
    expect(tableStatus).toHaveBeenCalledWith({ branchId: BRANCH_ID });
    expect(data.live.tablesOccupied).toBe(2);
    expect(data.live.tablesTotal).toBe(3);
  });

  it("does NOT read the Organisation table records any more (the source of the old fabricated 0)", async () => {
    tableStatus.mockResolvedValue(STATUS_ROWS);

    await httpServices.dashboard.get(scope(BRANCH_ID));

    expect(orgListTables).not.toHaveBeenCalled();
    expect(posListTables).not.toHaveBeenCalled();
  });

  it("'All branches': a dash (null), never a fabricated zero, and NO status request at all — no silent broadening", async () => {
    const data = await httpServices.dashboard.get(scope(null));

    expect(tableStatus).not.toHaveBeenCalled();
    expect(data.live.tablesOccupied).toBeNull();
    expect(data.live.tablesTotal).toBeNull();
  });

  it("403 (branch outside the caller's scope) or a network failure: a dash, never 0 of N", async () => {
    tableStatus.mockRejectedValue(new ServiceError("FORBIDDEN", "no", 403));
    const forbidden = await httpServices.dashboard.get(scope(BRANCH_ID));
    expect(forbidden.live.tablesOccupied).toBeNull();
    expect(forbidden.live.tablesTotal).toBeNull();

    tableStatus.mockRejectedValue(new ServiceError("NETWORK_UNREACHABLE", "down", 0));
    const down = await httpServices.dashboard.get(scope(BRANCH_2_ID));
    expect(down.live.tablesOccupied).toBeNull();
    expect(down.live.tablesTotal).toBeNull();
  });

  it("a branch with no tables is a truthful 0 of 0 (the read succeeded), distinct from a dash", async () => {
    tableStatus.mockResolvedValue([]);

    const data = await httpServices.dashboard.get(scope(BRANCH_ID));

    expect(data.live.tablesOccupied).toBe(0);
    expect(data.live.tablesTotal).toBe(0);
  });
});
