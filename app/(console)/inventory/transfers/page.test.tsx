import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const transfersList = vi.fn();
const transferGet = vi.fn();
const dispatchTransfer = vi.fn();
const dispatchTransferLines = vi.fn();
const receiveTransfer = vi.fn();
const investigateTransfer = vi.fn();
const returnTransferExcess = vi.fn();
const reasons = vi.fn();

vi.mock("@/lib/console/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/services")>();
  return {
    ServiceError: actual.ServiceError,
    services: {
      organisation: { locations: async () => [
        { id: "loc-a", name: { en: "North" } },
        { id: "loc-b", name: { en: "South" } },
      ] },
      inventory: {
        transfers: {
          list: (...args: unknown[]) => transfersList(...args),
          get: (...args: unknown[]) => transferGet(...args),
          dispatch: (...args: unknown[]) => dispatchTransfer(...args),
          create: (...args: unknown[]) => dispatchTransfer(...args),
        },
        items: { list: async () => ({ rows: [{ id: "item-1", name: { en: "Beans" } }, { id: "item-2", name: { en: "Rice" } }], total: 2 }) },
        receiveTransfer: (...args: unknown[]) => receiveTransfer(...args),
        investigateTransfer: (...args: unknown[]) => investigateTransfer(...args),
        returnTransferExcess: (...args: unknown[]) => returnTransferExcess(...args),
        dispatchTransferLines: (...args: unknown[]) => dispatchTransferLines(...args),
        reasonCodes: (...args: unknown[]) => reasons(...args),
      },
    },
  };
});

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) => typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({ scope: { tenantId: "t1", brandId: null, branchId: null }, canAny: () => true }),
  usePermission: () => true,
}));

vi.mock("@/lib/api/config", () => ({ DATA_MODE: "http" }));

import TransfersPage from "./page";

const transfer = {
  id: "transfer-1",
  transferReferenceId: "transfer-1",
  reference: "TR-1",
  status: "in_transit",
  fromLocationId: "loc-a",
  fromLocationName: "North",
  toLocationId: "loc-b",
  toLocationName: "South",
  requestedBy: "operator-1",
  dispatchedAt: "2026-10-18T10:00:00Z",
  receivedAt: null,
  discrepancyEvidence: null,
  discrepancyReasonCodeId: null,
  approvalRequestId: null,
  totalValue: { amount: 120, currency: "EGP" },
  receipts: [],
  approvalHistory: [],
  lines: [{
    id: "line-1", itemId: "item-1", itemName: "Beans", dispatched: { value: "10", unit: "kg" },
    received: null, discrepancy: 0, inTransit: { value: "10", unit: "kg" },
    physicallyHeld: { value: "0", unit: "kg" }, available: { value: "0", unit: "kg" },
    unitCost: { amount: 12, currency: "EGP" },
  }],
};

beforeEach(() => {
  transfersList.mockResolvedValue({ rows: [transfer], total: 1 });
  transferGet.mockResolvedValue(transfer);
  dispatchTransfer.mockResolvedValue(transfer);
  dispatchTransferLines.mockResolvedValue([transfer, { ...transfer, id: "transfer-2" }]);
  receiveTransfer.mockResolvedValue(transfer);
  investigateTransfer.mockResolvedValue(transfer);
  returnTransferExcess.mockResolvedValue(undefined);
  reasons.mockResolvedValue([{ id: "reason-1", code: "short", label: { en: "Shortage" } }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Inventory Transfers screen", () => {
  it("lists the server transfer and opens a detail view with in-transit quantity", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(await screen.findByText("TR-1"));

    expect(transfersList).toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("inv.inTransit")).toBeInTheDocument();
    expect(within(dialog).getAllByText("10 kg").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText("inv.availableAfterReceipt")).toBeInTheDocument();
    expect(within(dialog).getAllByText("0 kg").length).toBeGreaterThanOrEqual(1);
  });

  it("shows pending discrepancy custody and evidence without an available receipt action", async () => {
    transfersList.mockResolvedValue({
      rows: [{ ...transfer, status: "pending_investigation", discrepancyEvidence: "Counted at receiving bay", approvalRequestId: "approval-1", lines: [{ ...transfer.lines[0], received: { value: "9", unit: "kg" }, discrepancy: -1, inTransit: { value: "0", unit: "kg" }, physicallyHeld: { value: "9", unit: "kg" } }] }], total: 1,
    });
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(await screen.findByText("TR-1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("inv.pendingInvestigation")).toBeInTheDocument();
    expect(within(dialog).getByText("Counted at receiving bay")).toBeInTheDocument();
    expect(within(dialog).getAllByText("9 kg").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).queryByRole("button", { name: "inv.receiveTransfer" })).not.toBeInTheDocument();
  });

  it("submits a receipt against the selected transfer and refreshes its readback", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(await screen.findByText("TR-1"));
    const detail = await screen.findByRole("dialog");
    await user.click(within(detail).getByRole("button", { name: "inv.receiveTransfer" }));
    const receiveDialog = await screen.findByRole("dialog", { name: "inv.receiveTransfer" });
    await user.click(within(receiveDialog).getByRole("button", { name: "inv.receiveTransfer" }));

    await waitFor(() => expect(receiveTransfer).toHaveBeenCalledWith(expect.objectContaining({
      transferReferenceId: "transfer-1", toLocationId: "loc-b", receivedQuantity: "10", isFinal: true,
    })));
    expect(transferGet).toHaveBeenCalledWith("transfer-1");
  });

  it("dispatches a new transfer from the selected source to destination", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(await screen.findByRole("button", { name: "common.new" }));
    const dialog = await screen.findByRole("dialog", { name: "inv.newTransfer" });
    const itemPicker = within(dialog).getByRole("button", { name: /inv\.item/ });
    await user.click(itemPicker);
    await user.click(await screen.findByRole("option", { name: "Beans" }));
    await user.type(within(dialog).getByLabelText(/inv.quantity/), "3.25");
    await user.click(within(dialog).getByRole("button", { name: "inv.dispatch" }));

    await waitFor(() => expect(dispatchTransfer).toHaveBeenCalledWith(expect.objectContaining({
      fromLocationId: "loc-a",
      toLocationId: "loc-b",
      lines: [expect.objectContaining({ itemId: "item-1", dispatched: { value: "3.25", unit: "pc" } })],
    })));
  });

  it("records a recount with evidence and resubmits a rejected discrepancy", async () => {
    transfersList.mockResolvedValue({ rows: [{
      ...transfer,
      status: "pending_investigation",
      approvalRequestId: null,
      discrepancyReasonCodeId: "reason-1",
      discrepancyEvidence: "Manager requested recount",
      lines: [{ ...transfer.lines[0], received: { value: "9", unit: "kg" }, discrepancy: -1, inTransit: { value: "0", unit: "kg" }, physicallyHeld: { value: "9", unit: "kg" } }],
    }], total: 1 });
    const user = userEvent.setup();
    render(<TransfersPage />);

    await user.click(await screen.findByText("TR-1"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /inv\.reason/ }));
    await user.click(await screen.findByRole("option", { name: "Shortage" }));
    const recount = within(dialog).getByLabelText("inv.recountedQuantity");
    await user.clear(recount);
    await user.type(recount, "8");
    const evidence = within(dialog).getByLabelText(/inv\.investigationEvidence/);
    await user.clear(evidence);
    await user.type(evidence, "Independent recount: eight units.");
    await user.click(within(dialog).getByRole("button", { name: "inv.transferSubmitInvestigation" }));

    await waitFor(() => expect(investigateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      transferId: "transfer-1", discrepancyReasonCodeId: "reason-1", recountedQuantity: "8", evidence: "Independent recount: eight units.",
    })));
  });
  it("requires matching physical totals for every source lot before submitting a multi-lot shortage", async () => {
    transfersList.mockResolvedValue({ rows: [{ ...transfer, batchProvenance: [
      { sourceBatchId: "lot-1", batchNumber: "ONE", quantity: "5" },
      { sourceBatchId: "lot-2", batchNumber: "TWO", quantity: "5" },
    ] }], total: 1 });
    const user = userEvent.setup();
    render(<TransfersPage />);
    await user.click(await screen.findByText("TR-1"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "inv.receiveTransfer" }));
    const dialog = await screen.findByRole("dialog", { name: "inv.receiveTransfer" });
    const received = within(dialog).getByLabelText(/inv.received/);
    await user.clear(received);
    await user.type(received, "8");
    const submit = within(dialog).getByRole("button", { name: "inv.receiveTransfer" });
    expect(submit).toBeDisabled();
    for (const lot of ["ONE", "TWO"]) {
      const field = within(dialog).getByLabelText(new RegExp(`inv.lotReceived.*${lot}`));
      await user.clear(field);
      await user.type(field, "4");
    }
    await user.click(within(dialog).getByRole("button", { name: /inv.reason/ }));
    await user.click(await screen.findByRole("option", { name: "Shortage" }));
    await user.type(within(dialog).getByLabelText(/inv.investigationEvidence/), "Two lots counted separately.");
    await user.click(submit);
    await waitFor(() => expect(receiveTransfer).toHaveBeenCalledWith(expect.objectContaining({
      receivedQuantity: "8", lotCounts: [{ sourceBatchId: "lot-1", receivedQuantity: "4" }, { sourceBatchId: "lot-2", receivedQuantity: "4" }],
    })));
  });

  it("records an authorized physical excess return with quantity, reason and evidence", async () => {
    transfersList.mockResolvedValue({ rows: [{ ...transfer, status: "excess_held", lines: [{ ...transfer.lines[0], received: { value: "12", unit: "kg" }, physicallyHeld: { value: "2", unit: "kg" }, available: { value: "10", unit: "kg" }, unresolved: { value: "2", unit: "kg" } }] }], total: 1 });
    const user = userEvent.setup();
    render(<TransfersPage />);
    await user.click(await screen.findByText("TR-1"));
    const dialog = await screen.findByRole("dialog");
    const quantity = within(dialog).getByLabelText(/inv.returnQuantity/);
    await user.clear(quantity);
    await user.type(quantity, "3");
    expect(within(dialog).getByRole("button", { name: "inv.recordPhysicalReturn" })).toBeDisabled();
    await user.clear(quantity);
    await user.type(quantity, "0.5");
    await user.click(within(dialog).getByRole("button", { name: /inv.reason/ }));
    await user.click(await screen.findByRole("option", { name: "Shortage" }));
    await user.type(within(dialog).getByLabelText(/inv.investigationEvidence/), "Sender confirmed physical return.");
    await user.click(within(dialog).getByRole("button", { name: "inv.recordPhysicalReturn" }));
    await waitFor(() => expect(returnTransferExcess).toHaveBeenCalledWith(expect.objectContaining({
      transferId: "transfer-1", toLocationId: "loc-b", returnToLocationId: "loc-a", quantity: "0.5", reasonCodeId: "reason-1", evidence: "Sender confirmed physical return.", returnedAt: expect.any(String),
    })));
  });

  it("dispatches all additional item lines through the atomic grouped endpoint", async () => {
    const user = userEvent.setup();
    render(<TransfersPage />);
    await user.click(await screen.findByRole("button", { name: "common.new" }));
    const dialog = await screen.findByRole("dialog", { name: "inv.newTransfer" });
    await user.click(within(dialog).getByRole("button", { name: /inv.item/ }));
    await user.click(await screen.findByRole("option", { name: "Beans" }));
    await user.type(within(dialog).getByLabelText(/inv.quantity/), "1.25");
    await user.click(within(dialog).getByRole("button", { name: "inv.addTransferLine" }));
    await user.click(within(dialog).getByRole("button", { name: /inv.item 2/ }));
    await user.click(await screen.findByRole("option", { name: "Rice" }));
    await user.type(within(dialog).getByLabelText(/inv.quantity 2/), "2.5");
    await user.click(within(dialog).getByRole("button", { name: "inv.dispatch" }));
    await waitFor(() => expect(dispatchTransferLines).toHaveBeenCalledWith({
      fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ stockItemId: "item-1", quantity: "1.25" }, { stockItemId: "item-2", quantity: "2.5" }],
    }));
    expect(dispatchTransfer).not.toHaveBeenCalled();
  });

});
