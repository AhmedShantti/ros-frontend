import { describe, expect, it } from "vitest";
import {
  isAlreadyOpenConflict,
  isMine,
  reconcileWithServer,
  sameEmployee,
  type HeldSession,
} from "./cash-session-reconcile";

describe("sameEmployee", () => {
  it("matches identical codes", () => {
    expect(sameEmployee("EMP01", "EMP01")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(sameEmployee("emp01 ", " EMP01")).toBe(true);
  });

  it("rejects genuinely different codes", () => {
    expect(sameEmployee("EMP01", "EMP02")).toBe(false);
  });
});

describe("isMine", () => {
  const branchId = "branch-1";
  const cashier = { code: "EMP01" };

  it("is false with no held session", () => {
    expect(isMine(null, cashier, branchId)).toBe(false);
  });

  it("is false with no signed-on cashier", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP01", branchId };
    expect(isMine(held, null, branchId)).toBe(false);
  });

  it("is true when the held session names the same employee and branch", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP01", branchId };
    expect(isMine(held, cashier, branchId)).toBe(true);
  });

  it("tolerates case/whitespace differences in the employee code", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: " emp01", branchId };
    expect(isMine(held, cashier, branchId)).toBe(true);
  });

  it("is false for a foreign employee's session — never adopted silently", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP02", branchId };
    expect(isMine(held, cashier, branchId)).toBe(false);
  });

  it("is false for a record with no owner on file (pre-custody shape)", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "", branchId };
    expect(isMine(held, cashier, branchId)).toBe(false);
  });

  it("is false when the branch does not match — a device repurposed to another branch does not inherit it", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "branch-2" };
    expect(isMine(held, cashier, branchId)).toBe(false);
  });

  it("tolerates a blank branchId on the record (pre-branch-tracking shape)", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "" };
    expect(isMine(held, cashier, branchId)).toBe(true);
  });
});

describe("reconcileWithServer", () => {
  it("restores a server session that local storage never knew about (missing local)", () => {
    const action = reconcileWithServer({ held: null, serverCashSessionId: "cs-server" });
    expect(action).toEqual({ type: "restore", cashSessionId: "cs-server" });
  });

  it("restores when local storage names a stale id and the server has a different one", () => {
    const held: HeldSession = { cashSessionId: "cs-old", employeeCode: "EMP01", branchId: "t1" };
    const action = reconcileWithServer({ held, serverCashSessionId: "cs-new" });
    expect(action).toEqual({ type: "restore", cashSessionId: "cs-new" });
  });

  it("does nothing when local storage already matches the server (idempotent)", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "t1" };
    const action = reconcileWithServer({ held, serverCashSessionId: "cs-1" });
    expect(action).toEqual({ type: "none" });
  });

  it("clears a stale local session once the server confirms it is closed/gone", () => {
    const held: HeldSession = { cashSessionId: "cs-1", employeeCode: "EMP01", branchId: "t1" };
    const action = reconcileWithServer({ held, serverCashSessionId: null });
    expect(action).toEqual({ type: "clear" });
  });

  it("does nothing when both agree there is no session", () => {
    const action = reconcileWithServer({ held: null, serverCashSessionId: null });
    expect(action).toEqual({ type: "none" });
  });
});

describe("isAlreadyOpenConflict", () => {
  it("matches a bare 409 status", () => {
    expect(isAlreadyOpenConflict({ status: 409 })).toBe(true);
  });

  it("matches the client's status-derived CONFLICT code", () => {
    expect(isAlreadyOpenConflict({ code: "CONFLICT" })).toBe(true);
  });

  it("matches a server-named ALREADY_OPEN-style code", () => {
    expect(isAlreadyOpenConflict({ code: "CASH_SESSION_ALREADY_OPEN" })).toBe(true);
  });

  it("matches on message wording as a last resort", () => {
    expect(isAlreadyOpenConflict({ message: "You already have an open shift." })).toBe(true);
  });

  it("does not match an unrelated failure", () => {
    expect(isAlreadyOpenConflict({ status: 400, code: "BAD_REQUEST", message: "Invalid float" })).toBe(
      false,
    );
  });

  it("does not match a network failure", () => {
    expect(isAlreadyOpenConflict({ status: 0, code: "NETWORK_UNREACHABLE" })).toBe(false);
  });
});
