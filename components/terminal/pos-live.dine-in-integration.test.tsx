import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

/*
 * DINE-IN-TABLE-SELECTOR-RESUME-P0 — end-to-end proof, driven through the real
 * `LivePos` component tree (mocked only at the transport boundary).
 *
 * The regression the task names:
 *
 *   1. Table 4 has Order MAIN-10.
 *   2. Burger was already fired.
 *   3. The operator leaves the order.
 *   4. The operator later selects Table 4 again.
 *   5. MAIN-10 must reopen with Burger still present (and still fired).
 *   6. The operator adds Fries.
 *   7. Fire.
 *
 * Expected: Burger is not fired again, no second order appears, and only the
 * new/unfired work follows the existing Fire path. The client sends Fire with
 * no line list at all — the backend fires the order's pending lines — and the
 * Fire control is only enabled while a `pending` line exists.
 *
 * Also proved here: a table-resumed order and the same order resumed from Open
 * Orders are the same canonical Order, and hopping between tables never loses
 * server data (every open re-reads the server's Order; nothing is cached).
 */

const {
  getCurrentSession,
  listSessionDrawers,
  tables,
  selectTable,
  openOrder,
  getPosMenu,
  addLine,
  fireOrder,
  openOrders,
  ordersGet,
} = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  listSessionDrawers: vi.fn(),
  tables: vi.fn(),
  selectTable: vi.fn(),
  openOrder: vi.fn(),
  getPosMenu: vi.fn(),
  addLine: vi.fn(),
  fireOrder: vi.fn(),
  openOrders: vi.fn(),
  ordersGet: vi.fn(),
}));

vi.mock("@/lib/console/services", () => ({
  services: {
    treasury: {
      getCurrentSession: (...args: unknown[]) => getCurrentSession(...args),
      listSessionDrawers: (...args: unknown[]) => listSessionDrawers(...args),
    },
    operations: {
      openOrders: (...args: unknown[]) => openOrders(...args),
    },
    sales: {
      tables: (...args: unknown[]) => tables(...args),
      selectTable: (...args: unknown[]) => selectTable(...args),
      orders: { get: (...args: unknown[]) => ordersGet(...args) },
      mutations: {
        open: (...args: unknown[]) => openOrder(...args),
        addLine: (...args: unknown[]) => addLine(...args),
        fire: (...args: unknown[]) => fireOrder(...args),
      },
    },
  },
  ServiceError: class ServiceError extends Error {},
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

const FRIES_ID = "line-fries";
const friesLine = (overrides: Partial<OrderLine> = {}) =>
  makeLine({
    id: FRIES_ID,
    sequence: 2,
    menuItemId: "item-2",
    variantId: "variant-2",
    itemNameSnapshot: { en: "Fries", ar: "بطاطس" },
    unitPrice: money(4000),
    lineSubtotal: money(4000),
    lineTotal: money(4000),
    state: "pending",
    firedAt: null,
    ...overrides,
  });

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
    version: 4,
    ...overrides,
  };
}

/** MAIN-10 exactly as the server holds it after Burger was fired. */
const MAIN_10_BURGER_FIRED = () =>
  makeOrder({
    lines: [makeLine()],
    subtotal: money(10000),
    grandTotal: money(10000),
    firstFiredAt: "2026-09-19T10:05:00Z",
    version: 4,
  });

const MAIN_10_REF = {
  id: "order-perm-10",
  businessDay: "2026-09-19",
  orderNumber: "MAIN-10",
  state: "open",
  version: 4,
};

const table = (overrides: Partial<PosTable>): PosTable => ({
  id: "table-1",
  label: "1",
  section: null,
  seatCapacity: 4,
  occupancy: "available",
  activeOrder: null,
  conflictingOrders: [],
  ...overrides,
});

const TABLE_4_OCCUPIED = table({
  id: "table-4",
  label: "4",
  occupancy: "occupied",
  activeOrder: MAIN_10_REF,
});

const POS_MENU_WIRE = {
  branchId: BRANCH_ID,
  orderType: "dine_in",
  menus: [],
  categories: [],
  items: [
    {
      id: "item-1",
      names: { en: "Burger", ar: "برجر" },
      description: null,
      allergens: [],
      dietaryTags: [],
      sortOrder: 1,
      colour: null,
      barcodePlu: null,
      isOpenPrice: false,
      isWeighed: false,
      isAvailable: true,
      variants: [
        {
          id: "variant-1",
          name: { en: "Regular", ar: "عادي" },
          barcode: null,
          sortOrder: 1,
          isAvailable: true,
          price: { amountMinorUnits: "10000", currency: "EGP" },
        },
      ],
      modifierGroups: [],
    },
    {
      id: "item-2",
      names: { en: "Fries", ar: "بطاطس" },
      description: null,
      allergens: [],
      dietaryTags: [],
      sortOrder: 2,
      colour: null,
      barcodePlu: null,
      isOpenPrice: false,
      isWeighed: false,
      isAvailable: true,
      variants: [
        {
          id: "variant-2",
          name: { en: "Regular", ar: "عادي" },
          barcode: null,
          sortOrder: 1,
          isAvailable: true,
          price: { amountMinorUnits: "4000", currency: "EGP" },
        },
      ],
      modifierGroups: [],
    },
  ],
  ambiguousMenuPriority: false,
  warning: null,
};

async function enterDineInTables() {
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

  await user.click(screen.getByLabelText("orders.type"));
  await user.click(screen.getByRole("option", { name: "Dine In" }));
  await waitFor(() => expect(tables).toHaveBeenCalled());
  return user;
}

const card = (label: string) => screen.findByRole("button", { name: new RegExp(`^${label},`) });

/** The order pane's line list is the only `<ul>` of order lines on screen. */
function orderLines() {
  return screen.getAllByRole("listitem");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  listSessionDrawers.mockResolvedValue(ONE_DRAWER);
  getPosMenu.mockResolvedValue(POS_MENU_WIRE);
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LivePos — Dine-In resume: fired order, new line, fire", () => {
  it("re-selecting an occupied table reopens the SAME order with its fired line; adding Fries and firing does not re-fire Burger", async () => {
    tables.mockResolvedValue([TABLE_4_OCCUPIED]);
    const user = await enterDineInTables();

    // -- resume: table 4 -> MAIN-10, exactly as the server holds it ---------
    selectTable.mockResolvedValue({ outcome: "resumed", order: MAIN_10_BURGER_FIRED() });
    await user.click(await card("4"));

    await waitFor(() => expect(selectTable).toHaveBeenCalledTimes(1));
    expect(selectTable.mock.calls[0]).toEqual(["table-4"]);
    expect(await screen.findByText("MAIN-10")).toBeInTheDocument();
    expect(openOrder).not.toHaveBeenCalled();

    // Burger is present, still FIRED, and nothing is queued to fire.
    const before = orderLines();
    expect(before).toHaveLength(1);
    expect(within(before[0]).getByText("Burger")).toBeInTheDocument();
    expect(within(before[0]).getByText("Fired")).toBeInTheDocument();
    expect(within(before[0]).queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pos.fire" })).toBeDisabled();

    // -- add Fries: addressed to the PERMANENT id, at the resumed version ---
    addLine.mockResolvedValue(
      makeOrder({
        lines: [makeLine(), friesLine()],
        subtotal: money(14000),
        grandTotal: money(14000),
        firstFiredAt: "2026-09-19T10:05:00Z",
        version: 5,
      }),
    );
    await user.click(await screen.findByRole("button", { name: /Fries/ }));

    await waitFor(() => expect(addLine).toHaveBeenCalledTimes(1));
    expect(addLine.mock.calls[0][0]).toBe("2026-09-19");
    expect(addLine.mock.calls[0][1]).toBe("order-perm-10");
    expect(addLine.mock.calls[0][2]).toMatchObject({ menuItemId: "item-2", variantId: "variant-2" });
    expect(addLine.mock.calls[0][3]).toEqual({ ifMatch: 4 });

    // Burger is untouched (same id, still fired); Fries is the one new line.
    await waitFor(() => expect(orderLines()).toHaveLength(2));
    const [burger, fries] = orderLines();
    expect(within(burger).getByText("Burger")).toBeInTheDocument();
    expect(within(burger).getByText("Fired")).toBeInTheDocument();
    expect(within(fries).getByText("Fries")).toBeInTheDocument();
    expect(within(fries).queryByText("Fired")).not.toBeInTheDocument();

    // -- fire: the existing path. One call, no line list, current version. --
    const fireButton = screen.getByRole("button", { name: "pos.fire" });
    await waitFor(() => expect(fireButton).toBeEnabled());
    fireOrder.mockResolvedValue(
      makeOrder({
        lines: [makeLine(), friesLine({ state: "fired", firedAt: "2026-09-19T10:20:00Z" })],
        subtotal: money(14000),
        grandTotal: money(14000),
        firstFiredAt: "2026-09-19T10:05:00Z",
        version: 6,
      }),
    );
    await user.click(fireButton);

    await waitFor(() => expect(fireOrder).toHaveBeenCalledTimes(1));
    expect(fireOrder).toHaveBeenCalledWith("2026-09-19", "order-perm-10", { ifMatch: 5 });
    // Nothing per-line was sent: Burger cannot be re-fired by this client.
    expect(fireOrder.mock.calls[0]).toHaveLength(3);

    // Everything is fired now, so there is nothing left to send.
    await waitFor(() => expect(screen.getByRole("button", { name: "pos.fire" })).toBeDisabled());
    expect(addLine).toHaveBeenCalledTimes(1);
  });

  it("leaving the order returns to the table surface (still Dine-In) with a FRESH GET /orders/tables", async () => {
    tables.mockResolvedValue([TABLE_4_OCCUPIED]);
    const user = await enterDineInTables();
    selectTable.mockResolvedValue({ outcome: "resumed", order: MAIN_10_BURGER_FIRED() });
    await user.click(await card("4"));
    await screen.findByText("MAIN-10");
    expect(tables).toHaveBeenCalledTimes(1);

    // The server says table 4 is free by now (e.g. it was paid elsewhere).
    tables.mockResolvedValue([table({ id: "table-4", label: "4" })]);
    await user.click(screen.getByRole("button", { name: "pos.closeOrder" }));

    // Back on the table surface — no need to re-pick Dine-In — freshly read.
    expect(await screen.findByText("pos.selectTable")).toBeInTheDocument();
    await waitFor(() => expect(tables).toHaveBeenCalledTimes(2));
    const four = await card("4");
    expect(within(four).getByText("pos.tableAvailable")).toBeInTheDocument();
  });

  it("a table-resumed order and the same order resumed from Open Orders are the same canonical Order", async () => {
    tables.mockResolvedValue([TABLE_4_OCCUPIED]);
    const user = await enterDineInTables();

    // (a) via the table
    selectTable.mockResolvedValue({ outcome: "resumed", order: MAIN_10_BURGER_FIRED() });
    await user.click(await card("4"));
    await screen.findByText("MAIN-10");
    const viaTable = orderLines().map((li) => li.textContent);
    await user.click(screen.getByRole("button", { name: "pos.closeOrder" }));

    // (b) via Open Orders — the drawer re-reads the order by (businessDay, id)
    openOrders.mockResolvedValue({ rows: [MAIN_10_BURGER_FIRED()], total: 1 });
    ordersGet.mockResolvedValue(MAIN_10_BURGER_FIRED());
    await user.click(await screen.findByRole("button", { name: /pos.openOrders/ }));
    // Scoped to the drawer: the occupied table card also names MAIN-10.
    await user.click(within(await screen.findByRole("dialog")).getByText("MAIN-10"));

    await waitFor(() => expect(ordersGet).toHaveBeenCalledWith("2026-09-19/order-perm-10"));
    await waitFor(() => expect(screen.queryByText("pos.newOrder")).not.toBeInTheDocument());
    expect(orderLines().map((li) => li.textContent)).toEqual(viaTable);
    expect(screen.getByText("MAIN-10")).toBeInTheDocument();
    // Neither path created anything.
    expect(openOrder).not.toHaveBeenCalled();
  });

  it("switching between tables re-reads each order from the server — no data is lost or bled across", async () => {
    const tableA = table({ id: "table-1", label: "1" });
    const orderA = makeOrder({ id: "order-perm-11", orderNumber: "MAIN-11", tableId: "table-1", version: 1 });
    const orderB = makeOrder({
      id: "order-perm-12",
      orderNumber: "MAIN-12",
      tableId: "table-2",
      lines: [makeLine({ id: "line-b" })],
      subtotal: money(10000),
      grandTotal: money(10000),
      firstFiredAt: "2026-09-19T10:05:00Z",
    });
    tables.mockResolvedValue([
      tableA,
      table({
        id: "table-2",
        label: "2",
        occupancy: "occupied",
        activeOrder: { ...MAIN_10_REF, id: "order-perm-12", orderNumber: "MAIN-12" },
      }),
    ]);
    const user = await enterDineInTables();

    // A: free -> created (empty)
    selectTable.mockResolvedValueOnce({ outcome: "created", order: orderA });
    await user.click(await card("1"));
    await screen.findByText("MAIN-11");
    expect(screen.getByText("pos.noLines")).toBeInTheDocument();

    // A gets a Fries line on the server, then the operator hops to B.
    addLine.mockResolvedValue({
      ...orderA,
      lines: [friesLine()],
      subtotal: money(4000),
      grandTotal: money(4000),
      version: 2,
    });
    await user.click(await screen.findByRole("button", { name: /Fries/ }));
    await waitFor(() => expect(orderLines()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "pos.closeOrder" }));

    // B: occupied -> resumed with ITS OWN Burger, nothing of A's Fries.
    selectTable.mockResolvedValueOnce({ outcome: "resumed", order: orderB });
    await user.click(await card("2"));
    await screen.findByText("MAIN-12");
    expect(within(orderLines()[0]).getByText("Burger")).toBeInTheDocument();
    expect(screen.queryByText("Fries", { selector: "p" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "pos.closeOrder" }));

    // Back to A: the server's version, with the Fries the operator added.
    selectTable.mockResolvedValueOnce({
      outcome: "resumed",
      order: { ...orderA, lines: [friesLine()], subtotal: money(4000), grandTotal: money(4000), version: 2 },
    });
    await user.click(await card("1"));
    await screen.findByText("MAIN-11");
    expect(within(orderLines()[0]).getByText("Fries")).toBeInTheDocument();
    expect(orderLines()).toHaveLength(1);

    expect(selectTable.mock.calls.map((call) => call[0])).toEqual(["table-1", "table-2", "table-1"]);
    expect(openOrder).not.toHaveBeenCalled();
  });
});
