import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * DEMO-CASH-AUTH-FINAL-GAP-P0 — regression coverage for the close-at-terminal
 * manager hand-off losing its sign-on on reload/Back. `manager` used to be a
 * bare `useState(null)` with nothing rehydrating it, so remounting this
 * screen (exactly what a reload or Back does) always fell back to the PIN
 * form even though the manager's tokens/`posEmployee` were still intact in
 * storage — indistinguishable from being signed out, and easy to mistake for
 * a `close-context` 403 clearing the session (it does not; only a
 * 401/refresh failure ever calls `clearSession()`, per `lib/api/client.ts`).
 *
 * Mocked only at the boundary: `next/navigation`, `@/lib/api/auth`
 * (`signInWithPin`'s network half), `@/components/terminal/chrome`
 * (irrelevant chrome), and `@/components/terminal/pos-drawer` (the actual
 * close flow — covered by its own tests; this file is only about who gets to
 * see it). The REAL `@/lib/api/session.ts` runs against jsdom's
 * `localStorage`/`sessionStorage`, and the REAL hydration logic in
 * `page.tsx` is what is under test.
 */

const { signInWithPin } = vi.hoisted(() => ({ signInWithPin: vi.fn() }));

vi.mock("@/lib/api/auth", () => ({ signInWithPin }));

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/terminal/chrome", () => ({
  TerminalBar: () => null,
}));

vi.mock("@/components/terminal/pos-drawer", () => ({
  DrawerSheet: () => <div data-testid="drawer-sheet">drawer-sheet-open</div>,
}));

const searchParamsValue = vi.hoisted(() => ({ current: new URLSearchParams() }));
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => searchParamsValue.current,
}));

import * as Session from "@/lib/api/session";
import CloseSessionPage from "./page";

const TENANT_ID = "tenant-1";
const BRANCH_ID = "branch-1";
const SESSION_ID = "cash-session-1";

function setSearchParams(params: Record<string, string>) {
  searchParamsValue.current = new URLSearchParams(params);
}

function seedDevice() {
  Session.setActiveSurface("pos");
  Session.setActiveBranchId(BRANCH_ID);
  Session.setTenantId(TENANT_ID);
}

/** Simulates a real `signInWithPin` — writes through the real session module. */
function mockSignOnAs(code: string, name = code) {
  signInWithPin.mockImplementation(async (input: { employeeCode: string; sessionType: "pos" | "kds" }) => {
    Session.setTokens({ accessToken: `tok-${input.employeeCode}`, refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: input.employeeCode, name, sessionType: input.sessionType });
  });
  return code;
}

async function signOnAsManager() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/shift\.managerCode/), "MGR1");
  await user.type(screen.getByLabelText(/shift\.managerPin/), "1234");
  await user.click(screen.getByRole("button", { name: "shift.signOn" }));
  await waitFor(() => expect(screen.getByTestId("drawer-sheet")).toBeInTheDocument());
}

async function click(el: HTMLElement) {
  const { default: userEvent } = await import("@testing-library/user-event");
  await userEvent.setup().click(el);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  setSearchParams({ sessionId: SESSION_ID, employee: "Cashier One", branch: "Main" });
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("Close-at-terminal manager hand-off — sign-on persistence", () => {
  it("a fresh visit always prompts for a PIN, even if this till already has someone signed on", async () => {
    // A cashier is already signed on to this till from an unrelated /pos visit.
    Session.setTokens({ accessToken: "tok-cashier", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "CASH1", name: "Cashier One", sessionType: "pos" });

    render(<CloseSessionPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "shift.signOn" })).toBeInTheDocument());
    expect(screen.queryByTestId("drawer-sheet")).not.toBeInTheDocument();
  });

  it("after signing on, a reload (remount) of the same URL resumes the manager without re-prompting", async () => {
    mockSignOnAs("MGR1", "Manager One");
    const { unmount } = render(<CloseSessionPage />);
    await signOnAsManager();

    unmount();

    // Same tab, same sessionId, same tokens/posEmployee already in storage —
    // exactly what a hard reload or Back-navigation looks like.
    render(<CloseSessionPage />);
    await waitFor(() => expect(screen.getByTestId("drawer-sheet")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "shift.signOn" })).not.toBeInTheDocument();
  });

  it("a DIFFERENT sessionId in the URL is not resumed by a marker written for another session", async () => {
    mockSignOnAs("MGR1", "Manager One");
    const { unmount } = render(<CloseSessionPage />);
    await signOnAsManager();
    unmount();

    setSearchParams({ sessionId: "some-other-session", employee: "X", branch: "Main" });
    render(<CloseSessionPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "shift.signOn" })).toBeInTheDocument());
  });

  it('explicit "switch employee" clears the resumable sign-on', async () => {
    mockSignOnAs("MGR1", "Manager One");
    const { unmount } = render(<CloseSessionPage />);
    await signOnAsManager();

    await click(screen.getByRole("button", { name: "shift.switchEmployee" }));
    unmount();

    render(<CloseSessionPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "shift.signOn" })).toBeInTheDocument());
  });

  it("real sign-out (session cleared) drops the manager immediately, not just on next reload", async () => {
    mockSignOnAs("MGR1", "Manager One");
    render(<CloseSessionPage />);
    await signOnAsManager();

    Session.clearTerminalIdentity();

    await waitFor(() => expect(screen.getByRole("button", { name: "shift.signOn" })).toBeInTheDocument());
    expect(screen.queryByTestId("drawer-sheet")).not.toBeInTheDocument();
  });

  it("a different employee signing on later is never mistaken for the remembered manager", async () => {
    mockSignOnAs("MGR1", "Manager One");
    const { unmount } = render(<CloseSessionPage />);
    await signOnAsManager();
    unmount();

    // A different employee now holds this till's token (e.g. signed on
    // elsewhere) — `isSignedIn()` is true, but not as MGR1.
    Session.setTokens({ accessToken: "tok-other", refreshToken: "ref", expiresIn: 900 });
    Session.setPosEmployee({ code: "OTHER1", name: "Someone Else", sessionType: "pos" });

    render(<CloseSessionPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "shift.signOn" })).toBeInTheDocument());
  });
});
