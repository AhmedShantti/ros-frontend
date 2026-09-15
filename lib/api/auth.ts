/**
 * Signing in against the real backend.
 *
 * The API splits what the console thinks of as one step into two, and the
 * order matters — every `/org`, `/catalogue`, `/inventory` and `/orders` call
 * 403s until the second one has happened:
 *
 *   1. POST /auth/login     → access + refresh token, no tenant claim
 *   2. POST /auth/tenant    → the access token is rotated to carry a tenant
 *
 * `signIn()` does both, picking the tenant automatically when the account
 * belongs to exactly one — which is the ordinary case, and one screen fewer.
 *
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 / FRONTEND-REMOVE-DEVICE-UX-P1 —
 * there used to be a step 3, `POST /auth/terminal`, a CONSOLE
 * (password-signed-in) user binding a device to a registered ROS Terminal.
 * POS and KDS are branch/employee application sessions now, with no device
 * to set up or register at all: `/select-branch` has a console user pick an
 * operating branch instead (see that file), and `signInWithPin` below takes
 * that branchId directly. Nothing in this file calls `/auth/terminal` or
 * `/auth/terminals` any more.
 */

import { api } from "./endpoints";
import { http } from "./client";
import { ServiceError } from "../console/services/types";
import { setDefaultCurrency } from "../console/services/map";
import {
  clearSession,
  clearTerminalIdentity,
  getActiveBranchId,
  getActiveSurface,
  getDeviceTenantId,
  getPosEmployee,
  getTenantId,
  peekTerminalAccessTokens,
  setPosEmployee,
  setTenantId,
  setTokens,
} from "./session";
import type * as S from "./schema";

export type Membership = S.TenantController_listTenantsResponse[number];

export interface SignInResult {
  user: S.AuthController_meResponse;
  /** Every tenant the account can act for. */
  memberships: Membership[];
  /** The one now on the token, or null when the caller must choose. */
  tenantId: string | null;
  /** FR-SEC — a first sign-in, or an administrator-forced rotation. */
  mustResetPassword: boolean;
}

/**
 * POS-CUSTODY — ends whatever PIN session(s) this device was left holding.
 *
 * Called on the way IN to a sign-in as well as on the way out, because a
 * till is not always left tidily: a tab closed mid-shift, a browser crash, a
 * cashier who simply walked away. Whatever the reason, a different person
 * authenticating is the end of the previous one's session(s), and the
 * token(s) they left behind must not still be sitting where `/pos`/`/kds`
 * reads them.
 *
 * POS-KDS-SESSION-ISOLATION-P0 — a console user reclaiming the device does
 * not know, and must not guess, whether a stray till session was POS's or
 * KDS's (or both) — so this ends both independently, never assuming one
 * implies the other.
 *
 * Revoking server-side is best-effort and explicitly credentialled: neither
 * token being revoked is the active surface's, so each is passed as an
 * explicit bearer rather than by switching the active surface out from under
 * whatever else is in flight. A failure here is not a reason to block a
 * sign-in — the local copies are gone either way, which is what closes the
 * leak on this device.
 */
async function endTerminalSession(): Promise<void> {
  const { pos, kds } = peekTerminalAccessTokens();
  clearTerminalIdentity();
  await Promise.all(
    [pos, kds].map(async (token) => {
      if (!token) return;
      try {
        await http.post("/auth/logout", { anonymous: true, bearer: token });
      } catch {
        // Already expired, already revoked, or offline. Nothing to recover.
      }
    }),
  );
}

/**
 * Steps 1 and 2. When the account has several tenants, the token is left
 * unscoped and `tenantId` comes back null for the caller to resolve with
 * `selectTenant()`.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  // Before the new credential exists, not after: a failed sign-in must still
  // leave the previous employee's till session ended.
  await endTerminalSession();

  const session = await api.auth.login({ email, password });
  setTokens(session);

  const memberships = await api.tenants.listTenants();
  const usable = memberships.filter((membership) => membership.status === "active");

  let tenantId: string | null = null;
  if (usable.length === 1) {
    tenantId = await selectTenant(usable[0]!.tenant.id, usable);
  }

  const user = await api.auth.me();

  return { user, memberships: usable, tenantId, mustResetPassword: user.mustReset };
}

/** Step 2 on its own, for an account with more than one tenant. */
export async function selectTenant(
  tenantId: string,
  known?: Membership[],
): Promise<string> {
  const scoped = await api.tenants.selectTenant({ tenantId });
  setTokens(scoped);
  setTenantId(tenantId);

  // Every price the console renders is denominated in this.
  const memberships = known ?? (await api.tenants.listTenants());
  const chosen = memberships.find((membership) => membership.tenant.id === tenantId);
  setDefaultCurrency(chosen?.tenant.defaultCurrency);

  return tenantId;
}

/** The terminal the current token is bound to, if any — Category B: admin device visibility, independent of POS/KDS PIN sign-on. */
export async function currentTerminal(): Promise<string | null> {
  const response = await api.terminals.currentTerminal();
  return response.terminalId;
}

export type TerminalRow = S.TerminalController_listResponse[number];

/** FR-SEC-030 — disable or revoke a terminal from the console. */
export async function setTerminalStatus(
  terminalId: string,
  status: "active" | "disabled" | "revoked",
): Promise<TerminalRow> {
  return api.terminals.setStatus(terminalId, { status });
}

/**
 * A POS cashier or KDS employee signing on at this device with a PIN, rather
 * than a console user signing in with a password. The POS/KDS surface
 * identifies staff by employee code and PIN — never by email — and the
 * tenant/branch are already known (`getDeviceTenantId`/`getActiveBranchId`,
 * the operating branch selected once at `/select-branch`), not typed
 * (FR-SEC-020).
 *
 * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 — `PinLoginDto` no longer takes a
 * `terminalId`, and the token it mints no longer carries `trm`: POS and KDS
 * are branch/employee application sessions, distinguished by `sessionType`
 * ("pos" | "kds"), not registered Terminal/device ones. Do not reintroduce a
 * terminal lookup, a terminal selector, or a call to `POST /auth/terminal`
 * on this path — that concept is gone from this contract.
 */
export async function signInWithPin(input: {
  tenantId: string;
  branchId: string;
  employeeCode: string;
  pin: string;
  sessionType: "pos" | "kds";
}): Promise<void> {
  // The employee on THIS surface is being replaced, so nothing of the
  // previous one may survive into the new session — including a
  // half-finished drawer open, which would otherwise be replayed under the
  // new employee's name. `clearSession()`, not `clearTerminalIdentity()`:
  // this must clear only the surface being signed into (POS-KDS-SESSION-
  // ISOLATION-P0) — signing on to KDS must never touch a POS session still
  // open on the same device, and vice versa. `activeSurface` already
  // matches `input.sessionType` here, since only `/pos`'s own sign-on calls
  // this with `"pos"` and only `/kds`'s own calls it with `"kds"`.
  clearSession();

  const session = await api.auth.loginWithPin(input);
  setTokens(session);
  setTenantId(input.tenantId);
  // The till/display shows who is on it, and knows to ask when nobody is.
  setPosEmployee({
    code: input.employeeCode,
    name: session.user?.displayName || input.employeeCode,
    sessionType: input.sessionType,
  });
}

/**
 * POS-SESSION-RESILIENCE-P1 — re-authenticate the CURRENTLY signed-on
 * employee with their PIN again, for the narrow case of a
 * `STALE_AUTHORIZATION_SNAPSHOT` recovery (`client.ts`'s
 * `setStaleSnapshotReauthHandler`). Deliberately NOT `signInWithPin`:
 *
 *   - `signInWithPin` calls `clearSession()` FIRST, before the network call
 *     even resolves — right for a genuine fresh sign-on (replacing whoever
 *     was on the till), catastrophic here: a mistyped PIN would wipe the
 *     still-otherwise-good session out from under an operator who was mid-
 *     order, for a recovery that only needed to rotate a token.
 *   - This only ever touches stored session state on a CONFIRMED successful
 *     PIN. Any failure — wrong PIN, network error, still-denied after
 *     re-auth — leaves the existing session exactly as it was: stale, but
 *     intact, so the caller (`PosReauthPrompt`) can let the operator retry
 *     or cancel without anything having been lost.
 *   - Uses the SAME device/employee context already on this surface
 *     (`getDeviceTenantId()`, `getActiveBranchId()`, the signed-on
 *     `PosEmployee`) — never asks the operator to re-identify themselves,
 *     only to re-prove it.
 *
 * The PIN itself is a parameter, never stored — this function's own stack
 * frame is the only place it ever exists on the client.
 */
export async function reauthenticateWithPin(pin: string): Promise<void> {
  const surface = getActiveSurface();
  const tenantId = getDeviceTenantId();
  const branchId = getActiveBranchId();
  const employee = getPosEmployee();
  if ((surface !== "pos" && surface !== "kds") || !tenantId || !branchId || !employee) {
    throw new ServiceError(
      "SESSION_EXPIRED",
      "Your session has ended. Sign in again.",
      401,
      "reauthenticateWithPin: no POS/KDS device or employee context to re-authenticate against",
    );
  }

  const session = await api.auth.loginWithPin({
    tenantId,
    branchId,
    employeeCode: employee.code,
    pin,
    sessionType: surface,
  });

  // Only now, with the PIN confirmed, replace the session atomically.
  setTokens(session);
  setTenantId(tenantId);
  setPosEmployee({
    code: employee.code,
    name: session.user?.displayName || employee.code,
    sessionType: surface,
  });
}

export async function signOut(): Promise<void> {
  try {
    await api.auth.logout();
  } catch {
    // A revoked or expired token cannot be revoked again; clearing is enough.
  } finally {
    clearSession();
  }
  // A console sign-out ends the till too. The two used to be independent,
  // which is precisely how a signed-out Owner stayed signed on at the POS.
  await endTerminalSession();
}

/**
 * FR-SEC-020 — the cashier (or KDS employee) signing OFF the till.
 *
 * The counterpart the terminal never had: `clearSession()` existed but no
 * screen called it, so a PIN session ended only when someone cleared site
 * data. Runs on whichever terminal surface is active — POS or KDS — where
 * `api.auth.logout()` already carries that surface's own token.
 *
 * `clearSession()`, not `clearTerminalIdentity()`: this is called from
 * `TerminalBar` (POS-KDS-SESSION-ISOLATION-P0 — shared chrome rendered on
 * BOTH `/pos` and `/kds`), so it must end only the surface it was clicked
 * on. Ending the other one too would mean signing off the kitchen display
 * silently signed the till out as well.
 *
 * Deliberately does not touch the open cash session. Signing off with a
 * drawer open is a normal thing to do — a break, a handover, the end of a
 * queue — and the money stays open and findable until it is counted. The
 * record knows whose it is, so the next person to sign on is shown it rather
 * than given it.
 */
export async function signOffTerminal(): Promise<void> {
  try {
    await api.auth.logout();
  } catch {
    // Same as above: an unrevokable token is still one we are done with.
  } finally {
    clearSession();
  }
}

/**
 * Every permission code the server will actually honour for this session,
 * across every scope the token carries.
 *
 * `GET /auth/permissions` answers two things and it is easy to read only the
 * first: the top-level `permissions` array is documented as "TENANT-scoped
 * permission codes only — what an unscoped, target-less endpoint authorises
 * today." The operational grants a console actually gates navigation on —
 * `kds.operate`, `pos.order.create`, `inventory.view`, `cash.session.view`,
 * `audit.view` and the like — are typically held at brand or branch scope,
 * so they never appear there; they live in `scopes[]`, "every effective
 * assignment, scope-qualified." Reading `permissions` alone is why an Owner
 * with the full catalogue still loses whole sections of the sidebar: the
 * codes were never missing server-side, this call just never asked for them.
 */
export function effectivePermissionCodes(
  response: S.RbacController_myPermissionsResponse,
): string[] {
  const codes = new Set(response.permissions);
  for (const scope of response.scopes) {
    for (const code of scope.permissions) codes.add(code);
  }
  return [...codes];
}

/** The permission codes the server will actually honour for this session. */
export async function permissions(): Promise<string[]> {
  if (!getTenantId()) return [];
  const response = await api.rbac.myPermissions();
  return effectivePermissionCodes(response);
}

/**
 * Confirms the configured address really is the API, before a user types a
 * password into a form that cannot possibly submit.
 */
export async function ping(): Promise<{ ok: boolean; detail: string }> {
  try {
    const health = await api.health.check();
    return { ok: health.status === "ok", detail: `${health.service}: ${health.status}` };
  } catch (error) {
    const detail =
      error instanceof ServiceError
        ? `${error.code} — ${error.detail ?? error.message}`
        : String(error);
    return { ok: false, detail };
  }
}
