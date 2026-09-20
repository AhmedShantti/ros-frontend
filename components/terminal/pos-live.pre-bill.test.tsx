import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

/*
 * POS-DINEIN-PREBILL-PRINT-P0 — SRS UC-POS-01: "Customer requests bill.
 * Waiter prints the pre-bill (non-fiscal)." Payment begins only afterward.
 *
 * Proves: the "Print bill" action is reachable on an active order before
 * payment, never initiates payment, always fresh-fetches
 * (`services.sales.preBill`, never a cached/local order), renders the real
 * current lines/totals and a human-readable table label, is explicitly
 * marked non-fiscal, and never marks the order completed. Also proves the
 * existing payment flow and the final receipt (now carrying the same table
 * label) both still work afterward, and that takeaway is unaffected.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/api/auth`. The REAL `@/lib/api/session.ts` runs against jsdom's
 * `localStorage`. Same pattern as `pos-live.test.tsx`.
 */

const {
  MockServiceError,
  getCurrentSession,
  listSessionDrawers,
  tables,
  openOrder,
  capturePayment,
  salesReceipt,
  salesPreBill,
  ordersGet,
} = vi.hoisted(() => {
  class MockServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    MockServiceError,
    getCurrentSession: vi.fn(),
    listSessionDrawers: vi.fn(),
    tables: vi.fn(),
    openOrder: vi.fn(),
    capturePayment: vi.fn(),
    salesReceipt: vi.fn(),
    salesPreBill: vi.fn(),
    ordersGet: vi.fn(),
  };
});

vi.mock("@/lib/console/services", () => ({
  services: {
    treasury: {
      getCurrentSession: (...args: unknown[]) => getCurrentSession(...args),
      listSessionDrawers: (...args: unknown[]) => listSessionDrawers(...args),
    },
    operations: {
      tables: (...args: unknown[]) => tables(...args),
    },
    sales: {
      mutations: {
        open: (...args: unknown[]) => openOrder(...args),
        capturePayment: (...args: unknown[]) => capturePayment(...args),
      },
      orders: { get: (...args: unknown[]) => ordersGet(...args) },
      receipt: (...args: unknown[]) => salesReceipt(...args),
      preBill: (...args: unknown[]) => salesPreBill(...args),
    },
  },
  ServiceError: MockServiceError,
}));

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) =>
      typeof value === "string" ? value : ((value as { en?: string })?.en ?? ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
  useSession: () => ({
    scope: { tenantId: "tenant-1", brandId: null, branchId: "branch-1" },
    can: () => false,
  }),
}));

vi.mock("@/lib/api/auth", () => ({
  signInWithPin: vi.fn(),
  signOffTerminal: vi.fn(),
}));

import { signInWithPin } from "@/lib/api/auth";
import * as Session from "@/lib/api/session";
import type { Order } from "@/lib/console/types";
import { LivePos } from "./pos-live";

const BRANCH_ID = "branch-1";
const TENANT_ID = "tenant-1";
const ONE_DRAWER = [{ id: "drawer-1", branchId: BRANCH_ID, name: "Front drawer", terminalId: null, isActive: true }];

const money = (amount: number) => ({ amount, currency: "EGP" as const });

function seedDevice() {
  Session.setActiveSurface("pos");
  Session.setActiveBranchId(BRANCH_ID);
  Session.setTenantId(TENANT_ID);
}

function signOnAs(code: string, name = code) {
  vi.mocked(signInWithPin).mockImplementation(async (input) => {
    Session.setTokens({ accessToken: `tok-${input.employeeCode}`, refreshToken: "ref", expiresIn: 900 });
    Session.setTenantId(input.tenantId);
    Session.setPosEmployee({ code: input.employeeCode, name, sessionType: input.sessionType });
  });
  return code;
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    branchName: { en: "Front Branch", ar: "الفرع" },
    terminalId: "terminal-1",
    terminalName: "Front Till",
    orderNumber: "ORD-1",
    businessDay: "2026-09-20",
    orderType: "dine_in",
    channel: "pos",
    state: "open",
    tableId: "table-1",
    tableLabel: null,
    guestCount: 4,
    customerId: null,
    customerName: null,
    openedBy: "emp-1",
    openedByName: { en: "Amina", ar: "أمينة" },
    servedByName: null,
    currency: "EGP",
    subtotal: money(10000),
    discountTotal: money(0),
    serviceChargeTotal: money(0),
    taxTotal: money(0),
    roundingAdjustment: money(0),
    grandTotal: money(10000),
    paidTotal: money(0),
    tipTotal: money(0),
    cogsTotal: money(0),
    lines: [
      {
        id: "line-1",
        sequence: 1,
        menuItemId: "item-1",
        variantId: "variant-1",
        itemNameSnapshot: { en: "Burger", ar: "برجر" },
        quantity: 1,
        unitPrice: money(10000),
        modifiers: [],
        modifierTotal: money(0),
        lineDiscount: money(0),
        lineSubtotal: money(10000),
        taxAmount: money(0),
        lineTotal: money(10000),
        unitCostSnapshot: money(0),
        recipeVersionId: null,
        course: 1,
        seatNumber: null,
        state: "pending",
        stationId: null,
        firedAt: null,
        readyAt: null,
        voidReason: null,
        isComp: false,
        notes: null,
      },
    ],
    payments: [],
    discounts: [],
    openedAt: "2026-09-20T10:00:00Z",
    firstFiredAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    syncState: "synced",
    syncedAt: "2026-09-20T10:00:00Z",
    aggregatorRef: null,
    notes: null,
    version: 1,
    ...overrides,
  };
}

function preBillFixture(order: Order) {
  return {
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    currency: order.currency,
    state: order.state as "draft" | "open" | "held" | "parked" | "partially_paid",
    openedAt: order.openedAt,
    tableId: order.tableId,
    guestCount: order.guestCount,
    tableLabel: "T07",
    lines: [
      {
        menuItemId: "item-1",
        name: { en: "Burger", ar: "برجر" },
        quantity: 1,
        unitPrice: money(10000),
        modifiers: [],
        modifierTotal: money(0),
        lineDiscount: money(0),
        lineSubtotal: money(10000),
        taxAmount: money(0),
        lineTotal: money(10000),
      },
    ],
    payments: [],
    totals: {
      subtotal: money(10000),
      discountTotal: money(0),
      taxTotal: money(0),
      serviceChargeTotal: money(0),
      tipTotal: money(0),
      cashRoundingAdjustment: money(0),
      grandTotal: money(10000),
      paidTotal: money(0),
    },
    taxPresentation: "NOT_APPLICABLE" as const,
  };
}

function receiptFixture(order: Order, tableLabel: string | null) {
  return {
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    currency: order.currency,
    completedAt: "2026-09-20T12:00:00Z",
    tableId: order.tableId,
    guestCount: order.guestCount,
    tableLabel,
    lines: [
      {
        menuItemId: "item-1",
        name: { en: "Burger", ar: "برجر" },
        quantity: 1,
        unitPrice: money(10000),
        modifiers: [],
        modifierTotal: money(0),
        lineDiscount: money(0),
        lineSubtotal: money(10000),
        taxAmount: money(0),
        lineTotal: money(10000),
      },
    ],
    payments: [
      {
        id: "pay-1",
        tender: "cash" as const,
        amount: money(10000),
        processedAt: "2026-09-20T12:00:00Z",
        cardLast4: null,
        changeGiven: money(0),
        tenderedAmount: money(10000),
      },
    ],
    totals: {
      subtotal: money(10000),
      discountTotal: money(0),
      taxTotal: money(0),
      serviceChargeTotal: money(0),
      tipTotal: money(0),
      cashRoundingAdjustment: money(0),
      grandTotal: money(10000),
      paidTotal: money(10000),
    },
    taxPresentation: "NOT_APPLICABLE" as const,
  };
}

/** Signs a cashier on, resumes an open shift, and opens the fixture order. */
async function enterPosWithOrder(order: Order) {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();

  getCurrentSession.mockResolvedValue({
    cashSessionId: "cs-1",
    shiftId: "sh-1",
    drawerId: "drawer-1",
    status: "open",
  });
  openOrder.mockResolvedValue(order);

  signOnAs("EMP01", "Amina");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
  Session.setPosEmployee({ code: "EMP01", name: "Amina" });

  render(<LivePos />);

  const openButton = await screen.findByRole("button", { name: "pos.openOrder" });
  await waitFor(() => expect(openButton).toBeEnabled());
  await user.click(openButton);
  await waitFor(() => expect(screen.getByText(order.orderNumber)).toBeInTheDocument());

  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  tables.mockResolvedValue({ rows: [], total: 0 });
  listSessionDrawers.mockResolvedValue(ONE_DRAWER);
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LivePos — Print bill (POS-DINEIN-PREBILL-PRINT-P0)", () => {
  it("1. a dine-in active order exposes Print bill before payment", async () => {
    const order = makeOrder();
    await enterPosWithOrder(order);

    expect(screen.getByRole("button", { name: "pos.printBill" })).toBeInTheDocument();
    // The payment button is a SEPARATE, unaffected action.
    expect(screen.getByRole("button", { name: "pos.pay" })).toBeInTheDocument();
  });

  it("2. Print bill does NOT initiate payment — capturePayment is never called", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    await screen.findByRole("dialog");

    expect(capturePayment).not.toHaveBeenCalled();
  });

  it("3. Print bill fresh-fetches the current pre-bill from the server, never a cached/local order", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));

    await waitFor(() =>
      expect(salesPreBill).toHaveBeenCalledWith(order.businessDay, order.id),
    );
  });

  it("4. the pre-bill shows the real current order lines and totals from the server response", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText(/Burger/)).toBeInTheDocument();
    expect(dialog.textContent).toContain(order.orderNumber);
  });

  it("5. the pre-bill shows a human-readable table label, never the opaque tableId", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.textContent).toContain("T07");
    expect(dialog.textContent).not.toContain(order.tableId);
  });

  it("6. the pre-bill is explicitly marked non-fiscal", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.textContent).toContain("pos.preBillTitle");
    expect(dialog.textContent).toContain("pos.preBillNonFiscalNotice");
  });

  it("7/8. printing the pre-bill never marks the order completed and issues no mutating call at all", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    await screen.findByRole("dialog");

    // Still shows the order as open, on-screen, behind the dialog (appears
    // both in the background pane and inside the pre-bill dialog itself).
    expect(screen.getAllByText(order.orderNumber).length).toBeGreaterThan(0);
    expect(capturePayment).not.toHaveBeenCalled();
    expect(openOrder).toHaveBeenCalledTimes(1); // only the original Open — nothing else
  });

  it("hides Print bill once the order is completed (the real receipt exists instead)", async () => {
    const order = makeOrder({ state: "completed", paidTotal: money(10000) });
    await enterPosWithOrder(order);

    expect(screen.queryByRole("button", { name: "pos.printBill" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pos.viewReceipt" })).toBeInTheDocument();
  });

  it("9. the final payment flow still works after printing the pre-bill", async () => {
    const order = makeOrder();
    salesPreBill.mockResolvedValue(preBillFixture(order));
    capturePayment.mockResolvedValue(makeOrder({ state: "completed", paidTotal: money(10000) }));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    const dialog = await screen.findByRole("dialog");
    // Two elements share the "common.close" accessible name (the header's
    // icon-only X and the footer's text button) — the header one is first.
    await user.click(within(dialog).getAllByRole("button", { name: "common.close" })[0]!);

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("10. the final dine-in receipt includes the resolved table label", async () => {
    const order = makeOrder({ state: "completed", paidTotal: money(10000) });
    salesReceipt.mockResolvedValue(receiptFixture(order, "T07"));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.viewReceipt" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(salesReceipt).toHaveBeenCalledWith(order.businessDay, order.id));

    expect(dialog.textContent).toContain("T07");
  });

  it("a takeaway final receipt shows no table line at all (tableLabel null)", async () => {
    const order = makeOrder({ orderType: "takeaway", tableId: null, state: "completed", paidTotal: money(10000) });
    salesReceipt.mockResolvedValue(receiptFixture(order, null));
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.viewReceipt" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(salesReceipt).toHaveBeenCalledWith(order.businessDay, order.id));

    expect(dialog.textContent).not.toContain("pos.tableLabel");
  });

  it("11. takeaway Print bill still works — flow is not broken by the dine-in table label logic", async () => {
    const order = makeOrder({ orderType: "takeaway", tableId: null, guestCount: null });
    salesPreBill.mockResolvedValue({ ...preBillFixture(order), tableId: null, tableLabel: null, guestCount: null });
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.printBill" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(salesPreBill).toHaveBeenCalledWith(order.businessDay, order.id),
    );
    expect(dialog.textContent).not.toContain("pos.tableLabel");
  });
});
