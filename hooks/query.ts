"use client";

/**
 * TanStack Query bindings over the service registry.
 *
 * The registry already returns promises and already carries scope on every
 * read, so the query layer adds exactly three things the hand-rolled
 * `useAsync` could not: a shared cache across components, invalidation after
 * a mutation, and optimistic updates that roll back on failure.
 *
 * Query keys are built by `qk` rather than assembled at call sites, because
 * an invalidation that misses by one array element fails silently.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { Id, Page } from "@/lib/console/types";
import { ServiceError, type Scope, type ScopedQuery } from "@/services";

/** Every key starts with a module name so a module can be invalidated whole. */
export const qk = {
  all: ["ros"] as const,
  module: (module: string) => ["ros", module] as const,
  list: (module: string, entity: string, query?: ScopedQuery) =>
    ["ros", module, entity, "list", normaliseQuery(query)] as const,
  detail: (module: string, entity: string, id: Id) =>
    ["ros", module, entity, "detail", id] as const,
  report: (name: string, scope?: Scope, params?: Record<string, unknown>) =>
    ["ros", "report", name, scopeKey(scope), params ?? {}] as const,
};

function scopeKey(scope?: Scope): string {
  if (!scope) return "*";
  return `${scope.tenantId}|${scope.brandId ?? "*"}|${scope.branchId ?? "*"}`;
}

/**
 * Two queries that differ only in key order must share a cache entry, so the
 * query object is flattened to a stable shape before it becomes part of a key.
 */
function normaliseQuery(query?: ScopedQuery): Record<string, unknown> {
  if (!query) return {};
  const { scope, filters, ...rest } = query;
  return {
    ...rest,
    scope: scopeKey(scope),
    filters: filters
      ? Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)))
      : {},
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CollectionQueryArgs<T> {
  module: string;
  entity: string;
  fetcher: (query: ScopedQuery) => Promise<Page<T>>;
  query?: ScopedQuery;
  enabled?: boolean;
}

export function useCollectionQuery<T>({
  module,
  entity,
  fetcher,
  query,
  enabled = true,
}: CollectionQueryArgs<T>) {
  return useQuery({
    queryKey: qk.list(module, entity, query),
    queryFn: () => fetcher(query ?? {}),
    enabled,
    // A list the user is looking at should not refetch under them mid-scroll.
    staleTime: 30_000,
  });
}

export function useDetailQuery<T>(
  module: string,
  entity: string,
  id: Id | null | undefined,
  fetcher: (id: Id) => Promise<T | null>,
  options?: Partial<UseQueryOptions<T | null>>,
) {
  return useQuery({
    queryKey: qk.detail(module, entity, id ?? "none"),
    queryFn: () => fetcher(id!),
    enabled: Boolean(id),
    ...options,
  });
}

export function useReportQuery<T>(
  name: string,
  fetcher: () => Promise<T>,
  scope?: Scope,
  params?: Record<string, unknown>,
  options?: Partial<UseQueryOptions<T>>,
) {
  return useQuery({
    queryKey: qk.report(name, scope, params),
    queryFn: fetcher,
    staleTime: 60_000,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A mutation that invalidates its module on success.
 *
 * Invalidating the whole module rather than the exact list is deliberate: a
 * purchase order moving to `approved` changes the approvals inbox, the PO
 * list, the supplier's open value and the audit trail, and enumerating those
 * at every call site is how stale panels happen.
 */
export function useModuleMutation<TData, TVariables>(
  module: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ServiceError | Error, TVariables>, "mutationFn">,
) {
  const client = useQueryClient();
  return useMutation<TData, ServiceError | Error, TVariables>({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: qk.module(module) });
      options?.onSuccess?.(...args);
    },
  });
}

/** Human-readable failure text, preferring the service's own message. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ServiceError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** The stable error code, for branching on a specific failure. */
export function errorCode(error: unknown): string | null {
  return error instanceof ServiceError ? error.code : null;
}
