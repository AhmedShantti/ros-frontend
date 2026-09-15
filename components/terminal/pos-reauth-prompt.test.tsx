import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

/*
 * POS-SESSION-RESILIENCE-P1 — `PosReauthPrompt`'s own state machine, in
 * isolation from `client.ts`'s real network/dedup logic (covered separately
 * in `lib/api/client.test.ts`). `setStaleSnapshotReauthHandler` is mocked
 * here purely to CAPTURE the handler the component registers — the test
 * then calls that captured handler directly, exactly as `client.ts` would,
 * and asserts what the component does in response.
 */

const { registerHandler, reauthenticateWithPin, MockServiceError } = vi.hoisted(() => {
  class MockServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    registerHandler: vi.fn(),
    reauthenticateWithPin: vi.fn(),
    MockServiceError,
  };
});

vi.mock("@/lib/api/client", () => ({
  setStaleSnapshotReauthHandler: (...args: unknown[]) => registerHandler(...args),
}));

vi.mock("@/lib/api/auth", () => ({
  reauthenticateWithPin: (...args: unknown[]) => reauthenticateWithPin(...args),
}));

vi.mock("@/lib/console/services/types", () => ({
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
}));

import { PosReauthPrompt } from "./pos-reauth-prompt";

/** The handler the mounted component registered with `client.ts`. */
function capturedHandler(): () => Promise<boolean> {
  const call = registerHandler.mock.calls.find(([fn]) => typeof fn === "function");
  if (!call) throw new Error("PosReauthPrompt never registered a handler");
  return call[0] as () => Promise<boolean>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PosReauthPrompt", () => {
  it("registers exactly one handler on mount, and none of the dialog renders until it is invoked", () => {
    render(<PosReauthPrompt />);
    expect(registerHandler).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unregisters its handler on unmount", () => {
    const { unmount } = render(<PosReauthPrompt />);
    unmount();
    // Last call with a real function was the registration; the final call
    // overall must be the null de-registration.
    const lastCall = registerHandler.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeNull();
  });

  it("invoking the registered handler opens exactly one PIN dialog", async () => {
    render(<PosReauthPrompt />);
    void capturedHandler()();
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("a successful PIN submission calls reauthenticateWithPin, resolves the handler's promise true, and closes the dialog — existing POS state (this component's siblings) is never touched", async () => {
    reauthenticateWithPin.mockResolvedValue(undefined);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(
      <div>
        <div data-testid="pos-order-state">Order #42 — 3 lines</div>
        <PosReauthPrompt />
      </div>,
    );
    const outcome = capturedHandler()();

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/shift\.pinLabel/), "4321");
    await user.click(within(dialog).getByRole("button", { name: "pos.reauthSubmit" }));

    await expect(outcome).resolves.toBe(true);
    expect(reauthenticateWithPin).toHaveBeenCalledWith("4321");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Untouched throughout — this component never re-renders its siblings.
    expect(screen.getByTestId("pos-order-state")).toHaveTextContent("Order #42 — 3 lines");
  });

  it("a failed PIN submission shows the error, does NOT resolve the handler's promise, and lets the operator retry without losing anything", async () => {
    reauthenticateWithPin.mockRejectedValueOnce(
      new MockServiceError("UNAUTHENTICATED", "Incorrect PIN.", 401),
    );
    reauthenticateWithPin.mockResolvedValueOnce(undefined);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<PosReauthPrompt />);
    const outcome = capturedHandler()();

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/shift\.pinLabel/), "0000");
    await user.click(within(dialog).getByRole("button", { name: "pos.reauthSubmit" }));

    // The error surfaces, the dialog stays open — no resolution yet, so
    // nothing waiting on `outcome` has been told anything (real or false).
    expect(await within(dialog).findByText("Incorrect PIN.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // A human retry, not an automatic loop — the SAME dialog, a fresh PIN.
    await user.type(within(dialog).getByLabelText(/shift\.pinLabel/), "4321");
    await user.click(within(dialog).getByRole("button", { name: "pos.reauthSubmit" }));

    await expect(outcome).resolves.toBe(true);
    expect(reauthenticateWithPin).toHaveBeenCalledTimes(2);
  });

  it("cancelling resolves the handler's promise false, without ever calling reauthenticateWithPin", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<PosReauthPrompt />);
    const outcome = capturedHandler()();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "common.cancel" }));

    await expect(outcome).resolves.toBe(false);
    expect(reauthenticateWithPin).not.toHaveBeenCalled();
  });
});
