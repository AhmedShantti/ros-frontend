import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * FR-INV-035/047/058 acceptance-review hardening — the real `/approvals`
 * queue wired to the Inventory approval backend. Before this task,
 * `services.governance.approvals`/`.decide` always failed through
 * `unsupportedGovernance` (`governance.approvals` listed in `API_COVERAGE
 * .absent`) — this is DATA_MODE=http's queue reading a real list and
 * deciding through real endpoints, never the mock/demo fallback.
 *
 * Mocked only at `@/lib/console/services` and `@/lib/console/providers` —
 * the same boundary `app/(console)/inventory/levels/page.test.tsx` and
 * `app/(console)/inventory/counts/page.test.tsx` already establish.
 * `ApprovalsScreen` is the real component.
 */

const approvalsList = vi.fn();
const decide = vi.fn();

vi.mock("@/lib/console/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/console/services")>();
  return {
    ServiceError: actual.ServiceError,
    services: {
      governance: {
        approvals: { list: (...args: unknown[]) => approvalsList(...args) },
        decide: (...args: unknown[]) => decide(...args),
      },
    },
  };
});

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
    scope: { tenantId: "t1", brandId: null, branchId: null },
    session: { user: { id: "requester-1" } },
    canAny: () => true,
    availableBranches: [BRANCH_A],
  }),
}));

vi.mock("@/lib/api/config", () => ({ DATA_MODE: "http" }));

import ApprovalsPage from "./page";

const BRANCH_A = { id: "branch-a", name: { en: "Downtown" } };

function approvalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    tenantId: "t1",
    reference: "REQ-1",
    kind: "stock_adjustment",
    entityType: "stock_adjustment",
    entityId: "req-1",
    entityLabel: { en: "Stock adjustment", ar: "تسوية مخزون" },
    branchId: "",
    branchName: { en: "", ar: "" },
    value: { amount: 200, currency: "EGP" },
    requestedBy: "other-user",
    requestedByName: { en: "ABCDEF12", ar: "ABCDEF12" },
    requestedAt: "2026-01-01T00:00:00Z",
    requiredPermission: "inventory.approve_adjustment",
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    comment: null,
    expiresAt: "2026-01-08T00:00:00Z",
    reason: { en: "Above threshold.", ar: "" },
    ...overrides,
  };
}

beforeEach(() => {
  approvalsList.mockResolvedValue({ rows: [approvalRow()], total: 1 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function fillCredentialsAndDecide(user: ReturnType<typeof userEvent.setup>, action: RegExp) {
  await user.click(await screen.findByText("REQ-1"));
  const dialog = await screen.findByRole("dialog");
  // `required` appends a literal "*" to the label text, and the branch
  // picker is the same custom listbox `Select` (not a native <select>) as
  // everywhere else in this console — open it, then pick the option.
  await user.click(within(dialog).getByLabelText(/^apr\.approvalBranch/));
  await user.click(within(dialog).getByRole("option", { name: "Downtown" }));
  await user.type(within(dialog).getByLabelText(/^apr\.employeeCode/), "EMP1");
  await user.type(within(dialog).getByLabelText(/^apr\.pin/), "4821");
  await user.click(within(dialog).getByRole("button", { name: action }));
  return dialog;
}

describe("Approvals — real Inventory list (17, 27)", () => {
  it("17. DATA_MODE=http reads the real GET /inventory/approvals list, not a mock fallback", async () => {
    render(<ApprovalsPage />);

    expect(await screen.findByText("REQ-1")).toBeInTheDocument();
    expect(approvalsList).toHaveBeenCalled();
  });

  it("27. no unsupported/mock placeholder text leaks into the real-http queue", async () => {
    render(<ApprovalsPage />);
    await screen.findByText("REQ-1");

    expect(screen.queryByText(/not implemented/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT_IMPLEMENTED/)).not.toBeInTheDocument();
  });
});

describe("Approvals — kind labels (18, 19, 20)", () => {
  it("18. stock_adjustment renders its real label", async () => {
    approvalsList.mockResolvedValue({ rows: [approvalRow({ kind: "stock_adjustment" })], total: 1 });
    render(<ApprovalsPage />);
    // Both the entity column and the kind badge legitimately say "Stock
    // adjustment" for this fixture — at least one real occurrence is what
    // matters here, not which column it is in.
    await waitFor(() => expect(screen.getAllByText("Stock adjustment").length).toBeGreaterThan(0));
  });

  it("19. count_adjustment renders its real label", async () => {
    approvalsList.mockResolvedValue({
      rows: [approvalRow({ kind: "count_adjustment", entityLabel: { en: "Count adjustment", ar: "" } })],
      total: 1,
    });
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getAllByText("Count adjustment").length).toBeGreaterThan(0));
  });

  it("20. waste renders its real label", async () => {
    approvalsList.mockResolvedValue({
      rows: [approvalRow({ kind: "waste", entityLabel: { en: "Waste", ar: "" } })],
      total: 1,
    });
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getAllByText("Waste").length).toBeGreaterThan(0));
  });

  it("transfer discrepancy renders in the shared queue and can use the existing PIN decision flow", async () => {
    approvalsList.mockResolvedValue({ rows: [approvalRow({ kind: "transfer_discrepancy", entityLabel: { en: "Transfer discrepancy", ar: "" } })], total: 1 });
    decide.mockResolvedValue(approvalRow({ kind: "transfer_discrepancy", status: "approved" }));
    const user = userEvent.setup();
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getAllByText("Transfer discrepancy").length).toBeGreaterThan(0));
    await fillCredentialsAndDecide(user, /common\.approve/);
    expect(decide).toHaveBeenCalledWith("req-1", "approved", expect.objectContaining({ employeeCode: "EMP1", pin: "4821", approvalBranchId: BRANCH_A.id }));
  });
});

describe("Approvals — decide (21, 22, 23, 26)", () => {
  it("21. approve calls the real decide endpoint with the PIN-verification fields, never the signed-in session alone", async () => {
    decide.mockResolvedValue(approvalRow({ status: "approved" }));
    const user = userEvent.setup();
    render(<ApprovalsPage />);

    await fillCredentialsAndDecide(user, /common\.approve/);

    expect(decide).toHaveBeenCalledWith("req-1", "approved", {
      comment: undefined,
      employeeCode: "EMP1",
      pin: "4821",
      approvalBranchId: BRANCH_A.id,
    });
  });

  it("22. reject calls the real decide endpoint", async () => {
    decide.mockResolvedValue(approvalRow({ status: "rejected" }));
    const user = userEvent.setup();
    render(<ApprovalsPage />);

    await fillCredentialsAndDecide(user, /common\.reject/);

    expect(decide).toHaveBeenCalledWith(
      "req-1",
      "rejected",
      expect.objectContaining({ employeeCode: "EMP1", pin: "4821" }),
    );
  });

  it("23. the PIN is never stored beyond the form — cleared immediately after a decision, never logged", async () => {
    const logSpy = vi.spyOn(console, "log");
    decide.mockResolvedValue(approvalRow({ status: "approved" }));
    const user = userEvent.setup();
    render(<ApprovalsPage />);

    const dialog = await fillCredentialsAndDecide(user, /common\.approve/);

    for (const call of logSpy.mock.calls) {
      expect(call.join(" ")).not.toContain("4821");
    }
    // The drawer closes on a successful decision (setSelected(null)); the
    // PIN field does not persist across the next open of any request.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    void dialog;
  });

  it("26. a successful decision refetches the queue", async () => {
    decide.mockResolvedValue(approvalRow({ status: "approved" }));
    const user = userEvent.setup();
    render(<ApprovalsPage />);
    await screen.findByText("REQ-1");
    expect(approvalsList).toHaveBeenCalledTimes(1);

    await fillCredentialsAndDecide(user, /common\.approve/);

    await waitFor(() => expect(approvalsList).toHaveBeenCalledTimes(2));
  });
});

describe("Approvals — honest error handling (24, 25)", () => {
  it("24. a 403 shows a clear 'not permitted' message and does not remove the request", async () => {
    const { ServiceError } = await import("@/lib/console/services/types");
    decide.mockRejectedValue(new ServiceError("FORBIDDEN", "Forbidden.", 403));
    const user = userEvent.setup();
    render(<ApprovalsPage />);

    await fillCredentialsAndDecide(user, /common\.approve/);

    expect(await screen.findByText("apr.decideForbidden")).toBeInTheDocument();
    // Still present (list row + drawer subtitle) — nothing was removed.
    expect(screen.getAllByText("REQ-1").length).toBeGreaterThan(0);
  });

  it("25. a 409 (already decided) shows a conflict message and refetches rather than leaving a stale row", async () => {
    const { ServiceError } = await import("@/lib/console/services/types");
    decide.mockRejectedValue(new ServiceError("ALREADY_DECIDED", "Conflict.", 409));
    const user = userEvent.setup();
    render(<ApprovalsPage />);
    await screen.findByText("REQ-1");
    const callsBefore = approvalsList.mock.calls.length;

    await fillCredentialsAndDecide(user, /common\.approve/);

    expect(await screen.findByText("apr.decideConflict")).toBeInTheDocument();
    await waitFor(() => expect(approvalsList.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("a network failure never optimistically removes the request", async () => {
    decide.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<ApprovalsPage />);

    await fillCredentialsAndDecide(user, /common\.approve/);

    // A plain Error (not a ServiceError) falls through to its own
    // `.message` — "Failed to fetch", never a fabricated success.
    await waitFor(() => expect(screen.getByText("Failed to fetch")).toBeInTheDocument());
    expect(screen.getAllByText("REQ-1").length).toBeGreaterThan(0);
  });
});
