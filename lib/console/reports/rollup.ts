"use client";

/**
 * Daily sales totals, as the report runner reads them — SRS FR-RPT-002.
 *
 * A year-on-year comparison must not scan a year of orders in the browser.
 * The comparison therefore reads per-business-day totals:
 *
 *   mock  the generated two-year history in `mock/sales-rollup.ts`
 *   http  `GET /reports/branches/{id}/sales-daily?from&to`, one call per
 *         branch in scope, covering last year's 1 January up to today
 *
 * The live figures follow the backend's definitions, which are the daily-
 * trading report's: gross is tax-inclusive, and
 * net = gross − discounts − refunds − tax.
 */

import { DATA_MODE } from "@/lib/api/config";
import { api } from "@/lib/api/endpoints";
import type { Scope } from "../services/types";
import type { Localised } from "../types";
import { BUSINESS_DAY, NOW_ISO } from "../mock/clock";

export interface DailySales {
  date: string;
  branchId: string;
  branchName: Localised;
  orders: number;
  gross: number;
  discounts: number;
  refunds: number;
  net: number;
  tax: number;
}

export interface SalesRollup {
  rows: DailySales[];
  currency: string;
  /** First day the source can answer for; null when it has nothing. */
  earliest: string | null;
  /** The business day treated as "today" for the comparison. */
  today: string;
  source: "rollup" | "orders";
  /** FR-RPT-004 — when the figures were computed. */
  generatedAt: string;
}

/** A branch the comparison may ask about. */
export interface RollupBranch {
  id: string;
  name: Localised;
}

/**
 * The business day a comparison treats as "today". The mock dataset sits on a
 * fixed anchor day, so "this week" in demo mode means the week of that day;
 * live, it is the wall clock.
 */
export function reportToday(): string {
  return DATA_MODE === "mock" ? BUSINESS_DAY : new Date().toISOString().slice(0, 10);
}

export async function loadSalesRollup(
  scope: Scope,
  branches: readonly RollupBranch[] = [],
): Promise<SalesRollup> {
  if (DATA_MODE === "mock") {
    const { salesRollup, salesRollupCurrency } = await import("../mock/sales-rollup");

    const rows = salesRollup.filter((row) => {
      if (scope.branchId) return row.branchId === scope.branchId;
      if (scope.brandId) return row.brandId === scope.brandId;
      return true;
    });

    return {
      rows,
      currency: salesRollupCurrency,
      earliest: rows[0]?.date ?? null,
      today: BUSINESS_DAY,
      source: "rollup",
      generatedAt: NOW_ISO,
    };
  }

  // -- Live: one call per branch, from last year's 1 January to today --------
  const today = reportToday();
  const from = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const targets = scope.branchId
    ? branches.filter((branch) => branch.id === scope.branchId)
    : branches;

  // The console knows the branch it is scoped to even when the list has not
  // loaded; do not silently report "no branches".
  const asked: RollupBranch[] =
    targets.length > 0 || !scope.branchId
      ? [...targets]
      : [{ id: scope.branchId, name: { en: "", ar: "" } }];

  const settled = await Promise.allSettled(
    asked.map((branch) => api.reporting.getSalesDailyRange(branch.id, { from, to: today })),
  );

  const answered = settled.flatMap((result, index) =>
    result.status === "fulfilled" ? [{ branch: asked[index]!, response: result.value }] : [],
  );

  // Every branch failing is an error to show, not an empty comparison.
  if (asked.length > 0 && answered.length === 0) {
    const failure = settled.find((result) => result.status === "rejected");
    throw failure && failure.status === "rejected"
      ? failure.reason
      : new Error("The sales report could not be loaded.");
  }

  const rows: DailySales[] = answered.flatMap(({ branch, response }) =>
    response.days.map((day) => ({
      date: day.businessDay,
      branchId: branch.id,
      branchName: branch.name,
      orders: day.orderCount,
      gross: Number(day.grossSales),
      discounts: Number(day.discounts),
      refunds: Number(day.refunds),
      net: Number(day.netSales),
      tax: Number(day.taxTotal),
    })),
  );
  rows.sort((a, b) => a.date.localeCompare(b.date));

  return {
    rows,
    currency: answered[0]?.response.currency ?? "EGP",
    // The server answered for the whole range, so an empty stretch means no
    // sales, not a source that cannot see that far back.
    earliest: answered.length > 0 ? from : null,
    today,
    source: "rollup",
    generatedAt: answered[0]?.response.dataAsOf ?? new Date().toISOString(),
  };
}
