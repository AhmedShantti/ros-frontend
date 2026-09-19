import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * TABLE-MANAGEMENT-AND-POS-OPEN-ORDERS-CORRECTION-P0
 *
 * Root cause of "managers cannot practically configure tables": the
 * Create/Edit affordance on this page was gated on `usePermission
 * ("ops.live.manage")` — a permission that exists in NEITHER this
 * console's own catalogue (`lib/console/permissions.ts`) nor any real
 * backend code, so it never matched on a live session and silently hid
 * Create/Edit for every role, Owner included, even though the nav item
 * itself (gated on the real `ops.live.view`) was reachable and the list
 * loaded. The fix is `settings.branch.manage` — the actual code
 * `organisation.controller.ts` requires for `POST/PATCH .../tables`.
 *
 * Mocked only at the transport boundary (`@/lib/console/services`) and
 * `@/lib/console/providers`; the live floor grid's own occupancy engine
 * (`@/lib/console/live/store`, `@/lib/console/live/reducer`) is mocked to
 * an empty table list since it is out of scope for this fix (occupancy has
 * no backend field by design) — only the real, backend-wired "Table
 * Definitions" CRUD section is under test here.
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

let granted = new Set<string>(["settings.branch.manage"]);

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
    scope: { tenantId: "t1", brandId: null, branchId: BRANCH_ID },
    availableBranches: [{ id: BRANCH_ID, name: { en: "Downtown" } }],
  }),
  usePermission: (permission: string) => granted.has(permission),
}));

vi.mock("@/lib/console/live/store", () => ({
  useLive: () => ({ state: {} }),
  useNow: () => 0,
  elapsedSince: () => null,
}));

vi.mock("@/lib/console/live/reducer", () => ({
  tablesOf: () => [],
}));

import TablesPage from "./page";

const BRANCH_ID = "branch-1";
const TABLE_PATIO_1 = {
  id: "tbl-1",
  branchId: BRANCH_ID,
  label: "P1",
  area: { en: "Patio", ar: "الفناء" },
  capacity: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  granted = new Set(["settings.branch.manage"]);
  tablesList.mockResolvedValue({ rows: [TABLE_PATIO_1], total: 1 });
});

afterEach(() => {
  cleanup();
});

describe("Console Operations > Tables — real Table Definitions CRUD", () => {
  it("loads and lists real tables from services.operations.tables, never a fabricated/local source", async () => {
    render(<TablesPage />);

    await waitFor(() => expect(tablesList).toHaveBeenCalled());
    expect(await screen.findByText("P1")).toBeInTheDocument();
  });

  it('shows the empty state, not a fabricated row, when the branch has no tables', async () => {
    tablesList.mockResolvedValue({ rows: [], total: 0 });
    render(<TablesPage />);

    expect(await screen.findByText("ops.noTables")).toBeInTheDocument();
  });

  it("surfaces a real service error rather than silently showing nothing", async () => {
    tablesList.mockRejectedValue(new Error("Insufficient permission for this scope."));
    render(<TablesPage />);

    expect(await screen.findByText("Insufficient permission for this scope.")).toBeInTheDocument();
  });

  it("an authorised manager (settings.branch.manage) sees Create Table, and it calls the real backend service", async () => {
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
        BRANCH_ID,
        expect.objectContaining({ label: "P2" }),
      ),
    );
  });

  it("clicking a row opens Edit, and saving calls the real backend update service", async () => {
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

  it('never shows Create Table or opens Edit for a user without settings.branch.manage — the read still works', async () => {
    granted = new Set();
    const user = userEvent.setup();
    render(<TablesPage />);

    await screen.findByText("P1");
    expect(screen.queryByRole("button", { name: "common.new" })).not.toBeInTheDocument();

    // Clicking the row does nothing — `onRowClick` is undefined without `canManage`.
    await user.click(screen.getByText("P1"));
    expect(screen.queryByRole("button", { name: "common.save" })).not.toBeInTheDocument();
  });
});
