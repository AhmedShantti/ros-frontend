import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { KitchenTicket } from "@/lib/console/types";

/*
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 — KDS gains its own PIN sign-on
 * here (it had none before: any employee/announce-listener wiring is new,
 * not a regression). Coverage mirrors `pos-live.test.tsx`'s POS contract
 * tests: the PIN request shape, that stale Terminal-era localStorage is
 * inert, that a missing device branch shows a branch prompt rather than a
 * Terminal one, and that station-scoped ticket mutations carry `stationId`.
 *
 * Mocked only at the transport boundary: `@/lib/console/services` and
 * `@/lib/api/auth`. The REAL `@/lib/api/session.ts` runs against jsdom's
 * `localStorage`.
 */

const { queue, acknowledgeViewed, startLine, bumpLine, bumpAll, recall, stationsFn } = vi.hoisted(
  () => ({
    queue: vi.fn(),
    acknowledgeViewed: vi.fn(),
    startLine: vi.fn(),
    bumpLine: vi.fn(),
    bumpAll: vi.fn(),
    recall: vi.fn(),
    stationsFn: vi.fn(),
  }),
);

vi.mock("@/lib/console/services", () => ({
  services: {
    kitchen: {
      queue: (...args: unknown[]) => queue(...args),
      acknowledgeViewed: (...args: unknown[]) => acknowledgeViewed(...args),
      startLine: (...args: unknown[]) => startLine(...args),
      bumpLine: (...args: unknown[]) => bumpLine(...args),
      bumpAll: (...args: unknown[]) => bumpAll(...args),
      recall: (...args: unknown[]) => recall(...args),
    },
    operations: {
      stations: (...args: unknown[]) => stationsFn(...args),
    },
  },
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
}));

import { signInWithPin } from "@/lib/api/auth";
import * as Session from "@/lib/api/session";
import { LiveKds } from "./kds-live";

const BRANCH_ID = "branch-1";
const TENANT_ID = "tenant-1";

const STATION = {
  id: "station-1",
  branchId: BRANCH_ID,
  name: { en: "Grill", ar: "شواء" },
  type: "hot",
  colour: "#f00",
  capacityPerHour: 10,
  active: true,
};

function seedDevice() {
  Session.setActiveSurface("terminal");
  Session.setDeviceBranchId(BRANCH_ID);
  Session.setTenantId(TENANT_ID);
}

/** Simulates a real `signInWithPin` — writes through the real session module. */
function signOnAsKds(code: string, name = code) {
  vi.mocked(signInWithPin).mockImplementation(async (input) => {
    Session.setTokens({ accessToken: `tok-${input.employeeCode}`, refreshToken: "ref", expiresIn: 900 });
    Session.setTenantId(input.tenantId);
    Session.setPosEmployee({ code: input.employeeCode, name, sessionType: input.sessionType });
  });
}

function signOnLocally(code: string, name = code) {
  Session.setTokens({ accessToken: `tok-${code}`, refreshToken: "ref", expiresIn: 900 });
  Session.setPosEmployee({ code, name, sessionType: "kds" });
}

function makeTicket(overrides: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: "ticket-1",
    branchId: BRANCH_ID,
    orderId: "order-1",
    orderNumber: "A-101",
    orderType: "takeaway",
    tableLabel: null,
    stationId: STATION.id,
    stationName: STATION.name,
    state: "queued",
    urgency: "on_target",
    course: 1,
    priority: "normal",
    firedAt: new Date().toISOString(),
    startedAt: null,
    bumpedAt: null,
    cancelReason: null,
    targetSeconds: 600,
    elapsedSeconds: 0,
    lines: [
      {
        id: "line-1",
        name: { en: "Burger", ar: "برغر" },
        quantity: 1,
        modifiers: [],
        state: "fired",
        notes: null,
        cancelledAt: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  stationsFn.mockResolvedValue({ rows: [STATION], total: 1 });
  queue.mockResolvedValue({ tickets: [], recallWindowSeconds: 300, cancelledLineVisibilitySeconds: null });
  acknowledgeViewed.mockResolvedValue(0);
  seedDevice();
});

afterEach(() => {
  cleanup();
});

describe("LiveKds — PIN sign-on contract (FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0)", () => {
  it("shows the branch-setup prompt, never a Terminal one, when this device has no branch set up", async () => {
    window.localStorage.clear();
    Session.setActiveSurface("terminal");
    Session.setTenantId(TENANT_ID);

    render(<LiveKds />);

    expect(await screen.findByText("pos.noBranch")).toBeInTheDocument();
    expect(screen.queryByText("pos.noTerminal")).not.toBeInTheDocument();
  });

  it('calls signInWithPin with tenantId, branchId, sessionType "kds", and no terminalId', async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<LiveKds />);

    await user.type(await screen.findByLabelText(/shift\.employeeCode/), "EMP02");
    await user.type(screen.getByLabelText(/shift\.pinLabel/), "5678");
    await user.click(screen.getByRole("button", { name: "shift.signOn" }));

    await waitFor(() => expect(signInWithPin).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(signInWithPin).mock.calls[0]![0];
    expect(payload).toEqual({
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      employeeCode: "EMP02",
      pin: "5678",
      sessionType: "kds",
    });
    expect(payload).not.toHaveProperty("terminalId");
  });

  it("boots normally even when the device still carries legacy Terminal localStorage from before this migration", async () => {
    window.localStorage.setItem("ros.api.terminalId", "legacy-term-1");
    window.localStorage.setItem("ros.api.terminalName", "Old KDS Display");
    window.localStorage.setItem("ros.api.terminalBranchId", "legacy-branch-9");

    render(<LiveKds />);

    await screen.findByLabelText(/shift\.employeeCode/);
    expect(screen.queryByText("pos.noBranch")).not.toBeInTheDocument();
  });

  it("a POS sign-on left on this device is not treated as a KDS sign-on", async () => {
    // Same device-level identity slot, but the wrong session type — the
    // display must still ask for its own sign-on, never inherit a cashier's.
    signOnLocally("EMP01", "Amina");
    Session.setPosEmployee({ code: "EMP01", name: "Amina", sessionType: "pos" });

    render(<LiveKds />);

    await screen.findByLabelText(/shift\.employeeCode/);
    expect(screen.queryByText("Amina")).not.toBeInTheDocument();
  });
});

describe("LiveKds — station context (operational, not device identity)", () => {
  it("requires a station to be selected before showing the ticket queue", async () => {
    signOnLocally("EMP02", "Chef");

    render(<LiveKds />);

    expect(await screen.findByText("kds.pickStation")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Grill" })).toBeInTheDocument();
  });

  it("includes stationId when starting a ticket line", async () => {
    signOnLocally("EMP02", "Chef");
    Session.setKdsStationId(STATION.id);

    const ticket = makeTicket({ state: "queued" });
    queue.mockResolvedValue({
      tickets: [ticket],
      recallWindowSeconds: 300,
      cancelledLineVisibilitySeconds: null,
    });
    startLine.mockResolvedValue(ticket);

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<LiveKds />);

    const startButton = await screen.findByRole("button", { name: "kds.start" });
    await user.click(startButton);

    await waitFor(() => expect(startLine).toHaveBeenCalledTimes(1));
    expect(startLine).toHaveBeenCalledWith(ticket.id, ticket.lines[0]!.id, STATION.id);
  });

  it("includes stationId when recalling a bumped ticket", async () => {
    signOnLocally("EMP02", "Chef");
    Session.setKdsStationId(STATION.id);

    const bumped = makeTicket({
      id: "ticket-2",
      orderNumber: "A-102",
      state: "bumped",
      bumpedAt: new Date().toISOString(),
    });
    queue.mockResolvedValue({
      tickets: [bumped],
      recallWindowSeconds: 300,
      cancelledLineVisibilitySeconds: null,
    });
    recall.mockResolvedValue({ ...bumped, state: "queued", bumpedAt: null });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    render(<LiveKds />);

    const recallButton = await screen.findByRole("button", { name: bumped.orderNumber });
    await user.click(recallButton);

    await waitFor(() => expect(recall).toHaveBeenCalledTimes(1));
    expect(recall).toHaveBeenCalledWith(bumped.id, STATION.id);
  });
});
