import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * FR-INV-040/041 — production regression: the Open Count drawer correctly
 * put the selected Storage Area's id into `storageAreaId` state and the
 * page's submit object, but `httpServices.inventory.counts.create()` — the
 * real HTTP mapping layer between the page and `POST /inventory/counts` —
 * only ever forwarded `scopeId` onto the wire for `scopeType: "category"`.
 * `storage_area` silently lost it, so the backend's own `OpenCountDto`
 * validation rejected every storage_area count with "scopeId is required
 * for a storage_area scope." A page-level test that mocks
 * `services.inventory.counts.create` directly never exercises this
 * mapping at all — this file mocks only `@/lib/api/endpoints` (the real
 * transport boundary), same convention as `http.count-history.test.ts`, so
 * `http.ts`'s own request-building logic is what's actually under test.
 * `api.inventory.openCount`'s own argument IS the JSON body that gets sent
 * (`client.ts`'s `post()` does `JSON.stringify(options.body)` with no
 * further transformation), so asserting that argument is asserting the
 * real wire body.
 */

const openCount = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: {
      openCount: (...args: unknown[]) => openCount(...args),
    },
  },
}));

vi.mock("@/lib/api/session", () => ({
  getTenantId: () => "t1",
}));

let httpServices: typeof import("./http")["httpServices"];

function wireSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    locationId: "loc-main",
    scopeType: "full_location",
    scopeId: null,
    isBlindCount: true,
    status: "in_progress",
    lineCount: 0,
    startedAt: "2026-01-01T00:00:00Z",
    startedBy: "u1",
    postedAt: null,
    postedBy: null,
    requiresApproval: false,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  openCount.mockResolvedValue(wireSession());
  httpServices = (await import("./http")).httpServices;
});

describe("inventory.counts.create() — the real POST /inventory/counts wire body (production regression)", () => {
  it("storage_area: sends scopeId on the wire, not dropped", async () => {
    await httpServices.inventory.counts.create({
      locationId: "loc-main",
      mode: "blind",
      scopeType: "storage_area",
      scopeId: "area-a",
    } as never);

    expect(openCount).toHaveBeenCalledWith({
      locationId: "loc-main",
      scopeType: "storage_area",
      scopeId: "area-a",
      itemIds: undefined,
      isBlindCount: true,
    });
  });

  it("category: still sends scopeId on the wire (no regression)", async () => {
    await httpServices.inventory.counts.create({
      locationId: "loc-main",
      mode: "open",
      scopeType: "category",
      scopeId: "cat-dairy",
    } as never);

    expect(openCount).toHaveBeenCalledWith({
      locationId: "loc-main",
      scopeType: "category",
      scopeId: "cat-dairy",
      itemIds: undefined,
      isBlindCount: false,
    });
  });

  it("item_list: still sends itemIds, no scopeId (no regression)", async () => {
    await httpServices.inventory.counts.create({
      locationId: "loc-main",
      mode: "blind",
      scopeType: "item_list",
      itemIds: ["item-1", "item-2"],
    } as never);

    expect(openCount).toHaveBeenCalledWith({
      locationId: "loc-main",
      scopeType: "item_list",
      scopeId: undefined,
      itemIds: ["item-1", "item-2"],
      isBlindCount: true,
    });
  });

  it("full_location: no scopeId, no itemIds (no regression)", async () => {
    await httpServices.inventory.counts.create({
      locationId: "loc-main",
      mode: "open",
      scopeType: "full_location",
    } as never);

    expect(openCount).toHaveBeenCalledWith({
      locationId: "loc-main",
      scopeType: "full_location",
      scopeId: undefined,
      itemIds: undefined,
      isBlindCount: false,
    });
  });

  it("never forwards a storage_area scopeId onto a category request or vice versa", async () => {
    await httpServices.inventory.counts.create({
      locationId: "loc-main",
      mode: "blind",
      scopeType: "storage_area",
      scopeId: "area-a",
      itemIds: ["item-should-be-dropped"],
    } as never);

    expect(openCount).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "storage_area", scopeId: "area-a", itemIds: undefined }),
    );
  });
});
