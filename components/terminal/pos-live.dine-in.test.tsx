import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

/*
 * DINE-IN-TABLE-SELECTOR-RESUME-P0 (supersedes POS-SAFE-TABLES-DINEIN-P0's
 * "pick a table, then press Open order" flow, which posted a direct
 * `POST /orders` — the path that used to create a second order on an
 * already-occupied table).
 *
 * Driven through the real `LivePos` tree, mocked only at the transport
 * boundary (`@/lib/console/services`, `@/lib/api/auth`); the REAL
 * `@/lib/api/session.ts` runs against jsdom's `localStorage`. Proves:
 *
 *   - Dine-In shows the branch's real tables from `GET /orders/tables`, each
 *     as Available / Occupied / Conflict, with capacity;
 *   - Occupied stays selectable (that is how the operator resumes);
 *     Conflict (ambiguous) is a visible problem and never opens anything;
 *   - a tap is exactly ONE `selectTable` (`POST /orders/tables/:id/select`)
 *     for available and occupied alike — the client never decides
 *     create-vs-resume and never calls the direct `mutations.open`;
 *   - created and resumed both open the order the backend returned, with its
 *     real lines; 409 ambiguous / 403 / 404 / network failures show a truthful
 *     localized message, keep the operator on the table surface, and create
 *     no local order;
 *   - a double-tap while the request is in flight sends ONE request;
 *   - Takeaway is untouched: no table read, no table select, ordinary create;
 *   - nothing on the Cashier path reads the BRANCH_READ-gated
 *     `services.operations.tables` (`/org/branches/{id}/tables`).
 */

const { getCurrentSession, listSessionDrawers, tables, selectTable, openOrder, operationsTables, getPosMenu } =
  vi.hoisted(() => ({
    getCurrentSession: vi.fn(),
    listSessionDrawers: vi.fn(),
    tables: vi.fn(),
    selectTable: vi.fn(),
    openOrder: vi.fn(),
    operationsTables: vi.fn(),
    getPosMenu: vi.fn(),
  }));

vi.mock("@/lib/console/services", () => ({
  services: {
    treasury: {
      getCurrentSession: (...args: unknown[]) => getCurrentSession(...args),
      listSessionDrawers: (...args: unknown[]) => listSessionDrawers(...args),
    },
    operations: {
      tables: (...args: unknown[]) => operationsTables(...args),
    },
    sales: {
      tables: (...args: unknown[]) => tables(...args),
      selectTable: (...args: unknown[]) => selectTable(...args),
      mutations: { open: (...args: unknown[]) => openOrder(...args) },
    },
  },
  ServiceError: class ServiceError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    catalogue: {
      getPosMenu: (...args: unknown[]) => getPosMenu(...args),
    },
  },
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
import { ServiceError } from "@/lib/console/services";
import type { PosTable } from "@/lib/console/services/types";
import type { Order, OrderLine } from "@/lib/console/types";
import { LivePos } from "./pos-live";

const BRANCH_ID = "branch-1";
const TENANT_ID = "tenant-1";
const ONE_DRAWER = [
  { id: "drawer-1", branchId: BRANCH_ID, name: "Front drawer", terminalId: null, isActive: true },
];

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

const money = (amount: number) => ({ amount, currency: "EGP" as const });

function makeLine(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    id: "line-burger",
    sequence: 1,
    menuItemId: "item-1",
    variantId: "variant-1",
    itemNameSnapshot: { en: "Burger", ar: "برجر" },
    quantity: 2,
    unitPrice: money(10000),
    modifiers: [],
    modifierTotal: money(0),
    lineDiscount: money(0),
    lineSubtotal: money(20000),
    taxAmount: money(0),
    lineTotal: money(20000),
    unitCostSnapshot: money(0),
    recipeVersionId: null,
    course: 1,
    seatNumber: null,
    state: "fired",
    stationId: null,
    firedAt: "2026-09-19T10:05:00Z",
    readyAt: null,
    voidReason: null,
    isComp: false,
    notes: null,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-perm-10",
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    branchName: { en: "Front Branch", ar: "الفرع" },
    terminalId: "terminal-1",
    terminalName: "Front Till",
    orderNumber: "MAIN-10",
    businessDay: "2026-09-19",
    orderType: "dine_in",
    channel: "pos",
    state: "open",
    tableId: "table-4",
    tableLabel: null,
    guestCount: 2,
    customerId: null,
    customerName: null,
    openedBy: "emp-1",
    openedByName: { en: "Amina", ar: "أمينة" },
    servedByName: null,
    currency: "EGP",
    subtotal: money(0),
    discountTotal: money(0),
    serviceChargeTotal: money(0),
    taxTotal: money(0),
    roundingAdjustment: money(0),
    grandTotal: money(0),
    paidTotal: money(0),
    tipTotal: money(0),
    cogsTotal: money(0),
    lines: [],
    payments: [],
    discounts: [],
    openedAt: "2026-09-19T10:00:00Z",
    firstFiredAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    syncState: "synced",
    syncedAt: "2026-09-19T10:00:00Z",
    aggregatorRef: null,
    notes: null,
    version: 1,
    ...overrides,
  };
}

function makeTable(overrides: Partial<PosTable> = {}): PosTable {
  return {
    id: "table-1",
    label: "1",
    section: null,
    seatCapacity: 4,
    occupancy: "available",
    activeOrder: null,
    conflictingOrders: [],
    ...overrides,
  };
}

const orderRef = (overrides: Record<string, unknown> = {}) => ({
  id: "order-perm-10",
  businessDay: "2026-09-19",
  orderNumber: "MAIN-10",
  state: "open",
  version: 4,
  ...overrides,
});

const AVAILABLE = makeTable({ id: "table-1", label: "1", seatCapacity: 4 });
const OCCUPIED = makeTable({
  id: "table-4",
  label: "4",
  seatCapacity: 6,
  occupancy: "occupied",
  activeOrder: orderRef(),
});
const AMBIGUOUS = makeTable({
  id: "table-9",
  label: "9",
  seatCapacity: 2,
  occupancy: "ambiguous",
  conflictingOrders: [orderRef({ id: "a", orderNumber: "MAIN-3" }), orderRef({ id: "b", orderNumber: "MAIN-8" })],
});

async function enterPosNoOrder() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();

  getCurrentSession.mockResolvedValue({
    cashSessionId: "cs-1",
    shiftId: "sh-1",
    drawerId: "drawer-1",
    status: "open",
  });

  signOnAs("EMP01", "Amina");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
  Session.setPosEmployee({ code: "EMP01", name: "Amina" });

  render(<LivePos />);

  await screen.findByText("pos.newOrder");
  return user;
}

/**
 * Opens the order-type listbox (`Select` in `components/console/ui.tsx` is a
 * custom listbox, not a native `<select>`) and chooses "Dine In".
 */
async function selectDineIn(user: import("@testing-library/user-event").UserEvent) {
  await user.click(screen.getByLabelText("orders.type"));
  await user.click(screen.getByRole("option", { name: "Dine In" }));
}

async function reachTables(rows: PosTable[] = [AVAILABLE, OCCUPIED, AMBIGUOUS]) {
  tables.mockResolvedValue(rows);
  const user = await enterPosNoOrder();
  await selectDineIn(user);
  await waitFor(() => expect(tables).toHaveBeenCalled());
  await screen.findByRole("button", { name: /^1,/ });
  return user;
}

/** The card for a table, found by its label (the first part of its accessible name). */
const card = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label},`) });

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  listSessionDrawers.mockResolvedValue(ONE_DRAWER);
  getPosMenu.mockResolvedValue({
    branchId: BRANCH_ID,
    orderType: "dine_in",
    menus: [],
    categories: [],
    items: [],
    ambiguousMenuPriority: false,
    warning: null,
  });
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LivePos — Dine-In table surface", () => {
  it("shows the tables GET /orders/tables returned, grouped by section, with capacity", async () => {
    await reachTables([
      makeTable({ id: "t-1", label: "1", section: "Patio", seatCapacity: 4 }),
      makeTable({ id: "t-2", label: "2", section: "Patio", seatCapacity: 2 }),
      makeTable({ id: "t-3", label: "9", section: "Bar", seatCapacity: null }),
    ]);

    expect(tables).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Patio")).toBeInTheDocument();
    expect(screen.getByText("Bar")).toBeInTheDocument();
    expect(card("1")).toHaveTextContent("4 pos.seats");
    expect(card("2")).toHaveTextContent("2 pos.seats");
    // No capacity from the backend -> none invented.
    expect(card("9")).not.toHaveTextContent("pos.seats");
  });

  it("an Available table says Available; an Occupied table says Occupied and names the order to resume", async () => {
    await reachTables();

    expect(within(card("1")).getByText("pos.tableAvailable")).toBeInTheDocument();
    expect(within(card("1")).queryByText("pos.tableOccupied")).not.toBeInTheDocument();

    expect(within(card("4")).getByText("pos.tableOccupied")).toBeInTheDocument();
    expect(within(card("4")).getByText("MAIN-10")).toBeInTheDocument();
    expect(within(card("4")).getByText(/pos\.tableResumeOrder/)).toBeInTheDocument();
    expect(within(card("4")).queryByText("pos.tableAvailable")).not.toBeInTheDocument();
  });

  it("an Occupied table is NOT disabled — selecting it is how the operator resumes", async () => {
    await reachTables();

    expect(card("4")).toBeEnabled();
    expect(card("4")).not.toHaveAttribute("aria-disabled");
  });

  it("an Ambiguous table is a visible problem card, marked unavailable, and explains the repair", async () => {
    await reachTables();

    const conflict = card("9");
    expect(within(conflict).getByText("pos.tableConflict")).toBeInTheDocument();
    expect(within(conflict).getByText("pos.tableConflictHint")).toBeInTheDocument();
    expect(conflict).toHaveAttribute("aria-disabled", "true");
    expect(within(conflict).queryByText("pos.tableAvailable")).not.toBeInTheDocument();
  });

  it("tapping an Ambiguous table explains why and sends NO request — no create, no resume", async () => {
    const user = await reachTables();

    await user.click(card("9"));

    expect(await screen.findByRole("alert")).toHaveTextContent("pos.tableAmbiguous");
    expect(selectTable).not.toHaveBeenCalled();
    expect(openOrder).not.toHaveBeenCalled();
    expect(screen.getByText("pos.newOrder")).toBeInTheDocument();
  });

  it("has no separate 'Open order' step in Dine-In — the table tap IS the open", async () => {
    await reachTables();
    expect(screen.queryByRole("button", { name: "pos.openOrder" })).not.toBeInTheDocument();
  });

  it("shows the real empty state when the branch has no tables — never a fabricated table", async () => {
    tables.mockResolvedValue([]);
    const user = await enterPosNoOrder();
    await selectDineIn(user);

    expect(await screen.findByText("ops.noTables")).toBeInTheDocument();
  });

  it("Refresh re-reads GET /orders/tables", async () => {
    const user = await reachTables();
    tables.mockResolvedValue([AVAILABLE, { ...OCCUPIED, occupancy: "available", activeOrder: null }]);

    await user.click(screen.getByRole("button", { name: /common\.refresh/ }));

    await waitFor(() => expect(tables).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(card("4")).getByText("pos.tableAvailable")).toBeInTheDocument(),
    );
  });
});

describe("LivePos — Dine-In select: create or resume, decided by the backend", () => {
  it("Available -> ONE selectTable; outcome created opens the returned order; direct POST /orders is never used", async () => {
    selectTable.mockResolvedValue({
      outcome: "created",
      order: makeOrder({ id: "order-perm-11", orderNumber: "MAIN-11", tableId: "table-1" }),
    });
    const user = await reachTables();

    await user.click(card("1"));

    await waitFor(() => expect(selectTable).toHaveBeenCalledTimes(1));
    expect(selectTable.mock.calls[0][0]).toBe("table-1");
    expect(selectTable.mock.calls[0]).toEqual(["table-1"]);
    expect(await screen.findByText("MAIN-11")).toBeInTheDocument();
    expect(screen.getByText("pos.orderOpened")).toBeInTheDocument();
    expect(screen.queryByText("pos.newOrder")).not.toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("Occupied -> the SAME endpoint; outcome resumed opens that SAME order with its existing lines", async () => {
    selectTable.mockResolvedValue({
      outcome: "resumed",
      order: makeOrder({
        lines: [makeLine()],
        subtotal: money(20000),
        grandTotal: money(20000),
        firstFiredAt: "2026-09-19T10:05:00Z",
        version: 4,
      }),
    });
    const user = await reachTables();

    await user.click(card("4"));

    await waitFor(() => expect(selectTable).toHaveBeenCalledTimes(1));
    expect(selectTable.mock.calls[0][0]).toBe("table-4");
    // Same order number the card showed, and its real fired line.
    expect(await screen.findByText("MAIN-10")).toBeInTheDocument();
    expect(screen.getByText("Burger")).toBeInTheDocument();
    expect(screen.getByText("Fired")).toBeInTheDocument();
    expect(screen.getByText("pos.orderResumed")).toBeInTheDocument();
    expect(screen.queryByText("pos.newOrder")).not.toBeInTheDocument();
    // Never a create, never a second order.
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("Dine-In shows NO Guests field — and no leftover hint for one", async () => {
    await reachTables();

    expect(screen.queryByLabelText(/pos\.guests/)).not.toBeInTheDocument();
    expect(screen.queryByText("pos.guests")).not.toBeInTheDocument();
    expect(screen.queryByText("pos.guestsNewOrderOnly")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Available / new order: sends the table id and NOTHING else — no guest count, no default", async () => {
    selectTable.mockResolvedValue({
      outcome: "created",
      order: makeOrder({ id: "order-perm-11", orderNumber: "MAIN-11", tableId: "table-1" }),
    });
    const user = await reachTables();

    await user.click(card("1"));

    await waitFor(() => expect(selectTable).toHaveBeenCalledTimes(1));
    expect(selectTable.mock.calls[0]).toEqual(["table-1"]);
    // New-order creation still succeeds and opens the returned order.
    expect(await screen.findByText("MAIN-11")).toBeInTheDocument();
    expect(screen.getByText("pos.orderOpened")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("Occupied / resume: sends the table id and NOTHING else, and hydrates the order unchanged", async () => {
    selectTable.mockResolvedValue({
      outcome: "resumed",
      order: makeOrder({
        guestCount: 2,
        lines: [makeLine()],
        subtotal: money(20000),
        grandTotal: money(20000),
        firstFiredAt: "2026-09-19T10:05:00Z",
      }),
    });
    const user = await reachTables();

    await user.click(card("4"));

    await waitFor(() => expect(selectTable).toHaveBeenCalledTimes(1));
    expect(selectTable.mock.calls[0]).toEqual(["table-4"]);
    expect(await screen.findByText("MAIN-10")).toBeInTheDocument();
    expect(screen.getByText("Burger")).toBeInTheDocument();
    expect(screen.getByText("Fired")).toBeInTheDocument();
    expect(screen.getByText("pos.orderResumed")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("stale Available: the list said free, the backend resumes the existing order — still no guest count sent", async () => {
    // The list was read before someone else opened table 1; the tap is the same
    // single call either way, and the backend alone decides "resumed".
    selectTable.mockResolvedValue({
      outcome: "resumed",
      order: makeOrder({
        tableId: "table-1",
        lines: [makeLine()],
        subtotal: money(20000),
        grandTotal: money(20000),
        firstFiredAt: "2026-09-19T10:05:00Z",
      }),
    });
    const user = await reachTables();
    expect(within(card("1")).getByText("pos.tableAvailable")).toBeInTheDocument();

    await user.click(card("1"));

    await waitFor(() => expect(selectTable).toHaveBeenCalledTimes(1));
    expect(selectTable.mock.calls[0]).toEqual(["table-1"]);
    expect(await screen.findByText("MAIN-10")).toBeInTheDocument();
    expect(screen.getByText("Burger")).toBeInTheDocument();
    expect(screen.getByText("pos.orderResumed")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("409 DINE_IN_TABLE_AMBIGUOUS is shown truthfully, keeps the operator on the tables, refreshes them and creates no order", async () => {
    selectTable.mockRejectedValue(
      new ServiceError("DINE_IN_TABLE_AMBIGUOUS", "backend english wording", 409),
    );
    const user = await reachTables();

    await user.click(card("1"));

    expect(await screen.findByRole("alert")).toHaveTextContent("pos.tableAmbiguous");
    expect(screen.getByText("pos.newOrder")).toBeInTheDocument();
    expect(card("1")).toBeInTheDocument();
    // The table list was stale — it is re-read from the server.
    await waitFor(() => expect(tables).toHaveBeenCalledTimes(2));
    expect(openOrder).not.toHaveBeenCalled();
    // No order pane was opened: the empty-order placeholder is still shown.
    expect(screen.getByText("pos.noActiveOrder")).toBeInTheDocument();
  });

  it("403 says the operator is not authorized and creates no order", async () => {
    selectTable.mockRejectedValue(new ServiceError("FORBIDDEN", "nope", 403));
    const user = await reachTables();

    await user.click(card("1"));

    expect(await screen.findByRole("alert")).toHaveTextContent("pos.tableSelectForbidden");
    expect(screen.getByText("pos.newOrder")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();
    expect(tables).toHaveBeenCalledTimes(1);
  });

  it("404 says the table is gone, refreshes the list and creates no order", async () => {
    selectTable.mockRejectedValue(new ServiceError("NOT_FOUND", "nope", 404));
    const user = await reachTables();

    await user.click(card("1"));

    expect(await screen.findByRole("alert")).toHaveTextContent("pos.tableNotFound");
    await waitFor(() => expect(tables).toHaveBeenCalledTimes(2));
    expect(screen.getByText("pos.newOrder")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("a network failure guesses nothing (no order), and the operator can safely retry", async () => {
    selectTable.mockRejectedValueOnce(new ServiceError("NETWORK_UNREACHABLE", "down", 0));
    const user = await reachTables();

    await user.click(card("4"));
    expect(await screen.findByRole("alert")).toHaveTextContent("pos.tableNetworkError");
    expect(screen.getByText("pos.newOrder")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();

    // Retry: the same tap, a fresh call — the backend resumes the one order.
    selectTable.mockResolvedValueOnce({ outcome: "resumed", order: makeOrder() });
    await user.click(card("4"));

    expect(await screen.findByText("MAIN-10")).toBeInTheDocument();
    expect(selectTable).toHaveBeenCalledTimes(2);
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("a double tap while the request is in flight sends ONE request and locks every other card", async () => {
    let finish: (value: unknown) => void = () => {};
    selectTable.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = await reachTables();

    await user.dblClick(card("1"));

    await waitFor(() => expect(card("4")).toBeDisabled());
    expect(card("9")).toBeDisabled();
    expect(selectTable).toHaveBeenCalledTimes(1);

    // Tapping a different table mid-flight is also ignored.
    await user.click(card("4"));
    expect(selectTable).toHaveBeenCalledTimes(1);

    finish({ outcome: "created", order: makeOrder({ orderNumber: "MAIN-12" }) });
    expect(await screen.findByText("MAIN-12")).toBeInTheDocument();
    expect(selectTable).toHaveBeenCalledTimes(1);
  });
});

/** Picks an order type in the custom Select (which may already be open — see `selectDineIn`). */
async function pickOrderType(user: import("@testing-library/user-event").UserEvent, name: string) {
  if (!screen.queryByRole("option", { name })) {
    await user.click(screen.getByLabelText("orders.type"));
  }
  await user.click(screen.getByRole("option", { name }));
}

describe("LivePos — no Guests field on ANY order type, and none on the wire", () => {
  it("Takeaway (the default) shows NO Guests field", async () => {
    await enterPosNoOrder();

    expect(screen.queryByLabelText(/pos\.guests/)).not.toBeInTheDocument();
    expect(screen.queryByText("pos.guests")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pos.openOrder" })).toBeEnabled();
  });

  it("Pickup shows NO Guests field", async () => {
    const user = await enterPosNoOrder();
    await pickOrderType(user, "Pickup from Branch");

    expect(screen.queryByLabelText(/pos\.guests/)).not.toBeInTheDocument();
    expect(screen.queryByText("pos.guests")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pos.openOrder" })).toBeEnabled();
  });

  it.each([
    ["takeaway", "MAIN-20"],
    ["pickup", "MAIN-21"],
  ] as const)(
    "%s opens through the ordinary direct create, sending ONLY {orderType, channel} — no guestCount, no default",
    async (orderType, orderNumber) => {
      openOrder.mockResolvedValue(makeOrder({ orderType, tableId: null, orderNumber }));
      const user = await enterPosNoOrder();
      if (orderType === "pickup") await pickOrderType(user, "Pickup from Branch");

      await user.click(screen.getByRole("button", { name: "pos.openOrder" }));

      await waitFor(() => expect(openOrder).toHaveBeenCalledTimes(1));
      // Exact equality: not even an `undefined`-valued guestCount key.
      expect(openOrder.mock.calls[0][0]).toStrictEqual({ orderType, channel: "pos" });
      expect(await screen.findByText(orderNumber)).toBeInTheDocument();
      expect(screen.getByText("pos.orderOpened")).toBeInTheDocument();
      expect(selectTable).not.toHaveBeenCalled();
      expect(tables).not.toHaveBeenCalled();
    },
  );

  it("Dine-In still opens (created) and resumes with the table id only — all three order types open successfully", async () => {
    selectTable.mockResolvedValueOnce({ outcome: "created", order: makeOrder({ orderNumber: "MAIN-30" }) });
    const user = await reachTables();
    await user.click(card("1"));
    expect(await screen.findByText("MAIN-30")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "pos.closeOrder" }));
    selectTable.mockResolvedValueOnce({ outcome: "resumed", order: makeOrder({ orderNumber: "MAIN-31" }) });
    await user.click(await screen.findByRole("button", { name: /^4,/ }));
    expect(await screen.findByText("MAIN-31")).toBeInTheDocument();

    expect(selectTable.mock.calls).toEqual([["table-1"], ["table-4"]]);
    expect(openOrder).not.toHaveBeenCalled();
  });
});

describe("LivePos — Takeaway and the Cashier boundary are untouched", () => {
  it("Takeaway keeps the ordinary create: no table read, no table select, direct open with no tableId", async () => {
    openOrder.mockResolvedValue(makeOrder({ orderType: "takeaway", tableId: null, orderNumber: "MAIN-20" }));
    const user = await enterPosNoOrder();

    expect(tables).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "pos.openOrder" }));

    await waitFor(() => expect(openOrder).toHaveBeenCalledTimes(1));
    expect(openOrder.mock.calls[0][0]).toMatchObject({ orderType: "takeaway", channel: "pos" });
    expect(openOrder.mock.calls[0][0].tableId).toBeUndefined();
    expect(await screen.findByText("MAIN-20")).toBeInTheDocument();
    expect(selectTable).not.toHaveBeenCalled();
    expect(tables).not.toHaveBeenCalled();
  });

  it("never calls the BRANCH_READ-gated services.operations.tables (/org/branches/{id}/tables) on the Cashier path", async () => {
    selectTable.mockResolvedValue({ outcome: "created", order: makeOrder() });
    const user = await reachTables();
    await user.click(card("1"));
    await screen.findByText("MAIN-10");

    expect(operationsTables).not.toHaveBeenCalled();
  });

  it("switching from Dine-In back to Takeaway removes the table surface and never reads tables again", async () => {
    const user = await reachTables();
    expect(tables).toHaveBeenCalledTimes(1);

    // The custom Select stays open after a pick (its option click re-activates
    // the wrapping <label>'s button); open it only if it is not already.
    if (!screen.queryByRole("option", { name: "Takeaway" })) {
      await user.click(screen.getByRole("button", { name: /Dine In/ }));
    }
    await user.click(screen.getByRole("option", { name: "Takeaway" }));

    expect(screen.queryByText("pos.selectTable")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/pos\.guests/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pos.openOrder" })).toBeEnabled();
    expect(tables).toHaveBeenCalledTimes(1);
  });
});
