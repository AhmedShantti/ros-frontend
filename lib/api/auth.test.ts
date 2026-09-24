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
const checkPinPrecheck = vi.fn();
const logout = vi.fn();
const login = vi.fn();
const me = vi.fn();
const listTenants = vi.fn();
const selectTenant = vi.fn();

vi.mock("./endpoints", () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => login(...args),
      loginWithPin: (...args: unknown[]) => loginWithPin(...args),
      checkPinPrecheck: (...args: unknown[]) => checkPinPrecheck(...args),
      logout: (...args: unknown[]) => logout(...args),
      me: (...args: unknown[]) => me(...args),
    },
    tenants: {
      listTenants: (...args: unknown[]) => listTenants(...args),
      selectTenant: (...args: unknown[]) => selectTenant(...args),
    },
  },
}));

import { checkActiveBranchValid, signIn, signInWithPin, signOffTerminal, signOut } from "./auth";
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

function consoleLoginResponse(accessToken: string, displayName: string) {
  return {
    tokenType: "Bearer" as const,
    accessToken,
    refreshToken: `${accessToken}-refresh`,
    expiresIn: 3600,
    user: {
      id: "u-console",
      email: "owner@example.com",
      displayName,
      phone: null,
      preferredLocale: "en",
      status: "active" as const,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function meResponse() {
  return {
    id: "u-console",
    email: "owner@example.com",
    displayName: "Owner",
    phone: null,
    preferredLocale: "en",
    status: "active" as const,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    mustReset: false,
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

/*
 * CROSS-SURFACE-SESSION-ISOLATION-P0
 *
 * Live symptom: a Console sign-in or sign-out on a device also logged out
 * any POS/KDS session on that same backend, both locally and server-side.
 * Root cause: `signIn()`/`signOut()` unconditionally called a since-removed
 * `endTerminalSession()` helper, which cleared BOTH terminal surfaces'
 * credential storage and revoked BOTH their sessions via an explicit
 * `POST /auth/logout` per token — regardless of whether the console user
 * had any relationship to that till. Credential storage itself was already
 * correctly surface-namespaced (`CONSOLE_KEYS`/`POS_KEYS`/`KDS_KEYS`); this
 * was a console-auth-lifecycle bug, not a storage bug.
 *
 * These tests exercise the REAL `signIn`/`signOut`/`signInWithPin`/
 * `signOffTerminal` against the REAL `lib/api/session.ts` (real jsdom
 * localStorage) — only `./endpoints` is mocked.
 */
describe("signIn/signOut — console never touches POS or KDS credentials", () => {
  async function signOnPosAndKds() {
    Session.setActiveSurface("pos");
    loginWithPin.mockResolvedValueOnce(pinResponse("pos-tok", "Cashier"));
    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "C1",
      pin: "1234",
      sessionType: "pos",
    });

    Session.setActiveSurface("kds");
    loginWithPin.mockResolvedValueOnce(pinResponse("kds-tok", "Cook"));
    await signInWithPin({
      tenantId: "t1",
      branchId: "b1",
      employeeCode: "K1",
      pin: "5678",
      sessionType: "kds",
    });
  }

  async function consoleSignIn() {
    Session.setActiveSurface("console");
    login.mockResolvedValueOnce(consoleLoginResponse("console-tok", "Owner"));
    // Deliberately not exactly 1 membership: keeps this test off the
    // `selectTenant()` branch, which is exercised elsewhere.
    listTenants.mockResolvedValueOnce([]);
    me.mockResolvedValueOnce(meResponse());
    await signIn("owner@example.com", "s3cure-passphrase-10+");
  }

  it("console signIn leaves an existing POS and KDS session untouched — the exact live bug", async () => {
    await signOnPosAndKds();

    await consoleSignIn();

    Session.setActiveSurface("console");
    expect(Session.getAccessToken()).toBe("console-tok");

    Session.setActiveSurface("pos");
    expect(Session.getAccessToken()).toBe("pos-tok");
    expect(Session.getPosEmployee()?.code).toBe("C1");

    Session.setActiveSurface("kds");
    expect(Session.getAccessToken()).toBe("kds-tok");
    expect(Session.getPosEmployee()?.code).toBe("K1");
  });

  it("console signOut leaves an existing POS and KDS session untouched", async () => {
    await signOnPosAndKds();
    await consoleSignIn();

    Session.setActiveSurface("console");
    await signOut();

    expect(Session.isSignedIn()).toBe(false); // console itself signed out

    Session.setActiveSurface("pos");
    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("pos-tok");
    expect(Session.getPosEmployee()?.code).toBe("C1");

    Session.setActiveSurface("kds");
    expect(Session.isSignedIn()).toBe(true);
    expect(Session.getAccessToken()).toBe("kds-tok");
    expect(Session.getPosEmployee()?.code).toBe("K1");
  });

  it("console signOut revokes only its own session — exactly one /auth/logout call, never one per terminal token", async () => {
    await signOnPosAndKds();
    await consoleSignIn();

    Session.setActiveSurface("console");
    await signOut();

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("POS sign-off behavior is unchanged: still ends only POS", async () => {
    await signOnPosAndKds();

    Session.setActiveSurface("pos");
    await signOffTerminal();

    expect(Session.isSignedIn()).toBe(false); // pos
    Session.setActiveSurface("kds");
    expect(Session.isSignedIn()).toBe(true); // kds untouched
  });

  it("KDS sign-off behavior is unchanged: still ends only KDS", async () => {
    await signOnPosAndKds();

    Session.setActiveSurface("kds");
    await signOffTerminal();

    expect(Session.isSignedIn()).toBe(false); // kds
    Session.setActiveSurface("pos");
    expect(Session.isSignedIn()).toBe(true); // pos untouched
  });
});

/*
 * CASHIER-POS-STALE-BRANCH-401-P0
 *
 * `checkActiveBranchValid` is the thin, POS-safe wrapper around
 * `POST /auth/pin/precheck` — it never reads or touches a Console
 * credential (the earlier, reverted attempt at this fix did exactly that),
 * never throws, and fails CLOSED on any error.
 */
describe("checkActiveBranchValid — POST /auth/pin/precheck, no Console involvement", () => {
  it("valid: true when the precheck says so", async () => {
    checkPinPrecheck.mockResolvedValue({ valid: true });

    await expect(
      checkActiveBranchValid({ tenantId: "t1", branchId: "b1" }),
    ).resolves.toBe(true);
    expect(checkPinPrecheck).toHaveBeenCalledWith({ tenantId: "t1", branchId: "b1" });
  });

  it("valid: false when the precheck says so", async () => {
    checkPinPrecheck.mockResolvedValue({ valid: false });

    await expect(
      checkActiveBranchValid({ tenantId: "t1", branchId: "b1" }),
    ).resolves.toBe(false);
  });

  it("fails CLOSED (false) on a network/transport error — never throws, never assumes valid", async () => {
    checkPinPrecheck.mockRejectedValue(new Error("network unreachable"));

    await expect(
      checkActiveBranchValid({ tenantId: "t1", branchId: "b1" }),
    ).resolves.toBe(false);
  });

  it("never touches a Console (or any other surface's) credential — only the mocked endpoint boundary is crossed", async () => {
    checkPinPrecheck.mockResolvedValue({ valid: true });

    await checkActiveBranchValid({ tenantId: "t1", branchId: "b1" });

    expect(window.localStorage.getItem("ros.api.accessToken")).toBeNull();
    expect(window.localStorage.getItem("ros.api.refreshToken")).toBeNull();
    expect(window.localStorage.getItem("ros.pos.accessToken")).toBeNull();
  });
});
