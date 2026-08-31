/**
 * Requesting an account — the seam between this form and a backend.
 *
 * ## Read this first
 *
 * **The API has no endpoint for this.** Across all 142 operations in
 * `api/openapi.json` there is no signup, no user creation, no invitation and
 * no way to set an employee PIN. `employeeCode` appears in exactly two
 * request bodies (`PinLoginDto`, `FinalizeCashSessionCloseDto`) and in no
 * response anywhere: the API can consume a staff code but can never produce
 * one, and `/auth/me` returns a user with no employee attached.
 *
 * That is why this file exists rather than a call to `api.auth.something`.
 * The form is complete and validated; the transport is one function, and it
 * refuses loudly instead of pretending. Nothing here writes to a store,
 * fakes a delay, or returns a success the server never gave — a signup that
 * appears to work and creates nothing is worse than one that plainly says it
 * is not connected.
 *
 * ## What to implement
 *
 * Replace the body of `submitRegistration` with the real call. The shape
 * below is what the form already produces, so a backend that accepts it
 * needs no change on this side:
 *
 *   POST /auth/registrations
 *   Content-Type: application/json
 *   Idempotency-Key: <uuid>          // a double-tap must not make two people
 *
 *   {
 *     "fullName":     "Areej ...",
 *     "email":        "areej@example.com",   // lowercased already
 *     "phone":        "+20 100 000 0000",    // optional
 *     "roleKey":      "cashier",             // one of ROLE_KEYS
 *     "organisation": "Trendow Restaurants",
 *     "scopeName":    "Maadi",               // null for tenant-wide roles
 *     "employeeCode": "areej",               // null unless the role uses a terminal
 *     "pin":          "1234",                // null unless the role uses a terminal
 *     "password":     "..."                  // never logged, never echoed
 *   }
 *
 * Three things the server has to decide, not this form:
 *
 *  1. **Whether a request becomes an account at all.** Self-service signup
 *     into a tenant's books is not obviously right for this product; an
 *     approval queue is the safer reading, and `RegistrationOutcome` carries
 *     `status` so the page can say "submitted for approval" rather than
 *     "you're in" when that is the truth.
 *  2. **The role.** A form cannot be trusted to grant `owner`. Treat
 *     `roleKey` as what the person *asked* for, and let an administrator
 *     confirm it — FR-SEC-004 scopes do not leak, and a role granted
 *     tenant-wide by a text field is a permissions incident.
 *  3. **Resolving `organisation` and `scopeName`.** They are names typed by
 *     a person, not ids. The server matches them to a tenant and a
 *     brand/branch, or rejects them.
 *
 * If the endpoint lands under a different path or shape, this is the only
 * file that changes.
 */

import { ServiceError } from "../console/services/types";
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

/**
 * What the page renders after a successful submit.
 *
 * `status` exists because "created" and "waiting for an administrator" are
 * different sentences to the person reading them, and only the server knows
 * which one is true.
 */
export interface RegistrationOutcome {
  status: "created" | "pending_approval";
  /** Echoed back so the confirmation can name the address to check. */
  email: string;
}

/**
 * Submits an account request.
 *
 * Throws `ServiceError("NOT_IMPLEMENTED")` until a backend exists. The
 * console renders that code as a neutral "not available from this backend"
 * panel rather than as an outage, because nothing is broken — the route has
 * simply not been built yet.
 */
export async function submitRegistration(
  request: RegistrationRequest,
): Promise<RegistrationOutcome> {
  void request;

  throw new ServiceError(
    "NOT_IMPLEMENTED",
    "Account requests are not connected to a backend yet.",
    501,
    "No signup, user-creation or PIN-setting endpoint exists in api/openapi.json. " +
      "Implement submitRegistration() in lib/api/registration.ts once the route is live.",
  );
}

/** True while `submitRegistration` is still the placeholder above. */
export const REGISTRATION_IS_WIRED = false;
