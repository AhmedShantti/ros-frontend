/**
 * Which tenant the local-backed services are reading and writing for.
 *
 * The service registry is built once at module load, long before anyone has
 * signed in, so a store cannot capture a tenant id at construction time. It
 * asks for one lazily instead, and the session provider supplies it as soon
 * as it knows.
 *
 * Namespacing local collections per tenant is not cosmetic: two demo tenants
 * open in one browser would otherwise read each other's customers, which is
 * exactly the cross-tenant leak the platform chapter exists to prevent —
 * and a habit worth keeping even where the data is only ever local.
 *
 * ## Fail closed — FR-PLT-012
 *
 * A read or write that reaches a store before any tenant has been resolved
 * used to land in a shared `tenant_unresolved` bucket: every tenant's early
 * writes in one pile, readable by whichever tenant signed in next. That is
 * the "default to an unfiltered query" failure the requirement forbids, in
 * miniature. It now throws `TENANT_UNRESOLVED` instead, and the screen shows
 * an error that says to choose an organisation — never someone else's rows.
 *
 * The session provider resolves a tenant during its own render, before any
 * child can reach a service, so a signed-in console never sees the error; it
 * exists for the code path nobody meant to write.
 */

import { ServiceError } from "./types";

let activeTenantId: string | null = null;

export function setActiveTenantId(tenantId: string | null | undefined): void {
  activeTenantId = tenantId?.trim() ? tenantId.trim() : null;
}

/** Whether a tenant has been resolved — for callers that want to wait rather than fail. */
export function hasActiveTenant(): boolean {
  return activeTenantId !== null;
}

/**
 * FR-PLT-012 — the resolved tenant, or a thrown `TENANT_UNRESOLVED`.
 * Never a fallback namespace.
 */
export function requireActiveTenantId(): string {
  if (activeTenantId === null) {
    throw new ServiceError(
      "TENANT_UNRESOLVED",
      "No organisation is selected, so no data was read or written.",
      400,
      "The request reached the data layer without a tenant context and was refused rather than run unfiltered.",
    );
  }
  return activeTenantId;
}

/**
 * Kept for the existing stores. Identical to `requireActiveTenantId` — it
 * fails closed too; the old fallback bucket is gone.
 */
export function getActiveTenantId(): string {
  return requireActiveTenantId();
}

// ---------------------------------------------------------------------------
// FR-PLT-021 — a suspended or restricted tenant is read-only
// ---------------------------------------------------------------------------

let readOnlyReason: string | null = null;

/** Set by the console shell from the tenant's lifecycle state. */
export function setTenantReadOnly(reason: string | null): void {
  readOnlyReason = reason;
}

export function tenantReadOnlyReason(): string | null {
  return readOnlyReason;
}

/**
 * Refuse a write while the tenant is read-only. Reads, exports, the
 * security log and the lifecycle record itself (so a termination can still
 * be cancelled) do not call this — only ordinary record writes do.
 */
export function assertTenantWritable(): void {
  if (readOnlyReason !== null) {
    throw new ServiceError(
      "TENANT_READ_ONLY",
      "This organisation is read-only, so the change was not saved.",
      423,
      `Tenant state: ${readOnlyReason}. Data is kept, not deleted; it can be viewed and exported.`,
    );
  }
}
