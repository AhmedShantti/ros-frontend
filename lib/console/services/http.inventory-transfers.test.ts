import { beforeEach, describe, expect, it, vi } from "vitest";

const listTransfers = vi.fn();
const dispatchLines = vi.fn();
const returnExcess = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listWarehouses = vi.fn();
const listCentralKitchens = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    inventory: { dispatchTransferLines: (...args: unknown[]) => dispatchLines(...args), returnTransferExcess: (...args: unknown[]) => returnExcess(...args), listTransfers: (...args: unknown[]) => listTransfers(...args), listItems: (...args: unknown[]) => listItems(...args) },
    organisation: {
      listLocations: (...args: unknown[]) => listLocations(...args),
      listBranches: (...args: unknown[]) => listBranches(...args),
      listWarehouses: (...args: unknown[]) => listWarehouses(...args),
      listCentralKitchens: (...args: unknown[]) => listCentralKitchens(...args),
    },
  },
}));
vi.mock("@/lib/api/session", () => ({ getTenantId: () => "tenant-1" }));

let httpServices: typeof import("./http")["httpServices"];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listItems.mockResolvedValue([]);
  listLocations.mockResolvedValue([]);
  listBranches.mockResolvedValue([]);
  listWarehouses.mockResolvedValue([]);
  listCentralKitchens.mockResolvedValue([]);
  listTransfers.mockResolvedValue([
    { id: "t1", tenantId: "tenant-1", stockItemId: "i1", fromLocationId: "l1", toLocationId: "l2", quantityDispatched: "10.000000", physicallyReceived: "4.000000", status: "in_transit", inTransit: "6.000000", physicallyHeld: "4.000000", availableQuantity: "0.000000", discrepancy: "-6.000000", unitCost: "125", dispatchedBy: "user-1", createdAt: "2026-10-18T10:00:00.000Z", receipts: [] },
    { id: "t2", tenantId: "tenant-1", stockItemId: "i1", fromLocationId: "l1", toLocationId: "l2", quantityDispatched: "5.000000", physicallyReceived: "6.000000", status: "pending_investigation", inTransit: "0.000000", physicallyHeld: "6.000000", availableQuantity: "0.000000", discrepancy: "1.000000", unitCost: "125", dispatchedBy: "user-1", createdAt: "2026-10-18T11:00:00.000Z", receipts: [{ id: "r1", receivedQuantity: "6.000000", isFinal: true, isRecount: true, recountedQuantity: "6.000000", receivedBy: "user-1", createdAt: "2026-10-18T11:01:00.000Z" }] },
    { id: "t3", tenantId: "tenant-1", stockItemId: "i1", fromLocationId: "l1", toLocationId: "l2", quantityDispatched: "5.000000", physicallyReceived: "6.000000", status: "excess_held", inTransit: "0.000000", physicallyHeld: "1.000000", excessHeldQuantity: "1.000000", availableQuantity: "5.000000", discrepancy: "1.000000", unitCost: "125", dispatchedBy: "user-1", createdAt: "2026-10-18T12:00:00.000Z", receipts: [] },
  ]);
  ({ httpServices } = await import("./http"));
});

describe("inventory transfer collection mapping", () => {
  it("lists pending, in-transit, and excess custody quantities without marking held stock available", async () => {
    const page = await httpServices.inventory.transfers.list();
    expect(page.rows).toHaveLength(3);
    expect(page.rows[0]?.status).toBe("in_transit");
    expect(page.rows[0]?.lines[0]?.inTransit?.value).toBe("6.000000");
    expect(page.rows[0]?.lines[0]?.physicallyHeld?.value).toBe("4.000000");
    expect(page.rows[1]?.status).toBe("pending_investigation");
    expect(page.rows[1]?.lines[0]?.available?.value).toBe("0.000000");
    expect(page.rows[1]?.receipts[0]?.isRecount).toBe(true);
    expect(page.rows[1]?.receipts[0]?.recounted?.value).toBe("6.000000");
    expect(page.rows[2]?.status).toBe("excess_held");
    expect(page.rows[2]?.lines[0]?.available?.value).toBe("5.000000");
    expect(page.rows[2]?.lines[0]?.physicallyHeld?.value).toBe("1.000000");
  });
  it("maps every grouped dispatch line and preserves source identities", async () => {
    dispatchLines.mockResolvedValue([
      { id: "one", dispatchGroupId: "group", stockItemId: "i1", fromLocationId: "l1", toLocationId: "l2", batchProvenance: [{ sourceBatchId: "source", quantity: "1", batchNumber: "B1" }] },
      { id: "two", dispatchGroupId: "group", stockItemId: "i2", fromLocationId: "l1", toLocationId: "l2" },
    ]);
    const rows = await httpServices.inventory.dispatchTransferLines({ fromLocationId: "l1", toLocationId: "l2", lines: [{ stockItemId: "i1", quantity: "1" }, { stockItemId: "i2", quantity: "2" }] });
    expect(rows.map(row => row.id)).toEqual(["one", "two"]);
    expect(rows.every(row => row.dispatchGroupId === "group")).toBe(true);
    expect(rows[0]?.batchProvenance?.[0]?.sourceBatchId).toBe("source");
  });
  it("forwards a physical return without invoking any stock movement API", async () => {
    returnExcess.mockResolvedValue({});
    await httpServices.inventory.returnTransferExcess({ transferId: "one", toLocationId: "l2", returnToLocationId: "l1", quantity: "0.000001", reasonCodeId: "reason", evidence: "Returned", returnedAt: "2026-10-19T08:00:00Z" });
    expect(returnExcess).toHaveBeenCalledWith("one", expect.objectContaining({ quantity: "0.000001", returnToLocationId: "l1" }));
  });

});
