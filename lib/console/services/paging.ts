/**
 * Client-side search, sort and paging.
 *
 * The backend answers most list endpoints with a plain array: no envelope,
 * no `?search=`, no `?sort=`. The console's tables want a `Page<T>` with a
 * total, and its toolbars want to filter. Until the API grows those
 * parameters, the work happens here — on a tenant's worth of branches,
 * stock items or menu items that is a few hundred rows, which is nothing.
 *
 * Two list endpoints do paginate — `GET /orders` uses a keyset cursor — and
 * those are handled directly in `http.ts` rather than through this file.
 *
 * The text matching is the same normalisation the POS search uses: Arabic
 * diacritics stripped, alef/ya/ta-marbuta folded, so "شاورمه" finds
 * "شاورما" (FR-POS-012).
 */

import type { Localised, Page } from "../types";
import type { ScopedQuery } from "./types";

export type Accessor<T> = (row: T) => unknown;

export interface ProjectionConfig<T> {
  /** Fields the free-text box looks at. */
  search?: (row: T) => (string | Localised | null | undefined)[];
  /** Named filters exposed to the toolbar. */
  filters?: Record<string, Accessor<T>>;
  /** Named sort keys; `-key` sorts descending. */
  sorters?: Record<string, Accessor<T>>;
  /** Rows a scope excludes. Return null when the row belongs to every scope. */
  branchOf?: (row: T) => string | null;
  brandOf?: (row: T) => string | null;
}

export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function textOf(value: string | Localised | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return `${value.en} ${value.ar}`;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Applies a query to an already-fetched array and wraps it as a `Page`. */
export function project<T>(
  rows: readonly T[],
  query: ScopedQuery = {},
  config: ProjectionConfig<T> = {},
): Page<T> {
  let out = [...rows];

  const scope = query.scope;
  if (scope?.branchId && config.branchOf) {
    out = out.filter((row) => {
      const branchId = config.branchOf!(row);
      return branchId === null || branchId === scope.branchId;
    });
  } else if (scope?.brandId && config.brandOf) {
    out = out.filter((row) => {
      const brandId = config.brandOf!(row);
      return brandId === null || brandId === scope.brandId;
    });
  }

  const needle = query.search?.trim();
  if (needle && config.search) {
    const folded = normalise(needle);
    out = out.filter((row) =>
      config.search!(row).some((field) => normalise(textOf(field)).includes(folded)),
    );
  }

  if (query.filters) {
    for (const [key, expected] of Object.entries(query.filters)) {
      if (expected === undefined || expected === "" || expected === "all") continue;
      const accessor = config.filters?.[key];
      if (!accessor) continue;
      out = out.filter((row) => String(accessor(row)) === String(expected));
    }
  }

  if (query.sort) {
    const desc = query.sort.startsWith("-");
    const key = desc ? query.sort.slice(1) : query.sort;
    const accessor = config.sorters?.[key];
    if (accessor) {
      out.sort((a, b) => {
        const result = compare(accessor(a), accessor(b));
        return desc ? -result : result;
      });
    }
  }

  const total = out.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 25;

  return { rows: out.slice(offset, offset + limit), total, cursor: null };
}

export function emptyPage<T>(): Page<T> {
  return { rows: [], total: 0, cursor: null };
}

export function singlePage<T>(rows: T[]): Page<T> {
  return { rows, total: rows.length, cursor: null };
}
