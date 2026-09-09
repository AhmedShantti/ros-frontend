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
 */

const FALLBACK = "tenant_unresolved";

let activeTenantId = FALLBACK;

export function setActiveTenantId(tenantId: string | null | undefined): void {
  activeTenantId = tenantId?.trim() ? tenantId : FALLBACK;
}

export function getActiveTenantId(): string {
  return activeTenantId;
}
