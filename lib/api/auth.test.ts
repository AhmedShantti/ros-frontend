import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * POS-KDS-SESSION-ISOLATION-P0
 *
 * Live symptom: `POST /orders/.../lines` on `/pos` 403'd with "PIN (KDS)
 * sessions cannot access dashboard, back-office, or POS endpoints." — proof
 * the POS page was sending a KDS token. Root cause: POS and KDS shared ONE
 * `lib/api/session.ts` storage slot (`activeSurface` only distinguished
 * "console" from "terminal", never POS from KDS within "terminal"), so a
 * KDS PIN sign-on overwrote the exact token/employee record `/pos` was
 * reading. `signInWithPin` made this worse on top of the shared slot: it
 * called `clearTerminalIdentity()` on every sign-on, which — even after
 * splitting the storage — would have gone on wiping BOTH surfaces' tokens
 * from either one's own sign-on, had it not been switched to `clearSession()`
 * (current-surface-only).
 *
 * These tests exercise the REAL `signInWithPin`/`signOffTerminal` against
 * the REAL `lib/api/session.ts` (real jsdom localStorage) — only
 * `./endpoints` (the network boundary) is mocked.
 */

const loginWithPin = vi.fn();
const logout = vi.fn();

vi.mock("./endpoints", () => ({
  api: {
    auth: {
      loginWithPin: (...args: unknown[]) => loginWithPin(...args),
      logout: (...args: unknown[]) => logout(...args),
    },
  },
}));

import { signInWithPin, signOffTerminal } from "./auth";
import * as Session from "./session";

function pinResponse(accessToken: string, displayName: string) {
  return {
    tokenType: "Bearer" as const,
    accessToken,
    refreshToken: `${accessToken}-refresh`,
    expiresIn: 900,
    user: {
      id: "u1",
      email: "e@example.com",
      displayName,
      phone: null,
      preferredLocale: "en",
      status: "active" as const,
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  logout.mockResolvedValue(undefined);
});

describe("signInWithPin — POS and KDS never overwrite each other", () => {
  it("POS sign-on stores a POS session", async () => {
    Session.setActiveSurface("pos");
    loginWithPin.mockResolvedValue(pinResponse("pos-tok", "Cashier"));

    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "C1",
      pin: "1234",
      sessionType: "pos",
    });

    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("pos-tok");
    expect(Session.getPosEmployee()).toEqual({
      code: "C1",
      name: "Cashier",
      sessionType: "pos",
    });
  });

  it("KDS sign-on stores a KDS session, separately from POS", async () => {
    Session.setActiveSurface("kds");
    loginWithPin.mockResolvedValue(pinResponse("kds-tok", "Cook"));

    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "K1",
      pin: "5678",
      sessionType: "kds",
    });

    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("kds-tok");
    expect(Session.getPosEmployee()).toEqual({
      code: "K1",
      name: "Cook",
      sessionType: "kds",
    });
  });

  it("signing into KDS does not overwrite an existing POS token — the exact live bug", async () => {
    Session.setActiveSurface("pos");
    loginWithPin.mockResolvedValue(pinResponse("pos-tok", "Cashier"));
    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "C1",
      pin: "1234",
      sessionType: "pos",
    });

    Session.setActiveSurface("kds");
    loginWithPin.mockResolvedValue(pinResponse("kds-tok", "Cook"));
    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "K1",
      pin: "5678",
      sessionType: "kds",
    });

    // Returning to /pos must still send the POS token, not KDS's.
    Session.setActiveSurface("pos");
    expect(Session.getAccessToken()).toBe("pos-tok");
    expect(Session.getPosEmployee()?.code).toBe("C1");

    // And /kds must still see its own.
    Session.setActiveSurface("kds");
    expect(Session.getAccessToken()).toBe("kds-tok");
    expect(Session.getPosEmployee()?.code).toBe("K1");
  });

  it("signing into POS does not overwrite an existing KDS token", async () => {
    Session.setActiveSurface("kds");
    loginWithPin.mockResolvedValue(pinResponse("kds-tok", "Cook"));
    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "K1",
      pin: "5678",
      sessionType: "kds",
    });

    Session.setActiveSurface("pos");
    loginWithPin.mockResolvedValue(pinResponse("pos-tok", "Cashier"));
    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "C1",
      pin: "1234",
      sessionType: "pos",
    });

    Session.setActiveSurface("kds");
    expect(Session.getAccessToken()).toBe("kds-tok");
  });
});

describe("signOffTerminal — explicit sign-off is surface-scoped", () => {
  async function signOnBoth() {
    Session.setActiveSurface("pos");
    loginWithPin.mockResolvedValue(pinResponse("pos-tok", "Cashier"));
    await signInWithPin({ tenantId: "t1", branchId: "b1", employeeCode: "C1", pin: "1234", sessionType: "pos" });

    Session.setActiveSurface("kds");
    loginWithPin.mockResolvedValue(pinResponse("kds-tok", "Cook"));
    await signInWithPin({ tenantId: "t1", branchId: "b1", employeeCode: "K1", pin: "5678", sessionType: "kds" });
  }

  it("POS sign-off does not sign out KDS", async () => {
    await signOnBoth();

    Session.setActiveSurface("pos");
    await signOffTerminal();

    expect(Session.isSignedIn()).toBe(false); // pos
    Session.setActiveSurface("kds");
    expect(Session.isSignedIn()).toBe(true); // kds untouched
  });

  it("KDS sign-off does not sign out POS", async () => {
    await signOnBoth();

    Session.setActiveSurface("kds");
    await signOffTerminal();

    expect(Session.isSignedIn()).toBe(false); // kds
    Session.setActiveSurface("pos");
    expect(Session.isSignedIn()).toBe(true); // pos untouched
  });

  it("no terminalId/device binding is written by either sign-on", async () => {
    await signOnBoth();

    const keys = Object.keys(window.localStorage).join(" ");
    expect(keys.toLowerCase()).not.toContain("terminalid");
  });
});
