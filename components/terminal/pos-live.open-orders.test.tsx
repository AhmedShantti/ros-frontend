import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * FRONTEND-REAL-UX-BATCH-1A — POS Open Orders/Resume.
 *
 * `LivePos` used to lose the selected order from its own UI on reload or
 * navigation away, even though the server order was untouched — `order`
 * was local component state with no picker/list UI, and `GET /orders`
 * (already Cashier-safe, already used elsewhere) was never called from
 * here. This proves the new Open Orders picker: it lists only resumable
 * orders via the existing `services.operations.openOrders`, and resuming
 * one re-fetches it fresh via `services.sales.orders.get` (preserving the
 * order's own optimistic-concurrency `version`) rather than reusing the
 * stale list row.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/api/auth`. The REAL `@/lib/api/session.ts` runs against jsdom's
 * `localStorage`. Same pattern as `pos-live.test.tsx`.
 */

const {
  getCurrentSession,
  listSessionDrawers,
  tables,
  openOrders,
  ordersGet,
} = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  listSessionDrawers: vi.fn(),
  tables: vi.fn(),
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
      tables: (...args: unknown[]) => tables(...args),
      openOrders: (...args: unknown[]) => openOrders(...args),
    },
    sales: {
      mutations: {},
      orders: { get: (...args: unknown[]) => ordersGet(...args) },
    },
  },
  ServiceError: class ServiceError extends Error {},
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
import type { Order } from "@/lib/console/types";
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

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    branchName: { en: "Front Branch", ar: "الفرع" },
    terminalId: "terminal-1",
    terminalName: "Front Till",
    orderNumber: "ORD-1",
    businessDay: "2026-09-19",
    orderType: "takeaway",
    channel: "pos",
    state: "open",
    tableId: null,
    tableLabel: null,
    guestCount: null,
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
    paidTotal: money(4000),
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
    version: 3,
    ...overrides,
  };
}

/** Signs a cashier on and resumes an already-open shift, landing on NewOrderPane. */
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

describe("LivePos — Open Orders picker", () => {
  it("lists only resumable orders from services.operations.openOrders, never a fabricated/local source", async () => {
    openOrders.mockResolvedValue({
      rows: [makeOrder({ id: "order-9", orderNumber: "ORD-9" })],
      total: 1,
    });

    const user = await enterPosNoOrder();
    await user.click(screen.getByRole("button", { name: /pos.openOrders/ }));

    await waitFor(() => expect(openOrders).toHaveBeenCalled());
    expect(openOrders.mock.calls[0][0]).toMatchObject({
      scope: expect.objectContaining({ branchId: BRANCH_ID }),
    });
    expect(await screen.findByText("ORD-9")).toBeInTheDocument();
  });

  it("resuming re-fetches the order fresh (GET /orders/{day}/{id}) and lands in MenuPane with the current version", async () => {
    const summaryRow = makeOrder({ id: "order-9", orderNumber: "ORD-9", version: 1 });
    // The fresh fetch answers with a NEWER version — proving the till uses
    // this, not the stale list row, for its optimistic-concurrency token.
    const freshOrder = makeOrder({ id: "order-9", orderNumber: "ORD-9", version: 5 });

    openOrders.mockResolvedValue({ rows: [summaryRow], total: 1 });
    ordersGet.mockResolvedValue(freshOrder);

    const user = await enterPosNoOrder();
    await user.click(screen.getByRole("button", { name: /pos.openOrders/ }));
    await user.click(await screen.findByText("ORD-9"));

    await waitFor(() =>
      expect(ordersGet).toHaveBeenCalledWith(`${summaryRow.businessDay}/${summaryRow.id}`),
    );

    // Back on the till, no longer the "new order" screen, showing the
    // resumed order — MenuPane, not NewOrderPane.
    await waitFor(() => expect(screen.queryByText("pos.newOrder")).not.toBeInTheDocument());
  });
});
