import { beforeEach, describe, expect, it, vi } from "vitest";

const listGoodsReceipts = vi.fn();
const postGoodsReceipts = vi.fn();
const listPurchaseOrders = vi.fn();
const listSuppliers = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
const listWarehouses = vi.fn();
const listCentralKitchens = vi.fn();

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    procurement: {
      listGoodsReceipts: (...args: unknown[]) => listGoodsReceipts(...args),
      postGoodsReceipts: (...args: unknown[]) => postGoodsReceipts(...args),
      listPurchaseOrders: (...args: unknown[]) => listPurchaseOrders(...args),
      listSuppliers: (...args: unknown[]) => listSuppliers(...args),
    },
    inventory: { listItems: (...args: unknown[]) => listItems(...args) },
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
const response = {
  id: "receipt-1", reference: "GRN-1", status: "posted" as const,
  purchaseOrderId: null, purchaseOrderReference: null, supplierId: "supplier-1", supplierName: "Supplier",
  locationId: "location-1", receivedAt: "2026-10-18T10:00:00.000Z", receivedBy: "user-1", currency: "EGP",
  temperatureC: null, temperatureOk: true,
  lines: [{ id: "line-1", purchaseOrderLineId: null, orderedQuantity: "0", stockItemId: "item-1", purchaseUnitId: "unit-1", purchaseUnitLabel: "Case 12", purchaseUnitConversionFactor: "12", receivedQuantity: "2.5", acceptedQuantity: "2", rejectedQuantity: "0.5", acceptedBaseQuantity: "24", unitPrice: "1200", unitCostMinor: "100", rejectionReason: "damaged", batchNumber: "B1", productionDate: null, expiryDate: "2027-01-01", batchId: "batch-1", movementId: "movement-1" }],
};

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  listGoodsReceipts.mockResolvedValue([response]);
  postGoodsReceipts.mockResolvedValue(response);
  listPurchaseOrders.mockResolvedValue([{
    id: "po-1", supplierId: "supplier-1", deliveryLocationId: "location-1", requestedBy: "user-1",
    expectedDeliveryDate: "2026-10-20T00:00:00.000Z", approvalBand: "auto", currency: "EGP",
    subtotal: "100000", taxTotal: "0", grandTotal: "100000",
    lines: [{
      id: "po-line-1", stockItemId: "item-1", purchaseUnitId: "unit-1", purchaseUnitLabel: "Case 12",
      purchaseUnitConversionFactor: "12", quantity: "100", orderedBaseQuantity: "1200.000000",
      acceptedBaseReceivedQuantity: "1080.000000", remainingBaseQuantity: "120.000000",
      unitPrice: "1000", lineTotal: "100000",
    }],
  }]);
  listSuppliers.mockResolvedValue([{ id: "supplier-1", code: "S1", legalName: "Supplier", tradingName: "Supplier", contacts: [], currency: "EGP", deliveryDays: [], status: "active", paymentTermsNetDays: 0, deliveryLeadTimeDays: 0, minimumOrderValue: "0" }]);
  listItems.mockResolvedValue([]); listLocations.mockResolvedValue([]); listBranches.mockResolvedValue([]);
  listWarehouses.mockResolvedValue([]); listCentralKitchens.mockResolvedValue([]);
  ({ httpServices } = await import("./http"));
});

describe("Goods receipts HTTP service", () => {
  it("serializes direct receipt inputs as precise decimal strings and maps readback", async () => {
    const result = await httpServices.purchasing.receipts.create({
      supplierId: "supplier-1", locationId: "location-1", temperatureC: "4.5", temperatureOk: true,
      lines: [{ stockItemId: "item-1", purchaseUnitId: "unit-1", receivedQuantity: "2.500001", rejectedQuantity: "0.5", unitPrice: "1200", batchNumber: "B1", expiryDate: "2027-01-01", rejectionReason: "damaged" }],
    });
    expect(postGoodsReceipts).toHaveBeenCalledWith({
      supplierId: "supplier-1", locationId: "location-1", temperatureC: "4.5", temperatureOk: true,
      lines: [{ stockItemId: "item-1", purchaseUnitId: "unit-1", receivedQuantity: "2.500001", rejectedQuantity: "0.5", unitPrice: "1200", batchNumber: "B1", expiryDate: "2027-01-01", rejectionReason: "damaged" }],
    });
    expect(result.lines[0]).toMatchObject({ itemId: "item-1", purchaseUnitId: "unit-1", purchaseUnitLabel: "Case 12", received: { value: "2.5" }, rejected: { value: "0.5" }, batchNumber: "B1", expiryDate: "2027-01-01" });
    expect(result.id).toBe("receipt-1");
  });

  it("reads posted receipts from the real API, including movement and batch-backed receipt ids", async () => {
    const page = await httpServices.purchasing.receipts.list();
    expect(listGoodsReceipts).toHaveBeenCalledOnce();
    expect(page.rows[0]?.lines[0]?.received.value).toBe("2.5");
  });

  it("maps PO remaining quantity from accepted base units, not physical rejected quantity", async () => {
    const page = await httpServices.purchasing.orders.list();
    expect(listPurchaseOrders).toHaveBeenCalledOnce();
    expect(listGoodsReceipts).not.toHaveBeenCalled();
    expect(page.rows[0]?.lines[0]).toMatchObject({
      quantity: { value: "100" },
      receivedQuantity: { value: "90" },
      purchaseUnitLabel: "Case 12",
    });
  });
});
