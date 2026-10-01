/**
 * Period-over-period aggregation — SRS §19.3.
 *
 * Pure functions over daily rollup rows: totals for a span, the buckets a
 * chart plots (a day at a time for a week, a month at a time for a year), and
 * the per-branch breakdown the "Sales by Branch" report is defined by.
 */

import type { Localised } from "../types";
import type { DailySales } from "./rollup";
import { addDays, inSpan, spanDays, type ComparisonPeriods, type Span } from "./periods";

export interface SalesTotals {
  orders: number;
  gross: number;
  discounts: number;
  refunds: number;
  net: number;
  tax: number;
  /** Net divided by orders; 0 when there are none. */
  aov: number;
}

export type SalesMetric = keyof SalesTotals;

const EMPTY: SalesTotals = { orders: 0, gross: 0, discounts: 0, refunds: 0, net: 0, tax: 0, aov: 0 };

export function totalsOf(rows: readonly DailySales[], span: Span): SalesTotals {
  const total = { ...EMPTY };
  for (const row of rows) {
    if (!inSpan(row.date, span)) continue;
    total.orders += row.orders;
    total.gross += row.gross;
    total.discounts += row.discounts;
    total.refunds += row.refunds;
    total.net += row.net;
    total.tax += row.tax;
  }
  total.aov = total.orders > 0 ? Math.round(total.net / total.orders) : 0;
  return total;
}

export interface Bucket {
  key: string;
  /** A date the label is formatted from: the day, or the first of the month. */
  labelDate: string;
  current: number;
  previous: number;
}

function sumOn(rows: readonly DailySales[], metric: "net" | "orders", match: (date: string) => boolean): number {
  let total = 0;
  for (const row of rows) if (match(row.date)) total += row[metric];
  return total;
}

/**
 * Chart buckets. Week: day *i* of this week against day *i* of the previous
 * one. Year: month *m* of this year against month *m* of last year, up to the
 * month the current period has reached.
 */
export function bucketsOf(
  rows: readonly DailySales[],
  periods: ComparisonPeriods,
  metric: "net" | "orders" = "net",
): Bucket[] {
  if (periods.mode === "week") {
    return Array.from({ length: spanDays(periods.current) }, (_, index) => {
      const currentDay = addDays(periods.current.from, index);
      const previousDay = addDays(periods.previous.from, index);
      return {
        key: String(index),
        labelDate: currentDay,
        current: sumOn(rows, metric, (date) => date === currentDay),
        previous: sumOn(rows, metric, (date) => date === previousDay),
      };
    });
  }

  const lastMonth = Number(periods.current.to.slice(5, 7)) - 1;
  const year = periods.current.to.slice(0, 4);
  return Array.from({ length: lastMonth + 1 }, (_, month) => {
    const mm = String(month + 1).padStart(2, "0");
    const inMonth = (span: Span) => (date: string) => inSpan(date, span) && date.slice(5, 7) === mm;
    return {
      key: mm,
      labelDate: `${year}-${mm}-01`,
      current: sumOn(rows, metric, inMonth(periods.current)),
      previous: sumOn(rows, metric, inMonth(periods.previous)),
    };
  });
}

export interface BranchComparison {
  branchId: string;
  name: Localised;
  current: SalesTotals;
  previous: SalesTotals;
}

export function branchesOf(rows: readonly DailySales[], periods: ComparisonPeriods): BranchComparison[] {
  const byBranch = new Map<string, { name: Localised; rows: DailySales[] }>();
  for (const row of rows) {
    const entry = byBranch.get(row.branchId) ?? { name: row.branchName, rows: [] };
    entry.rows.push(row);
    byBranch.set(row.branchId, entry);
  }

  return [...byBranch.entries()]
    .map(([branchId, entry]) => ({
      branchId,
      name: entry.name,
      current: totalsOf(entry.rows, periods.current),
      previous: totalsOf(entry.rows, periods.previous),
    }))
    .sort((a, b) => b.current.net - a.current.net);
}
