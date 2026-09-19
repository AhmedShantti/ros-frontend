import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * POS-SAFE-TABLES-DINEIN-P0.
 *
 * `LivePos`'s Dine-in order type used to be permanently disabled — there was
 * no POS-safe way to read tables, so the UI switched it off client-side
 * rather than call the back-office `GET /org/branches/{id}/tables` (403 for
 * a Cashier session). This proves the real flow now works end to end: the
 * new `services.sales.tables()` (`GET /orders/tables`) populates a picker,
 * grouped by section, a table must be selected before the order can open,
 * and the chosen real tableId is submitted with the create call — and that
 * takeaway/pickup are completely unaffected by any of it.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/api/auth`. The REAL `@/lib/api/session.ts` runs against jsdom's
 * `localStorage`. Same pattern as `pos-live.test.tsx` /
 * `pos-live.open-orders.test.tsx`.
 */

const { getCurrentSession, listSessionDrawers, tables, openOrder } = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  listSessionDrawers: vi.fn(),
  tables: vi.fn(),
  openOrder: vi.fn(),
}));

vi.mock("@/lib/console/services", () => ({
  services: {
    treasury: {
      getCurrentSession: (...args: unknown[]) => getCurrentSession(...args),
      listSessionDrawers: (...args: unknown[]) => listSessionDrawers(...args),
    },
    operations: {
      tables: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    },
    sales: {
      tables: (...args: unknown[]) => tables(...args),
      mutations: { open: (...args: unknown[]) => openOrder(...args) },
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
    orderType: "dine_in",
    channel: "pos",
    state: "open",
    tableId: "table-1",
    tableLabel: "T1",
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
 * custom listbox, not a native `<select>` — same pattern established in
 * `pos-live.test.tsx`'s own `pickOption` helper) and chooses "Dine In".
 */
async function selectDineIn(user: import("@testing-library/user-event").UserEvent) {
  await user.click(screen.getByLabelText("orders.type"));
  await user.click(screen.getByRole("option", { name: "Dine In" }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  listSessionDrawers.mockResolvedValue(ONE_DRAWER);
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LivePos — Dine-in table selection", () => {
  it("shows real tables grouped by section, with capacity, once Dine-in is selected", async () => {
    tables.mockResolvedValue([
      { id: "t-1", label: "1", section: "Patio", seatCapacity: 4 },
      { id: "t-2", label: "2", section: "Patio", seatCapacity: 2 },
      { id: "t-3", label: "9", section: "Bar", seatCapacity: null },
    ]);
    const user = await enterPosNoOrder();
    await selectDineIn(user);

    await waitFor(() => expect(tables).toHaveBeenCalled());
    expect(await screen.findByText("Patio")).toBeInTheDocument();
    expect(screen.getByText("Bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "9" })).toBeInTheDocument();
  });

  it("requires a table selection before the order can be opened, then submits the real tableId", async () => {
    tables.mockResolvedValue([{ id: "t-1", label: "1", section: null, seatCapacity: 4 }]);
    openOrder.mockResolvedValue(makeOrder());
    const user = await enterPosNoOrder();
    await selectDineIn(user);
    await waitFor(() => expect(tables).toHaveBeenCalled());

    const openButton = await screen.findByRole("button", { name: "pos.openOrder" });
    expect(openButton).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: /^1/ }));
    await waitFor(() => expect(openButton).toBeEnabled());

    await user.click(openButton);
    await waitFor(() => expect(openOrder).toHaveBeenCalled());
    expect(openOrder.mock.calls[0][0]).toMatchObject({ orderType: "dine_in", tableId: "t-1" });
  });

  it("shows the real empty state when the branch has no tables — never a fabricated table", async () => {
    tables.mockResolvedValue([]);
    const user = await enterPosNoOrder();
    await selectDineIn(user);

    expect(await screen.findByText("ops.noTables")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pos.openOrder" })).toBeDisabled();
  });

  it("never calls services.sales.tables for takeaway/pickup — those remain unaffected", async () => {
    await enterPosNoOrder();
    expect(tables).not.toHaveBeenCalled();
    expect(screen.getByText("pos.guests")).toBeInTheDocument();
  });
});
