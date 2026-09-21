import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/*
 * CASH-CLOSE-RECOUNT-AFTER-REJECTION-P0 — the Drawer after a manager REJECTS a
 * variance.
 *
 * Live: expected EGP 18,500, the cashier counted EGP 3,800 (variance
 * -EGP 14,700, tolerance 0), the manager rejected — and the sheet then offered
 * nothing but another manager decision against the same, mistaken, count.
 *
 * Mocked only at the transport boundary (`@/lib/console/services`) and the
 * i18n provider (`t` returns the key, so assertions read the key). The REAL
 * `DrawerSheet`, `useAsync`, `useAction`, `Drawer` and `formatMoney` run.
 *
 * Whether a recount is OFFERED is the server's `recountAvailable` — these
 * tests drive it through `closeContext`, exactly as the real screen does; there
 * is no local "was rejected" state to fake.
 */

const { closeContext, declareClose, finalizeClose, recountClose, recordMovement } = vi.hoisted(
  () => ({
    closeContext: vi.fn(),
    declareClose: vi.fn(),
    finalizeClose: vi.fn(),
    recountClose: vi.fn(),
    recordMovement: vi.fn(),
  }),
);

vi.mock("@/lib/console/services", () => {
  class ServiceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    services: {
      treasury: {
        closeContext: (...args: unknown[]) => closeContext(...args),
        declareClose: (...args: unknown[]) => declareClose(...args),
        finalizeClose: (...args: unknown[]) => finalizeClose(...args),
        recountClose: (...args: unknown[]) => recountClose(...args),
        recordMovement: (...args: unknown[]) => recordMovement(...args),
      },
    },
    ServiceError,
  };
});

vi.mock("@/lib/console/providers", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tx: (value: unknown) => (typeof value === "string" ? value : ""),
    locale: "en",
    dir: "ltr",
    fmt: { locale: "en", arabicIndicNumerals: false },
  }),
}));

import { DrawerSheet } from "./pos-drawer";
import { formatMoney } from "@/lib/console/format";

const FMT = { locale: "en", arabicIndicNumerals: false } as const;
const money = (amount: number) => ({ amount, currency: "EGP" as const });
/** The exact text the screen renders for a figure. */
const shown = (amount: number) => formatMoney(money(amount), FMT as never).replace(/\s+/g, " ");

const EXPECTED = 1_850_000; // EGP 18,500
const WRONG = 380_000; // EGP 3,800
const TOLERANCE = 0;

type Ctx = Record<string, unknown>;
const closingContext = (over: Ctx = {}): Ctx => ({
  cashSessionId: "cs-1",
  status: "closing",
  countMode: "blind",
  currency: "EGP",
  openingFloat: money(EXPECTED),
  tolerance: money(TOLERANCE),
  expectedCash: money(EXPECTED),
  countedCash: money(WRONG),
  variance: money(WRONG - EXPECTED),
  approvalRequired: true,
  closedAt: null,
  frozen: true,
  closeAttemptId: "attempt-1",
  attemptNumber: 1,
  recountAvailable: false,
  ...over,
});
const rejectedContext = (over: Ctx = {}) => closingContext({ recountAvailable: true, ...over });
const closedContext = (): Ctx =>
  closingContext({ status: "closed", frozen: false, recountAvailable: false, closedAt: "2026-09-21T10:00:00Z" });
const openContext = (): Ctx => ({
  cashSessionId: "cs-1",
  status: "open",
  countMode: "blind",
  currency: "EGP",
  openingFloat: money(EXPECTED),
  tolerance: money(TOLERANCE),
  expectedCash: null,
  countedCash: null,
  variance: null,
  approvalRequired: null,
  closedAt: null,
  frozen: false,
  closeAttemptId: null,
  attemptNumber: null,
  recountAvailable: false,
});

const onClose = vi.fn();
const onMessage = vi.fn();
const onClosed = vi.fn();

function mount() {
  return render(
    <DrawerSheet
      open
      cashSessionId="cs-1"
      onClose={onClose}
      onMessage={onMessage}
      onClosed={onClosed}
    />,
  );
}

async function user() {
  const { default: userEvent } = await import("@testing-library/user-event");
  return userEvent.setup();
}

const recountButton = () => screen.queryByRole("button", { name: "shift.recount" });
const findRecountButton = () => screen.findByRole("button", { name: "shift.recount" });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("DrawerSheet — when a recount is offered (server truth)", () => {
  it("1. a REJECTED variance shows Recount cash — replacing the dead-end decision form", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    mount();

    expect(await findRecountButton()).toBeInTheDocument();
    expect(screen.getByText("shift.rejectedTitle")).toBeInTheDocument();
    // The old dead-end: a manager approve/reject form as the ONLY thing on offer.
    expect(screen.queryByRole("button", { name: "shift.approveClose" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "shift.rejectClose" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/shift\.managerPin/)).not.toBeInTheDocument();
  });

  it("2. a PENDING variance (frozen, no rejection yet) does not show a recount — only the manager decision", async () => {
    closeContext.mockResolvedValue(closingContext({ recountAvailable: false }));
    mount();

    expect(await screen.findByLabelText(/shift\.managerPin/)).toBeInTheDocument();
    expect(recountButton()).not.toBeInTheDocument();
    expect(screen.queryByText("shift.rejectedTitle")).not.toBeInTheDocument();
  });

  it("3. approved / closed and still-open sessions do not show a recount", async () => {
    closeContext.mockResolvedValue(closedContext());
    const first = mount();
    expect((await screen.findAllByText("shift.closed")).length).toBeGreaterThan(0);
    expect(recountButton()).not.toBeInTheDocument();
    first.unmount();

    closeContext.mockResolvedValue(openContext());
    mount();
    expect(await screen.findByText("shift.declare")).toBeInTheDocument();
    expect(recountButton()).not.toBeInTheDocument();
  });

  it("a stale client cannot conjure a recount: if the server says recountAvailable=false it is never shown", async () => {
    // Same frozen session, but the server does not vouch for a rejection.
    closeContext.mockResolvedValue(closingContext({ recountAvailable: false }));
    mount();
    await screen.findByLabelText(/shift\.managerPin/);
    expect(recountButton()).not.toBeInTheDocument();
  });

  it("a manager REJECTION lands the screen on the recount action (re-read from the server, not inferred)", async () => {
    closeContext
      .mockResolvedValueOnce(closingContext({ recountAvailable: false }))
      .mockResolvedValue(rejectedContext());
    finalizeClose.mockResolvedValue({ status: "closing", outcome: "rejected" });
    mount();

    const u = await user();
    await u.type(await screen.findByLabelText(/shift\.managerCode/), "MGR1");
    await u.type(screen.getByLabelText(/shift\.managerPin/), "1234");
    await u.type(screen.getByLabelText(/shift\.decisionReason/), "Not a real shortage");
    await u.click(screen.getByRole("button", { name: "shift.rejectClose" }));

    expect(await findRecountButton()).toBeInTheDocument();
    expect(onMessage).toHaveBeenCalledWith("shift.rejectedOutcome");
    // The decision was bound to the attempt the manager was shown.
    expect(finalizeClose).toHaveBeenCalledWith(
      "cs-1",
      expect.objectContaining({ decision: "rejected", closeAttemptId: "attempt-1" }),
    );
  });

  it("a fresh manager decision on the SAME count stays reachable, but only as a deliberate secondary action", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    mount();
    await findRecountButton();
    expect(screen.queryByLabelText(/shift\.managerPin/)).not.toBeInTheDocument();

    const u = await user();
    await u.click(screen.getByRole("button", { name: "shift.recordNewDecision" }));
    expect(await screen.findByLabelText(/shift\.managerPin/)).toBeInTheDocument();
  });
});

describe("DrawerSheet — recount entry", () => {
  it("4. clicking Recount cash returns to the count-entry UI", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    mount();
    const u = await user();
    await u.click(await findRecountButton());

    expect(screen.getByText("shift.recountTitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "shift.recountCommit" })).toBeInTheDocument();
    expect(screen.getByLabelText(/shift\.faceValue/)).toBeInTheDocument();
    // The rejected panel and the manager form are gone while counting.
    expect(recountButton()).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/shift\.managerPin/)).not.toBeInTheDocument();
    // Nothing was sent just by opening the form.
    expect(recountClose).not.toHaveBeenCalled();
  });

  it("5/6. the new count field is EMPTY — never the expected cash, never the previous count — and cannot be submitted blank", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    mount();
    const u = await user();
    await u.click(await findRecountButton());

    // Total mode: the field starts empty.
    await u.click(screen.getByText("shift.countByTotal"));
    const total = screen.getByLabelText(/shift\.countedTotal/) as HTMLInputElement;
    expect(total.value).toBe("");
    expect(total.value).not.toContain("18500");
    expect(total.value).not.toContain("3800");

    // Denomination mode: rows start empty.
    await u.click(screen.getByText("shift.countByDenomination"));
    expect((screen.getByLabelText(/shift\.faceValue/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/shift\.count$/) as HTMLInputElement).value).toBe("");

    // Nothing to commit until the cashier actually counts.
    expect(screen.getByRole("button", { name: "shift.recountCommit" })).toBeDisabled();
    expect(recountClose).not.toHaveBeenCalled();
  });

  it("7. BLIND: expected cash, tolerance, the previous count and the old variance are hidden while the recount is entered — and were visible before", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    mount();

    // Before: the rejected screen legitimately shows what was disclosed at commit time.
    await findRecountButton();
    expect(screen.getAllByText(shown(EXPECTED)).length).toBeGreaterThan(0);
    expect(screen.getByText(shown(WRONG))).toBeInTheDocument();

    const u = await user();
    await u.click(screen.getByRole("button", { name: "shift.recount" }));

    // During: nothing in the sheet reads as the expected/previous figure. (The
    // opening float is a policy/opening fact and here happens to equal EXPECTED,
    // so it is asserted by its label rather than by amount.)
    expect(screen.queryByText(shown(WRONG))).not.toBeInTheDocument();
    expect(screen.queryByText(shown(WRONG - EXPECTED))).not.toBeInTheDocument();
    const expectedRow = screen.getByText("shift.expected").parentElement!;
    expect(expectedRow).toHaveTextContent("—");
    expect(expectedRow).not.toHaveTextContent(shown(EXPECTED));
    for (const label of ["shift.tolerance", "shift.countedTotal", "shift.variance"]) {
      expect(screen.getAllByText(label)[0]!.parentElement).toHaveTextContent("—");
    }
  });

  it("7b. OPEN-count mode keeps showing what its policy shows (the recount does not invent extra secrecy)", async () => {
    closeContext.mockResolvedValue(rejectedContext({ countMode: "open" }));
    mount();
    const u = await user();
    await u.click(await findRecountButton());
    expect(screen.getByText("shift.expected").parentElement).toHaveTextContent(shown(EXPECTED));
  });

  it("Back returns to the rejected screen without calling the server", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    mount();
    const u = await user();
    await u.click(await findRecountButton());
    await u.click(screen.getByRole("button", { name: "shift.recountCancel" }));

    expect(await findRecountButton()).toBeInTheDocument();
    expect(recountClose).not.toHaveBeenCalled();
  });
});

describe("DrawerSheet — committing the recount", () => {
  const recountResult = (over: Ctx = {}) => ({
    cashSessionId: "cs-1",
    closeAttemptId: "attempt-2",
    status: "closed",
    approvalRequired: false,
    created: true,
    supersedesCloseAttemptId: "attempt-1",
    countMode: "blind",
    tolerance: money(TOLERANCE),
    expectedCash: money(EXPECTED),
    countedCash: money(EXPECTED),
    variance: money(0),
    ...over,
  });

  it("6/8. the recount sends exactly what was typed (not 3,800), names the attempt it replaces, and a correct recount finishes the close", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    recountClose.mockResolvedValue(recountResult());
    mount();
    const u = await user();
    await u.click(await findRecountButton());
    await u.click(screen.getByText("shift.countByTotal"));
    await u.type(screen.getByLabelText(/shift\.countedTotal/), "18500");
    await u.click(screen.getByRole("button", { name: "shift.recountCommit" }));

    await waitFor(() => expect(recountClose).toHaveBeenCalledTimes(1));
    expect(recountClose).toHaveBeenCalledWith("cs-1", {
      countedTotalMinorUnits: "1850000",
      supersedesCloseAttemptId: "attempt-1",
    });
    // The first (mistaken) count is not resubmitted, and no first-count route is used.
    expect(declareClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("shift.closedWithin"));
  });

  it("denomination counting is preserved: the recount submits denominations, not a total", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    recountClose.mockResolvedValue(recountResult());
    mount();
    const u = await user();
    await u.click(await findRecountButton());
    await u.type(screen.getByLabelText(/shift\.faceValue/), "200");
    await u.type(screen.getByLabelText(/shift\.count$/), "92");
    await u.click(screen.getByRole("button", { name: "shift.recountCommit" }));

    await waitFor(() => expect(recountClose).toHaveBeenCalledTimes(1));
    expect(recountClose).toHaveBeenCalledWith("cs-1", {
      denominations: [{ denominationMinorUnits: "20000", quantity: 92 }],
      supersedesCloseAttemptId: "attempt-1",
    });
  });

  it("9. a recount that is STILL over tolerance returns to the manager-decision state — on the NEW count, with a fresh decision bound to it", async () => {
    closeContext
      .mockResolvedValueOnce(rejectedContext())
      .mockResolvedValue(
        closingContext({
          closeAttemptId: "attempt-2",
          attemptNumber: 2,
          countedCash: money(EXPECTED - 500),
          variance: money(-500),
          recountAvailable: false, // the OLD rejection does not authorise a recount of the NEW count
        }),
      );
    recountClose.mockResolvedValue(
      recountResult({
        status: "closing",
        approvalRequired: true,
        countedCash: money(EXPECTED - 500),
        variance: money(-500),
      }),
    );
    finalizeClose.mockResolvedValue({ status: "closed", outcome: "closed" });
    mount();
    const u = await user();
    await u.click(await findRecountButton());
    await u.click(screen.getByText("shift.countByTotal"));
    await u.type(screen.getByLabelText(/shift\.countedTotal/), "18495");
    await u.click(screen.getByRole("button", { name: "shift.recountCommit" }));

    // Back in the manager-decision state, NOT the recount panel, NOT closed.
    expect(await screen.findByLabelText(/shift\.managerPin/)).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();
    expect(recountButton()).not.toBeInTheDocument();
    expect(onMessage).toHaveBeenCalledWith("shift.recountDeclared");
    // The figures on screen are the recount's, not the superseded count's.
    expect(screen.getAllByText(shown(EXPECTED - 500)).length).toBeGreaterThan(0);
    expect(screen.queryByText(shown(WRONG))).not.toBeInTheDocument();

    // The manager's decision is bound to attempt 2 (the one they are looking at).
    await u.type(screen.getByLabelText(/shift\.managerCode/), "MGR1");
    await u.type(screen.getByLabelText(/shift\.managerPin/), "1234");
    await u.type(screen.getByLabelText(/shift\.decisionReason/), "Five pounds short");
    await u.click(screen.getByRole("button", { name: "shift.approveClose" }));
    await waitFor(() => expect(finalizeClose).toHaveBeenCalledTimes(1));
    expect(finalizeClose).toHaveBeenCalledWith(
      "cs-1",
      expect.objectContaining({ decision: "approved", closeAttemptId: "attempt-2" }),
    );
  });

  it("8. a server refusal (e.g. another till already recounted) is shown, and the sheet stays on the count form", async () => {
    closeContext.mockResolvedValue(rejectedContext());
    const { ServiceError } = await import("@/lib/console/services");
    recountClose.mockRejectedValue(
      new ServiceError("conflict", "That count is no longer the current one.", 409),
    );
    mount();
    const u = await user();
    await u.click(await findRecountButton());
    await u.click(screen.getByText("shift.countByTotal"));
    await u.type(screen.getByLabelText(/shift\.countedTotal/), "18500");
    await u.click(screen.getByRole("button", { name: "shift.recountCommit" }));

    expect(await screen.findByText(/no longer the current one/)).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "shift.recountCommit" })).toBeInTheDocument();
  });
});
