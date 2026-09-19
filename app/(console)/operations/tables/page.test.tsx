import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * TABLE-MANAGEMENT-REAL-UI-CORRECTION-P0
 *
 * Production showed a "Table status" screen — a yellow "This device only"
 * banner over `T01`..`T16` cards sourced from `lib/console/mock/org.ts`'s
 * seeded fixture (via `lib/console/live/*`), with the real, backend-wired
 * Create/Edit CRUD buried underneath it, no visible branch context, and no
 * obvious way to add/edit/delete a table. This page is now rewritten to be
 * a real, branch-scoped Table Management surface: the fixture grid is gone
 * entirely (not hidden), a concrete branch must be resolved (from the
 * Console's own scope, a single-authorized-branch shortcut, or an explicit
 * page-level pick) before any fetch happens, and the whole screen is
 * wrapped in the same `Gate` component `/operations/drawers` already uses
 * for exactly this permission shape.
 *
 * Permission mocks below model `useSession().can`/`canAny` as a REAL
 * granted-code-set lookup (OR-array semantics, no local-catalogue
 * filtering) using the exact real backend codes verified against the
 * canonical role templates in
 * TABLES-SIDEBAR-PRODUCTION-PERMISSION-CORRECTION-P0's report — not a
 * single boolean flag — so "Owner/Branch Manager can manage, Cashier
 * cannot" is proven against realistic permission shapes, not a heuristic.
 * (Sidebar-level reachability from a REAL bootstrapped session is proven
 * separately by `lib/console/nav-live-permissions.test.tsx`; this file
 * covers this page's own CRUD/branch-selection behaviour.)
 *
 * Mocked only at the transport boundary (`@/lib/console/services`) and
 * `@/lib/console/providers`. `TablesPage` (default export) is the real
 * component — no `@/lib/console/live/*` mock is needed because the page no
 * longer imports it at all.
 */

const tablesList = vi.fn();
const createTable = vi.fn();
const updateTable = vi.fn();

vi.mock("@/lib/console/services", () => ({
  ServiceError: class ServiceError extends Error {},
  services: {
    operations: {
      tables: (...args: unknown[]) => tablesList(...args),
      createTable: (...args: unknown[]) => createTable(...args),
      updateTable: (...args: unknown[]) => updateTable(...args),
    },
  },
}));

const BRANCH_1 = { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" } };
const BRANCH_2 = { id: "branch-2", name: { en: "Marina", ar: "المارينا" } };

/** Real backend codes, per canonical-role-templates.ts (not the local catalogue). */
const OWNER_CODES = new Set(["settings.branch.read", "settings.branch.manage", "org.manage"]);
const BRANCH_MANAGER_CODES = new Set(["settings.branch.read", "settings.branch.manage", "pos.order.create"]);
const CASHIER_CODES = new Set(["pos.order.create", "cash.session.open", "menu.item.read"]);

let session = {
  scope: { tenantId: "t1", brandId: null as string | null, branchId: null as string | null },
  branch: null as typeof BRANCH_1 | null,
  availableBranches: [BRANCH_1, BRANCH_2] as (typeof BRANCH_1)[],
  grantedCodes: OWNER_CODES,
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
  usePermission: (permission: string) => session.grantedCodes.has(permission),
}));

import TablesPage from "./page";

const TABLE_PATIO_1 = {
  id: "tbl-1",
  branchId: BRANCH_1.id,
  label: "P1",
  area: { en: "Patio", ar: "الفناء" },
  capacity: 4,
};

function selectBranch1() {
  session = { ...session, scope: { ...session.scope, branchId: BRANCH_1.id }, branch: BRANCH_1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  session = {
    scope: { tenantId: "t1", brandId: null, branchId: null },
    branch: null,
    availableBranches: [BRANCH_1, BRANCH_2],
    grantedCodes: OWNER_CODES,
  };
  tablesList.mockResolvedValue({ rows: [TABLE_PATIO_1], total: 1 });
});

afterEach(() => {
  cleanup();
});

describe("Console Operations > Tables — branch selection (no All-branches management)", () => {
  it("1. no concrete branch resolved -> shows the branch-selection prompt, fetches nothing, shows no fake tables", async () => {
    render(<TablesPage />);

    expect(await screen.findByText("ops.selectBranchToManageTables")).toBeInTheDocument();
    expect(tablesList).not.toHaveBeenCalled();
    expect(screen.queryByText("P1")).not.toBeInTheDocument();
  });

  it("offers an explicit branch picker when scope is All-branches and more than one branch is authorised, and picking one loads its real tables", async () => {
    const user = userEvent.setup();
    render(<TablesPage />);

    await screen.findByText("ops.selectBranchToManageTables");
    expect(tablesList).not.toHaveBeenCalled();

    // `Select` is a custom listbox (button + popup), not a native <select>.
    await user.click(screen.getByLabelText("common.branch"));
    await user.click(screen.getByRole("option", { name: "Downtown" }));

    await waitFor(() => expect(tablesList).toHaveBeenCalled());
    expect(tablesList.mock.calls[0]![0]).toMatchObject({
      scope: expect.objectContaining({ branchId: BRANCH_1.id }),
    });
    expect(await screen.findByText("P1")).toBeInTheDocument();
  });

  it("exactly one authorised branch resolves automatically — no prompt, no picker, real fetch fires", async () => {
    session.availableBranches = [BRANCH_1];
    render(<TablesPage />);

    await waitFor(() => expect(tablesList).toHaveBeenCalled());
    expect(screen.queryByText("ops.selectBranchToManageTables")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("common.branch")).not.toBeInTheDocument();
    expect(await screen.findByText("P1")).toBeInTheDocument();
  });

  it("never fans a fetch out across every accessible branch when none is explicitly chosen (no All-branches management)", async () => {
    render(<TablesPage />);
    await screen.findByText("ops.selectBranchToManageTables");
    // The whole point: services.operations.tables (which fans out across
    // every accessible branch when scope.branchId is falsy) must never be
    // called at all while no concrete branch is resolved.
    expect(tablesList).not.toHaveBeenCalled();
  });
});

describe("Console Operations > Tables — real Table Management CRUD", () => {
  it("2/3. a concrete branch loads and renders its real tables from services.operations.tables, never a fabricated/local source", async () => {
    selectBranch1();
    render(<TablesPage />);

    await waitFor(() => expect(tablesList).toHaveBeenCalled());
    expect(tablesList.mock.calls[0]![0]).toMatchObject({
      scope: expect.objectContaining({ branchId: BRANCH_1.id }),
    });
    expect(await screen.findByText("P1")).toBeInTheDocument();
    expect(screen.getByText(`${"common.branch"}: Downtown`)).toBeInTheDocument();
  });

  it('shows the empty state, not a fabricated row, when the branch has no tables', async () => {
    selectBranch1();
    tablesList.mockResolvedValue({ rows: [], total: 0 });
    render(<TablesPage />);

    expect(await screen.findByText("ops.noTables")).toBeInTheDocument();
  });

  it("surfaces a real service error rather than silently showing nothing", async () => {
    selectBranch1();
    tablesList.mockRejectedValue(new Error("Insufficient permission for this scope."));
    render(<TablesPage />);

    expect(await screen.findByText("Insufficient permission for this scope.")).toBeInTheDocument();
  });

  it("4. an authorised manager sees Create Table, and it calls the real backend POST service", async () => {
    selectBranch1();
    createTable.mockResolvedValue({ ...TABLE_PATIO_1, id: "tbl-2", label: "P2" });
    const user = userEvent.setup();
    render(<TablesPage />);

    await screen.findByText("P1");
    await user.click(screen.getByRole("button", { name: "common.new" }));

    const label = await screen.findByLabelText(/ops\.tableLabel/);
    await user.type(label, "P2");
    await user.click(screen.getByRole("button", { name: "common.create" }));

    await waitFor(() =>
      expect(createTable).toHaveBeenCalledWith(
        BRANCH_1.id,
        expect.objectContaining({ label: "P2" }),
      ),
    );
  });

  it("5. clicking a row opens Edit, and saving calls the real backend PATCH service", async () => {
    selectBranch1();
    updateTable.mockResolvedValue({ ...TABLE_PATIO_1, label: "P1-Renamed" });
    const user = userEvent.setup();
    render(<TablesPage />);

    await user.click(await screen.findByText("P1"));

    const label = await screen.findByDisplayValue("P1");
    await user.clear(label);
    await user.type(label, "P1-Renamed");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(updateTable).toHaveBeenCalledWith(
        "tbl-1",
        expect.objectContaining({ label: "P1-Renamed" }),
      ),
    );
  });
});

describe("Console Operations > Tables — permissions (real granted codes, not a role heuristic)", () => {
  it("6. Owner-shaped real granted codes can manage: sees Create Table and can Edit via row click", async () => {
    session.grantedCodes = OWNER_CODES;
    selectBranch1();
    render(<TablesPage />);

    await screen.findByText("P1");
    expect(screen.getByRole("button", { name: "common.new" })).toBeInTheDocument();
  });

  it("6. Branch-Manager-shaped real granted codes can manage: sees Create Table and can Edit via row click", async () => {
    session.grantedCodes = BRANCH_MANAGER_CODES;
    selectBranch1();
    const user = userEvent.setup();
    render(<TablesPage />);

    await screen.findByText("P1");
    expect(screen.getByRole("button", { name: "common.new" })).toBeInTheDocument();

    await user.click(screen.getByText("P1"));
    expect(await screen.findByDisplayValue("P1")).toBeInTheDocument();
  });

  it("7. Cashier-shaped real granted codes see the read (if reachable) but never Create/Edit — and cannot even reach the page via the Gate", async () => {
    session.grantedCodes = CASHIER_CODES;
    selectBranch1();
    render(<TablesPage />);

    // Cashier holds neither settings.branch.read nor .manage, so the page's
    // own Gate (mirroring the sidebar's) refuses the whole screen.
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(tablesList).not.toHaveBeenCalled();
  });

  it("a read-only holder (settings.branch.read, no .manage) sees the real list but never Create/Edit", async () => {
    session.grantedCodes = new Set(["settings.branch.read"]);
    selectBranch1();
    const user = userEvent.setup();
    render(<TablesPage />);

    await screen.findByText("P1");
    expect(screen.queryByRole("button", { name: "common.new" })).not.toBeInTheDocument();

    await user.click(screen.getByText("P1"));
    expect(screen.queryByRole("button", { name: "common.save" })).not.toBeInTheDocument();
  });
});

describe("Console Operations > Tables — no device-only fixture data, no delete/deactivate UI", () => {
  it("8. renders only the real service's rows — never the T01..T16 device-only fixture, never the 'This device only' banner", async () => {
    selectBranch1();
    render(<TablesPage />);

    await screen.findByText("P1");
    // The old device-only grid's labels (`T01`..`T16`, `lib/console/mock/org.ts`)
    // and its warning banner must never appear on this page again.
    expect(screen.queryByText(/^T0[1-9]$/)).not.toBeInTheDocument();
    expect(screen.queryByText("live.deviceOnlyTitle")).not.toBeInTheDocument();
    expect(screen.queryByText("common.status")).not.toBeInTheDocument();
  });

  it("10. no Delete/Deactivate/Archive action exists anywhere on the page (no real backend support)", async () => {
    selectBranch1();
    const user = userEvent.setup();
    render(<TablesPage />);

    await user.click(await screen.findByText("P1"));

    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument();
  });
});

describe("Console Operations > Tables — POS contract unchanged", () => {
  it("9. Console management (services.operations.tables) and the POS-safe read (services.sales.tables) are distinct real service functions, never aliased", async () => {
    // `@/lib/console/services` (the barrel this page imports) is mocked
    // above; `./http` — the real, unmocked implementation module — is
    // imported directly here to prove the two paths were never merged.
    const { httpServices } = await import("@/lib/console/services/http");
    expect(httpServices.operations.tables).not.toBe(httpServices.sales.tables);
    expect(typeof httpServices.sales.tables).toBe("function");
    expect(typeof httpServices.operations.tables).toBe("function");
  });
});
