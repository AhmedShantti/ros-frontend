import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as Session from "@/lib/api/session";
import SelectBranchPage from "./page";

/*
 * FRONTEND-REMOVE-DEVICE-UX-P1-FINAL-CORRECTION — this screen has exactly one
 * flow now, not a live/demo split: `useSession()` already resolves live vs.
 * fixture branch data internally (see `lib/console/providers.tsx`), so the
 * page itself renders identically either way and needs no `DATA_MODE`
 * branch of its own. These tests prove the branch-selection UI directly —
 * under "many authorized branches", "exactly one" (the auto-select shortcut,
 * standing in for what used to be the fixture-only shape) and "not signed
 * in" — and that none of the retired device/terminal copy ("Device set up",
 * "This device is ready…", "Register this device", "Pair a device", "Bind
 * this device", "Terminal") survives anywhere on it, in ANY of those states.
 *
 * Mocked only at the transport boundary this page actually has:
 * `@/lib/console/providers` (the console's own session/branch context) and
 * `next/navigation` (routing). `@/lib/console/services` is deliberately NOT
 * mocked — this screen makes no service/network call at all, and leaving it
 * unmocked means an accidental call would fail the test loudly rather than
 * silently succeeding against a mock. The REAL `@/lib/api/session.ts` runs
 * against jsdom's `localStorage`.
 */

const BANNED_PHRASES: RegExp[] = [
  /device set up/i,
  /this device is ready/i,
  /register this device/i,
  /pair a device/i,
  /bind this device/i,
  /activate.*device/i,
  /\bterminal\b/i,
];

function expectNoDeviceOrTerminalWording(container: HTMLElement) {
  const text = container.textContent ?? "";
  for (const phrase of BANNED_PHRASES) {
    expect(text).not.toMatch(phrase);
  }
}

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

type SessionShape = {
  authenticated: boolean;
  branch: { id: string; name: { en: string; ar: string } } | null;
  availableBranches: { id: string; name: { en: string; ar: string }; code: string }[];
  org: { loading: boolean; error: { message: string } | null };
};

const sessionState = vi.hoisted(() => ({
  current: {
    authenticated: true,
    branch: null,
    availableBranches: [],
    org: { loading: false, error: null },
  } as SessionShape,
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
  useSession: () => sessionState.current,
}));

const DOWNTOWN = { id: "branch-1", name: { en: "Downtown", ar: "وسط البلد" }, code: "DT" };
const UPTOWN = { id: "branch-2", name: { en: "Uptown", ar: "أعلى المدينة" }, code: "UT" };

function setSession(overrides: Partial<SessionShape>) {
  sessionState.current = {
    authenticated: true,
    branch: null,
    availableBranches: [],
    org: { loading: false, error: null },
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  pushMock.mockClear();
  setSession({ availableBranches: [DOWNTOWN, UPTOWN] });
});

afterEach(() => {
  cleanup();
});

describe("SelectBranchPage — retired device/terminal copy never appears", () => {
  it("renders no device/terminal wording on the branch-picker screen (many branches)", async () => {
    const { container } = render(<SelectBranchPage />);
    await screen.findByText("branch.selectTitle");
    expectNoDeviceOrTerminalWording(container);
  });

  it("renders no device/terminal wording once a branch is confirmed", async () => {
    const { container } = render(<SelectBranchPage />);
    const confirmButton = await screen.findByRole("button", { name: "branch.confirmSelection" });
    confirmButton.click();
    await screen.findByText("branch.selected");
    expectNoDeviceOrTerminalWording(container);
  });

  it("renders no device/terminal wording on the single-branch auto-select screen (the fixture/demo shape)", async () => {
    setSession({ availableBranches: [DOWNTOWN] });
    const { container } = render(<SelectBranchPage />);
    await waitFor(() => expect(screen.getByText("branch.selected")).toBeInTheDocument());
    expectNoDeviceOrTerminalWording(container);
  });

  it("renders no device/terminal wording on the sign-in prompt", async () => {
    setSession({ authenticated: false, availableBranches: [] });
    const { container } = render(<SelectBranchPage />);
    await screen.findByText("branch.needsSession");
    expectNoDeviceOrTerminalWording(container);
  });
});

describe("SelectBranchPage — branch selection", () => {
  it("shows the sign-in prompt, not a branch list, when not signed in", async () => {
    setSession({ authenticated: false, availableBranches: [] });
    render(<SelectBranchPage />);

    expect(await screen.findByText("branch.needsSession")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("only offers the authorized branches from the console's own session", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<SelectBranchPage />);
    await screen.findByText("branch.selectTitle");

    // `Select` (components/console/ui.tsx) is a custom listbox: the trigger
    // shows only the currently selected option's text, and the rest only
    // appear once opened.
    expect(screen.getByText(/Downtown/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /term\.branch/ }));
    expect(screen.getByRole("option", { name: /Uptown/ })).toBeInTheDocument();
  });

  it("selecting a branch persists it under the new activeBranchId key, not a device key", async () => {
    render(<SelectBranchPage />);
    const confirmButton = await screen.findByRole("button", { name: "branch.confirmSelection" });
    confirmButton.click();

    await waitFor(() => expect(screen.getByText("branch.selected")).toBeInTheDocument());
    expect(Session.getActiveBranchId()).toBe(DOWNTOWN.id);
    expect(window.localStorage.getItem("ros.api.deviceBranchId")).toBeNull();
    expect(window.localStorage.getItem("ros.api.activeBranchId")).toBe(DOWNTOWN.id);
  });

  it("auto-selects and proceeds when exactly one authorized branch exists", async () => {
    setSession({ availableBranches: [DOWNTOWN] });

    render(<SelectBranchPage />);

    await waitFor(() => expect(screen.getByText("branch.selected")).toBeInTheDocument());
    expect(Session.getActiveBranchId()).toBe(DOWNTOWN.id);
    // No manual confirmation step was needed for the single-branch case.
    expect(screen.queryByRole("button", { name: "branch.confirmSelection" })).not.toBeInTheDocument();
  });

  it("shows Open point of sale and Open kitchen display once a branch is selected", async () => {
    render(<SelectBranchPage />);
    const confirmButton = await screen.findByRole("button", { name: "branch.confirmSelection" });
    confirmButton.click();

    await screen.findByText("branch.selected");
    expect(screen.getByRole("button", { name: "branch.openPos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "branch.openKds" })).toBeInTheDocument();
  });
});
