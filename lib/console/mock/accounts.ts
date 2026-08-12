/**
 * Demo credentials.
 *
 * Seventeen sign-ins, one per standard role, so every permission set in the
 * catalogue can be walked through without a real identity provider. There is
 * no credential store and no hashing here on purpose: this file *is* the
 * authentication backend, and it is a lookup table.
 *
 * When a real backend arrives, `POST /v1/auth/login` replaces
 * `authenticate()` and nothing else in the auth flow changes — the screens
 * already treat the result as opaque.
 */

import {
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  homeRouteForRole,
  roleRequiresMfa,
  surfacesForRole,
  type RoleKey,
  type Surface,
} from "../permissions";
import type { Localised } from "../types";
import { demoUserForRole } from "./governance";

/** The same for every demo account. Stated openly on the sign-in screen. */
export const DEMO_PASSWORD = "trendow-demo-2026";

/** Any six digits are accepted by the MFA screen; this is the one shown. */
export const DEMO_MFA_CODE = "204060";

export interface DemoAccount {
  roleKey: RoleKey;
  name: Localised;
  email: string;
  /** POS and KDS sign-in — four digits, unique across the tenant. */
  pin: string;
  password: string;
  requiresMfa: boolean;
  surfaces: Surface[];
  home: string;
  /** What this login is for, shown as the hint under the account picker. */
  character: Localised;
}

/**
 * PINs are assigned in role order from 1101 upwards rather than generated,
 * because a demo account whose PIN changes between reloads is useless.
 */
const PIN_BASE = 1101;

export const DEMO_ACCOUNTS: DemoAccount[] = ROLE_KEYS.map((roleKey, index) => {
  const definition = ROLE_DEFINITIONS[roleKey];
  const user = demoUserForRole(roleKey);
  return {
    roleKey,
    name: user.name,
    email: user.email,
    pin: String(PIN_BASE + index * 7),
    password: DEMO_PASSWORD,
    requiresMfa: roleRequiresMfa(roleKey),
    surfaces: surfacesForRole(roleKey),
    home: homeRouteForRole(roleKey),
    character: definition.character,
  };
});

const byEmail = new Map(DEMO_ACCOUNTS.map((a) => [a.email.toLowerCase(), a]));
const byPin = new Map(DEMO_ACCOUNTS.map((a) => [a.pin, a]));
const byRole = new Map(DEMO_ACCOUNTS.map((a) => [a.roleKey, a]));

export function accountForRole(roleKey: RoleKey): DemoAccount {
  return byRole.get(roleKey)!;
}

export function accountByEmail(email: string): DemoAccount | null {
  return byEmail.get(email.trim().toLowerCase()) ?? null;
}

export function accountByPin(pin: string): DemoAccount | null {
  return byPin.get(pin.trim()) ?? null;
}

/** Accounts that can sign in at a terminal — POS PIN pad and KDS. */
export const TERMINAL_ACCOUNTS: DemoAccount[] = DEMO_ACCOUNTS.filter(
  (a) => a.surfaces.includes("pos") || a.surfaces.includes("kds"),
);

// ---------------------------------------------------------------------------
// The mock authentication endpoint
// ---------------------------------------------------------------------------

export type AuthFailure =
  | "unknown_email"
  | "bad_password"
  | "bad_pin"
  | "locked";

export interface AuthSuccess {
  account: DemoAccount;
  /** True when the caller must clear MFA before the session is usable. */
  mfaRequired: boolean;
}

export class AuthError extends Error {
  readonly reason: AuthFailure;
  constructor(reason: AuthFailure) {
    super(reason);
    this.name = "AuthError";
    this.reason = reason;
  }
}

/**
 * Five failures against one email locks it for the rest of the tab, so the
 * lockout state is reachable in the demo. A real backend counts server-side
 * and against the account, not the browser.
 */
const LOCKOUT_THRESHOLD = 5;
const attempts = new Map<string, number>();

export function authenticate(email: string, password: string): AuthSuccess {
  const key = email.trim().toLowerCase();

  if ((attempts.get(key) ?? 0) >= LOCKOUT_THRESHOLD) throw new AuthError("locked");

  const account = accountByEmail(key);
  if (!account) {
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    throw new AuthError("unknown_email");
  }
  if (password !== account.password) {
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    throw new AuthError("bad_password");
  }

  attempts.delete(key);
  return { account, mfaRequired: account.requiresMfa };
}

export function authenticatePin(pin: string): DemoAccount {
  const account = accountByPin(pin);
  if (!account) throw new AuthError("bad_pin");
  return account;
}

/** Remaining attempts before the email locks, for the "3 tries left" hint. */
export function attemptsRemaining(email: string): number {
  return Math.max(0, LOCKOUT_THRESHOLD - (attempts.get(email.trim().toLowerCase()) ?? 0));
}
