/**
 * Plan limits and the read-only state they produce — FR-PLT-021.
 *
 * The rule is the requirement's: a downgrade or a suspension never deletes
 * anything. What no longer fits the plan stays, and becomes read-only.
 *
 *   - A tenant that is suspended, restricted, past due or terminating is
 *     read-only across the board — it can still sign in, look and export
 *     (FR-PLT-022), and cannot change anything.
 *   - A tenant over its plan's limits keeps writing to what fits. The rows
 *     past the limit — the newest ones, so the business keeps the estate it
 *     had longest — are read-only until the plan is raised or rows retired.
 *
 * The SRS fixes per-plan rate limits (FR-PLT-015) but not entity counts, and
 * the API serves no plan catalogue, so `PLAN_LIMITS` below is a placeholder
 * catalogue. The screen that shows it says so.
 */

import type { Id, PlanTier, TenantState } from "./types";

export interface PlanLimits {
  brands: number;
  branches: number;
  users: number;
  /** FR-PLT-015 — export rows per day. This one the SRS does specify. */
  exportRowsPerDay: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: { brands: 1, branches: 2, users: 15, exportRowsPerDay: 100_000 },
  professional: { brands: 5, branches: 25, users: 250, exportRowsPerDay: 1_000_000 },
  enterprise: {
    brands: Number.POSITIVE_INFINITY,
    branches: Number.POSITIVE_INFINITY,
    users: Number.POSITIVE_INFINITY,
    exportRowsPerDay: 10_000_000,
  },
};

export type ReadOnlyReason = "suspended" | "restricted" | "past_due" | "terminating";

const READ_ONLY_STATES: Partial<Record<TenantState, ReadOnlyReason>> = {
  suspended: "suspended",
  restricted: "restricted",
  past_due: "past_due",
  terminating: "terminating",
};

export interface TenantAccess {
  readOnly: boolean;
  reason: ReadOnlyReason | null;
}

export function tenantAccess(state: TenantState): TenantAccess {
  const reason = READ_ONLY_STATES[state] ?? null;
  return { readOnly: reason !== null, reason };
}

/**
 * The ids past the limit, oldest kept writable. `rows` need not be sorted;
 * `createdOf` orders them, with the id as a stable tie-break.
 */
export function overLimitIds<T>(
  rows: T[],
  limit: number,
  idOf: (row: T) => Id,
  createdOf: (row: T) => string,
): Set<Id> {
  if (!Number.isFinite(limit) || rows.length <= limit) return new Set();
  const ordered = [...rows].sort(
    (a, b) => createdOf(a).localeCompare(createdOf(b)) || idOf(a).localeCompare(idOf(b)),
  );
  return new Set(ordered.slice(limit).map(idOf));
}
