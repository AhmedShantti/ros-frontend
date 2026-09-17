/**
 * Break-even per branch — FR-CST-038.
 *
 * Pure.
 *
 *   Contribution margin % = (Net sales − COGS) ÷ Net sales
 *   Break-even sales      = Fixed costs for the month ÷ Contribution margin %
 *   Progress              = Month-to-date net sales ÷ Break-even sales
 *   Required daily rate   = (Break-even − MTD) ÷ remaining days
 *   Projected month-end   = MTD ÷ elapsed days × days in month
 *
 * Fixed costs are the branch's allocated monthly equivalent of the fixed
 * operating expenses (FR-CST-036). Labour is not assumed to be fixed: a
 * salaried team recorded as an operating expense counts, an hourly one does
 * not.
 */

import type { Id } from "./types";

export interface BreakEvenInput {
  branchId: Id;
  fixedCostsMinor: number;
  mtdNetSalesMinor: number;
  /** 0–100, or null when there is no margin to use. */
  contributionMarginPercent: number | null;
  daysInMonth: number;
  /** Days of the month the figures cover, 1..daysInMonth. */
  elapsedDays: number;
}

export interface BreakEvenResult extends BreakEvenInput {
  breakEvenMinor: number | null;
  progressPercent: number | null;
  remainingDays: number;
  requiredDailyMinor: number | null;
  projectedMonthEndMinor: number;
  projectedReaches: boolean | null;
  reached: boolean;
}

export function breakEven(input: BreakEvenInput): BreakEvenResult {
  const cm = input.contributionMarginPercent;
  const breakEvenMinor =
    input.fixedCostsMinor > 0 && cm !== null && cm > 0 ? Math.round(input.fixedCostsMinor / (cm / 100)) : null;
  const remainingDays = Math.max(0, input.daysInMonth - input.elapsedDays);
  const projectedMonthEndMinor =
    input.elapsedDays > 0 ? Math.round((input.mtdNetSalesMinor / input.elapsedDays) * input.daysInMonth) : 0;
  const reached = breakEvenMinor !== null && input.mtdNetSalesMinor >= breakEvenMinor;
  return {
    ...input,
    breakEvenMinor,
    progressPercent: breakEvenMinor ? (input.mtdNetSalesMinor / breakEvenMinor) * 100 : null,
    remainingDays,
    requiredDailyMinor:
      breakEvenMinor === null || reached
        ? breakEvenMinor === null
          ? null
          : 0
        : remainingDays > 0
          ? Math.ceil((breakEvenMinor - input.mtdNetSalesMinor) / remainingDays)
          : null,
    projectedMonthEndMinor,
    projectedReaches: breakEvenMinor === null ? null : projectedMonthEndMinor >= breakEvenMinor,
    reached,
  };
}

export function daysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, m!, 0)).getUTCDate();
}
