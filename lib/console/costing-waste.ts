/**
 * Waste analytics — FR-CST-021, FR-CST-022, FR-CST-024.
 *
 * Pure. Three computations over recorded waste:
 *
 *   - waste as a share of COGS and of net sales (FR-CST-021);
 *   - a rolling weekly baseline per item and location, with the current week
 *     flagged when it sits more than k standard deviations above it
 *     (FR-CST-022);
 *   - Pearson correlation of daily waste (optionally one reason) against
 *     operational factors — labour hours, order volume, new starters on
 *     shift, equipment faults (FR-CST-024).
 *
 * The correlation is a prompt for root-cause work, never a finding: it is
 * suppressed below a minimum number of days, and the screen says that two
 * series moving together do not make one the cause of the other.
 */

import type { AttendanceRecord, Employee, Id, Localised, Order, WasteRecord } from "./types";

// ---------------------------------------------------------------------------
// FR-CST-021
// ---------------------------------------------------------------------------

export function wasteShares(wasteMinor: number, cogsMinor: number, netSalesMinor: number) {
  return {
    percentOfCogs: cogsMinor > 0 ? (wasteMinor / cogsMinor) * 100 : null,
    percentOfNetSales: netSalesMinor > 0 ? (wasteMinor / netSalesMinor) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// FR-CST-022 — rolling baseline
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface BaselineOptions {
  /** Trailing complete weeks the baseline is drawn from. */
  windowWeeks: number;
  /** Standard deviations above the mean that count as a deviation. */
  sigma: number;
  /** The instant the current week ends at. Defaults to the latest record. */
  asAt?: string;
  /** True waste only (staff meals and tastings are a decision, not a loss). */
  trueWasteOnly: boolean;
}

export interface BaselineRow {
  key: string;
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  currentMinor: number;
  currentQty: number;
  meanMinor: number;
  sdMinor: number;
  /** Null when the history has no spread to measure against. */
  z: number | null;
  flagged: boolean;
  /** Weekly values, oldest first, current week last. */
  weeks: number[];
  weeksWithWaste: number;
}

export function wasteBaseline(records: WasteRecord[], options: BaselineOptions): { rows: BaselineRow[]; weekStarts: string[] } {
  const pool = records.filter((record) => !options.trueWasteOnly || record.isTrueWaste);
  if (pool.length === 0) return { rows: [], weekStarts: [] };

  const end = new Date(options.asAt ?? pool.reduce((latest, record) => (record.recordedAt > latest ? record.recordedAt : latest), pool[0]!.recordedAt)).getTime() + 1;
  const buckets = Math.max(1, Math.floor(options.windowWeeks)) + 1;
  const start = end - buckets * WEEK_MS;
  const weekStarts = Array.from({ length: buckets }, (_, index) => new Date(start + index * WEEK_MS).toISOString());

  const groups = new Map<string, { record: WasteRecord; values: number[]; qty: number[] }>();
  for (const record of pool) {
    const at = new Date(record.recordedAt).getTime();
    if (at < start || at >= end) continue;
    const bucket = Math.min(buckets - 1, Math.floor((at - start) / WEEK_MS));
    const key = `${record.locationId}:${record.itemId}`;
    const group = groups.get(key) ?? { record, values: new Array(buckets).fill(0), qty: new Array(buckets).fill(0) };
    group.values[bucket] += record.value.amount;
    group.qty[bucket] += Number(record.quantity.value);
    groups.set(key, group);
  }

  const rows: BaselineRow[] = [];
  for (const [key, group] of groups) {
    // Empty weeks are zeros, not gaps: a week with no waste is part of the baseline.
    const history = group.values.slice(0, -1);
    const current = group.values[group.values.length - 1]!;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const sd =
      history.length > 1 ? Math.sqrt(history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (history.length - 1)) : 0;
    const z = sd > 0 ? (current - mean) / sd : null;
    rows.push({
      key,
      itemId: group.record.itemId,
      itemName: group.record.itemName,
      locationId: group.record.locationId,
      locationName: group.record.locationName,
      currentMinor: Math.round(current),
      currentQty: group.qty[group.qty.length - 1]!,
      meanMinor: Math.round(mean),
      sdMinor: Math.round(sd),
      z,
      flagged: z !== null && z > options.sigma,
      weeks: group.values.map((value) => Math.round(value)),
      weeksWithWaste: group.values.filter((value) => value > 0).length,
    });
  }

  rows.sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.z ?? -Infinity) - (a.z ?? -Infinity) || b.currentMinor - a.currentMinor);
  return { rows, weekStarts };
}

// ---------------------------------------------------------------------------
// FR-CST-024 — correlation with operational factors
// ---------------------------------------------------------------------------

export interface EquipmentFaultLike {
  reportedOn: string;
  branchId: Id | null;
}

export type FactorKey = "labourHours" | "orderVolume" | "newStarters" | "equipmentFaults";

export interface FactorSeries {
  key: FactorKey;
  /** Null when the source is not available from this backend. */
  byDay: Map<string, number> | null;
}

export interface CorrelationResult {
  key: FactorKey;
  available: boolean;
  n: number;
  r: number | null;
  /** Suppressed because there are too few paired days. */
  suppressed: boolean;
}

export const MIN_CORRELATION_DAYS = 7;

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Daily waste value, optionally for one reason code. */
export function dailyWaste(records: WasteRecord[], reasonCode: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const record of records) {
    if (reasonCode && record.reasonCode !== reasonCode) continue;
    const key = day(record.recordedAt);
    out.set(key, (out.get(key) ?? 0) + record.value.amount);
  }
  return out;
}

export function labourHoursByDay(attendance: AttendanceRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const record of attendance) {
    out.set(record.date, (out.get(record.date) ?? 0) + record.regularHours + record.overtimeHours);
  }
  return out;
}

export function ordersByDay(orders: Order[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const order of orders) {
    if (order.state === "cancelled" || order.state === "merged") continue;
    out.set(order.businessDay, (out.get(order.businessDay) ?? 0) + 1);
  }
  return out;
}

/**
 * New starters on shift per day: attendance by an employee hired within
 * `withinDays` of that day. Presence is taken from attendance, not from the
 * employment record, because a new hire who was not working cannot have
 * affected that day's waste.
 */
export function newStartersByDay(attendance: AttendanceRecord[], employees: Employee[], withinDays: number): Map<string, number> {
  const hired = new Map(employees.map((employee) => [employee.id, employee.hiredOn]));
  const out = new Map<string, number>();
  for (const record of attendance) {
    const hiredOn = hired.get(record.employeeId);
    if (!hiredOn) continue;
    const tenureDays = (new Date(record.date).getTime() - new Date(hiredOn).getTime()) / DAY_MS;
    const isNew = tenureDays >= 0 && tenureDays <= withinDays;
    out.set(record.date, (out.get(record.date) ?? 0) + (isNew ? 1 : 0));
  }
  return out;
}

export function faultsByDay(faults: EquipmentFaultLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const fault of faults) out.set(fault.reportedOn, (out.get(fault.reportedOn) ?? 0) + 1);
  return out;
}

/**
 * Correlate waste with each factor over the days both series cover.
 *
 * Days are the union of days with any waste and days the factor observed:
 * a day with orders but no waste is a zero-waste day, which is informative.
 * A factor series that is itself sparse (faults) counts missing days as 0
 * only inside the span the waste series covers.
 */
export function correlate(
  waste: Map<string, number>,
  factors: FactorSeries[],
  span: { from: string; to: string },
): CorrelationResult[] {
  const days: string[] = [];
  for (let at = new Date(span.from).getTime(); at <= new Date(span.to).getTime(); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }

  return factors.map((factor) => {
    if (!factor.byDay) return { key: factor.key, available: false, n: 0, r: null, suppressed: false };
    const sparse = factor.key === "equipmentFaults";
    const paired = days.filter((d) => sparse || factor.byDay!.has(d));
    const xs = paired.map((d) => factor.byDay!.get(d) ?? 0);
    const ys = paired.map((d) => waste.get(d) ?? 0);
    const n = paired.length;
    const suppressed = n < MIN_CORRELATION_DAYS;
    return { key: factor.key, available: true, n, r: suppressed ? null : pearson(xs, ys), suppressed };
  });
}

/** Plain-language strength band for |r|. */
export function strengthOf(r: number | null): "none" | "weak" | "moderate" | "strong" {
  if (r === null) return "none";
  const a = Math.abs(r);
  if (a >= 0.6) return "strong";
  if (a >= 0.3) return "moderate";
  if (a >= 0.1) return "weak";
  return "none";
}
