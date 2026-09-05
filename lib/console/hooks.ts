"use client";

/**
 * Data-fetching hooks over the service registry.
 *
 * Deliberately small — no cache, no revalidation, no query library. The
 * point is that every page has a real loading, error and empty state, and
 * that swapping the mock services for HTTP does not change a single call
 * site here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, ListQuery, Page, Station } from "./types";
import { ServiceError, services, type Scope, type ScopedQuery } from "./services";
import { DATA_MODE } from "@/lib/api/config";
import { useSession } from "./providers";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ServiceError | Error | null;
  reload: () => void;
}

/** Run an async producer, re-running whenever `deps` change. */
export function useAsync<T>(
  producer: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ServiceError | Error | null>(null);
  const [nonce, setNonce] = useState(0);

  // Guards against a slow first request resolving after a fast second one.
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;

    setLoading(true);
    setError(null);

    producer()
      .then((result) => {
        if (cancelled || id !== requestId.current) return;
        setData(result);
      })
      .catch((caught: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        setData(null);
      })
      .finally(() => {
        if (cancelled || id !== requestId.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `producer` is intentionally excluded: call sites pass an inline closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Paged collections
// ---------------------------------------------------------------------------

export interface CollectionOptions {
  scope?: Scope;
  pageSize?: number;
  initialSort?: string;
  initialFilters?: Record<string, string>;
}

export interface CollectionState<T> {
  rows: T[];
  total: number;
  loading: boolean;
  error: ServiceError | Error | null;
  page: number;
  pageSize: number;
  pageCount: number;
  search: string;
  sort: string | undefined;
  filters: Record<string, string>;
  /** True when a filter or a search term is narrowing the result set. */
  filtered: boolean;
  setSearch: (value: string) => void;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  toggleSort: (key: string) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  reload: () => void;
}

/**
 * Wraps a `list()` call with the toolbar state every table page needs.
 * Debounces the search box so typing does not fire a request per keystroke.
 */
export function useCollection<T>(
  fetcher: (query: ScopedQuery) => Promise<Page<T>>,
  options: CollectionOptions = {},
): CollectionState<T> {
  const { scope, pageSize: initialPageSize = 25, initialSort, initialFilters } = options;

  const [search, setSearchState] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters ?? {});
  const [sort, setSort] = useState<string | undefined>(initialSort);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filterKey = JSON.stringify(filters);
  const scopeKey = `${scope?.tenantId ?? ""}|${scope?.brandId ?? ""}|${scope?.branchId ?? ""}`;

  const { data, loading, error, reload } = useAsync<Page<T>>(
    () =>
      fetcher({
        scope,
        search: debouncedSearch || undefined,
        filters,
        sort,
        offset: page * pageSize,
        limit: pageSize,
      } satisfies ScopedQuery & ListQuery),
    [scopeKey, debouncedSearch, filterKey, sort, page, pageSize],
  );

  // Any narrowing change should return the user to the first page, otherwise
  // they land on an empty page 4 of a two-page result.
  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(0);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (!value || value === "all") delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchState("");
    setPage(0);
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSort((current) => {
      if (current === key) return `-${key}`;
      if (current === `-${key}`) return undefined;
      return key;
    });
    setPage(0);
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(0);
  }, []);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return useMemo(
    () => ({
      rows: data?.rows ?? [],
      total,
      loading,
      error,
      page,
      pageSize,
      pageCount,
      search,
      sort,
      filters,
      filtered: Object.keys(filters).length > 0 || debouncedSearch.length > 0,
      setSearch,
      setFilter,
      clearFilters,
      toggleSort,
      setPage,
      setPageSize,
      reload,
    }),
    [
      data,
      total,
      loading,
      error,
      page,
      pageSize,
      pageCount,
      search,
      sort,
      filters,
      debouncedSearch,
      setSearch,
      setFilter,
      clearFilters,
      toggleSort,
      setPageSize,
      reload,
    ],
  );
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Close on Escape and on a click outside — menus, popovers, drawers. */
export function useDismissable(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose]);

  return ref;
}

/**
 * The branches a filter dropdown may offer.
 *
 * Every screen with a "branch" filter used to map over the `mock/org`
 * fixture directly. On a live deployment that listed branches belonging to
 * nobody, next to rows belonging to the tenant — and picking one filtered
 * the table to an id the server had never heard of, so it emptied.
 *
 * Live mode reads `useSession().availableBranches` rather than issuing its
 * own request. That list already comes from `GET /org/access` (MTMB-1), the
 * caller's *accessible* scope — every call site here passes `useSession().scope`
 * straight through, so a second, independent call to `GET /org/branches`
 * would not just be redundant, it would 403 outright for a branch- or
 * brand-scoped actor (that route is deliberately tenant-owner-only) and
 * silently empty the very filter this hook exists to build. Mock mode is
 * unchanged — it still asks the registry, which still serves the fixtures.
 */
export function useBranches(scope?: Scope): Branch[] {
  const live = DATA_MODE === "http";
  const { availableBranches } = useSession();

  const mock = useAsync(
    () =>
      live
        ? Promise.resolve([] as Branch[])
        : services.organisation.branches
            .list({ scope, limit: 200 })
            .then((page) => page.rows)
            .catch(() => [] as Branch[]),
    [live, scope?.tenantId, scope?.brandId, scope?.branchId],
  );

  return live ? availableBranches : (mock.data ?? []);
}

/**
 * The stations of the branches in scope, for a picker or a load table.
 *
 * Same shape and same reasoning as `useBranches`: the registry serves the
 * demo fixtures in mock mode and `GET /org/branches/{id}/stations` against a
 * backend, and a failure yields an empty list rather than a broken screen.
 */
export function useStations(scope?: Scope): Station[] {
  const stations = useAsync(
    () =>
      services.operations
        .stations({ scope, limit: 200 })
        .then((page) => page.rows.filter((station) => station.active))
        .catch(() => [] as Station[]),
    [scope?.tenantId, scope?.brandId, scope?.branchId],
  );

  return stations.data ?? [];
}

/** A transient confirmation message — "Saved", "Approved", "Copied". */
export function useTransientMessage(durationMs = 2600) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs]);

  return [message, setMessage] as const;
}
