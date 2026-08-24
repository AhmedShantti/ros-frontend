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
import {
  clearSession,
  getTenantId,
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
