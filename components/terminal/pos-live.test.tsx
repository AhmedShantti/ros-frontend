import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

/*
 * Integration coverage for the cashier/drawer session lifecycle in
 * `LivePos` — Bug 1 (a drawer that opens but cannot be recovered/closed) and
 * Bug 2 (an existing open shift stranding the cashier instead of returning
 * them to the POS).
 *
 * Mocked only at the transport boundary: `@/lib/console/services` (the
 * backend) and `@/lib/api/auth` (the network half of signing on/off). The
 * REAL `@/lib/api/session.ts` runs against jsdom's `localStorage`, and the
 * REAL reconciliation logic in `pos-live.tsx` / `cash-session-reconcile.ts`
 * is what is under test — never a re-implementation of it in the mock.
 */

const {
  MockServiceError,
  getCurrentSession,
  openCashSession,
  listSessionDrawers,
  closeContext,
  tables,
  openOrder,
  salesReasonCodes,
  voidLine,
  voidLinePostFire,
  inventoryReasonCodes,
  capturePayment,
} = vi.hoisted(() => {
  class MockServiceError extends Error {
    code: string;
    status: number;
    detail?: string;
    constructor(code: string, message: string, status = 500, detail?: string) {
      super(message);
      this.code = code;
      this.status = status;
      this.detail = detail;
    }
  }

  return {
    MockServiceError,
    getCurrentSession: vi.fn(),
    openCashSession: vi.fn(),
    listSessionDrawers: vi.fn(),
    closeContext: vi.fn(),
    tables: vi.fn(),
    openOrder: vi.fn(),
    salesReasonCodes: vi.fn(),
    voidLine: vi.fn(),
    voidLinePostFire: vi.fn(),
    // LIVE-01-PREFIRE-LINE-VOID-P0 — kept as an explicit spy (not omitted)
    // so a regression that reintroduces the back-office call fails loudly
    // ("Cannot read properties of undefined") instead of silently passing.
    inventoryReasonCodes: vi.fn(),
    capturePayment: vi.fn(),
  };
});

vi.mock("@/lib/console/services", () => ({
  services: {
    treasury: {
      getCurrentSession: (...args: unknown[]) => getCurrentSession(...args),
      openCashSession: (...args: unknown[]) => openCashSession(...args),
      listSessionDrawers: (...args: unknown[]) => listSessionDrawers(...args),
      closeContext: (...args: unknown[]) => closeContext(...args),
    },
    operations: {
      tables: (...args: unknown[]) => tables(...args),
    },
    sales: {
      mutations: {
        open: (...args: unknown[]) => openOrder(...args),
        voidLine: (...args: unknown[]) => voidLine(...args),
        voidLinePostFire: (...args: unknown[]) => voidLinePostFire(...args),
        capturePayment: (...args: unknown[]) => capturePayment(...args),
      },
      reasonCodes: (...args: unknown[]) => salesReasonCodes(...args),
    },
    inventory: {
      reasonCodes: (...args: unknown[]) => inventoryReasonCodes(...args),
    },
  },
  ServiceError: MockServiceError,
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

import { signInWithPin, signOffTerminal } from "@/lib/api/auth";
import * as Session from "@/lib/api/session";
import type { Order, OrderLine } from "@/lib/console/types";
import type { UserEvent } from "@testing-library/user-event";
import { LivePos } from "./pos-live";

const BRANCH_ID = "branch-1";
const TENANT_ID = "tenant-1";

function seedDevice() {
  Session.setActiveSurface("pos");
  Session.setActiveBranchId(BRANCH_ID);
  Session.setTenantId(TENANT_ID);
}

/** Simulates a real `signInWithPin` — writes through the real session module. */
function signOnAs(code: string, name = code) {
  vi.mocked(signInWithPin).mockImplementation(async (input) => {
    Session.setTokens({ accessToken: `tok-${input.employeeCode}`, refreshToken: "ref", expiresIn: 900 });
    Session.setTenantId(input.tenantId);
    Session.setPosEmployee({ code: input.employeeCode, name, sessionType: input.sessionType });
  });
  return code;
}

const ONE_DRAWER = [{ id: "drawer-1", branchId: "branch-1", name: "Front drawer", terminalId: null, isActive: true }];

const money = (amount: number) => ({ amount, currency: "EGP" as const });

/** A minimal, valid pending line — override `state` for a postfire fixture. */
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

/**
 * A minimal, valid open order with one line, for exercising `OrderPane`'s
 * trash/void action directly — mocked as the resolved value of
 * `services.sales.mutations.open(...)` (a fresh order would not realistically
 * have a line yet; this is a deliberate shortcut so a test can reach
 * `VoidLineDrawer` without also driving `MenuPane`'s own add-line flow,
 * which is unrelated to this bug).
 */
function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    branchName: { en: "Front Branch", ar: "الفرع" },
    terminalId: "terminal-1",
    terminalName: "Front Till",
    orderNumber: "ORD-1",
    businessDay: "2026-09-15",
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
    paidTotal: money(0),
    tipTotal: money(0),
    cogsTotal: money(0),
    lines: [makeLine()],
    payments: [],
    discounts: [],
    openedAt: "2026-09-15T10:00:00Z",
    firstFiredAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    syncState: "synced",
    syncedAt: "2026-09-15T10:00:00Z",
    aggregatorRef: null,
    notes: null,
    version: 1,
    ...overrides,
  };
}

const VOID_REASONS = [{ id: "reason-1", code: "WRONG_ITEM", label: { en: "Wrong item", ar: "صنف خاطئ" } }];

/**
 * `Select` (components/console/ui.tsx) is a custom listbox, not a native
 * `<select>` — `userEvent.selectOptions` does not apply to it. Opening it
 * (clicking the labelled trigger button) then clicking the option is the
 * real interaction a cashier performs.
 */
async function pickOption(
  user: UserEvent,
  container: HTMLElement,
  fieldLabel: RegExp,
  optionName: string,
) {
  await user.click(within(container).getByLabelText(fieldLabel));
  await user.click(within(container).getByRole("option", { name: optionName }));
}

/** Signs a cashier on, resumes an open shift, and opens the fixture order. */
async function enterPosWithOrder(order: Order) {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();

  getCurrentSession.mockResolvedValue({
    cashSessionId: "cs-1",
    shiftId: "sh-1",
    drawerId: "drawer-1",
    status: "open",
  });
  openOrder.mockResolvedValue(order);

  signOnAs("EMP01", "Amina");
  Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
  Session.setPosEmployee({ code: "EMP01", name: "Amina" });

  render(<LivePos />);

  const openButton = await screen.findByRole("button", { name: "pos.openOrder" });
  await waitFor(() => expect(openButton).toBeEnabled());
  await user.click(openButton);
  await waitFor(() => expect(screen.getByText(order.orderNumber)).toBeInTheDocument());

  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(signOffTerminal).mockImplementation(async () => {
    Session.clearTerminalIdentity();
  });
  tables.mockResolvedValue({ rows: [], total: 0 });
  listSessionDrawers.mockResolvedValue(ONE_DRAWER);
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LivePos — sign-on and session recovery", () => {
  it("shows the sign-on card with no shift open, then Open Drawer once authenticated", async () => {
    getCurrentSession.mockResolvedValue(null);

    render(<LivePos />);

    const codeField = await screen.findByLabelText(/shift\.employeeCode/);
    // No open cash session exists locally or on the server, so signing on
    // must land on "open a drawer", never a shift already in progress.
    expect(screen.queryByText("shift.openTitle")).not.toBeInTheDocument();
    void codeField;
  });

  it("Bug 2 — restores an existing server session instead of asking to open a duplicate", async () => {
    // The cashier already has an open session on the backend, but this
    // till's localStorage never learned about it (a different device, or a
    // reload that lost it). Signing on must recover it and land on the POS.
    getCurrentSession.mockResolvedValue({
      cashSessionId: "cs-existing",
      shiftId: "sh-existing",
      drawerId: "drawer-1",
    });

    const cashierCode = signOnAs("EMP01", "Amina");
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: cashierCode, name: "Amina" });

    render(<LivePos />);

    await waitFor(() => {
      expect(screen.getByText("pos.newOrder")).toBeInTheDocument();
    });
    expect(screen.queryByText("shift.openTitle")).not.toBeInTheDocument();

    // Local storage was reconciled to the server's session, for this
    // employee/terminal — not left stale.
    expect(Session.getOpenCashSession()).toEqual({
      cashSessionId: "cs-existing",
      employeeCode: cashierCode,
      branchId: BRANCH_ID,
    });
  });

  it("refresh restores an active session already held locally", async () => {
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });
    Session.setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", branchId: BRANCH_ID });
    getCurrentSession.mockResolvedValue({ cashSessionId: "cs-1", shiftId: "sh-1", drawerId: "drawer-1" });

    render(<LivePos />);

    await waitFor(() => expect(screen.getByText("pos.newOrder")).toBeInTheDocument());
  });

  it("POS-BACKOFFICE-CALLS-P0 — normal POS bootstrap makes no back-office (would-be-403) calls: no tables request, dine-in simply unavailable", async () => {
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });
    Session.setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", branchId: BRANCH_ID });
    getCurrentSession.mockResolvedValue({ cashSessionId: "cs-1", shiftId: "sh-1", drawerId: "drawer-1" });

    render(<LivePos />);

    await waitFor(() => expect(screen.getByText("pos.newOrder")).toBeInTheDocument());

    // `GET /org/branches/{branchId}/tables` (OrganisationController#listTables,
    // BRANCH_READ-gated, no @AllowPosSession) must never be attempted from
    // the POS "new order" screen — there is no POS-safe tables read yet, so
    // dine-in stays unavailable rather than firing a doomed request.
    expect(tables).not.toHaveBeenCalled();
    // Same class of bug, already fixed in a prior task — kept here as a
    // combined "zero expected 403s on normal bootstrap" regression guard.
    expect(inventoryReasonCodes).not.toHaveBeenCalled();
  });

  it("clears a stale local session once the server confirms it is no longer open", async () => {
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });
    Session.setOpenCashSession({ cashSessionId: "cs-stale", employeeCode: "EMP01", branchId: BRANCH_ID });
    getCurrentSession.mockResolvedValue(null);

    render(<LivePos />);

    await waitFor(() => expect(screen.getByText("shift.openTitle")).toBeInTheDocument());
    expect(Session.getOpenCashSession()).toBeNull();
  });

  it("never adopts a foreign cashier's held session", async () => {
    Session.setOpenCashSession({ cashSessionId: "cs-foreign", employeeCode: "EMP99", branchId: BRANCH_ID });
    getCurrentSession.mockResolvedValue(null);

    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });

    render(<LivePos />);

    await waitFor(() => expect(screen.getByText("shift.foreignTitle")).toBeInTheDocument());
    // Never asked the server on this cashier's own token — that call could
    // only ever answer for EMP01 and has nothing to say about EMP99's drawer.
    expect(getCurrentSession).not.toHaveBeenCalled();
    // The foreign record is untouched, not silently overwritten or deleted.
    expect(Session.getOpenCashSession()).toEqual({
      cashSessionId: "cs-foreign",
      employeeCode: "EMP99",
      branchId: BRANCH_ID,
    });
  });

  it("opening a drawer stores the returned session and moves straight to the POS", async () => {
    getCurrentSession.mockResolvedValue(null);
    openCashSession.mockResolvedValue({ cashSessionId: "cs-new", shiftId: "sh-new", created: true });

    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<LivePos />);

    const openButton = await screen.findByRole("button", { name: "shift.open" });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);

    await waitFor(() => expect(screen.getByText("pos.newOrder")).toBeInTheDocument());
    expect(Session.getOpenCashSession()).toEqual({
      cashSessionId: "cs-new",
      employeeCode: "EMP01",
      branchId: BRANCH_ID,
    });
  });

  it("Bug 2 — a duplicate-open (409) conflict resumes the existing session instead of leaving the cashier stuck", async () => {
    getCurrentSession
      .mockResolvedValueOnce(null) // the initial bootstrap check
      .mockResolvedValueOnce({ cashSessionId: "cs-existing", shiftId: "sh-existing", drawerId: "drawer-1" }); // the conflict-recovery read
    openCashSession.mockRejectedValue(new MockServiceError("CONFLICT", "You already have an open shift.", 409));

    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<LivePos />);

    const openButton = await screen.findByRole("button", { name: "shift.open" });
    await waitFor(() => expect(openButton).toBeEnabled());
    await user.click(openButton);

    await waitFor(() => expect(screen.getByText("pos.newOrder")).toBeInTheDocument());
    expect(Session.getOpenCashSession()).toEqual({
      cashSessionId: "cs-existing",
      employeeCode: "EMP01",
      branchId: BRANCH_ID,
    });
  });

  it("CASH-SESSION-RESUME-AND-CLOSE-P0 — resuming a session mid-close (status \"closing\") routes straight to the close flow, never the order screen", async () => {
    // Declared over tolerance on another terminal (or a previous visit to
    // this one) and now frozen, awaiting a manager's finalize decision. A
    // fresh PIN sign-on must never drop the cashier onto ordinary POS over
    // a session the server is about to finalize — see `DrawerSheet`'s own
    // `frozen` gate, which this mirrors from the other side of a resume.
    getCurrentSession.mockResolvedValue({
      cashSessionId: "cs-frozen",
      shiftId: "sh-frozen",
      drawerId: "drawer-1",
      status: "closing",
    });
    closeContext.mockResolvedValue({
      cashSessionId: "cs-frozen",
      status: "closing",
      countMode: "blind",
      currency: "EGP",
      openingFloat: { amount: 50000, currency: "EGP" },
      tolerance: { amount: 2000, currency: "EGP" },
      expectedCash: { amount: 123400, currency: "EGP" },
      countedCash: { amount: 130000, currency: "EGP" },
      variance: { amount: 6600, currency: "EGP" },
      approvalRequired: true,
      closedAt: null,
      frozen: true,
    });

    const cashierCode = signOnAs("EMP01", "Amina");
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: cashierCode, name: "Amina" });

    render(<LivePos />);

    // The manager-approval form only renders once the drawer sheet has both
    // opened AND resolved the session as frozen — the unambiguous marker
    // that this landed in the close flow, not merely that the badge (which
    // also reads "frozenTitle") happened to be present. Regex, not an exact
    // string: `Field`'s `required` marker appends a literal "*" to the label.
    await waitFor(() => expect(screen.getByLabelText(/shift\.managerPin/)).toBeInTheDocument());
    // The session was still resumed (not a fresh open) — same id, no
    // duplicate open-session call.
    expect(openCashSession).not.toHaveBeenCalled();
    expect(Session.getOpenCashSession()).toEqual({
      cashSessionId: "cs-frozen",
      employeeCode: cashierCode,
      branchId: BRANCH_ID,
    });
  });

  it("an expired token clears the stale cashier UI rather than continuing to render it", async () => {
    Session.setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "EMP01", name: "Amina" });
    getCurrentSession.mockResolvedValue(null);

    render(<LivePos />);

    await waitFor(() => expect(screen.getByText("shift.openTitle")).toBeInTheDocument());

    // The token disappears from under the mounted tree (a dead refresh, or a
    // console sign-out ending the terminal's own PIN session elsewhere).
    Session.clearTerminalIdentity();

    await waitFor(() => expect(screen.getByLabelText(/shift\.employeeCode/)).toBeInTheDocument());
    expect(screen.queryByText("Amina")).not.toBeInTheDocument();
  });
});

describe("LivePos — PIN sign-on contract (FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0)", () => {
  it("calls signInWithPin with tenantId, branchId, sessionType \"pos\", and no terminalId", async () => {
    getCurrentSession.mockResolvedValue(null);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<LivePos />);

    await user.type(await screen.findByLabelText(/shift\.employeeCode/), "EMP01");
    await user.type(screen.getByLabelText(/shift\.pinLabel/), "1234");
    await user.click(screen.getByRole("button", { name: "shift.signOn" }));

    await waitFor(() => expect(signInWithPin).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(signInWithPin).mock.calls[0]![0];
    expect(payload).toEqual({
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      employeeCode: "EMP01",
      pin: "1234",
      sessionType: "pos",
    });
    expect(payload).not.toHaveProperty("terminalId");
  });

  it("boots normally even when the device still carries legacy Terminal localStorage from before this migration", async () => {
    getCurrentSession.mockResolvedValue(null);
    // Left behind by a pre-decoupling build — must be inert, not read.
    window.localStorage.setItem("ros.api.terminalId", "legacy-term-1");
    window.localStorage.setItem("ros.api.terminalName", "Old Front Till");
    window.localStorage.setItem("ros.api.terminalBranchId", "legacy-branch-9");

    render(<LivePos />);

    // The device's real branch (set independently in `seedDevice`) is what
    // still gates entry — the legacy keys are simply never consulted.
    await screen.findByLabelText(/shift\.employeeCode/);
    expect(screen.queryByText("pos.noBranch")).not.toBeInTheDocument();
  });

  it("shows the branch-selection prompt, never a Terminal one, when no branch is selected", async () => {
    // A genuinely fresh browser: tenant known (from a console sign-in on it),
    // but no active branch selected yet.
    window.localStorage.clear();
    Session.setActiveSurface("pos");
    Session.setTenantId(TENANT_ID);

    render(<LivePos />);

    expect(await screen.findByText("pos.noBranch")).toBeInTheDocument();
    expect(screen.getByText("pos.noBranchNote")).toBeInTheDocument();
    expect(screen.queryByText("pos.noTerminal")).not.toBeInTheDocument();
  });
});

describe("LivePos — prefire line void (LIVE-01-PREFIRE-LINE-VOID-P0, PREFIRE-VOID-NO-REASON-P0)", () => {
  it("PREFIRE-VOID-NO-REASON-P0 — never fetches reason codes for a pre-fire line, and shows no reason selector or blocker", async () => {
    const user = await enterPosWithOrder(makeOrder());

    await user.click(screen.getByRole("button", { name: "pos.void" }));
    const dialog = await screen.findByRole("dialog");

    // The confirmation copy is still shown; there is simply nothing to pick.
    expect(within(dialog).getByText("pos.voidPreFire")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/inv\.reason/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText("pos.noReasonCodes")).not.toBeInTheDocument();
    expect(salesReasonCodes).not.toHaveBeenCalled();
    expect(inventoryReasonCodes).not.toHaveBeenCalled();
  });

  it("PREFIRE-VOID-NO-REASON-P0 — a prefire void executes directly after confirmation: submit is enabled with no reason, and the mutation carries none", async () => {
    const order = makeOrder();
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.void" }));
    const dialog = await screen.findByRole("dialog");

    const submit = within(dialog).getByRole("button", { name: "pos.void" });
    expect(submit).toBeEnabled();

    const voided = {
      ...order,
      lines: [{ ...order.lines[0]!, state: "voided" as const }],
      subtotal: money(0),
      grandTotal: money(0),
    };
    voidLine.mockResolvedValue(voided);

    await user.click(submit);

    await waitFor(() =>
      expect(voidLine).toHaveBeenCalledWith("2026-09-15", "order-1", "line-1", { ifMatch: 1 }),
    );
    // No reason-shaped fourth argument was ever fabricated or defaulted.
    expect(voidLine.mock.calls[0]).toHaveLength(4);
    // The drawer closes on success, and the pane re-renders from the
    // server's own response — never a locally-guessed removal.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Voided")).toBeInTheDocument();
  });

  it("a postfire line uses the postfire purpose and the postfire mutation — the two paths stay separate", async () => {
    salesReasonCodes.mockResolvedValue(VOID_REASONS);
    const order = makeOrder({ lines: [makeLine({ state: "fired", firedAt: "2026-09-15T10:05:00Z" })] });
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.void" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() => expect(salesReasonCodes).toHaveBeenCalledWith("void_postfire"));
    expect(salesReasonCodes).not.toHaveBeenCalledWith("void_prefire");

    await pickOption(user, dialog, /inv\.reason/, "Wrong item");
    voidLinePostFire.mockResolvedValue({
      ...order,
      lines: [{ ...order.lines[0]!, state: "voided" as const }],
    });

    await user.click(within(dialog).getByRole("button", { name: "pos.void" }));

    await waitFor(() =>
      expect(voidLinePostFire).toHaveBeenCalledWith(
        "2026-09-15",
        "order-1",
        "line-1",
        { disposition: "wasted", reasonCodeId: "reason-1" },
        { ifMatch: 1 },
      ),
    );
    expect(voidLine).not.toHaveBeenCalled();
  });

  it("a permission-denied reason read surfaces a real error, not a silently-stuck disabled button (POST-fire only — pre-fire no longer reads reasons at all)", async () => {
    salesReasonCodes.mockRejectedValue(
      new MockServiceError(
        "FORBIDDEN",
        "PIN (POS) sessions cannot access dashboard or back-office endpoints.",
        403,
      ),
    );
    const order = makeOrder({ lines: [makeLine({ state: "fired", firedAt: "2026-09-15T10:05:00Z" })] });
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.void" }));
    const dialog = await screen.findByRole("dialog");

    // Visibly distinguishable from a loading state or a mutation failure —
    // the error text and its machine-readable code both render.
    await waitFor(() =>
      expect(
        within(dialog).getByText(
          "PIN (POS) sessions cannot access dashboard or back-office endpoints.",
        ),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("FORBIDDEN")).toBeInTheDocument();
    // Never even attempted the back-office route as a fallback.
    expect(inventoryReasonCodes).not.toHaveBeenCalled();
    // The submit button stays disabled — nothing to void without a reason —
    // but the reason it's stuck is now visible, not silent.
    expect(within(dialog).getByRole("button", { name: "pos.void" })).toBeDisabled();
  });

  it("KDS session cannot reach the POS void mutation (session isolation, unchanged)", async () => {
    // `services.sales.mutations.voidLine`/`voidLinePostFire` are shared code
    // — the isolation that matters here is `lib/api/session.ts`'s per-surface
    // token storage (proved directly in `lib/api/session.test.ts` and
    // `lib/api/auth.test.ts`): a KDS PIN session never holds a POS token to
    // send in the first place, so there is nothing for this suite to
    // re-prove beyond confirming that isolation is untouched by this fix.
    Session.setActiveSurface("kds");
    expect(Session.getAccessToken()).toBeNull();
    Session.setActiveSurface("pos");
  });
});

/*
 * PAYMENT-AMOUNT-ENTRY-P0 — the production `PaymentDrawer` (`pos-live.tsx`)
 * is mounted once alongside its sibling drawers and only toggled via `open`;
 * it never remounts. Its `amount` field was seeded from `outstanding` with a
 * `useState` LAZY INITIALIZER, which only ever runs on that first-ever mount
 * — so every later open (a fresh order, or the same order right after a
 * partial payment already reduced the balance) kept showing whatever
 * "amount" was first captured (often "", before the order's totals were
 * known), forcing the cashier to type it by hand every time. Change due was
 * never computed or displayed at all. These tests exercise the fix through
 * the real `LivePos` screen, never a re-implementation of the drawer.
 */
describe("LivePos — payment amount entry (PAYMENT-AMOUNT-ENTRY-P0)", () => {
  /** The task's own example: a single line totalling EGP 600.00, unpaid. */
  function order600(overrides: Partial<Order> = {}): Order {
    return makeOrder({
      subtotal: money(60000),
      grandTotal: money(60000),
      lines: [
        makeLine({ unitPrice: money(60000), lineSubtotal: money(60000), lineTotal: money(60000) }),
      ],
      ...overrides,
    });
  }

  function changeDueText(dialog: HTMLElement): string {
    const label = within(dialog).getByText("pos.changeDue");
    const row = label.closest("div")!;
    return row.querySelector("dd")?.textContent ?? "";
  }

  it("1. the drawer opens with Amount already equal to the current remaining balance", async () => {
    const order = makeOrder(); // grandTotal 10000, paidTotal 0 -> outstanding 100.00
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/orders\.amount/)).toHaveValue("100.00");
  });

  it("2. cash payment with a remaining balance of 600 defaults Amount to 600.00", async () => {
    const user = await enterPosWithOrder(order600());

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/orders\.amount/)).toHaveValue("600.00");
    expect(within(dialog).getByLabelText(/orders\.tendered/)).toHaveValue("");
  });

  it("3. entering a received amount of 700 shows change due of 100 (FR-POS-063)", async () => {
    const user = await enterPosWithOrder(order600());

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText(/orders\.tendered/), "700");

    await waitFor(() => expect(changeDueText(dialog)).toMatch(/100\.00/));
    expect(changeDueText(dialog)).toMatch(/EGP/);
  });

  it("4. a cashier can intentionally lower Amount below the remaining balance for a partial payment", async () => {
    const order = order600();
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    const dialog = await screen.findByRole("dialog");

    const amountInput = within(dialog).getByLabelText(/orders\.amount/);
    await user.clear(amountInput);
    await user.type(amountInput, "300");
    await user.type(within(dialog).getByLabelText(/orders\.tendered/), "300");

    const submit = within(dialog).getByRole("button", { name: "pos.capturePayment" });
    expect(submit).toBeEnabled();

    capturePayment.mockResolvedValue({ ...order, paidTotal: money(30000), version: 2 });
    await user.click(submit);

    await waitFor(() =>
      expect(capturePayment).toHaveBeenCalledWith(
        order.businessDay,
        order.id,
        expect.objectContaining({
          tender: "cash",
          amountMinor: "30000",
          tenderedAmountMinor: "30000",
        }),
        { ifMatch: 1 },
      ),
    );
  });

  it("never allows Amount to exceed the remaining balance", async () => {
    const order = order600();
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    const dialog = await screen.findByRole("dialog");

    const amountInput = within(dialog).getByLabelText(/orders\.amount/);
    await user.clear(amountInput);
    await user.type(amountInput, "700");
    await user.type(within(dialog).getByLabelText(/orders\.tendered/), "700");

    expect(within(dialog).getByRole("button", { name: "pos.capturePayment" })).toBeDisabled();
    expect(capturePayment).not.toHaveBeenCalled();
  });

  it("5. after a partial payment, reopening the drawer uses the new remaining balance", async () => {
    const order = order600();
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    let dialog = await screen.findByRole("dialog");

    const amountInput = within(dialog).getByLabelText(/orders\.amount/);
    await user.clear(amountInput);
    await user.type(amountInput, "300");
    await user.type(within(dialog).getByLabelText(/orders\.tendered/), "300");

    capturePayment.mockResolvedValue({ ...order, paidTotal: money(30000), version: 2 });
    await user.click(within(dialog).getByRole("button", { name: "pos.capturePayment" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/orders\.amount/)).toHaveValue("300.00");
    // The previous payment's tendered amount must not linger either.
    expect(within(dialog).getByLabelText(/orders\.tendered/)).toHaveValue("");
  });

  it("6. non-cash (manual card) behavior is unaffected: Amount still defaults, no change-due row, terminal reference in place of tendered", async () => {
    const order = order600();
    const user = await enterPosWithOrder(order);

    await user.click(screen.getByRole("button", { name: "pos.pay" }));
    const dialog = await screen.findByRole("dialog");

    await pickOption(user, dialog, /^orders\.tender$/, "orders.card");

    expect(within(dialog).getByLabelText(/orders\.amount/)).toHaveValue("600.00");
    expect(within(dialog).queryByText("pos.changeDue")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/orders\.tendered/)).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/orders\.terminalReference/), "REF123");
    const submit = within(dialog).getByRole("button", { name: "pos.capturePayment" });
    expect(submit).toBeEnabled();

    capturePayment.mockResolvedValue({ ...order, paidTotal: money(60000), state: "completed" as const, version: 2 });
    await user.click(submit);

    await waitFor(() =>
      expect(capturePayment).toHaveBeenCalledWith(
        order.businessDay,
        order.id,
        expect.objectContaining({
          tender: "manual_external_card",
          amountMinor: "60000",
          terminalReference: "REF123",
        }),
        { ifMatch: 1 },
      ),
    );
  });
});
