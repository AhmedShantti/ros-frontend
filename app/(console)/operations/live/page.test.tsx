import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KitchenQueueSnapshot, Order } from "@/lib/console/types";
import type { TableStatusRow } from "@/lib/console/services/types";

/*
 * LIVE-OPERATIONS-P0 — the Console "Operations > Live" cockpit.
 *
 * `@/lib/console/feeds` is mocked at the boundary the page calls directly
 * (`useBranchOpenOrders`, `useTableStatus`, `useKitchenQueue`) — each hook's
 * own data source, polling, stale-data and failure behaviour is proven
 * separately (`lib/console/branch-open-orders-feed.test.ts`,
 * `lib/console/table-status-feed.test.ts`, `lib/console/kitchen-queue-feed.
 * test.ts`); this file covers what the PAGE renders, how it picks a branch,
 * and how it gates each card.
 *
 * Because the page never imports anything KDS/terminal-related — only the
 * three Dashboard-safe hooks above — it structurally cannot reach the KDS
 * station-operator queue endpoint or a KDS session; that boundary is proven
 * once, at the hook level, in `kitchen-queue-feed.test.ts`.
 */

const useBranchOpenOrdersMock = vi.fn();
const useTableStatusMock = vi.fn();
const useKitchenQueueMock = vi.fn();

vi.mock("@/lib/console/feeds", () => ({
  useBranchOpenOrders: (...args: unknown[]) => useBranchOpenOrdersMock(...args),
  useTableStatus: (...args: unknown[]) => useTableStatusMock(...args),
  useKitchenQueue: (...args: unknown[]) => useKitchenQueueMock(...args),
}));

const BRANCH_1 = { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } };
const BRANCH_2 = { id: "branch-2", name: { en: "Marina", ar: "المارينا" } };

const MANAGER_CODES = new Set(["pos.order.view_history", "kitchen.queue.view"]);
const ORDERS_ONLY_CODES = new Set(["pos.order.view_history"]);
const KITCHEN_ONLY_CODES = new Set(["kitchen.queue.view"]);
const CASHIER_CODES = new Set(["pos.order.create", "cash.session.open"]);

let session = {
  scope: { tenantId: "t1", brandId: null as string | null, branchId: null as string | null },
  branch: null as typeof BRANCH_1 | null,
  availableBranches: [BRANCH_1] as (typeof BRANCH_1)[],
  grantedCodes: MANAGER_CODES,
};

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
    scope: session.scope,
    branch: session.branch,
    availableBranches: session.availableBranches,
    can: (permission: string) => session.grantedCodes.has(permission),
    canAny: (list: string[]) => list.length === 0 || list.some((p) => session.grantedCodes.has(p)),
  }),
}));

import LiveOperationsPage from "./page";

const wireOrder = (id: string, state: Order["state"] = "open"): Order =>
  ({ id, orderNumber: `MAIN-${id}`, state }) as unknown as Order;

const OPEN_ORDERS: Order[] = [wireOrder("10"), wireOrder("11"), wireOrder("12", "partially_paid")];

const tableRow = (id: string, label: string, occupancy: TableStatusRow["occupancy"]): TableStatusRow => ({
  id,
  label,
  section: null,
  seatCapacity: 4,
  occupancy,
  activeOrder: null,
  conflictingOrders: [],
});
const TABLE_ROWS: TableStatusRow[] = [
  tableRow("t1", "1", "available"),
  tableRow("t2", "2", "available"),
  tableRow("t3", "3", "occupied"),
  tableRow("t4", "7", "ambiguous"),
];

const kitchenTicket = (id: string, delayed: boolean, elapsedSeconds = 120) => ({
  id,
  orderNumber: `MAIN-${id}`,
  delayed,
  elapsedSeconds,
});
const kitchenSnapshot = (branchId: string): KitchenQueueSnapshot =>
  ({
    branchId,
    dataAsOf: "2026-09-22T10:00:00.000Z",
    stations: [
      {
        stationId: "s1",
        stationName: { en: "Grill", ar: "الشواية" },
        colour: "#000",
        queueDepth: 2,
        tickets: [kitchenTicket("41", true, 14 * 60), kitchenTicket("42", false)],
      },
    ],
    totalActiveTickets: 2,
    averageWaitSeconds: 522,
  }) as unknown as KitchenQueueSnapshot;

function openOrdersFeed(overrides: Record<string, unknown> = {}) {
  return { rows: OPEN_ORDERS, ready: true, error: null, live: true, reload: vi.fn(), ...overrides };
}
function tableFeed(overrides: Record<string, unknown> = {}) {
  return { rows: TABLE_ROWS, ready: true, error: null, live: true, reload: vi.fn(), ...overrides };
}
function kitchenFeed(branchId: string, overrides: Record<string, unknown> = {}) {
  return {
    snapshot: kitchenSnapshot(branchId),
    ready: true,
    error: null,
    live: true,
    reload: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session = {
    scope: { tenantId: "t1", brandId: null, branchId: null },
    branch: BRANCH_1,
    availableBranches: [BRANCH_1],
    grantedCodes: MANAGER_CODES,
  };
  useBranchOpenOrdersMock.mockReturnValue(openOrdersFeed());
  useTableStatusMock.mockReturnValue(tableFeed());
  useKitchenQueueMock.mockReturnValue(kitchenFeed(BRANCH_1.id));
});

afterEach(() => {
  cleanup();
});

describe("Live Operations — branch resolution and source calls", () => {
  it("a concrete branch triggers all three canonical reads with that branch", async () => {
    render(<LiveOperationsPage />);
    await screen.findByText("3");

    expect(useBranchOpenOrdersMock).toHaveBeenCalledWith(BRANCH_1.id);
    expect(useTableStatusMock).toHaveBeenCalledWith(BRANCH_1.id);
    expect(useKitchenQueueMock).toHaveBeenCalledWith(BRANCH_1.id, session.scope);
  });

  it("'All branches' with several authorised branches: an explicit picker, no branch-specific request sent", async () => {
    session.branch = null;
    session.scope = { tenantId: "t1", brandId: null, branchId: null };
    session.availableBranches = [BRANCH_1, BRANCH_2];
    render(<LiveOperationsPage />);

    expect(await screen.findByLabelText("common.branch")).toBeInTheDocument();
    expect(screen.getByText("liveOps.selectBranch")).toBeInTheDocument();
    expect(useBranchOpenOrdersMock).toHaveBeenCalledWith(null);
    expect(useTableStatusMock).toHaveBeenCalledWith(null);
    expect(useKitchenQueueMock).toHaveBeenCalledWith(null, session.scope);
  });

  it("branch change: the new branch is what every hook is asked for", async () => {
    session.branch = null;
    session.scope = { tenantId: "t1", brandId: null, branchId: null };
    session.availableBranches = [BRANCH_1, BRANCH_2];
    const user = userEvent.setup();
    render(<LiveOperationsPage />);

    await user.click(await screen.findByLabelText("common.branch"));
    await user.click(screen.getByRole("option", { name: "Downtown" }));

    await waitFor(() => expect(useBranchOpenOrdersMock).toHaveBeenLastCalledWith(BRANCH_1.id));
    expect(useTableStatusMock).toHaveBeenLastCalledWith(BRANCH_1.id);
    expect(useKitchenQueueMock).toHaveBeenLastCalledWith(BRANCH_1.id, session.scope);
  });
});

describe("Live Operations — summary cards", () => {
  it("Open Orders shows the canonical count", async () => {
    render(<LiveOperationsPage />);
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("Tables shows available/occupied/conflict counts from the same source table-status uses", async () => {
    render(<LiveOperationsPage />);
    await screen.findByText(/pos\.tableAvailable/);

    expect(screen.getByText(/pos\.tableAvailable · 2/)).toBeInTheDocument();
    expect(screen.getByText(/pos\.tableOccupied · 1/)).toBeInTheDocument();
    expect(screen.getByText(/pos\.tableConflict · 1/)).toBeInTheDocument();
  });

  it("Kitchen shows queue depth, delayed count and the canonical average wait", async () => {
    render(<LiveOperationsPage />);
    await screen.findByText(/kds\.queue/);

    expect(screen.getByText(/kds\.queue · 2/)).toBeInTheDocument();
    expect(screen.getByText(/kds\.delayed · 1/)).toBeInTheDocument();
    expect(screen.getByText(/kds\.avgWait/)).toHaveTextContent("8:42");
  });

  it("drill-down links point at the existing production pages", async () => {
    render(<LiveOperationsPage />);
    await screen.findByText("3");

    expect(screen.getAllByText("dash.viewAll")[0]!.closest("a")).toHaveAttribute(
      "href",
      "/operations/open-orders",
    );
    expect(screen.getAllByText("dash.viewAll")[1]!.closest("a")).toHaveAttribute(
      "href",
      "/operations/table-status",
    );
    expect(screen.getAllByText("dash.viewAll")[2]!.closest("a")).toHaveAttribute(
      "href",
      "/operations/kitchen",
    );
  });
});

describe("Live Operations — Attention Needed", () => {
  it("includes a delayed kitchen ticket, a table conflict and a partially-paid order, each linking to its own page", async () => {
    render(<LiveOperationsPage />);
    await screen.findByText("liveOps.attention");

    const delayedRow = screen.getByText("MAIN-41").closest("li")!;
    expect(within(delayedRow).getByText("liveOps.delayedMinutes")).toBeInTheDocument();
    expect(within(delayedRow).getByRole("link")).toHaveAttribute("href", "/operations/kitchen");

    const conflictRow = screen.getByText("7").closest("li")!;
    expect(within(conflictRow).getByText("pos.tableConflict")).toBeInTheDocument();
    expect(within(conflictRow).getByRole("link")).toHaveAttribute("href", "/operations/table-status");

    const paidRow = screen.getByText("MAIN-12").closest("li")!;
    expect(within(paidRow).getByRole("link")).toHaveAttribute("href", "/operations/open-orders");

    // MAIN-42 (not delayed) and the available/occupied tables never appear here.
    expect(screen.queryByText("MAIN-42")).not.toBeInTheDocument();
  });

  it("shows nothing invented — no terminal/offline state anywhere on the page", async () => {
    render(<LiveOperationsPage />);
    await screen.findByText("liveOps.attention");

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/terminal.*(online|offline)|device.*(online|offline)/i);
  });

  it("a partially-paid order appears ONLY when the canonical Open Orders data actually returns one", async () => {
    useBranchOpenOrdersMock.mockReturnValue(openOrdersFeed({ rows: [wireOrder("20"), wireOrder("21")] }));
    render(<LiveOperationsPage />);
    await screen.findByText("liveOps.attention");

    expect(screen.queryByText(/MAIN-2[01]/)?.closest("li")).toBeUndefined();
  });

  it("the empty state renders when every source is ready with nothing to flag", async () => {
    useKitchenQueueMock.mockReturnValue(
      kitchenFeed(BRANCH_1.id, {
        snapshot: { ...kitchenSnapshot(BRANCH_1.id), stations: [], totalActiveTickets: 0 },
      }),
    );
    useTableStatusMock.mockReturnValue(tableFeed({ rows: TABLE_ROWS.filter((r) => r.occupancy !== "ambiguous") }));
    useBranchOpenOrdersMock.mockReturnValue(openOrdersFeed({ rows: [wireOrder("30")] }));
    render(<LiveOperationsPage />);

    expect(await screen.findByText("liveOps.attentionEmpty")).toBeInTheDocument();
  });
});

describe("Live Operations — one source failing never fabricates or destroys another card", () => {
  it("Kitchen network failure: Kitchen shows an error, Open Orders and Tables still render", async () => {
    useKitchenQueueMock.mockReturnValue(
      kitchenFeed(BRANCH_1.id, {
        snapshot: null,
        error: Object.assign(new Error("The backend did not answer."), { status: 0 }),
      }),
    );
    render(<LiveOperationsPage />);

    expect(await screen.findByText("The backend did not answer.")).toBeInTheDocument();
    expect(screen.queryByText(/kds\.queue ·/)).not.toBeInTheDocument();
    // Never a fabricated zero for the failed source.
    expect(screen.queryByText(/kds\.queue · 0/)).not.toBeInTheDocument();
    // Sibling cards are unaffected.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/pos\.tableAvailable · 2/)).toBeInTheDocument();
  });

  it("Table Status 403 does not leak previously-loaded table data and shows no rows", async () => {
    useTableStatusMock.mockReturnValue(
      tableFeed({ rows: null, error: Object.assign(new Error("forbidden"), { status: 403 }) }),
    );
    render(<LiveOperationsPage />);

    await screen.findByText("3");
    expect(screen.queryByText(/pos\.tableAvailable ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pos\.tableConflict ·/)).not.toBeInTheDocument();
  });

  it("Kitchen 403 does not leak previously-loaded queue data", async () => {
    useKitchenQueueMock.mockReturnValue(
      kitchenFeed(BRANCH_1.id, {
        snapshot: null,
        error: Object.assign(new Error("forbidden"), { status: 403 }),
      }),
    );
    render(<LiveOperationsPage />);

    await screen.findByText("3");
    expect(screen.queryByText(/kds\.queue ·/)).not.toBeInTheDocument();
  });

  it("Open Orders network error shows the error panel, never a fabricated 0", async () => {
    useBranchOpenOrdersMock.mockReturnValue(
      openOrdersFeed({ rows: null, error: Object.assign(new Error("down"), { status: 0 }) }),
    );
    render(<LiveOperationsPage />);

    expect(await screen.findByText("down")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("Live Operations — permissions (card-level, never a combined permission)", () => {
  it("a principal with neither permission never reaches the page", async () => {
    session.grantedCodes = CASHIER_CODES;
    render(<LiveOperationsPage />);

    expect(await screen.findByText("state.deniedTitle")).toBeInTheDocument();
    expect(useBranchOpenOrdersMock).not.toHaveBeenCalled();
    expect(useTableStatusMock).not.toHaveBeenCalled();
    expect(useKitchenQueueMock).not.toHaveBeenCalled();
  });

  it("pos.order.view_history only: Open Orders and Tables render, Kitchen shows a permission-denied card", async () => {
    session.grantedCodes = ORDERS_ONLY_CODES;
    render(<LiveOperationsPage />);

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText(/pos\.tableAvailable ·/)).toBeInTheDocument();
    expect(screen.getByText("state.deniedTitle")).toBeInTheDocument();
    expect(screen.getByText("kitchen.queue.view")).toBeInTheDocument();
    expect(useKitchenQueueMock).toHaveBeenCalledWith(null, session.scope);
  });

  it("kitchen.queue.view only: Kitchen renders, Open Orders and Tables show permission-denied cards", async () => {
    session.grantedCodes = KITCHEN_ONLY_CODES;
    render(<LiveOperationsPage />);

    expect(await screen.findByText(/kds\.queue ·/)).toBeInTheDocument();
    expect(screen.getAllByText("state.deniedTitle")).toHaveLength(2);
    expect(useBranchOpenOrdersMock).toHaveBeenCalledWith(null);
    expect(useTableStatusMock).toHaveBeenCalledWith(null);
  });
});
