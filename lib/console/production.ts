/**
 * Central-kitchen production arithmetic — SRS §17.5, FR-BRN-022 … FR-BRN-028.
 *
 * Pure functions, no I/O, so every number the production screens show can be
 * checked by hand. Quantities stay decimal strings (BigInt-scaled underneath,
 * see `stock-units.ts`); money is minor units.
 *
 * Recipe scaling follows the same model as the sale-time depletion engine
 * (`live/engine.ts`): a line's gross quantity is its net quantity plus its
 * trim loss, and a recipe that yields 85% has to start with 100/85 of its
 * inputs. A sub-recipe is walked into, because a central kitchen makes the
 * sauce as part of the run rather than drawing it from a shelf.
 */

import type { Id, Localised, Recipe, StockItem, UnitCode } from "./types";
import {
  convert,
  decimalAdd,
  decimalCompare,
  decimalDiv,
  decimalMul,
  decimalSub,
  dimensionOf,
} from "./stock-units";

export type ExpansionProblem = "no_item" | "no_density" | "incompatible" | "variable_size" | "invalid" | "unresolved_sub" | "cycle";

export interface RequiredInput {
  itemId: Id;
  name: Localised;
  /** The stock item's base unit — what the ledger counts in. */
  unit: UnitCode;
  /** Gross quantity for one batch of the recipe's yield. */
  perBatch: string;
  /** Gross quantity for the order's target. */
  required: string;
  /** True only when every line contributing this item is optional. */
  optional: boolean;
}

export interface ExpansionIssue {
  componentName: Localised;
  problem: ExpansionProblem;
}

export interface Expansion {
  /** How many recipe yields the target is. Null when the yield could not be read. */
  batches: string | null;
  /** The recipe's yield, in the output item's base unit. */
  yieldPerBatch: string | null;
  inputs: RequiredInput[];
  issues: ExpansionIssue[];
  yieldProblem: ExpansionProblem | null;
}

export interface ExpansionContext {
  items: Map<Id, StockItem>;
  /** g/ml per stock item, for mass↔volume lines (FR-INV-004). */
  densities: Map<Id, string | null>;
  recipes: Map<Id, Recipe>;
}

const MAX_DEPTH = 4;

/** 1 + wastage% — a trim loss consumes more, not less. */
function wastageFactor(percent: number): string {
  return decimalAdd("1", decimalDiv(String(percent || 0), "100") ?? "0");
}

/** 100 / yield% — a recipe that yields 85% needs 100/85 of its inputs. */
function yieldFactor(percent: number): string {
  return percent > 0 ? (decimalDiv("100", String(percent)) ?? "1") : "1";
}

export function expandRecipe(
  recipe: Recipe,
  target: string,
  output: StockItem,
  context: ExpansionContext,
): Expansion {
  const issues: ExpansionIssue[] = [];
  const totals = new Map<Id, { name: Localised; unit: UnitCode; required: string; optional: boolean }>();

  const converted = convert(
    recipe.yieldQuantity.value,
    recipe.yieldQuantity.unit,
    output.baseUnit,
    context.densities.get(output.id) ?? null,
  );
  if (!converted.ok || decimalCompare(converted.value, "0") <= 0) {
    return {
      batches: null,
      yieldPerBatch: null,
      inputs: [],
      issues,
      yieldProblem: converted.ok ? "invalid" : converted.reason,
    };
  }
  const yieldPerBatch = converted.value;
  const batches = decimalDiv(target, yieldPerBatch) ?? "0";

  function walk(current: Recipe, scale: string, depth: number, trail: Set<Id>) {
    const factor = decimalMul(scale, yieldFactor(current.yieldPercentage)) ?? "0";
    for (const line of current.lines) {
      const gross = decimalMul(decimalMul(line.quantity.value, wastageFactor(line.wastagePercentage)) ?? "0", factor) ?? "0";

      if (line.componentType === "sub_recipe") {
        const sub = context.recipes.get(line.componentId);
        if (!sub) {
          issues.push({ componentName: line.componentName, problem: "unresolved_sub" });
          continue;
        }
        if (trail.has(sub.id) || depth >= MAX_DEPTH) {
          issues.push({ componentName: line.componentName, problem: "cycle" });
          continue;
        }
        const inSubUnit = convert(gross, line.quantity.unit, sub.yieldQuantity.unit, null);
        const subYield = sub.yieldQuantity.value;
        if (!inSubUnit.ok || decimalCompare(subYield, "0") <= 0) {
          issues.push({ componentName: line.componentName, problem: inSubUnit.ok ? "invalid" : inSubUnit.reason });
          continue;
        }
        walk(sub, decimalDiv(inSubUnit.value, subYield) ?? "0", depth + 1, new Set([...trail, sub.id]));
        continue;
      }

      const item = context.items.get(line.componentId);
      if (!item) {
        issues.push({ componentName: line.componentName, problem: "no_item" });
        continue;
      }
      const inBase = convert(gross, line.quantity.unit, item.baseUnit, context.densities.get(item.id) ?? null);
      if (!inBase.ok) {
        issues.push({ componentName: line.componentName, problem: inBase.reason });
        continue;
      }
      const existing = totals.get(item.id);
      totals.set(item.id, {
        name: item.name,
        unit: item.baseUnit,
        required: decimalAdd(existing?.required ?? "0", inBase.value),
        optional: (existing?.optional ?? true) && line.isOptional,
      });
    }
  }

  walk(recipe, batches, 0, new Set([recipe.id]));

  const inputs = [...totals.entries()].map(([itemId, row]) => ({
    itemId,
    name: row.name,
    unit: row.unit,
    required: row.required,
    perBatch: decimalDiv(row.required, batches) ?? "0",
    optional: row.optional,
  }));
  return { batches, yieldPerBatch, inputs, issues, yieldProblem: null };
}

// ---------------------------------------------------------------------------
// Availability — FR-BRN-022
// ---------------------------------------------------------------------------

export interface AvailabilityRow extends RequiredInput {
  onHand: string;
  /** Positive when there is not enough; null when there is. */
  shortage: string | null;
}

export function checkAvailability(inputs: RequiredInput[], onHand: Map<Id, string>): AvailabilityRow[] {
  return inputs.map((input) => {
    const have = onHand.get(input.itemId) ?? "0";
    const gap = decimalSub(input.required, have);
    return { ...input, onHand: have, shortage: decimalCompare(gap, "0") > 0 ? gap : null };
  });
}

// ---------------------------------------------------------------------------
// Yield variance — FR-BRN-024
// ---------------------------------------------------------------------------

export interface YieldResult {
  /** What the inputs actually used should have made. */
  theoretical: string | null;
  /** Actual − theoretical. Negative is output lost. */
  variance: string | null;
  percent: number | null;
  /** The input that set the theoretical output — whichever ran shortest. */
  limitingItemId: Id | null;
}

/**
 * Yield Variance = Actual Output − Theoretical Output from Actual Inputs.
 *
 * "Theoretical output from actual inputs" is read as the output the recipe
 * says those inputs could make, which is set by the input that ran shortest
 * against its recipe proportion: using twice the salt does not make twice
 * the sauce. Optional inputs do not limit anything.
 */
export function yieldVariance(
  inputs: Pick<RequiredInput, "itemId" | "perBatch" | "optional">[],
  actual: Map<Id, string>,
  yieldPerBatch: string,
  actualOutput: string,
): YieldResult {
  let limiting: { itemId: Id; batches: string } | null = null;
  for (const input of inputs) {
    if (input.optional || decimalCompare(input.perBatch, "0") <= 0) continue;
    const batches = decimalDiv(actual.get(input.itemId) ?? "0", input.perBatch);
    if (batches === null) continue;
    if (!limiting || decimalCompare(batches, limiting.batches) < 0) {
      limiting = { itemId: input.itemId, batches };
    }
  }
  if (!limiting) return { theoretical: null, variance: null, percent: null, limitingItemId: null };

  const theoretical = decimalMul(limiting.batches, yieldPerBatch) ?? "0";
  const variance = decimalSub(actualOutput, theoretical);
  const percent = Number(theoretical) > 0 ? (Number(variance) / Number(theoretical)) * 100 : null;
  return { theoretical, variance, percent, limitingItemId: limiting.itemId };
}

// ---------------------------------------------------------------------------
// Output cost — FR-BRN-025
// ---------------------------------------------------------------------------

export type OverheadBasis = "per_unit" | "per_batch";

export interface Overhead {
  labourMinor: number;
  energyMinor: number;
  basis: OverheadBasis;
}

export interface ProductionCost {
  inputsMinor: number;
  overheadMinor: number;
  totalMinor: number;
  /** Minor units per base unit of output. Fractional — a gram of sauce costs less than a piastre. */
  perUnitMinor: number | null;
}

export function productionCost(
  inputs: { quantity: string; unitCostMinor: number }[],
  overhead: Overhead,
  actualOutput: string,
): ProductionCost {
  const output = Number(actualOutput);
  const inputsMinor = Math.round(inputs.reduce((sum, row) => sum + Number(row.quantity) * row.unitCostMinor, 0));
  const rate = overhead.labourMinor + overhead.energyMinor;
  const overheadMinor = Math.round(overhead.basis === "per_unit" ? rate * (output > 0 ? output : 0) : rate);
  const totalMinor = inputsMinor + overheadMinor;
  return {
    inputsMinor,
    overheadMinor,
    totalMinor,
    perUnitMinor: output > 0 ? totalMinor / output : null,
  };
}

// ---------------------------------------------------------------------------
// Production plan — FR-BRN-026
// ---------------------------------------------------------------------------

export interface BranchNeed {
  branchId: Id;
  onHand: string;
  par: string;
  need: string;
}

/**
 * What one branch is short of par. There is no forecasting service, so par
 * is the demand signal — the level each branch has said it wants to open on.
 */
export function branchNeed(onHand: string, par: string): string {
  const gap = decimalSub(par, onHand);
  return decimalCompare(gap, "0") > 0 ? gap : "0";
}

export function toProduce(needs: string[], kitchenOnHand: string): string {
  const gap = decimalSub(decimalAdd(...needs), decimalCompare(kitchenOnHand, "0") > 0 ? kitchenOnHand : "0");
  return decimalCompare(gap, "0") > 0 ? gap : "0";
}

// ---------------------------------------------------------------------------
// Allocation — FR-BRN-027 / FR-BRN-028
// ---------------------------------------------------------------------------

export type AllocationRule = "proportional" | "priority" | "manual";

export interface AllocationRequest {
  branchId: Id;
  requested: string;
  /** 1 is served first. */
  priority: number;
}

/** Whole pieces for count units; grams-of-a-kilo resolution for the rest. */
export function allocationStep(unit: UnitCode): number {
  return dimensionOf(unit) === "count" ? 1 : 1000;
}

function toSteps(value: string, perUnit: number): number {
  return Math.floor(Math.max(0, Number(value) || 0) * perUnit + 1e-9);
}

function fromSteps(steps: number, perUnit: number): string {
  return perUnit === 1 ? String(steps) : (steps / perUnit).toFixed(3).replace(/\.?0+$/, "") || "0";
}

/**
 * Share `available` among the requests.
 *
 * - **Proportional**: everyone gets the same fraction of what they asked
 *   for; the pieces left by rounding go to the largest remainders, ties to
 *   the higher priority. Nobody gets more than they asked for.
 * - **Priority**: served in priority order, each in full until it runs out.
 *
 * When there is enough for everyone, both rules give everyone what they
 * asked for. `manual` is not computed — the person types it — so it returns
 * the requests unchanged as a starting point.
 */
export function allocate(
  available: string,
  requests: AllocationRequest[],
  rule: AllocationRule,
  unit: UnitCode,
): Map<Id, string> {
  const perUnit = allocationStep(unit);
  const pool = toSteps(available, perUnit);
  const asked = requests.map((row) => ({ ...row, steps: toSteps(row.requested, perUnit) }));
  const totalAsked = asked.reduce((sum, row) => sum + row.steps, 0);
  const out = new Map<Id, string>();

  if (rule === "manual" || totalAsked <= pool) {
    for (const row of asked) out.set(row.branchId, fromSteps(Math.min(row.steps, rule === "manual" ? row.steps : pool), perUnit));
    return out;
  }

  if (rule === "priority") {
    let left = pool;
    for (const row of [...asked].sort((a, b) => a.priority - b.priority)) {
      const give = Math.min(row.steps, left);
      left -= give;
      out.set(row.branchId, fromSteps(give, perUnit));
    }
    return out;
  }

  // Proportional, largest remainder.
  const shares = asked.map((row) => {
    const exact = (row.steps * pool) / totalAsked;
    return { row, base: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = pool - shares.reduce((sum, share) => sum + share.base, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.row.priority - b.row.priority)) {
    if (left <= 0) break;
    if (share.base < share.row.steps) {
      share.base += 1;
      left -= 1;
    }
  }
  for (const share of shares) out.set(share.row.branchId, fromSteps(share.base, perUnit));
  return out;
}

/** Sum of allocations, and whether it fits what there is. */
export function allocationTotal(allocations: string[], available: string): { total: string; over: boolean } {
  const total = decimalAdd(...allocations);
  return { total, over: decimalCompare(total, available) > 0 };
}
