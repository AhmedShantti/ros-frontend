import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-050 — count sessions retain full history. `counts.list()` used to
 * return an empty page ("no index endpoint"); it now reads
 * `GET /inventory/counts`, and `counts.get()` reads
 * `GET /inventory/counts/:id` alongside the lines instead of synthesising a
 * session from a bare id.
 *
 * Mocked only at the transport boundary, same as
 * `http.inventory-locations.test.ts` — the real `http.ts` and `map.ts` run.
 */

const listCounts = vi.fn();
const getCount = vi.fn();
const countLines = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listWarehouses = vi.fn();
const listCentralKitchens = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      listCounts: (...args: unknown[]) => listCounts(...args),
      getCount: (...args: unknown[]) => getCount(...args),
      countLines: (...args: unknown[]) => countLines(...args),
      listItems: (...args: unknown[]) => listItems(...args),
    },
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

const branchRow = (id: string, name: string, code: string) => ({
  id,
  brandId: "brand-1",
  name: { en: name },
  code,
  countryCode: "EG",
  baseCurrency: "EGP",
  timezone: "Africa/Cairo",
  createdAt: "2026-01-01T00:00:00Z",
  status: "active" as const,
  address: {},
});
const BRANCH = branchRow("branch-1", "Downtown", "DT");
const BRANCH_2 = branchRow("branch-2", "Uptown", "UT");
const LOC_A = { id: "loc-a", locationType: "branch", refId: "branch-1", createdAt: "2026-01-01T00:00:00Z" };
const LOC_B = { id: "loc-b", locationType: "branch", refId: "branch-2", createdAt: "2026-01-01T00:00:00Z" };

function wire(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    locationId: LOC_A.id,
    scopeType: "full_location",
    scopeId: null,
    isBlindCount: true,
    status: "in_progress",
    startedBy: "user-1",
    startedAt: "2026-03-01T10:00:00Z",
    postedAt: null,
    postedBy: null,
    requiresApproval: false,
    lineCount: 3,
    ...overrides,
  };
}

// Newest first, exactly as the backend returns them.
const POSTED = wire({
  id: "cccccccc-0000-0000-0000-000000000003",
  status: "posted",
  startedAt: "2026-03-03T10:00:00Z",
  postedAt: "2026-03-03T11:00:00Z",
  postedBy: "user-2",
  scopeType: "category",
  scopeId: "cat-dairy",
  isBlindCount: false,
  locationId: LOC_B.id,
});
const IN_PROGRESS = wire({
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  startedAt: "2026-03-02T10:00:00Z",
  scopeType: "item_list",
});
const OLDEST = wire();

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listCounts.mockResolvedValue([POSTED, IN_PROGRESS, OLDEST]);
  listLocations.mockResolvedValue([LOC_A, LOC_B]);
  listBranches.mockResolvedValue([BRANCH, BRANCH_2]);
  listWarehouses.mockResolvedValue([]);
  listCentralKitchens.mockResolvedValue([]);
  listItems.mockResolvedValue([]);
  ({ httpServices } = await import("./http"));
});

describe("inventory.counts.list() — count session history (FR-INV-050)", () => {
  it("reads the real index instead of returning an empty page", async () => {
    const page = await httpServices.inventory.counts.list();

    expect(listCounts).toHaveBeenCalledTimes(1);
    expect(page.rows).toHaveLength(3);
    expect(page.total).toBe(3);
  });

  it("a posted session stays in the list, with status and postedAt/postedBy intact", async () => {
    const page = await httpServices.inventory.counts.list();
    const posted = page.rows.find((row) => row.id === POSTED.id)!;

    expect(posted.status).toBe("posted");
    expect(posted.postedAt).toBe("2026-03-03T11:00:00Z");
    expect(posted.postedBy).toBe("user-2");
  });

  it("resolves locationId to a readable name via the location registry", async () => {
    const page = await httpServices.inventory.counts.list();

    expect(page.rows.find((row) => row.id === POSTED.id)!.locationName).toEqual({
      en: "Uptown",
      ar: "Uptown",
    });
    expect(page.rows.find((row) => row.id === OLDEST.id)!.locationName).toEqual({
      en: "Downtown",
      ar: "Downtown",
    });
  });

  it("maps mode, status, opened timestamp and counter identity from real fields", async () => {
    const page = await httpServices.inventory.counts.list();
    const open = page.rows.find((row) => row.id === IN_PROGRESS.id)!;
    const posted = page.rows.find((row) => row.id === POSTED.id)!;

    expect(open.mode).toBe("blind");
    expect(open.status).toBe("counting");
    expect(open.openedAt).toBe("2026-03-02T10:00:00Z");
    expect(open.countedBy).toBe("user-1");
    expect(posted.mode).toBe("open");
  });

  it("keeps the backend's newest-first order when no sort is requested", async () => {
    const page = await httpServices.inventory.counts.list();

    expect(page.rows.map((row) => row.id)).toEqual([POSTED.id, IN_PROGRESS.id, OLDEST.id]);
  });

  it("sorts newest-first for the page's default -openedAt", async () => {
    listCounts.mockResolvedValue([OLDEST, POSTED, IN_PROGRESS]);
    const page = await httpServices.inventory.counts.list({ sort: "-openedAt" });

    expect(page.rows.map((row) => row.id)).toEqual([POSTED.id, IN_PROGRESS.id, OLDEST.id]);
  });

  it("filters by status", async () => {
    const page = await httpServices.inventory.counts.list({ filters: { status: "posted" } });
    expect(page.rows.map((row) => row.id)).toEqual([POSTED.id]);
  });

  it("filters by mode", async () => {
    const page = await httpServices.inventory.counts.list({ filters: { mode: "open" } });
    expect(page.rows.map((row) => row.id)).toEqual([POSTED.id]);
  });

  it("filters by location", async () => {
    const page = await httpServices.inventory.counts.list({ filters: { locationId: LOC_A.id } });
    expect(page.rows.map((row) => row.id)).toEqual([IN_PROGRESS.id, OLDEST.id]);
  });

  it("does not fabricate flagged/variance figures the index cannot supply", async () => {
    const page = await httpServices.inventory.counts.list();

    for (const row of page.rows) {
      expect(row.flaggedCount).toBeNull();
      expect(row.netVarianceValue).toBeNull();
    }
  });

  it("represents category, item_list and full_location scopes", async () => {
    const page = await httpServices.inventory.counts.list();
    const scopeOf = (id: string) => page.rows.find((row) => row.id === id)!.scope;

    expect(scopeOf(POSTED.id)).toEqual({ en: "category", ar: "category" });
    expect(scopeOf(IN_PROGRESS.id)).toEqual({ en: "item_list", ar: "item_list" });
    expect(scopeOf(OLDEST.id)).toEqual({ en: "full_location", ar: "full_location" });
  });

  it("an empty index yields an empty page", async () => {
    listCounts.mockResolvedValue([]);
    const page = await httpServices.inventory.counts.list();

    expect(page.rows).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("inventory.counts.get() — a posted session stays readable", () => {
  it("reads the session's own fields plus its counted lines", async () => {
    getCount.mockResolvedValue(POSTED);
    countLines.mockResolvedValue([]);
    listItems.mockResolvedValue([]);

    const session = await httpServices.inventory.counts.get(POSTED.id);

    expect(getCount).toHaveBeenCalledWith(POSTED.id);
    expect(countLines).toHaveBeenCalledWith(POSTED.id);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("posted");
    expect(session!.postedAt).toBe("2026-03-03T11:00:00Z");
    expect(session!.locationName).toEqual({ en: "Uptown", ar: "Uptown" });
    // Once its own lines are loaded the figures are real, not null.
    expect(session!.flaggedCount).toBe(0);
    expect(session!.netVarianceValue).not.toBeNull();
  });
});
