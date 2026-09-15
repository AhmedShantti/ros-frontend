import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HARD_SESSION_LIFETIME_MS,
  clearSession,
  clearTerminalIdentity,
  getAccessToken,
  getActiveBranchId,
  getActiveBranchName,
  getOpenCashSession,
  getPendingCashOpen,
  getPosEmployee,
  isSessionOverHardLimit,
  isSignedIn,
  migrateLegacyPosKdsDeviceState,
  onSessionChange,
  setActiveSurface,
  setActiveBranchId,
  setOpenCashSession,
  setPendingCashOpen,
  setPosEmployee,
  setTokens,
} from "./session";

beforeEach(() => {
  window.localStorage.clear();
  setActiveSurface("pos");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isSignedIn", () => {
  it("is false with nothing signed in", () => {
    expect(isSignedIn()).toBe(false);
  });

  it("checks the real access token, not the cached employee record", () => {
    // A stale `posEmployee` display record with no backing token — e.g. a
    // token that expired and was cleared without the cached name going with
    // it — must never read as "signed in".
    setPosEmployee({ code: "EMP01", name: "Amina" });
    expect(isSignedIn()).toBe(false);
    expect(getPosEmployee()).not.toBeNull(); // the stale record is still there…
    // …but nothing may act on it, because there is no credential behind it.
  });

  it("is true once a real token exists", () => {
    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    expect(isSignedIn()).toBe(true);
  });
});

describe("PosEmployee.sessionType — FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0", () => {
  it("round-trips a KDS sign-on distinctly from a POS one", () => {
    setPosEmployee({ code: "EMP02", name: "Cook", sessionType: "kds" });
    expect(getPosEmployee()).toEqual({ code: "EMP02", name: "Cook", sessionType: "kds" });
  });

  it("defaults an unmarked record to \"pos\" — the only kind that existed before KDS had its own sign-on", () => {
    window.localStorage.setItem(
      "ros.pos.employee",
      JSON.stringify({ code: "EMP01", name: "Amina" }),
    );
    expect(getPosEmployee()).toEqual({ code: "EMP01", name: "Amina", sessionType: "pos" });
  });
});

describe("OpenCashSession storage", () => {
  it("round-trips a full record", () => {
    setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "branch-1" });
    expect(getOpenCashSession()).toEqual({
      cashSessionId: "cs-1",
      employeeCode: "EMP01",
      branchId: "branch-1",
    });
  });

  it("reads a legacy bare-id record as owner-unknown, not as a parse failure", () => {
    window.localStorage.setItem("ros.api.cashSessionId", "cs-legacy");
    expect(getOpenCashSession()).toEqual({
      cashSessionId: "cs-legacy",
      employeeCode: "",
      branchId: "",
    });
  });

  it("returns null once cleared", () => {
    setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "branch-1" });
    setOpenCashSession(null);
    expect(getOpenCashSession()).toBeNull();
  });

  it("survives clearTerminalIdentity — a drawer belongs to the employee who opened it, not the token", () => {
    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "EMP01", name: "Amina" });
    setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "branch-1" });

    clearTerminalIdentity();

    expect(isSignedIn()).toBe(false);
    expect(getPosEmployee()).toBeNull();
    expect(getOpenCashSession()).toEqual({
      cashSessionId: "cs-1",
      employeeCode: "EMP01",
      branchId: "branch-1",
    });
  });
});

describe("active operating branch vs. cashier identity — FRONTEND-REMOVE-DEVICE-UX-P1", () => {
  it("clearTerminalIdentity ends the PIN session without forgetting the active branch", () => {
    setActiveBranchId("branch-1");
    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "EMP01", name: "Amina" });

    clearTerminalIdentity();

    expect(isSignedIn()).toBe(false);
    expect(getPosEmployee()).toBeNull();
    // The physical device does not stop running that branch's POS/KDS
    // because a cashier signed off.
    expect(getActiveBranchId()).toBe("branch-1");
  });

  it("a half-finished pending open survives a sign-off, so a timed-out open cannot be doubled", () => {
    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    setPendingCashOpen({
      cashSessionId: "cs-pending",
      shiftId: "sh-pending",
      drawerId: "d1",
      openingFloat: "50000",
      employeeCode: "EMP01",
    });

    clearTerminalIdentity();

    expect(getPendingCashOpen()).toEqual({
      cashSessionId: "cs-pending",
      shiftId: "sh-pending",
      drawerId: "d1",
      openingFloat: "50000",
      employeeCode: "EMP01",
    });
  });
});

describe("getActiveBranchName — POS-SESSION-RESILIENCE-P1", () => {
  it("round-trips the name cached alongside the branch id", () => {
    setActiveBranchId("branch-1", { en: "Downtown", ar: "وسط البلد" });
    expect(getActiveBranchName()).toEqual({ en: "Downtown", ar: "وسط البلد" });
  });

  it("is null when no name was ever cached for the current branch", () => {
    setActiveBranchId("branch-1");
    expect(getActiveBranchName()).toBeNull();
  });

  it("clears the cached name when the branch id changes without a new name — never leaves a stale name attached to a DIFFERENT branch", () => {
    setActiveBranchId("branch-1", { en: "Downtown", ar: "وسط البلد" });
    setActiveBranchId("branch-2");
    expect(getActiveBranchName()).toBeNull();
    expect(getActiveBranchId()).toBe("branch-2");
  });

  it("clears the cached name when the selection is cleared", () => {
    setActiveBranchId("branch-1", { en: "Downtown", ar: "وسط البلد" });
    setActiveBranchId(null);
    expect(getActiveBranchName()).toBeNull();
  });
});

describe("onSessionChange", () => {
  it("announces on a token write and can be unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = onSessionChange(listener);

    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setPosEmployee({ code: "EMP01", name: "Amina" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a silent token write during a refresh replay does not announce", () => {
    const listener = vi.fn();
    onSessionChange(listener);

    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 }, { silent: true });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("clearSession (console surface sign-out)", () => {
  it("only clears the CURRENT surface, never the other one", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "EMP01", name: "Amina" });

    setActiveSurface("console");
    setTokens({ accessToken: "console-tok", refreshToken: "ref", expiresIn: 900 });

    // A console sign-out must not silently end the till's own PIN session —
    // that is `clearTerminalIdentity`'s job, called separately by `signOut`.
    clearSession();
    expect(isSignedIn()).toBe(false); // console surface, just cleared

    setActiveSurface("pos");
    expect(isSignedIn()).toBe(true); // pos surface, untouched
    expect(getPosEmployee()).toEqual({ code: "EMP01", name: "Amina", sessionType: "pos" });
  });
});

describe("POS-KDS-SESSION-ISOLATION-P0 — POS and KDS are independent surfaces", () => {
  it("POS and KDS tokens/employees persist independently, including across a simulated reload", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "pos-ref", expiresIn: 900 });
    setPosEmployee({ code: "C1", name: "Cashier", sessionType: "pos" });

    setActiveSurface("kds");
    setTokens({ accessToken: "kds-tok", refreshToken: "kds-ref", expiresIn: 900 });
    setPosEmployee({ code: "K1", name: "Cook", sessionType: "kds" });

    // A reload re-derives `activeSurface` from the route and re-reads
    // storage fresh — simulated here by simply switching the surface back
    // and re-reading, since storage itself never changed underneath it.
    setActiveSurface("pos");
    expect(getAccessToken()).toBe("pos-tok");
    expect(getPosEmployee()).toEqual({ code: "C1", name: "Cashier", sessionType: "pos" });

    setActiveSurface("kds");
    expect(getAccessToken()).toBe("kds-tok");
    expect(getPosEmployee()).toEqual({ code: "K1", name: "Cook", sessionType: "kds" });
  });

  it("clearSession on POS never signs out a concurrent KDS session", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "ref", expiresIn: 900 });
    setActiveSurface("kds");
    setTokens({ accessToken: "kds-tok", refreshToken: "ref", expiresIn: 900 });

    setActiveSurface("pos");
    clearSession();
    expect(isSignedIn()).toBe(false);

    setActiveSurface("kds");
    expect(isSignedIn()).toBe(true);
    expect(getAccessToken()).toBe("kds-tok");
  });

  it("clearSession on KDS never signs out a concurrent POS session", () => {
    setActiveSurface("kds");
    setTokens({ accessToken: "kds-tok", refreshToken: "ref", expiresIn: 900 });
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "ref", expiresIn: 900 });

    setActiveSurface("kds");
    clearSession();
    expect(isSignedIn()).toBe(false);

    setActiveSurface("pos");
    expect(isSignedIn()).toBe(true);
    expect(getAccessToken()).toBe("pos-tok");
  });

  it("POS restores safely (signed out) when only a KDS session exists", () => {
    setActiveSurface("kds");
    setTokens({ accessToken: "kds-tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "K1", name: "Cook", sessionType: "kds" });

    setActiveSurface("pos");
    expect(isSignedIn()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getPosEmployee()).toBeNull();
  });

  it("KDS restores safely (signed out) when only a POS session exists", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "C1", name: "Cashier", sessionType: "pos" });

    setActiveSurface("kds");
    expect(isSignedIn()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getPosEmployee()).toBeNull();
  });

  it("clearTerminalIdentity (console reclaiming the device) ends BOTH, since it cannot know which one was left signed in", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "ref", expiresIn: 900 });
    setActiveSurface("kds");
    setTokens({ accessToken: "kds-tok", refreshToken: "ref", expiresIn: 900 });

    clearTerminalIdentity();

    setActiveSurface("pos");
    expect(isSignedIn()).toBe(false);
    setActiveSurface("kds");
    expect(isSignedIn()).toBe(false);
  });

  it("stores no terminalId/device-binding key for either surface", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-tok", refreshToken: "ref", expiresIn: 900 });
    setActiveSurface("kds");
    setTokens({ accessToken: "kds-tok", refreshToken: "ref", expiresIn: 900 });

    const keys = Object.keys(window.localStorage).join(" ").toLowerCase();
    expect(keys).not.toContain("terminalid");
  });
});

describe("migrateLegacyPosKdsDeviceState — FRONTEND-REMOVE-DEVICE-UX-P1", () => {
  it("carries a value from the immediately preceding deviceBranchId key forward, then removes it", () => {
    window.localStorage.setItem("ros.api.deviceBranchId", "branch-1");

    migrateLegacyPosKdsDeviceState();

    expect(getActiveBranchId()).toBe("branch-1");
    expect(window.localStorage.getItem("ros.api.deviceBranchId")).toBeNull();
  });

  it("falls back to the oldest terminalBranchId key when deviceBranchId was never set", () => {
    // A browser jumping straight from the original Terminal-bind build to
    // this one, skipping the interim `deviceBranchId` release entirely.
    window.localStorage.setItem("ros.api.terminalBranchId", "branch-9");

    migrateLegacyPosKdsDeviceState();

    expect(getActiveBranchId()).toBe("branch-9");
    expect(window.localStorage.getItem("ros.api.terminalBranchId")).toBeNull();
  });

  it("never overwrites a branch already selected under the current key", () => {
    setActiveBranchId("branch-current");
    window.localStorage.setItem("ros.api.deviceBranchId", "branch-stale");

    migrateLegacyPosKdsDeviceState();

    expect(getActiveBranchId()).toBe("branch-current");
  });

  it("removes legacy Terminal identity keys with no successor, and is a no-op on a fresh browser", () => {
    window.localStorage.setItem("ros.api.terminalId", "legacy-term-1");
    window.localStorage.setItem("ros.api.terminalName", "Old Front Till");

    expect(() => migrateLegacyPosKdsDeviceState()).not.toThrow();
    expect(window.localStorage.getItem("ros.api.terminalId")).toBeNull();
    expect(window.localStorage.getItem("ros.api.terminalName")).toBeNull();
    expect(getActiveBranchId()).toBeNull();

    // Calling it again on an already-clean browser must not throw or change anything.
    expect(() => migrateLegacyPosKdsDeviceState()).not.toThrow();
    expect(getActiveBranchId()).toBeNull();
  });
});

describe("isSessionOverHardLimit — POS-KDS-SESSION-LIFETIME-POLICY-P0", () => {
  it("is not over the limit right after sign-on", () => {
    setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 900 });
    expect(isSessionOverHardLimit()).toBe(false);
  });

  it("trips once the session has run longer than the hard cap, even with a live refresh token", () => {
    setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 900 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + HARD_SESSION_LIFETIME_MS + 1_000);
    expect(isSessionOverHardLimit()).toBe(true);
  });

  it("a silent token refresh does not reset the clock", () => {
    // `silent: true` is what a background refresh passes — see
    // `client.ts`'s `refreshSession()`. If this reset the clock, a session
    // refreshed every ~14 minutes would never actually hit the hard cap.
    setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 900 });
    const startedAt = window.localStorage.getItem("ros.pos.sessionStartedAt");

    setTokens({ accessToken: "a2", expiresIn: 900 }, { silent: true });

    expect(window.localStorage.getItem("ros.pos.sessionStartedAt")).toBe(startedAt);
  });

  it("a genuine re-sign-on (not silent) does reset the clock", () => {
    setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 900 });
    const startedAt = Number(window.localStorage.getItem("ros.pos.sessionStartedAt"));

    vi.spyOn(Date, "now").mockReturnValue(startedAt + 5_000);
    setTokens({ accessToken: "a2", refreshToken: "r2", expiresIn: 900 });

    expect(Number(window.localStorage.getItem("ros.pos.sessionStartedAt"))).toBe(startedAt + 5_000);
  });

  it("self-heals a session written before this cap existed, instead of treating it as instantly over", () => {
    window.localStorage.setItem("ros.pos.accessToken", "a");
    window.localStorage.setItem("ros.pos.refreshToken", "r");
    window.localStorage.setItem("ros.pos.expiresAt", String(Date.now() + 900_000));

    expect(isSessionOverHardLimit()).toBe(false);
    expect(window.localStorage.getItem("ros.pos.sessionStartedAt")).not.toBeNull();
  });

  it("POS and KDS track their own clocks independently", () => {
    setActiveSurface("pos");
    setTokens({ accessToken: "pos-a", refreshToken: "pos-r", expiresIn: 900 });

    setActiveSurface("kds");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + HARD_SESSION_LIFETIME_MS + 1_000);
    setTokens({ accessToken: "kds-a", refreshToken: "kds-r", expiresIn: 900 });

    expect(isSessionOverHardLimit()).toBe(false); // KDS just signed on

    setActiveSurface("pos");
    expect(isSessionOverHardLimit()).toBe(true); // POS's clock, unaffected by KDS's
  });
});
