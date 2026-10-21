import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createReceipt = vi.fn();
const createSupplier = vi.fn();
let manageSuppliers = true;
let supplierRows: any[] = [];
const listPurchaseUnits = vi.fn();
let orderRows: any[] = [];
const item = {
  id: "item-1", tenantId: "tenant-1", sku: "SKU-1", name: { en: "Water", ar: "ماء" },
  baseUnit: "pc", baseUnitId: "unit-base", costingMethod: "weighted_average", batchTracked: false,
  expiryTracked: false, storage: "ambient", shelfLifeDays: null, unitCost: { amount: 100, currency: "EGP" }, active: true,
};
const supplier = { active: true, id: "supplier-1", tradingName: { en: "Supplier", ar: "مورد" } };
const location = { id: "location-1", name: { en: "Main", ar: "الرئيسي" } };

vi.mock("@/lib/console/services", () => ({
  services: {
    purchasing: {
      suppliers: { list: async () => ({ rows: supplierRows }), create: (...args: unknown[]) => createSupplier(...args) },
      orders: { list: async () => ({ rows: orderRows }) },
      receipts: { create: (...args: unknown[]) => createReceipt(...args) },
    },
    organisation: { locations: async () => [location] },
    inventory: {
      items: { list: async () => ({ rows: [item] }) },
      listPurchaseUnits: (...args: unknown[]) => listPurchaseUnits(...args),
    },
  },
}));
vi.mock("@/lib/console/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/hooks")>();
  return { ...actual, useBranches: () => [] };
});
vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({ t: (key: string) => key, tx: (value: any) => typeof value === "string" ? value : value?.en ?? "", fmt: { locale: "en", arabicIndicNumerals: false }, locale: "en", dir: "ltr" }),
  usePermission: () => manageSuppliers,
  useSession: () => ({ scope: { tenantId: "tenant-1" } }),
}));
vi.mock("@/lib/console/actions", () => ({ useAction: () => ({ pending: false, error: null, run: async (fn: () => Promise<unknown>, opts?: { onSuccess?: (result: unknown) => void }) => { const result = await fn(); opts?.onSuccess?.(result); } }) }));

import { ReceivingDrawer } from "./purchasing-forms";

beforeEach(() => {
  manageSuppliers = true; supplierRows = [supplier];
  cleanup(); vi.clearAllMocks(); orderRows = [];
  createReceipt.mockResolvedValue({ id: "receipt-1" });
  listPurchaseUnits.mockResolvedValue([{ id: "unit-base", stockItemId: "item-1", name: "pc", conversionFactorToBase: "1", supplierId: null }, { id: "unit-case", stockItemId: "item-1", name: "Case 12", conversionFactorToBase: "12", supplierId: null }]);
});

async function selectCustom(label: string, option: string) {
  const field = screen.getByText(label).parentElement!;
  await userEvent.click(within(field).getByRole("button"));
  await userEvent.click(screen.getByRole("option", { name: option }));
}

describe("Goods receipt entry", () => {
  it("creates a direct receipt with selected item purchase unit, exact quantities and dates", async () => {
    const user = userEvent.setup();
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    await waitFor(() => expect(listPurchaseUnits).toHaveBeenCalledWith("item-1"));
    await selectCustom("inv.purchaseUnit", "Case 12");
    await user.type(screen.getByLabelText("pur.received"), "2.500001");
    await user.click(screen.getByRole("button", { name: "pur.postReceipt" }));
    await waitFor(() => expect(createReceipt).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "supplier-1", locationId: "location-1",
      lines: [expect.objectContaining({ stockItemId: "item-1", purchaseUnitId: "unit-case", receivedQuantity: "2.500001", rejectedQuantity: "0", unitPrice: "100" })],
    })));
  });

  it("submits a PO-linked line with its immutable PO line and purchase unit identity", async () => {
    orderRows = [{
      id: "po-1", reference: "PO-1", supplierId: "supplier-1", supplierName: supplier.tradingName,
      deliveryLocationId: "location-1", deliveryLocationName: location.name, status: "approved",
      lines: [{ id: "po-line-1", itemId: "item-1", itemName: item.name, purchaseUnitId: "unit-case", purchaseUnitLabel: "Case 12", quantity: { value: "5", unit: "pc" }, receivedQuantity: { value: "0", unit: "pc" }, unitPrice: { amount: 1200, currency: "EGP" } }],
    }];
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.againstOrder", "PO-1 · Supplier");
    await waitFor(() => expect(screen.getByDisplayValue("Case 12")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "pur.postReceipt" }));
    await waitFor(() => expect(createReceipt).toHaveBeenCalledWith(expect.objectContaining({
      purchaseOrderId: "po-1",
      lines: [expect.objectContaining({ purchaseOrderLineId: "po-line-1", stockItemId: "item-1", purchaseUnitId: "unit-case" })],
    })));
  });

  it("keeps submission disabled for zero and malformed receipt quantities", async () => {
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    const quantity = screen.getByLabelText("pur.received");
    await userEvent.type(quantity, "0");
    expect(screen.getByRole("button", { name: "pur.postReceipt" })).toHaveProperty("disabled", true);
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "1.1234567");
    expect(screen.getByRole("button", { name: "pur.postReceipt" })).toHaveProperty("disabled", true);
    expect(createReceipt).not.toHaveBeenCalled();
  });
  it("creates a supplier inside Receiving, selects it and preserves entered receipt lines", async () => {
    const created = { ...supplier, id: "supplier-new", tradingName: { en: "New supplier", ar: "" } };
    createSupplier.mockImplementation(async () => { supplierRows = [supplier, created]; return created; });
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    await userEvent.type(screen.getByLabelText("pur.received"), "2.5");
    await userEvent.click(screen.getByRole("button", { name: "pur.addSupplier" }));
    await userEvent.type(screen.getByLabelText("common.code"), "SYNTH");
    await userEvent.type(screen.getByLabelText("pur.legalName"), "New supplier");
    await userEvent.click(screen.getByRole("button", { name: "common.create" }));
    await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText("common.code")).not.toBeInTheDocument());
    expect(screen.getByLabelText("pur.received")).toHaveValue("2.5");
    await waitFor(() => expect(screen.getByLabelText(/pur.supplier/)).toHaveTextContent("New supplier"));
  });
  it("does not offer Add supplier without supplier.manage", async () => {
    manageSuppliers = false;
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "pur.addSupplier" })).not.toBeInTheDocument();
  });
  it("excludes inactive suppliers from new receipts", async () => {
    supplierRows = [{ ...supplier, active: false, tradingName: { en: "Inactive supplier" } }];
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/pur.supplier/));
    expect(screen.queryByRole("option", { name: "Inactive supplier" })).not.toBeInTheDocument();
  });

});
