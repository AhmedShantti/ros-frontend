/**
 * Branch ranking with normalisation — FR-CST-037.
 *
 * Pure and generic: rank rows by any metric, optionally dividing additive
 * metrics by a size measure (seats, floor area, labour hours) so branches of
 * different sizes are comparable. Ratios are already size-free and are never
 * divided. Modelled on the inline logic of `/organisation/scorecard`
 * (FR-BRN-010…013), which could adopt this module; that page is left as-is
 * here because it belongs to another module.
 *
 * The new piece is labour hours per branch, taken from attendance records —
 * the size basis the scorecard has no source for.
 */

import type { AttendanceRecord, Id } from "./types";

export type Normalisation = "absolute" | "seat" | "area" | "labourHour";

export interface RankMetric<Row> {
  key: string;
  kind: "money" | "count" | "percent";
  higherIsBetter: boolean;
  /** Only additive figures scale with the size of the branch. */
  additive: boolean;
  read: (row: Row) => number | null;
}

export interface SizeBasis {
  seats: number | null;
  areaSqm: number | null;
  labourHours: number | null;
}

export interface RankedRow<Row> {
  row: Row;
  rank: number | null;
  value: number | null;
  /** Standard score against the group, 0 when there is no spread. */
  z: number;
  outlier: boolean;
  /** The divisor was missing, so this branch cannot be ranked on this basis. */
  missingBasis: boolean;
}

export function divisorFor(basis: SizeBasis, normalisation: Normalisation): number | null {
  switch (normalisation) {
    case "absolute":
      return 1;
    case "seat":
      return basis.seats && basis.seats > 0 ? basis.seats : null;
    case "area":
      return basis.areaSqm && basis.areaSqm > 0 ? basis.areaSqm : null;
    default:
      return basis.labourHours && basis.labourHours > 0 ? basis.labourHours : null;
  }
}

export function normalisedValue<Row>(
  metric: RankMetric<Row>,
  row: Row,
  basis: SizeBasis,
  normalisation: Normalisation,
): { value: number | null; missingBasis: boolean } {
  const raw = metric.read(row);
  if (raw === null) return { value: null, missingBasis: false };
  if (!metric.additive || normalisation === "absolute") return { value: raw, missingBasis: false };
  const divisor = divisorFor(basis, normalisation);
  return divisor === null ? { value: null, missingBasis: true } : { value: raw / divisor, missingBasis: false };
}

export function rankRows<Row>(
  rows: Row[],
  metric: RankMetric<Row>,
  basisOf: (row: Row) => SizeBasis,
  normalisation: Normalisation,
  sigma = 2,
): RankedRow<Row>[] {
  const scored = rows.map((row) => ({ row, ...normalisedValue(metric, row, basisOf(row), normalisation) }));
  const pool = scored.map((entry) => entry.value).filter((value): value is number => value !== null);
  const mean = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : 0;
  const sd = pool.length > 1 ? Math.sqrt(pool.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (pool.length - 1)) : 0;

  const ordered = [...scored].sort((a, b) => {
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return metric.higherIsBetter ? b.value - a.value : a.value - b.value;
  });

  return ordered.map((entry, index) => {
    const z = entry.value === null || sd === 0 ? 0 : (entry.value - mean) / sd;
    return {
      row: entry.row,
      rank: entry.value === null ? null : index + 1,
      value: entry.value,
      z,
      outlier: Math.abs(z) > sigma,
      missingBasis: entry.missingBasis,
    };
  });
}

/** Hours worked per branch from attendance (regular + overtime). */
export function labourHoursByBranch(attendance: AttendanceRecord[]): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const record of attendance) {
    out.set(record.branchId, (out.get(record.branchId) ?? 0) + record.regularHours + record.overtimeHours);
  }
  return out;
}
