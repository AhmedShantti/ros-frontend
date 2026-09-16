import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * POS-BACKOFFICE-CALLS-P0 — production observation: a signed-on PIN(POS)
 * session's browser called `GET /org/branches` (403, `BRANCH_READ` is a
 * tenant/branch-owner permission no Cashier role holds) on nearly every
 * order action. Root cause: `orderContext()`/`hydrateOrder()`/
 * `orderMutations.open()`/`.get()` (all reached by every Sales order read
 * and mutation) resolved a `branchName` via `branchIndex()`, sourced from
 * `branchesRaw()` (`GET /org/branches`) — fine for a Console/Owner session,
 * a guaranteed 403 for a scoped PIN session.
 *
 * Fix: those four call sites now resolve through `accessibleBranchIndex()`,
 * sourced from `accessibleBranchesRaw()` (`GET /org/access`) — answers
 * correctly for BOTH: the identical full roster for an Owner, just the
 * caller's own branch(es) for a scoped role, and never denies. This test
 * proves the swap at the wire level (mocking only `@/lib/api/endpoints`,
 * never `@/lib/console/services` itself, so the real `http.ts` logic runs)
 * and that Console's own, separate `organisation.branches.list()` —
 * `app/(console)/organisation/branches/page.tsx`'s direct read — still
 * calls `GET /org/branches` unchanged.
 */

const {
  listBranches,
  getAccessibleScope,
  salesList,
  salesCreate,
  salesVoidLine,
} = vi.hoisted(() => ({
  listBranches: vi.fn(),
  getAccessibleScope: vi.fn(),
  salesList: vi.fn(),
  salesCreate: vi.fn(),
  salesVoidLine: vi.fn(),
}));

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    organisation: {
      listBranches: (...args: unknown[]) => listBranches(...args),
      getAccessibleScope: (...args: unknown[]) => getAccessibleScope(...args),
    },
    sales: {
      list: (...args: unknown[]) => salesList(...args),
      create: (...args: unknown[]) => salesCreate(...args),
      voidLine: (...args: unknown[]) => salesVoidLine(...args),
    },
  },
}));

import * as Session from "@/lib/api/session";
import type { ServiceRegistry } from "./types";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";

const ACCESSIBLE_SCOPE_RESPONSE = {
  tenantId: TENANT_ID,
  brands: [],
  branches: [
    {
      id: BRANCH_ID,
      brandId: "brand-1",
      name: { en: "Downtown" },
      code: "DOWNTOWN",
      countryCode: "EG",
      baseCurrency: "EGP",
      timezone: "Africa/Cairo",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      address: {},
    },
  ],
};

function wireOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    branchId: BRANCH_ID,
    terminalId: null,
    orderNumber: "1001",
    businessDay: "2026-09-16",
    orderType: "takeaway",
    channel: "pos",
    state: "pending",
    tableId: null,
    guestCount: null,
    openedBy: "user-1",
    currency: "EGP",
    subtotal: "0",
    discountTotal: "0",
    serviceChargeTotal: "0",
    taxTotal: "0",
    roundingAdjustment: "0",
    grandTotal: "0",
    paidTotal: "0",
    tipTotal: "0",
    lines: [],
    openedAt: "2026-09-16T10:00:00.000Z",
    firstFiredAt: null,
    completedAt: null,
    notes: null,
    version: 1,
    ...overrides,
  };
}

// `branchIndex()`/`accessibleBranchIndex()` are module-scoped, 20s-memoized
// caches inside `http.ts` (`cached()`) — a fresh module instance is needed
// per test so one test's cache hit doesn't hide another test's call.
let httpServices: ServiceRegistry;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  Session.setTenantId(TENANT_ID);
  getAccessibleScope.mockResolvedValue(ACCESSIBLE_SCOPE_RESPONSE);
  listBranches.mockResolvedValue([ACCESSIBLE_SCOPE_RESPONSE.branches[0]]);
  ({ httpServices } = await import("./http"));
});

afterEach(() => {
  Session.setTenantId(null);
});

describe("Sales order reads/mutations never call GET /org/branches (POS-BACKOFFICE-CALLS-P0)", () => {
  it("orders.list() resolves branch names via GET /org/access, never GET /org/branches", async () => {
    salesList.mockResolvedValue({ orders: [], nextCursor: null });

    await httpServices.sales.orders.list({ limit: 5 });

    expect(getAccessibleScope).toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("mutations.open() (a new POS order) resolves branch names via GET /org/access, never GET /org/branches", async () => {
    salesCreate.mockResolvedValue(wireOrder());

    await httpServices.sales.mutations.open({ orderType: "takeaway", channel: "pos" });

    expect(getAccessibleScope).toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("mutations.voidLine() (hydrateOrder) resolves branch names via GET /org/access, never GET /org/branches", async () => {
    salesVoidLine.mockResolvedValue({ line: {}, order: wireOrder({ state: "voided" }) });

    await httpServices.sales.mutations.voidLine("2026-09-16", "order-1", "line-1", {
      ifMatch: 1,
    });

    expect(getAccessibleScope).toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });
});

describe("Console's own branch list is unaffected", () => {
  it("organisation.branches.list() (Organisation → Branches, a real dashboard-only screen) still calls GET /org/branches directly", async () => {
    await httpServices.organisation.branches.list({});

    expect(listBranches).toHaveBeenCalled();
  });
});
