import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KitchenQueueSnapshot } from "@/lib/console/types";

/**
 * KITCHEN-QUEUE-MANAGER-REAL-BACKEND-P0 — the Dashboard "Operations >
 * Kitchen queue" page.
 *
 * `@/lib/console/feeds` is mocked at the boundary `KitchenPage` calls
 * directly (`useKitchenQueue`) — the hook's own real-vs-local data-source
 * behavior and polling/cleanup are proven separately in
 * `lib/console/kitchen-queue-feed.test.ts`; this file covers the PAGE's own
 * branch-selection, rendering and permission-gating behaviour.
 *
 * Permission mocks model `useSession().canAny` as a real granted-code-set
 * lookup (OR semantics), matching `operations/tables/page.test.tsx`'s own
 * convention — not a role-name heuristic.
 */

const useKitchenQueueMock = vi.fn();

vi.mock("@/lib/console/feeds", () => ({
  useKitchenQueue: (...args: unknown[]) => useKitchenQueueMock(...args),
}));

const BRANCH_1 = { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } };
const BRANCH_2 = { id: "branch-2", name: { en: "Marina", ar: "المارينا" } };

const BRANCH_MANAGER_CODES = new Set(["kitchen.queue.view", "pos.order.create"]);
const CASHIER_CODES = new Set(["pos.order.create", "cash.session.open", "menu.item.read"]);

let session = {
  scope: { tenantId: "t1", brandId: null as string | null, branchId: null as string | null },
  branch: null as typeof BRANCH_1 | null,
  availableBranches: [BRANCH_1] as (typeof BRANCH_1)[],
  grantedCodes: BRANCH_MANAGER_CODES,
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

import KitchenPage from "./page";

const TICKET_1 = {
  id: "t1",
  branchId: BRANCH_1.id,
  orderId: "o1",
  orderNumber: "ORD-1",
  orderType: "dine_in" as const,
  tableLabel: "Table 4",
  stationId: "station-1",
  stationName: { en: "Grill", ar: "الشواية" },
  state: "queued" as const,
  urgency: "on_target" as const,
  course: 1,
  priority: "normal" as const,
  firedAt: "2026-09-20T11:59:00.000Z",
  startedAt: null,
  bumpedAt: null,
  cancelReason: null,
  targetSeconds: 0,
  elapsedSeconds: 90,
  lines: [{ id: "l1", name: { en: "Burger", ar: "برجر" }, quantity: 2, modifiers: [], state: "fired" as const, notes: null, cancelledAt: null }],
  delayed: false,
};

const SNAPSHOT_ONE_STATION: KitchenQueueSnapshot = {
  branchId: BRANCH_1.id,
  dataAsOf: "2026-09-20T12:00:00.000Z",
  stations: [
    { stationId: "station-1", stationName: { en: "Grill", ar: "الشواية" }, colour: "#000", queueDepth: 1, tickets: [TICKET_1] },
    { stationId: "station-2", stationName: { en: "Packaging", ar: "التعبئة" }, colour: "#111", queueDepth: 0, tickets: [] },
  ],
  totalActiveTickets: 1,
  averageWaitSeconds: 90,
};

function feed(overrides: Partial<ReturnType<typeof defaultFeed>> = {}) {
  return { ...defaultFeed(), ...overrides };
}
function defaultFeed() {
  return {
    snapshot: SNAPSHOT_ONE_STATION as typeof SNAPSHOT_ONE_STATION | null,
    ready: true,
    error: null as Error | null,
    live: true,
    reload: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session = {
    scope: { tenantId: "t1", brandId: null, branchId: null },
    branch: BRANCH_1,
    availableBranches: [BRANCH_1],
    grantedCodes: BRANCH_MANAGER_CODES,
  };
  useKitchenQueueMock.mockReturnValue(feed());
});

afterEach(() => {
  cleanup();
});

describe("Kitchen Queue — permissions (20, 21)", () => {
  it("21. a kitchen.queue.view holder (Branch Manager) reaches the page", async () => {
    render(<KitchenPage />);
    expect(await screen.findByText("ORD-1")).toBeInTheDocument();
  });

  it("20. Cashier (no kitchen.queue.view) is refused by the page's own Gate — never calls the hook, never renders a ticket", async () => {
    session.grantedCodes = CASHIER_CODES;
    render(<KitchenPage />);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(useKitchenQueueMock).not.toHaveBeenCalled();
    expect(screen.queryByText("ORD-1")).not.toBeInTheDocument();
  });
});

describe("Kitchen Queue — branch selection (15, 16)", () => {
  it("15. exactly one authorised branch resolves automatically and is sent to the hook, with no picker shown", async () => {
    render(<KitchenPage />);

    await waitFor(() => expect(useKitchenQueueMock).toHaveBeenCalledWith(BRANCH_1.id, expect.anything()));
    expect(screen.queryByLabelText("common.branch")).not.toBeInTheDocument();
  });

  it("16. multiple authorised branches (All-branches scope) show an explicit picker, and no branch is assumed until one is chosen", async () => {
    session.branch = null;
    session.availableBranches = [BRANCH_1, BRANCH_2];
    useKitchenQueueMock.mockReturnValue(feed({ snapshot: null, ready: true }));

    render(<KitchenPage />);

    expect(await screen.findByLabelText("common.branch")).toBeInTheDocument();
    // No default branch is assumed when the session names none — the hook
    // is called with null, not silently defaulted to the first option.
    expect(useKitchenQueueMock).toHaveBeenCalledWith(null, expect.anything());
    expect(screen.getByText("kds.selectBranch")).toBeInTheDocument();
  });

  it("16. picking a branch from the picker sends exactly that branch to the hook — never a merged/All-branches read", async () => {
    session.branch = null;
    session.availableBranches = [BRANCH_1, BRANCH_2];
    useKitchenQueueMock.mockReturnValue(feed({ snapshot: null, ready: true }));
    const user = userEvent.setup();

    render(<KitchenPage />);
    await screen.findByLabelText("common.branch");

    // `Select` is a custom listbox (button + popup), not a native <select>.
    await user.click(screen.getByLabelText("common.branch"));
    await user.click(screen.getByRole("option", { name: "Marina" }));

    await waitFor(() => expect(useKitchenQueueMock).toHaveBeenCalledWith(BRANCH_2.id, expect.anything()));
  });
});

describe("Kitchen Queue — real data rendering, states (17, 18, 19)", () => {
  it("17. renders real ticket and station data from the snapshot — station grouping, queue depth, elapsed", async () => {
    render(<KitchenPage />);

    expect(await screen.findByText("ORD-1")).toBeInTheDocument();
    // "Grill" appears twice by design — once in the per-station summary,
    // once as the ticket row's own station column.
    expect(screen.getAllByText("Grill").length).toBe(2);
    expect(screen.getByText("Packaging")).toBeInTheDocument();
    // Station summary shows the real queueDepth for each station, including
    // the empty one (0), never omitted. ("1" also appears in the queue-depth
    // KPI tile — two occurrences of "1" is therefore correct here.)
    expect(screen.getAllByText("1").length).toBe(2);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("18. loading state — ready:false, no snapshot yet — shows a loading panel, not an empty table", async () => {
    useKitchenQueueMock.mockReturnValue(feed({ snapshot: null, ready: false }));
    render(<KitchenPage />);

    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("18. error state surfaces the real service error and offers retry", async () => {
    const reload = vi.fn();
    useKitchenQueueMock.mockReturnValue(
      feed({ snapshot: null, error: new Error("Branch not found."), reload }),
    );
    render(<KitchenPage />);

    expect(await screen.findByText("Branch not found.")).toBeInTheDocument();
  });

  it("18. empty branch — ready snapshot with zero active tickets — shows the real empty state, never a fabricated row", async () => {
    useKitchenQueueMock.mockReturnValue(
      feed({
        snapshot: { ...SNAPSHOT_ONE_STATION, stations: SNAPSHOT_ONE_STATION.stations.map((s) => ({ ...s, tickets: [], queueDepth: 0 })), totalActiveTickets: 0, averageWaitSeconds: null },
      }),
    );
    render(<KitchenPage />);

    expect(await screen.findByText("kds.emptyBranch")).toBeInTheDocument();
    expect(screen.queryByText("ORD-1")).not.toBeInTheDocument();
  });

  it("19. a delayed ticket (server-computed, real targetReadyAt-derived flag) shows the delayed badge; a non-delayed one does not", async () => {
    const delayedTicket = { ...TICKET_1, id: "t2", orderNumber: "ORD-2", delayed: true };
    useKitchenQueueMock.mockReturnValue(
      feed({
        snapshot: {
          ...SNAPSHOT_ONE_STATION,
          stations: [
            { ...SNAPSHOT_ONE_STATION.stations[0]!, tickets: [TICKET_1, delayedTicket], queueDepth: 2 },
            SNAPSHOT_ONE_STATION.stations[1]!,
          ],
          totalActiveTickets: 2,
        },
      }),
    );
    render(<KitchenPage />);

    await screen.findByText("ORD-2");
    expect(screen.getAllByText("kds.delayed")).toHaveLength(1);
  });
});
