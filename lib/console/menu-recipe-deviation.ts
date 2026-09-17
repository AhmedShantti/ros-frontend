/**
 * How a branch's recipe differs from the brand standard — FR-MNU-047.
 *
 * Compared component by component, keyed on what the component *is* (stock
 * item or sub-recipe, and its id), never on line order: re-sequencing a
 * recipe is not a deviation, swapping mozzarella for cheddar is.
 */

import type { Id, Localised, RecipeLine, UnitCode } from "./types";
import { convert as rawConvert } from "./stock-units";

/** Units that arrive as unrecognised ids (live unit registry gaps) are refused, not thrown on. */
function convert(...args: Parameters<typeof rawConvert>): ReturnType<typeof rawConvert> {
  try {
    return rawConvert(...args);
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export type DeviationKind = "added" | "removed" | "quantity" | "unit" | "wastage" | "optional";

export interface Deviation {
  key: string;
  componentId: Id;
  componentName: Localised;
  kinds: DeviationKind[];
  standard: RecipeLine | null;
  variant: RecipeLine | null;
  /** Relative quantity change, e.g. 0.25 for +25%. Null when not comparable. */
  quantityChange: number | null;
}

export interface DeviationSummary {
  deviations: Deviation[];
  added: number;
  removed: number;
  changed: number;
  /** Largest absolute relative quantity change among comparable lines. */
  maxQuantityChange: number | null;
}

function keyOf(line: RecipeLine): string {
  return `${line.componentType}:${line.componentId}`;
}

export function compareRecipes(standard: RecipeLine[], variant: RecipeLine[]): DeviationSummary {
  const left = new Map(standard.map((line) => [keyOf(line), line]));
  const right = new Map(variant.map((line) => [keyOf(line), line]));
  const keys = [...new Set([...left.keys(), ...right.keys()])];
  const deviations: Deviation[] = [];

  for (const key of keys) {
    const a = left.get(key) ?? null;
    const b = right.get(key) ?? null;
    const any = (a ?? b)!;
    const kinds: DeviationKind[] = [];
    let quantityChange: number | null = null;

    if (!a) kinds.push("added");
    else if (!b) kinds.push("removed");
    else {
      const converted = convert(b.quantity.value || "0", b.quantity.unit as UnitCode, a.quantity.unit as UnitCode, null);
      const base = Number(a.quantity.value || "0");
      if (converted.ok && base > 0) {
        quantityChange = (Number(converted.value) - base) / base;
        if (Math.abs(quantityChange) > 1e-9) kinds.push("quantity");
      } else if (a.quantity.unit !== b.quantity.unit) {
        kinds.push("unit");
      } else if (a.quantity.value !== b.quantity.value) {
        kinds.push("quantity");
      }
      if (Number(a.wastagePercentage) !== Number(b.wastagePercentage)) kinds.push("wastage");
      if (a.isOptional !== b.isOptional) kinds.push("optional");
    }

    if (kinds.length > 0) {
      deviations.push({ key, componentId: any.componentId, componentName: any.componentName, kinds, standard: a, variant: b, quantityChange });
    }
  }

  const comparable = deviations.map((row) => row.quantityChange).filter((value): value is number => value !== null);
  return {
    deviations,
    added: deviations.filter((row) => row.kinds.includes("added")).length,
    removed: deviations.filter((row) => row.kinds.includes("removed")).length,
    changed: deviations.filter((row) => !row.kinds.includes("added") && !row.kinds.includes("removed")).length,
    maxQuantityChange: comparable.length > 0 ? Math.max(...comparable.map(Math.abs)) : null,
  };
}
