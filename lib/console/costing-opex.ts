/**
 * Branch operating expenses — FR-CST-036 — and the fixed-cost side of
 * break-even — FR-CST-038.
 *
 * Pure. An operating expense has a category, an amount, a recurrence and an
 * allocation. This module turns one into the amount each branch carries for
 * a given month: the recurrence is normalised to a monthly equivalent, the
 * expense is only counted in months its start/end window touches, and the
 * allocation splits it across branches.
 *
 * Money stays in integer minor units. Splits use largest-remainder, so the
 * branch shares always add back to the whole to the last piastre.
 */

import type { Currency, Id, IsoDate, IsoDateTime, Localised } from "./types";

export type OpexCategory = "rent" | "utilities" | "maintenance" | "insurance" | "licences" | "other";
export type OpexRecurrence = "one_off" | "monthly" | "quarterly" | "annual";
export type OpexAllocation = "single" | "equal" | "net_sales" | "area" | "manual";

export interface OperatingExpense {
  id: Id;
  description: string;
  category: OpexCategory;
  amountMinor: number;
  currency: Currency;
  recurrence: OpexRecurrence;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  /** Fixed costs feed break-even; variable ones do not. */
  fixed: boolean;
  allocation: OpexAllocation;
  /** `single`: the one branch. Otherwise the branches it is split across. */
  branchIds: Id[];
  /** `manual`: percentage per branch, summing to 100. */
  manualPercent: Record<Id, number>;
  createdAt: IsoDateTime;
  createdBy: string | null;
}

export const OPEX_CATEGORIES: { value: OpexCategory; label: Localised }[] = [
  { value: "rent", label: { en: "Rent", ar: "الإيجار" } },
  { value: "utilities", label: { en: "Utilities", ar: "المرافق" } },
  { value: "maintenance", label: { en: "Maintenance", ar: "الصيانة" } },
  { value: "insurance", label: { en: "Insurance", ar: "التأمين" } },
  { value: "licences", label: { en: "Licences and permits", ar: "التراخيص والتصاريح" } },
  { value: "other", label: { en: "Other", ar: "أخرى" } },
];

export const OPEX_RECURRENCE: { value: OpexRecurrence; label: Localised; months: number | null }[] = [
  { value: "one_off", label: { en: "One-off", ar: "مرة واحدة" }, months: null },
  { value: "monthly", label: { en: "Monthly", ar: "شهري" }, months: 1 },
  { value: "quarterly", label: { en: "Quarterly", ar: "ربع سنوي" }, months: 3 },
  { value: "annual", label: { en: "Annual", ar: "سنوي" }, months: 12 },
];

export const OPEX_ALLOCATION: { value: OpexAllocation; label: Localised }[] = [
  { value: "single", label: { en: "One branch", ar: "فرع واحد" } },
  { value: "equal", label: { en: "Split equally", ar: "تقسيم بالتساوي" } },
  { value: "net_sales", label: { en: "Split by net sales", ar: "تقسيم حسب صافي المبيعات" } },
  { value: "area", label: { en: "Split by floor area", ar: "تقسيم حسب المساحة" } },
  { value: "manual", label: { en: "Manual percentages", ar: "نسب يدوية" } },
];

/** "YYYY-MM" of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * What this expense costs in `month` (YYYY-MM), before allocation.
 * Recurring expenses are spread evenly (an annual rent is a twelfth a month);
 * a one-off lands whole in the month it starts.
 */
export function monthlyAmount(expense: OperatingExpense, month: string): number {
  const start = monthOf(expense.startsOn);
  const end = expense.endsOn ? monthOf(expense.endsOn) : null;
  if (month < start || (end && month > end)) return 0;
  const recurrence = OPEX_RECURRENCE.find((row) => row.value === expense.recurrence)!;
  if (recurrence.months === null) return month === start ? expense.amountMinor : 0;
  return Math.round(expense.amountMinor / recurrence.months);
}

/** Split integer minor units by weights, largest remainder first. */
export function splitMinor(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.length === 0) return [];
  const safe = sum > 0 ? weights.map((w) => Math.max(0, w)) : weights.map(() => 1);
  const safeSum = safe.reduce((a, b) => a + b, 0);
  const raw = safe.map((w) => (total * w) / safeSum);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac);
  for (const entry of order) {
    if (remainder <= 0) break;
    floors[entry.index]! += 1;
    remainder -= 1;
  }
  return floors;
}

export interface AllocationInputs {
  netSalesByBranch: Map<Id, number>;
  areaByBranch: Map<Id, number>;
}

/** Branch → allocated minor units for one amount of this expense. */
export function allocate(expense: OperatingExpense, amount: number, inputs: AllocationInputs): Map<Id, number> {
  const branches = expense.allocation === "single" ? expense.branchIds.slice(0, 1) : expense.branchIds;
  if (branches.length === 0 || amount === 0) return new Map();
  let weights: number[];
  switch (expense.allocation) {
    case "net_sales":
      weights = branches.map((id) => inputs.netSalesByBranch.get(id) ?? 0);
      break;
    case "area":
      weights = branches.map((id) => inputs.areaByBranch.get(id) ?? 0);
      break;
    case "manual":
      weights = branches.map((id) => expense.manualPercent[id] ?? 0);
      break;
    default:
      weights = branches.map(() => 1);
  }
  const shares = splitMinor(amount, weights);
  return new Map(branches.map((id, index) => [id, shares[index]!]));
}

/** Per-branch operating cost for a month, optionally fixed costs only. */
export function branchCostsForMonth(
  expenses: OperatingExpense[],
  month: string,
  inputs: AllocationInputs,
  options: { fixedOnly?: boolean } = {},
): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const expense of expenses) {
    if (options.fixedOnly && !expense.fixed) continue;
    const amount = monthlyAmount(expense, month);
    for (const [branchId, share] of allocate(expense, amount, inputs)) {
      out.set(branchId, (out.get(branchId) ?? 0) + share);
    }
  }
  return out;
}

/** Validation shared by the form and the service. Null when valid. */
export function validateExpense(input: Partial<OperatingExpense>): string | null {
  if (!input.description?.trim()) return "Describe the expense.";
  if (!input.amountMinor || input.amountMinor <= 0) return "Enter an amount above zero.";
  if (!input.startsOn) return "Choose when the expense starts.";
  if (input.endsOn && input.endsOn < input.startsOn) return "The end date is before the start date.";
  const branches = input.branchIds ?? [];
  if (branches.length === 0) return "Choose at least one branch.";
  if (input.allocation === "single" && branches.length !== 1) return "A single-branch expense names exactly one branch.";
  if (input.allocation === "manual") {
    const total = branches.reduce((sum, id) => sum + (input.manualPercent?.[id] ?? 0), 0);
    if (Math.abs(total - 100) > 0.001) return "Manual percentages must add up to 100.";
  }
  return null;
}
