import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createReceipt = vi.fn();
const createSupplier = vi.fn();
let manageSuppliers = true;
let manageUnits = true;
const createPurchaseUnit = vi.fn();
const updatePurchaseUnit = vi.fn();
const deletePurchaseUnit = vi.fn();
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

vi.mock("@/lib/console/services", async () => ({
  ServiceError: (await import("@/lib/console/services/types")).ServiceError,
  services: {
    purchasing: {
      suppliers: { list: async () => ({ rows: supplierRows }), create: (...args: unknown[]) => createSupplier(...args) },
      orders: { list: async () => ({ rows: orderRows }) },
      receipts: { create: (...args: unknown[]) => createReceipt(...args) },
    },
    organisation: { locations: async () => [location] },
    inventory: {
      items: { list: async () => ({ rows: [item] }) },
      unitsOfMeasure: async () => [{id: "unit-base", code: "pc", name: "Piece", dimension: "count"}],
      listPurchaseUnits: (...args: unknown[]) => listPurchaseUnits(...args),
      createPurchaseUnit: (...args: unknown[]) => createPurchaseUnit(...args),
      updatePurchaseUnit: (...args: unknown[]) => updatePurchaseUnit(...args),
      deletePurchaseUnit: (...args: unknown[]) => deletePurchaseUnit(...args),
    },
  },
}));
vi.mock("@/lib/console/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/hooks")>();
  return { ...actual, useBranches: () => [] };
});
vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({ t: (key: string) => key, tx: (value: any) => typeof value === "string" ? value : value?.en ?? "", fmt: { locale: "en", arabicIndicNumerals: false }, locale: "en", dir: "ltr" }),
  usePermission: (permission: string) => permission === "inventory.adjust" ? manageUnits : manageSuppliers,
  useSession: () => ({ scope: { tenantId: "tenant-1" }, canAny: (permissions: string[]) => permissions.includes("inventory.adjust") && manageUnits }),
}));

import { ReceivingDrawer } from "./purchasing-forms";

beforeEach(() => {
  manageUnits = true; manageSuppliers = true; supplierRows = [supplier];
  cleanup(); vi.clearAllMocks(); orderRows = [];
  createReceipt.mockResolvedValue({ id: "receipt-1" });
  listPurchaseUnits.mockResolvedValue([{ id: "unit-case", stockItemId: "item-1", name: "Case 12", conversionFactorToBase: "12", supplierId: null }]);
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

describe("Receiving purchase-unit configuration", () => {
  it("keeps selection explicit and displays real packaging conversion", async () => {
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    await userEvent.type(screen.getByLabelText("pur.received"), "2");
    expect(screen.getByRole("button", { name: "pur.postReceipt" })).toBeDisabled();
    await selectCustom("inv.purchaseUnit", "Case 12");
    expect(screen.getByText("1 Case 12 = 12 pc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pur.postReceipt" })).toBeEnabled();
  });

  it("offers the genuine base unit explicitly even when packaging is empty", async () => {
    listPurchaseUnits.mockResolvedValue([]);
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    expect(screen.getByText("pur.purchaseUnitsEmpty")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("pur.received"), "2.5");
    expect(screen.getByRole("button", { name: "pur.postReceipt" })).toBeDisabled();
    await selectCustom("inv.purchaseUnit", "pc — inv.baseUnit");
    await userEvent.click(screen.getByRole("button", { name: "pur.postReceipt" }));
    await waitFor(() => expect(createReceipt).toHaveBeenCalledWith(expect.objectContaining({lines: [expect.objectContaining({purchaseUnitId: "unit-base", receivedQuantity: "2.5"})]})));
  });

  it("configures packaging from Receiving, reloads options, and preserves receipt entry", async () => {
    listPurchaseUnits.mockResolvedValue([]);
    const unit = {id:"new-pack",stockItemId:item.id,name:"Box 12.5",conversionFactorToBase:"12.5",supplierId:null};
    createPurchaseUnit.mockImplementation(async () => { listPurchaseUnits.mockResolvedValue([unit]); return unit; });
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    await userEvent.type(screen.getByLabelText("pur.received"), "2.500001");
    await userEvent.click(screen.getByRole("button", {name:"pur.managePurchaseUnits"}));
    await userEvent.click(screen.getByRole("button", {name:"inv.addPurchaseUnit"}));
    const form = screen.getByRole("dialog", {name:"inv.addPurchaseUnit"});
    await userEvent.type(within(form).getByLabelText(/common.name/), "Box 12.5");
    await userEvent.type(within(form).getByLabelText(/inv.purchaseUnitConversion/), "12.5");
    await userEvent.click(within(form).getByRole("button", {name:"common.create"}));
    await waitFor(() => expect(createPurchaseUnit).toHaveBeenCalledWith(item.id, {name:"Box 12.5", conversionFactorToBase:"12.5"}));
    await waitFor(() => expect(screen.queryByRole("dialog", {name:"inv.addPurchaseUnit"})).not.toBeInTheDocument());
    const manager = screen.getByRole("dialog", {name:"inv.purchaseUnits · Water"});
    await waitFor(() => expect(within(manager).getByText("Box 12.5")).toBeInTheDocument());
    await userEvent.click(within(manager).getByRole("button", {name:"common.close"}));
    expect(screen.getByLabelText("pur.received")).toHaveValue("2.500001");
    await selectCustom("inv.purchaseUnit", "Box 12.5");
    expect(screen.getByText("1 Box 12.5 = 12.5 pc")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", {name:"pur.postReceipt"}));
    await waitFor(() => expect(createReceipt).toHaveBeenCalledWith(expect.objectContaining({supplierId:"supplier-1",locationId:"location-1",lines:[expect.objectContaining({purchaseUnitId:"new-pack",receivedQuantity:"2.500001"})]})));
  });

  it("does not offer unit mutations without inventory.adjust", async () => {
    manageUnits = false; listPurchaseUnits.mockResolvedValue([]);
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    expect(screen.queryByRole("button", {name:"pur.managePurchaseUnits"})).not.toBeInTheDocument();
    expect(screen.getByText("pur.purchaseUnitsPermission")).toBeInTheDocument();
    expect(createPurchaseUnit).not.toHaveBeenCalled();
  });

  it("surfaces a failed unit lookup instead of fabricating a base-unit selection", async () => {
    listPurchaseUnits.mockRejectedValue(new Error("Purchase-unit lookup unavailable"));
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    expect(await screen.findByText("Purchase-unit lookup unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", {name:"pur.postReceipt"})).toBeDisabled();
    expect(createReceipt).not.toHaveBeenCalled();
  });
});

describe("Receiving purchase-unit edits", () => {
  it("clears a deleted selection without resetting the receipt quantity", async () => {
    deletePurchaseUnit.mockImplementation(async () => {listPurchaseUnits.mockResolvedValue([]);});
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    await selectCustom("inv.purchaseUnit", "Case 12");
    await userEvent.type(screen.getByLabelText("pur.received"), "2");
    await userEvent.click(screen.getByRole("button", {name:"pur.managePurchaseUnits"}));
    await userEvent.click(await screen.findByRole("button", {name:"common.delete"}));
    await waitFor(() => expect(deletePurchaseUnit).toHaveBeenCalledWith(item.id,"unit-case"));
    const manager=screen.getByRole("dialog", {name:"inv.purchaseUnits · Water"});
    await userEvent.click(within(manager).getByRole("button", {name:"common.close"}));
    expect(screen.getByLabelText("pur.received")).toHaveValue("2");
    await waitFor(() => expect(screen.getByRole("button", {name:"pur.postReceipt"})).toBeDisabled());
  });

  it.each(["0", "-1", "1.1234567", "100000000000000", "bad"])("rejects invalid purchase-unit factor %s before sending", async factor => {
    render(<ReceivingDrawer open onClose={vi.fn()} onSaved={vi.fn()} />);
    await selectCustom("pur.addUnorderedItem", "Water");
    await userEvent.click(screen.getByRole("button", {name:"pur.managePurchaseUnits"}));
    await userEvent.click(screen.getByRole("button", {name:"inv.addPurchaseUnit"}));
    const form=screen.getByRole("dialog", {name:"inv.addPurchaseUnit"});
    await userEvent.type(within(form).getByLabelText(/common.name/),"Box");
    await userEvent.type(within(form).getByLabelText(/inv.purchaseUnitConversion/),factor);
    expect(within(form).getByRole("button", {name:"common.create"})).toBeDisabled();
    expect(createPurchaseUnit).not.toHaveBeenCalled();
  });
});
