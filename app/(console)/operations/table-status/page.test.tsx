import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TableStatusRow } from "@/lib/console/services/types";

/*
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — the Dashboard "Operations > Table status"
 * page.
 *
 * `@/lib/console/feeds` is mocked at the boundary the page calls directly
 * (`useTableStatus`) — the hook's own data source, polling, stale-data and
 * failure behaviour are proven in `lib/console/table-status-feed.test.ts`, and
 * the wire contract in `lib/console/services/http.table-status.test.ts`. This
 * file covers what the PAGE renders and how it selects its branch.
 */

const useTableStatusMock = vi.fn();

vi.mock("@/lib/console/feeds", () => ({
  useTableStatus: (...args: unknown[]) => useTableStatusMock(...args),
}));

const BRANCH_1 = { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } };
const BRANCH_2 = { id: "branch-2", name: { en: "Marina", ar: "المارينا" } };

const MANAGER_CODES = new Set(["pos.order.view_history"]);
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

import TableStatusPage from "./page";

const ref = (overrides: Record<string, unknown> = {}) => ({
  id: "order-1",
  businessDay: "2026-09-21",
  orderNumber: "MAIN-10",
  state: "open",
  version: 4,
  ...overrides,
});

const AVAILABLE: TableStatusRow = {
  id: "t-1",
  label: "T1",
  section: null,
  seatCapacity: 4,
  occupancy: "available",
  activeOrder: null,
  conflictingOrders: [],
};
const OCCUPIED: TableStatusRow = {
  ...AVAILABLE,
  id: "t-2",
  label: "T2",
  seatCapacity: 2,
  occupancy: "occupied",
  activeOrder: ref({ orderNumber: "MAIN-10", state: "partially_paid" }),
};
const AMBIGUOUS: TableStatusRow = {
  ...AVAILABLE,
  id: "t-3",
  label: "T3",
  occupancy: "ambiguous",
  conflictingOrders: [
    ref({ id: "a", orderNumber: "MAIN-3" }),
    ref({ id: "b", orderNumber: "MAIN-8" }),
  ],
};

function feed(overrides: Record<string, unknown> = {}) {
  return {
    rows: [AVAILABLE, OCCUPIED, AMBIGUOUS] as TableStatusRow[] | null,
    ready: true,
    error: null as (Error & { status?: number }) | null,
    live: true,
    reload: vi.fn(),
    ...overrides,
  };
}

const card = (label: string) => screen.getByText(label).closest("li")!;

beforeEach(() => {
  vi.clearAllMocks();
  session = {
    scope: { tenantId: "t1", brandId: null, branchId: null },
    branch: BRANCH_1,
    availableBranches: [BRANCH_1],
    grantedCodes: MANAGER_CODES,
  };
  useTableStatusMock.mockReturnValue(feed());
});

afterEach(() => {
  cleanup();
});

describe("Table status — permission and branch selection", () => {
  it("a pos.order.view_history holder reaches the page and the hook gets the resolved branch", async () => {
    render(<TableStatusPage />);

    expect(await screen.findByText("T1")).toBeInTheDocument();
    expect(useTableStatusMock).toHaveBeenCalledWith(BRANCH_1.id);
  });

  it("the Console scope's named branch is what is read", async () => {
    session.scope = { tenantId: "t1", brandId: null, branchId: BRANCH_2.id };
    session.availableBranches = [BRANCH_1, BRANCH_2];
    render(<TableStatusPage />);

    await screen.findByText("T1");
    expect(useTableStatusMock).toHaveBeenCalledWith(BRANCH_2.id);
    expect(screen.queryByLabelText("common.branch")).not.toBeInTheDocument();
  });

  it("Cashier (no pos.order.view_history) is refused by the page's own Gate — the hook is never called, no table is shown", async () => {
    session.grantedCodes = CASHIER_CODES;
    render(<TableStatusPage />);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(useTableStatusMock).not.toHaveBeenCalled();
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
  });

  it("'All branches' with several authorised: an explicit picker, no branch assumed (hook gets null), no tables shown", async () => {
    session.branch = null;
    session.availableBranches = [BRANCH_1, BRANCH_2];
    useTableStatusMock.mockReturnValue(feed({ rows: null, ready: false }));
    render(<TableStatusPage />);

    expect(await screen.findByLabelText("common.branch")).toBeInTheDocument();
    expect(useTableStatusMock).toHaveBeenCalledWith(null);
    expect(screen.getByText("tableStatus.selectBranch")).toBeInTheDocument();
  });

  it("branch change: the picked branch is what the hook is asked for, and the previous branch's tables are NOT shown for the new one", async () => {
    session.branch = null;
    session.availableBranches = [BRANCH_1, BRANCH_2];
    // The hook contract: rows are tagged per branch — branch 2 has none yet.
    useTableStatusMock.mockImplementation((branchId: string | null) => {
      if (branchId === BRANCH_1.id) return feed({ rows: [AVAILABLE] });
      if (branchId === BRANCH_2.id) return feed({ rows: null, ready: false });
      return feed({ rows: null, ready: false });
    });
    const user = userEvent.setup();
    render(<TableStatusPage />);

    await user.click(await screen.findByLabelText("common.branch"));
    await user.click(screen.getByRole("option", { name: "Downtown" }));
    expect(await screen.findByText("T1")).toBeInTheDocument();

    // The custom Select stays open after a pick (its option click re-activates
    // the wrapping <label>'s button); open it only if it is not already.
    if (!screen.queryByRole("option", { name: "Marina" })) {
      await user.click(screen.getByRole("button", { name: /Downtown/ }));
    }
    await user.click(screen.getByRole("option", { name: "Marina" }));

    await waitFor(() => expect(useTableStatusMock).toHaveBeenLastCalledWith(BRANCH_2.id));
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Table status — what each occupancy renders", () => {
  it("Available: label, capacity and the Available badge — no order", async () => {
    render(<TableStatusPage />);
    await screen.findByText("T1");

    const t1 = card("T1");
    expect(t1).toHaveAttribute("data-occupancy", "available");
    expect(within(t1).getByText("pos.tableAvailable")).toBeInTheDocument();
    expect(within(t1).getByText(/4/)).toBeInTheDocument();
    expect(within(t1).queryByText(/MAIN-/)).not.toBeInTheDocument();
  });

  it("Occupied: the Occupied badge plus the canonical order reference and its real lifecycle state", async () => {
    render(<TableStatusPage />);
    await screen.findByText("T2");

    const t2 = card("T2");
    expect(t2).toHaveAttribute("data-occupancy", "occupied");
    expect(within(t2).getByText("pos.tableOccupied")).toBeInTheDocument();
    expect(within(t2).getByText("MAIN-10")).toBeInTheDocument();
    // The order's own state ("partially_paid"), from the existing order labels.
    expect(within(t2).getByText("Partially paid")).toBeInTheDocument();
    expect(within(t2).queryByText("pos.tableAvailable")).not.toBeInTheDocument();
  });

  it("Ambiguous: a conflict/attention card that lists EVERY conflicting order equally and presents none as canonical", async () => {
    render(<TableStatusPage />);
    await screen.findByText("T3");

    const t3 = card("T3");
    expect(t3).toHaveAttribute("data-occupancy", "ambiguous");
    expect(within(t3).getByText("pos.tableConflict")).toBeInTheDocument();
    expect(within(t3).getByText(/tableStatus\.conflictNote/)).toBeInTheDocument();
    // Both numbers, in ONE undifferentiated line — neither is singled out.
    expect(within(t3).getByText("MAIN-3 · MAIN-8")).toBeInTheDocument();
    expect(within(t3).queryByText("pos.tableOccupied")).not.toBeInTheDocument();
    expect(within(t3).queryByText("pos.tableAvailable")).not.toBeInTheDocument();
    // No order lifecycle state is shown for a conflict: there is no "the" order.
    expect(within(t3).queryByText("Open")).not.toBeInTheDocument();
  });

  it("invents no richer floor state — none of seated / food served / bill requested / needs cleaning appears anywhere", async () => {
    render(<TableStatusPage />);
    await screen.findByText("T1");

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/seated|food served|bill requested|needs cleaning|payment in progress/i);
    expect(text).not.toMatch(/tables\.seatedFor|tables\.free/);
  });

  it("the summary counts come from the rows the backend returned", async () => {
    render(<TableStatusPage />);
    await screen.findByText("T1");

    const summary = screen.getByTestId("table-status-summary");
    expect(within(summary).getByText(/pos\.tableAvailable · 1/)).toBeInTheDocument();
    expect(within(summary).getByText(/pos\.tableOccupied · 1/)).toBeInTheDocument();
    expect(within(summary).getByText(/pos\.tableConflict · 1/)).toBeInTheDocument();
  });

  it("no conflict badge in the summary when nothing is in conflict", async () => {
    useTableStatusMock.mockReturnValue(feed({ rows: [AVAILABLE, OCCUPIED] }));
    render(<TableStatusPage />);
    await screen.findByText("T1");

    expect(within(screen.getByTestId("table-status-summary")).queryByText(/pos\.tableConflict/)).not.toBeInTheDocument();
  });

  it("groups by section when the branch defines them", async () => {
    useTableStatusMock.mockReturnValue(
      feed({ rows: [{ ...AVAILABLE, section: "Patio" }, { ...OCCUPIED, section: "Bar" }] }),
    );
    render(<TableStatusPage />);

    expect(await screen.findByText("Patio")).toBeInTheDocument();
    expect(screen.getByText("Bar")).toBeInTheDocument();
  });
});

describe("Table status — loading, empty and failure states (never 'all available')", () => {
  it("loading: a status panel, no tables", async () => {
    useTableStatusMock.mockReturnValue(feed({ rows: null, ready: false }));
    render(<TableStatusPage />);

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("pos.tableAvailable")).not.toBeInTheDocument();
  });

  it("no configured tables: the truthful empty state", async () => {
    useTableStatusMock.mockReturnValue(feed({ rows: [] }));
    render(<TableStatusPage />);

    expect(await screen.findByText("ops.noTables")).toBeInTheDocument();
    expect(screen.queryByTestId("table-status-summary")).not.toBeInTheDocument();
  });

  it("403: an authorization message and NO table list", async () => {
    useTableStatusMock.mockReturnValue(
      feed({ rows: null, error: Object.assign(new Error("forbidden"), { status: 403 }) }),
    );
    render(<TableStatusPage />);

    expect(await screen.findByText("tableStatus.forbidden")).toBeInTheDocument();
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
    expect(screen.queryByText("pos.tableAvailable")).not.toBeInTheDocument();
  });

  it("404: a branch-unavailable message that names nothing else, and NO table list", async () => {
    useTableStatusMock.mockReturnValue(
      feed({ rows: null, error: Object.assign(new Error("Branch abc not found in tenant xyz"), { status: 404 }) }),
    );
    render(<TableStatusPage />);

    expect(await screen.findByText("tableStatus.notFound")).toBeInTheDocument();
    // The raw backend wording is not echoed for a refusal.
    expect(screen.queryByText(/tenant xyz/)).not.toBeInTheDocument();
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
  });

  it("network failure: the console's error panel with Retry — no tables, never 'all available'", async () => {
    const reload = vi.fn();
    const user = userEvent.setup();
    useTableStatusMock.mockReturnValue(
      feed({ rows: null, reload, error: Object.assign(new Error("The backend did not answer."), { status: 0 }) }),
    );
    render(<TableStatusPage />);

    expect(await screen.findByText("The backend did not answer.")).toBeInTheDocument();
    expect(screen.queryByText("pos.tableAvailable")).not.toBeInTheDocument();
    expect(screen.queryByText("T1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /state\.errorRetry/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
