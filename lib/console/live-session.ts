"use client";

/**
 * The signed-in organisation context, read from the backend.
 *
 * Everything the console renders is scoped: `services` receives a `Scope`
 * ({ tenantId, brandId, branchId }) on every list call, and `project()`
 * filters rows against it. In demo mode that scope comes from the fixtures
 * in `mock/org.ts`. Against a real backend it cannot, and the failure is
 * silent rather than loud: the branch switcher offers *mock* branch ids,
 * `project()` compares them against the *real* branch ids on the rows, and
 * every table renders empty with no error to explain why.
 *
 * So this module loads the real thing — the tenant on the token, the brands
 * and branches the *caller* may see, and the permission codes the server
 * will actually honour — and `providers.tsx` prefers it whenever
 * `DATA_MODE === "http"`.
 *
 * ## Accessible scope, not the tenant's whole roster
 *
 * The brand/branch switcher reads `GET /org/access`, not `GET /org/branches`
 * (MTMB-1). The latter is deliberately tenant-owner-only and 403s for a
 * branch- or brand-scoped actor — a cashier's own manager, say — which is
 * ratified behaviour (`scoped-authorization-matrix.e2e-spec.ts` cases 6/7),
 * not a bug to route around. `/org/access` resolves the caller's *live*
 * scoped role assignments instead: a branch-scoped grant gets exactly that
 * branch, a brand-scoped grant gets that brand and its branches, and a
 * tenant-scoped owner gets everything — the same three rows either endpoint
 * would return for that last case, which is why one call replaces two.
 *
 * It deliberately does not cache across sign-ins: `reload()` is called when
 * the token changes, because a different token is a different tenant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api/endpoints";
import { DATA_MODE } from "@/lib/api/config";
import { getAccessToken, getTenantId, onSessionChange } from "@/lib/api/session";
import { ServiceError } from "./services/types";
import * as map from "./services/map";
import type { Branch, Brand, Tenant } from "./types";

export interface LiveOrgContext {
  /** False until the first load settles, either way. */
  ready: boolean;
  loading: boolean;
  /** The tenant the access token is scoped to. */
  tenant: Tenant | null;
  brands: Brand[];
  branches: Branch[];
  /** Raw permission codes from `GET /auth/permissions`. */
  permissions: Set<string>;
  /** Non-null when the context could not be loaded. */
  error: ServiceError | null;
  reload: () => void;
}

const EMPTY: LiveOrgContext = {
  ready: false,
  loading: false,
  tenant: null,
  brands: [],
  branches: [],
  permissions: new Set(),
  error: null,
  reload: () => {},
};

/**
 * Loads tenant + brands + branches + permissions in one pass.
 *
 * The four calls are independent, so they go out together; a failure on any
 * one of them is kept rather than thrown, because a console that renders
 * with an empty branch list and a visible error beats a blank screen.
 */
async function loadContext(): Promise<Omit<LiveOrgContext, "ready" | "loading" | "reload">> {
  const tenantId = getTenantId();

  // Nothing below is scoped until a tenant is on the token, and every one of
  // these calls 403s without it.
  if (!tenantId) {
    return { tenant: null, brands: [], branches: [], permissions: new Set(), error: null };
  }

  const [memberships, access, granted, onToken] = await Promise.allSettled([
    api.tenants.listTenants(),
    // The caller's live accessible scope (MTMB-1) — never `/org/branches`,
    // which is tenant-owner-only and correctly 403s a branch/brand-scoped
    // actor rather than leaking every branch in the tenant to them.
    api.organisation.getAccessibleScope(),
    api.rbac.myPermissions(),
    // What the *server* thinks this token is scoped to. Worth asking,
    // because `localStorage` and the token can disagree — a rotated token
    // that failed its tenant replay still leaves the old id behind, and the
    // symptom would otherwise be a screen of unexplained 403s.
    api.tenants.currentTenant(),
  ]);

  const scopedTo = onToken.status === "fulfilled" ? onToken.value.tenantId : null;
  if (scopedTo && scopedTo !== tenantId) {
    return {
      tenant: null,
      brands: [],
      branches: [],
      permissions: new Set(),
      error: new ServiceError(
        "TENANT_SCOPE_MISMATCH",
        "This session is scoped to a different tenant. Sign in again.",
        409,
        `Stored tenant ${tenantId}, token carries ${scopedTo}.`,
      ),
    };
  }

  const firstFailure = [memberships, access, granted, onToken].find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  const membership =
    memberships.status === "fulfilled"
      ? memberships.value.find((row) => row.tenant.id === tenantId)
      : undefined;

  const brands =
    access.status === "fulfilled"
      ? access.value.brands.map((row) => map.toBrand(row, tenantId))
      : [];

  const branches =
    access.status === "fulfilled"
      ? access.value.branches.map((row) => map.toBranch(row, tenantId))
      : [];

  // The tenant carries brand/branch counts the switcher shows.
  const tenant = membership ? map.toTenant(membership) : null;
  if (tenant) {
    tenant.brandCount = brands.length;
    tenant.branchCount = branches.length;
  }

  // A brand's branch count is only known once both lists are in.
  const perBrand = new Map<string, number>();
  for (const branch of branches) {
    perBrand.set(branch.brandId, (perBrand.get(branch.brandId) ?? 0) + 1);
  }
  for (const brand of brands) {
    brand.branchCount = perBrand.get(brand.id) ?? 0;
  }

  const permissions = new Set(
    granted.status === "fulfilled" ? granted.value.permissions : [],
  );

  const error =
    firstFailure && access.status !== "fulfilled" ? toServiceError(firstFailure.reason) : null;

  return { tenant, brands, branches, permissions, error };
}

function toServiceError(reason: unknown): ServiceError {
  if (reason instanceof ServiceError) return reason;
  return new ServiceError(
    "ORG_CONTEXT_FAILED",
    "The console could not read this tenant's organisation.",
    500,
    reason instanceof Error ? reason.message : String(reason),
  );
}

/**
 * `authenticated` gates the load so the sign-in screen does not fire four
 * requests that are guaranteed to 401.
 */
export function useLiveOrgContext(authenticated: boolean): LiveOrgContext {
  const live = DATA_MODE === "http";

  const [state, setState] = useState<Omit<LiveOrgContext, "ready" | "loading" | "reload">>({
    tenant: null,
    brands: [],
    branches: [],
    permissions: new Set(),
    error: null,
  });
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Re-running on token change is what makes "select a different tenant"
  // work without a reload.
  const [tokenStamp, setTokenStamp] = useState<string>("");
  useEffect(() => {
    if (!live) return;
    const sync = () => setTokenStamp(`${getAccessToken() ?? ""}:${getTenantId() ?? ""}`);
    sync();
    return onSessionChange(sync);
  }, [live]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Guards against a slow response from a previous tenant landing after a
  // faster one from the current tenant.
  const generation = useRef(0);

  useEffect(() => {
    if (!live || !authenticated) {
      setReady(!live);
      return;
    }

    const mine = ++generation.current;
    setLoading(true);

    loadContext()
      .then((next) => {
        if (generation.current !== mine) return;
        setState(next);
      })
      .catch((error: unknown) => {
        if (generation.current !== mine) return;
        setState({
          tenant: null,
          brands: [],
          branches: [],
          permissions: new Set(),
          error: toServiceError(error),
        });
      })
      .finally(() => {
        if (generation.current !== mine) return;
        setLoading(false);
        setReady(true);
      });
  }, [live, authenticated, tokenStamp, nonce]);

  return useMemo<LiveOrgContext>(
    () => (live ? { ...state, ready, loading, reload } : { ...EMPTY, ready: true, reload }),
    [live, state, ready, loading, reload],
  );
}
