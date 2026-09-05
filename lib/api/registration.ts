/**
 * Requesting an account — SIGNUP-1 (FR-PLT-020).
 *
 * `POST /auth/registrations` is real, but it currently accepts exactly one
 * shape of request: `roleKey: "owner"`, which creates a brand-new tenant (an
 * atomic first user + tenant + working branch + Owner role, all-or-nothing)
 * and returns a tenant-scoped session so the caller can enter the dashboard
 * immediately — no separate login or tenant-selection step needed.
 *
 * Every OTHER `roleKey` (joining an *existing* organisation in a narrower
 * role) is **not implemented yet** and the backend answers 400: resolving a
 * free-text `organisation`/`scopeName` against an existing tenant with no
 * invitation/approval mechanism would be a tenant-isolation risk, and a form
 * cannot be trusted to grant a role — a proper administrator-invitation flow
 * is a separate, larger, unratified feature. `RegistrationOutcome.status`
 * stays `"pending_approval"`-capable so this page degrades gracefully if
 * that flow is added later; today only `"created"` (and `auth` present)
 * actually happens.
 */

import { http } from "./client";
import { setDefaultCurrency } from "../console/services/map";
import { setTenantId, setTokens } from "./session";
import type { RoleKey } from "../console/permissions";

/** Exactly what the form collects, after validation and normalisation. */
export interface RegistrationRequest {
  fullName: string;
  email: string;
  phone?: string;
  roleKey: RoleKey;
  organisation: string;
  /** Brand, branch or branch group by name. Null for tenant-wide roles. */
  scopeName: string | null;
  /** POS/KDS sign-on. Null for roles that never stand at a terminal. */
  employeeCode: string | null;
  pin: string | null;
  password: string;
}

interface RegistrationAuth {
  tokenType: "Bearer";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; displayName: string };
}

interface RegistrationTenant {
  id: string;
  slug: string;
  legalName: string;
  status: string;
  defaultCurrency: string;
  defaultLocale: string;
}

/**
 * What the page renders after a successful submit.
 *
 * `status` exists because "created" and "waiting for an administrator" are
 * different sentences to the person reading them, and only the server knows
 * which one is true. `auth`/`tenant`/`membership` are present only for
 * `status === "created"` — the caller already has a usable tenant-scoped
 * session and does not need to log in separately.
 */
export interface RegistrationOutcome {
  status: "created" | "pending_approval";
  /** Echoed back so the confirmation can name the address to check. */
  email: string;
  auth?: RegistrationAuth;
  tenant?: RegistrationTenant;
  membership?: { membershipId: string; status: string };
}

/** Submits a tenant self-service signup request. */
export function submitRegistration(
  request: RegistrationRequest,
): Promise<RegistrationOutcome> {
  return http.post<RegistrationOutcome>("/auth/registrations", {
    body: request,
    idempotent: true,
    anonymous: true,
  });
}

/**
 * Persists the auth state a successful signup returns, exactly like an
 * ordinary login + tenant-selection would — so the caller can proceed
 * straight to `GET /auth/permissions` and the dashboard.
 */
export function persistRegistrationSession(outcome: RegistrationOutcome): void {
  if (!outcome.auth || !outcome.tenant) return;
  setTokens(outcome.auth);
  setTenantId(outcome.tenant.id);
  setDefaultCurrency(outcome.tenant.defaultCurrency);
}

/** True now that `submitRegistration` calls the real backend. */
export const REGISTRATION_IS_WIRED = true;
