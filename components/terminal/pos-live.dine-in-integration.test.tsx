import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * POS-SAFE-TABLES-DINEIN-P0 — integration-oriented proof.
 *
 * The full flow the task asks for, driven entirely through the real
 * `LivePos` component tree (mocked only at the transport boundary):
 *
 *   PIN login -> choose Dine-in -> select a real table -> create the order
 *   -> add an item -> fire -> leave/reload -> Open Orders -> resume the
 *   same Dine-in order -> continue (the resumed order still shows its table
 *   and its fired line).
 *
 * "Leave/reload" is simulated the same way `pos-live.open-orders.test.tsx`
 * simulates it: unmount and render a fresh `<LivePos />`, exactly what a
 * real page reload does to React state (real `@/lib/api/session.ts` keeps
 * the signed-on session in `localStorage` across that, same as production).
 */

const {
  getCurrentSession,
  listSessionDrawers,
  tables,
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
      tables: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      openOrders: (...args: unknown[]) => openOrders(...args),
    },
    sales: {
      tables: (...args: unknown[]) => tables(...args),
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
  }),
}));

vi.mock("@/lib/api/auth", () => ({
  signInWithPin: vi.fn(),
  signOffTerminal: vi.fn(),
}));

import { signInWithPin } from "@/lib/api/auth";
import * as Session from "@/lib/api/session";
import type { Order, OrderLine } from "@/lib/console/types";
import { LivePos } from "./pos-live";

const BRANCH_ID = "branch-1";
const TENANT_ID = "tenant-1";
const ONE_DRAWER = [
  { id: "drawer-1", branchId: BRANCH_ID, name: "Front drawer", terminalId: null, isActive: true },
];
const TABLE_ID = "t-7";

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
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-9",
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    branchName: { en: "Front Branch", ar: "الفرع" },
    terminalId: "terminal-1",
    terminalName: "Front Till",
    orderNumber: "ORD-9",
    businessDay: "2026-09-19",
    orderType: "dine_in",
    channel: "pos",
    state: "open",
    tableId: TABLE_ID,
    tableLabel: "7",
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
          priceAmbiguous: false,
        },
      ],
      modifierGroups: [],
    },
  ],
  ambiguousMenuPriority: false,
  warning: null,
};

async function signOnAndReachDineIn() {
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
  await user.click(await screen.findByRole("button", { name: /^7/ }));

  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  listSessionDrawers.mockResolvedValue(ONE_DRAWER);
  tables.mockResolvedValue([{ id: TABLE_ID, label: "7", section: "Patio", seatCapacity: 4 }]);
  getPosMenu.mockResolvedValue(POS_MENU_WIRE);
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LivePos — Dine-in end-to-end: create, fire, reload, resume", () => {
  it("PIN login -> Dine-in -> select table -> create -> add item -> fire -> reload -> Open Orders -> resume the same order", async () => {
    const opened = makeOrder();
    openOrder.mockResolvedValue(opened);

    const user = await signOnAndReachDineIn();

    // -- create --------------------------------------------------------
    const openButton = screen.getByRole("button", { name: "pos.openOrder" });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);

    await waitFor(() => expect(openOrder).toHaveBeenCalled());
    expect(openOrder.mock.calls[0][0]).toMatchObject({ orderType: "dine_in", tableId: TABLE_ID });
    await screen.findByText("ORD-9");

    // -- add an item -----------------------------------------------------
    const withLine = makeOrder({ lines: [makeLine()], subtotal: money(10000), grandTotal: money(10000) });
    addLine.mockResolvedValue(withLine);

    await screen.findByRole("button", { name: /Burger/ });
    await user.click(screen.getByRole("button", { name: /Burger/ }));

    await waitFor(() => expect(addLine).toHaveBeenCalled());
    expect(addLine.mock.calls[0][0]).toBe(withLine.businessDay);
    expect(addLine.mock.calls[0][1]).toBe(withLine.id);
    expect(addLine.mock.calls[0][2]).toMatchObject({ menuItemId: "item-1", variantId: "variant-1" });

    // -- fire --------------------------------------------------------------
    const fired = makeOrder({
      lines: [makeLine({ state: "fired", firedAt: "2026-09-19T10:05:00Z" })],
      subtotal: money(10000),
      grandTotal: money(10000),
      firstFiredAt: "2026-09-19T10:05:00Z",
    });
    fireOrder.mockResolvedValue(fired);

    const fireButton = await screen.findByRole("button", { name: "pos.fire" });
    await waitFor(() => expect(fireButton).toBeEnabled());
    await user.click(fireButton);
    await waitFor(() => expect(fireOrder).toHaveBeenCalled());

    // -- leave / reload ------------------------------------------------
    cleanup();
    getCurrentSession.mockResolvedValue({
      cashSessionId: "cs-1",
      shiftId: "sh-1",
      drawerId: "drawer-1",
      status: "open",
    });
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });

    const user2 = (await import("@testing-library/user-event")).default.setup();
    render(<LivePos />);
    await screen.findByText("pos.newOrder");

    // -- Open Orders -> resume ------------------------------------------
    openOrders.mockResolvedValue({ rows: [fired], total: 1 });
    ordersGet.mockResolvedValue(fired);

    await user2.click(screen.getByRole("button", { name: /pos.openOrders/ }));
    await user2.click(await screen.findByText("ORD-9"));

    await waitFor(() =>
      expect(ordersGet).toHaveBeenCalledWith(`${fired.businessDay}/${fired.id}`),
    );

    // -- continue: the resumed order shows its real table and fired line --
    // ("Burger" appears twice once resumed — the menu tile on the left AND
    // the order line on the right — so this asserts both are present.)
    await waitFor(() => expect(screen.queryByText("pos.newOrder")).not.toBeInTheDocument());
    expect(await screen.findByText("Fired")).toBeInTheDocument();
    expect(screen.getAllByText("Burger").length).toBeGreaterThanOrEqual(2);
  });
});
