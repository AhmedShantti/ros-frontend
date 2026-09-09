"use client";

/**
 * Browser-local persistence for domains the server does not own yet.
 *
 * ## Why this exists, and what it is not
 *
 * A number of SRS modules — customers, promotions, rosters, alert rules,
 * settings overrides — need a complete, testable frontend now, ahead of the
 * server that will eventually hold them. The two usual answers are both bad:
 * hard-coded fixtures make every form a lie (you fill it in, nothing
 * happens), and inventing endpoints makes the eventual integration a
 * rewrite.
 *
 * So this is the third answer: a tiny durable collection store behind the
 * *same* `CollectionService<T>` interface the rest of the console already
 * talks to. Screens are written once, against the interface. When the
 * backend arrives, `http.ts` implements those members and the registry
 * swaps — no screen changes, because no screen ever knew.
 *
 * It is explicitly not a database and not a cache. It has no querying beyond
 * what the toolbar needs, it is per-browser, and it is cleared by the demo
 * reset. Anything that must survive a device belongs on the server.
 *
 * ## Storage
 *
 * `localStorage`, namespaced per tenant so two demo tenants in one browser
 * do not read each other's rows. Every read and write is wrapped: a private
 * window, a cleared profile or a browser configured to block site data all
 * throw on access, and a store that throws on read is a console that will
 * not paint.
 */

import type { Id, Localised, Page } from "./types";
import { ServiceError, type CollectionService, type ScopedQuery } from "./services/types";

const PREFIX = "ros.local";

/** Simulated latency, so local-backed screens still exercise their spinners. */
const LATENCY = 90;

function key(collection: string, tenantId: string): string {
  return `${PREFIX}.${tenantId}.${collection}`;
}

function readRaw<T>(collection: string, tenantId: string): T[] | null {
  try {
    const stored = window.localStorage.getItem(key(collection, tenantId));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function writeRaw<T>(collection: string, tenantId: string, rows: T[]): void {
  try {
    window.localStorage.setItem(key(collection, tenantId), JSON.stringify(rows));
  } catch {
    // Quota exhausted or storage blocked. The in-memory copy still holds for
    // this session, which is the honest degradation: the user's work in the
    // current tab survives, it just will not outlive the tab.
  }
}

/** Wipe every local collection for a tenant — the demo reset. */
export function clearLocalStore(tenantId: string): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const name = window.localStorage.key(i);
      if (name?.startsWith(`${PREFIX}.${tenantId}.`)) doomed.push(name);
    }
    for (const name of doomed) window.localStorage.removeItem(name);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

async function settle<T>(produce: () => T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY));
  return produce();
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

let counter = 0;

/**
 * A sortable, collision-resistant id.
 *
 * Shaped like the ULIDs the domain uses so ids look consistent in the UI and
 * in an export, and monotonic within a session so "newest first" works
 * without a timestamp column.
 */
export function localId(prefix = "loc"): Id {
  counter += 1;
  const time = Date.now().toString(36);
  const seq = counter.toString(36).padStart(3, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${seq}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

type Accessor<T> = (row: T) => unknown;

export interface LocalCollectionConfig<T> {
  /** Storage name. Namespaced per tenant automatically. */
  name: string;
  idOf: (row: T) => Id;
  /** Rows written on first use, so a fresh browser is not an empty product. */
  seed?: () => T[];
  /** Fields the free-text search box looks at. */
  search?: (row: T) => (string | Localised | null | undefined)[];
  branchOf?: (row: T) => Id | null;
  brandOf?: (row: T) => Id | null;
  filters?: Record<string, Accessor<T>>;
  sorters?: Record<string, Accessor<T>>;
  /** Builds a row from a partial. Required for `create` to work. */
  factory?: (input: Partial<T>, id: Id) => T;
  /** Applied on `update`, so a row can normalise or recompute derived fields. */
  onUpdate?: (row: T, patch: Partial<T>) => T;
  /** Return a message to refuse a delete — referential integrity, mostly. */
  guardRemove?: (row: T, all: T[]) => string | null;
}

function textOf(value: string | Localised | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return `${value.en} ${value.ar}`;
}

/** Strip Arabic diacritics and normalise alef/ya/ta-marbuta — FR-POS-012. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export interface LocalCollection<T> extends CollectionService<T> {
  /** Everything, unpaged and unfiltered — for pickers and derived reports. */
  all(): Promise<T[]>;
  /** Synchronous read for callers already inside a render that has the data. */
  peek(): T[];
  /** Replace the whole collection — bulk import, reset to seed. */
  replace(rows: T[]): Promise<void>;
}

/**
 * Build a durable collection that satisfies `CollectionService<T>`.
 *
 * `tenantOf` is a function rather than a value because the registry is
 * constructed once at module load, before anybody has signed in — resolving
 * the tenant lazily is what lets one store serve whichever tenant the
 * session later turns out to be.
 */
export function localCollection<T>(
  config: LocalCollectionConfig<T>,
  tenantOf: () => string,
): LocalCollection<T> {
  // Per-tenant in-memory mirror, so repeated reads in one render pass do not
  // re-parse the JSON each time.
  const cache = new Map<string, T[]>();

  function load(): T[] {
    const tenantId = tenantOf();
    const cached = cache.get(tenantId);
    if (cached) return cached;

    const stored = readRaw<T>(config.name, tenantId);
    const rows = stored ?? config.seed?.() ?? [];
    if (!stored && rows.length > 0) writeRaw(config.name, tenantId, rows);
    cache.set(tenantId, rows);
    return rows;
  }

  function save(rows: T[]): void {
    const tenantId = tenantOf();
    cache.set(tenantId, rows);
    writeRaw(config.name, tenantId, rows);
  }

  function applyScope(rows: T[], query?: ScopedQuery): T[] {
    const scope = query?.scope;
    if (!scope) return rows;
    let out = rows;
    if (scope.branchId && config.branchOf) {
      out = out.filter((row) => {
        const branch = config.branchOf!(row);
        return branch === null || branch === scope.branchId;
      });
    } else if (scope.brandId && config.brandOf) {
      out = out.filter((row) => {
        const brand = config.brandOf!(row);
        return brand === null || brand === scope.brandId;
      });
    }
    return out;
  }

  return {
    peek: load,

    async all() {
      return settle(() => [...load()]);
    },

    async list(query: ScopedQuery = {}): Promise<Page<T>> {
      return settle(() => {
        let rows = applyScope([...load()], query);

        const term = query.search?.trim();
        if (term && config.search) {
          const needle = normalise(term);
          rows = rows.filter((row) =>
            config
              .search!(row)
              .some((field) => normalise(textOf(field)).includes(needle)),
          );
        }

        for (const [name, value] of Object.entries(query.filters ?? {})) {
          const accessor = config.filters?.[name];
          if (!accessor || !value || value === "all") continue;
          rows = rows.filter((row) => String(accessor(row) ?? "") === value);
        }

        if (query.sort) {
          const descending = query.sort.startsWith("-");
          const field = descending ? query.sort.slice(1) : query.sort;
          const accessor = config.sorters?.[field];
          if (accessor) {
            rows.sort((a, b) => compare(accessor(a), accessor(b)) * (descending ? -1 : 1));
          }
        }

        const total = rows.length;
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 25;
        return { rows: rows.slice(offset, offset + limit), total, cursor: null };
      });
    },

    async get(id: Id) {
      return settle(() => load().find((row) => config.idOf(row) === id) ?? null);
    },

    async create(input: Partial<T>) {
      return settle(() => {
        if (!config.factory) {
          throw new ServiceError(
            "NOT_SUPPORTED",
            "This collection cannot be created into.",
            400,
          );
        }
        const rows = [...load()];
        const created = config.factory(input, localId(config.name.slice(0, 4)));
        rows.unshift(created);
        save(rows);
        return created;
      });
    },

    async update(id: Id, patch: Partial<T>) {
      return settle(() => {
        const rows = [...load()];
        const index = rows.findIndex((row) => config.idOf(row) === id);
        if (index === -1) {
          throw new ServiceError("NOT_FOUND", "That record no longer exists.", 404);
        }
        const merged = config.onUpdate
          ? config.onUpdate(rows[index]!, patch)
          : { ...rows[index]!, ...patch };
        rows[index] = merged;
        save(rows);
        return merged;
      });
    },

    async remove(id: Id) {
      return settle(() => {
        const rows = [...load()];
        const index = rows.findIndex((row) => config.idOf(row) === id);
        if (index === -1) return;

        const refusal = config.guardRemove?.(rows[index]!, rows);
        if (refusal) throw new ServiceError("CONFLICT", refusal, 409);

        rows.splice(index, 1);
        save(rows);
      });
    },

    async replace(rows: T[]) {
      return settle(() => {
        save([...rows]);
      });
    },
  };
}

/**
 * A single durable document — settings, a layout, a draft.
 *
 * Same reasoning as `localCollection`, for the things there is only one of.
 */
export function localDocument<T>(
  name: string,
  initial: () => T,
  tenantOf: () => string,
): {
  read(): T;
  write(next: T): void;
  patch(part: Partial<T>): T;
  reset(): T;
} {
  return {
    read() {
      const stored = readRaw<T>(name, tenantOf());
      // Documents are stored as a one-element array so the same primitives
      // serve both shapes; anything else means a corrupted or older value.
      return stored && stored.length > 0 ? (stored[0] as T) : initial();
    },
    write(next: T) {
      writeRaw(name, tenantOf(), [next]);
    },
    patch(part: Partial<T>) {
      const merged = { ...this.read(), ...part };
      this.write(merged);
      return merged;
    },
    reset() {
      const fresh = initial();
      this.write(fresh);
      return fresh;
    },
  };
}
