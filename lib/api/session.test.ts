import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  clearTerminalIdentity,
  getOpenCashSession,
  getPendingCashOpen,
  getPosEmployee,
  getTerminalId,
  isSignedIn,
  onSessionChange,
  setActiveSurface,
  setOpenCashSession,
  setPendingCashOpen,
  setPosEmployee,
  setTerminalId,
  setTokens,
} from "./session";

beforeEach(() => {
  window.localStorage.clear();
  setActiveSurface("terminal");
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

describe("OpenCashSession storage", () => {
  it("round-trips a full record", () => {
    setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", terminalId: "t1" });
    expect(getOpenCashSession()).toEqual({
      cashSessionId: "cs-1",
      employeeCode: "EMP01",
      terminalId: "t1",
    });
  });

  it("reads a legacy bare-id record as owner-unknown, not as a parse failure", () => {
    window.localStorage.setItem("ros.api.cashSessionId", "cs-legacy");
    expect(getOpenCashSession()).toEqual({
      cashSessionId: "cs-legacy",
      employeeCode: "",
      terminalId: "",
    });
  });

  it("returns null once cleared", () => {
    setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", terminalId: "t1" });
    setOpenCashSession(null);
    expect(getOpenCashSession()).toBeNull();
  });

  it("survives clearTerminalIdentity — a drawer belongs to the employee who opened it, not the token", () => {
    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "EMP01", name: "Amina" });
    setOpenCashSession({ cashSessionId: "cs-1", employeeCode: "EMP01", terminalId: "t1" });

    clearTerminalIdentity();

    expect(isSignedIn()).toBe(false);
    expect(getPosEmployee()).toBeNull();
    expect(getOpenCashSession()).toEqual({
      cashSessionId: "cs-1",
      employeeCode: "EMP01",
      terminalId: "t1",
    });
  });
});

describe("terminal binding vs. cashier identity", () => {
  it("clearTerminalIdentity ends the PIN session without unbinding the terminal", () => {
    setTerminalId("term-1");
    setTokens({ accessToken: "tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "EMP01", name: "Amina" });

    clearTerminalIdentity();

    expect(isSignedIn()).toBe(false);
    expect(getPosEmployee()).toBeNull();
    // The physical till does not stop being that till because a cashier signed off.
    expect(getTerminalId()).toBe("term-1");
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
    setActiveSurface("terminal");
    setTokens({ accessToken: "terminal-tok", refreshToken: "ref", expiresIn: 900 });
    setPosEmployee({ code: "EMP01", name: "Amina" });

    setActiveSurface("console");
    setTokens({ accessToken: "console-tok", refreshToken: "ref", expiresIn: 900 });

    // A console sign-out must not silently end the till's own PIN session —
    // that is `clearTerminalIdentity`'s job, called separately by `signOut`.
    clearSession();
    expect(isSignedIn()).toBe(false); // console surface, just cleared

    setActiveSurface("terminal");
    expect(isSignedIn()).toBe(true); // terminal surface, untouched
    expect(getPosEmployee()).toEqual({ code: "EMP01", name: "Amina" });
  });
});
