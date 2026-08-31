/**
 * Signing in against the real backend.
 *
 * The API splits what the console thinks of as one step into three, and the
 * order matters — every `/org`, `/catalogue`, `/inventory` and `/orders` call
 * 403s until the second one has happened:
 *
 *   1. POST /auth/login     → access + refresh token, no tenant claim
 *   2. POST /auth/tenant    → the access token is rotated to carry a tenant
 *   3. POST /auth/terminal  → optional; POS/KDS screens need a bound device
 *
 * `signIn()` does 1 and 2, picking the tenant automatically when the account
 * belongs to exactly one — which is the ordinary case, and one screen fewer.
 */

import { api } from "./endpoints";
import { ServiceError } from "../console/services/types";
import { setDefaultCurrency } from "../console/services/map";
import { appVersion, deviceFingerprint, deviceOs } from "./device";
import {
  clearSession,
  getTenantId,
  setPosEmployee,
  setTenantId,
  setTerminalId,
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
 * Steps 1 and 2. When the account has several tenants, the token is left
 * unscoped and `tenantId` comes back null for the caller to resolve with
 * `selectTenant()`.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
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

/** Step 3 — required by the endpoints that record who rang something up. */
export async function bindTerminal(terminalId: string): Promise<void> {
  const bound = await api.terminals.bind({ terminalId });
  setTokens(bound);
  setTerminalId(terminalId);
}

export type TerminalRow = S.TerminalController_listResponse[number];

/** Terminals registered to this tenant — the list a device picks itself from. */
export async function listTerminals(): Promise<TerminalRow[]> {
  return api.terminals.list();
}

/**
 * Registers a new terminal against a branch.
 *
 * The device's own fingerprint goes on the create call, so the terminal is
 * usable from this device immediately without a second round trip.
 */
export async function registerTerminal(input: {
  branchId: string;
  name: string;
  terminalType: "pos" | "kds" | "kiosk" | "handheld";
}): Promise<TerminalRow> {
  return api.terminals.register({
    branchId: input.branchId,
    name: input.name,
    terminalType: input.terminalType,
    deviceFingerprint: deviceFingerprint(),
    os: deviceOs(),
    appVersion: appVersion(),
  });
}

/**
 * Binds this session to a terminal and enrols the device against it.
 *
 * The fingerprint call is idempotent and secondary: a terminal that is bound
 * but whose device is not yet enrolled still works, so a failure there must
 * not undo a successful bind.
 */
export async function bindTerminalFromThisDevice(terminalId: string): Promise<void> {
  await bindTerminal(terminalId);
  try {
    await api.terminals.addFingerprint(terminalId, {
      deviceFingerprint: deviceFingerprint(),
      os: deviceOs(),
      appVersion: appVersion(),
    });
  } catch {
    // Already enrolled, or the caller may not enrol devices. Neither is a
    // reason to tell someone their terminal did not bind — it did.
  }
}

/** The terminal the current token is bound to, if any. */
export async function currentTerminal(): Promise<string | null> {
  const response = await api.terminals.currentTerminal();
  return response.terminalId;
}

/** FR-SEC-030 — disable or revoke a terminal from the console. */
export async function setTerminalStatus(
  terminalId: string,
  status: "active" | "disabled" | "revoked",
): Promise<TerminalRow> {
  return api.terminals.setStatus(terminalId, { status });
}

/**
 * A cashier signing on at a bound terminal, rather than a console user. The
 * POS identifies staff by employee code and PIN — never by email — and the
 * terminal and tenant are known from the device, not typed (FR-SEC-020).
 */
export async function signInWithPin(input: {
  tenantId: string;
  terminalId: string;
  employeeCode: string;
  pin: string;
}): Promise<void> {
  const session = await api.auth.loginWithPin(input);
  setTokens(session);
  setTenantId(input.tenantId);
  setTerminalId(input.terminalId);
  // The till shows who is on it, and knows to ask when nobody is.
  setPosEmployee({
    code: input.employeeCode,
    name: session.user?.displayName || input.employeeCode,
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
}

/** The permission codes the server will actually honour for this session. */
export async function permissions(): Promise<string[]> {
  if (!getTenantId()) return [];
  const response = await api.rbac.myPermissions();
  return response.permissions;
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
