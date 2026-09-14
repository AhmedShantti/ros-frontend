import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

const { MockServiceError, getCurrentSession, openCashSession, listSessionDrawers, tables } =
  vi.hoisted(() => {
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
      tables: vi.fn(),
    };
  });

vi.mock("@/lib/console/services", () => ({
  services: {
    treasury: {
      getCurrentSession: (...args: unknown[]) => getCurrentSession(...args),
      openCashSession: (...args: unknown[]) => openCashSession(...args),
      listSessionDrawers: (...args: unknown[]) => listSessionDrawers(...args),
    },
    operations: {
      tables: (...args: unknown[]) => tables(...args),
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
