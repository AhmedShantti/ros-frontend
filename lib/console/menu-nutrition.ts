/**
 * Nutrition per portion — FR-MNU-050.
 *
 * Informational only and explicitly not certified: the figures are only as
 * good as the per-ingredient data somebody typed in, the cooking losses of
 * individual nutrients are ignored, and trim loss is treated as not eaten
 * (a recipe line's quantity is the usable amount; the wastage percentage is
 * what was bought on top of it). What this does get right is the plumbing —
 * units converted exactly (with density refused rather than guessed),
 * sub-recipes scaled by the share of their yield a line uses, and every
 * component that could not be counted listed by name, so "partial" is never
 * mistaken for "complete".
 */

import type { Id, Localised, Quantity, RecipeLine } from "./types";
import { NUTRIENTS, type Nutrient, type NutritionFacts } from "./services/menu-recipes";
import { convert as rawConvert, dimensionOf } from "./stock-units";

/** Units that arrive as unrecognised ids (live unit registry gaps) are refused, not thrown on. */
function convert(...args: Parameters<typeof rawConvert>): ReturnType<typeof rawConvert> {
  try {
    return rawConvert(...args);
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export interface RecipeNode {
  lines: RecipeLine[];
  yieldQuantity: Quantity;
}

export type MissingReason = "no_data" | "unit" | "sub_recipe" | "cycle";

export interface MissingComponent {
  componentId: Id;
  componentName: Localised;
  reason: MissingReason;
}

export interface NutritionResult {
  /** Totals for the whole recipe yield. */
  total: Record<Nutrient, number>;
  /** Totals ÷ portions. */
  perPortion: Record<Nutrient, number>;
  portions: number;
  /** Whether the yield is a count (portions) or a mass/volume batch. */
  yieldIsCount: boolean;
  /** Components that contributed nothing, and why. */
  missing: MissingComponent[];
  /** Per nutrient: components that had data but left this value blank. */
  blanks: Record<Nutrient, Localised[]>;
  coveredLines: number;
  totalLines: number;
}

function zero(): Record<Nutrient, number> {
  return Object.fromEntries(NUTRIENTS.map((key) => [key, 0])) as Record<Nutrient, number>;
}

function emptyBlanks(): Record<Nutrient, Localised[]> {
  return Object.fromEntries(NUTRIENTS.map((key) => [key, [] as Localised[]])) as Record<Nutrient, Localised[]>;
}

export function computeNutrition(
  root: RecipeNode,
  context: {
    tree: Map<Id, RecipeNode>;
    facts: Map<Id, NutritionFacts>;
    density: Map<Id, string | null>;
    rootId: Id;
  },
): NutritionResult {
  const missing: MissingComponent[] = [];
  const blanks = emptyBlanks();
  let coveredLines = 0;

  function walk(node: RecipeNode, scale: number, path: Set<Id>, top: boolean): Record<Nutrient, number> {
    const sum = zero();
    for (const line of node.lines) {
      const quantity = line.quantity.value || "0";
      let contribution: Record<Nutrient, number> | null = null;

      if (line.componentType === "stock_item") {
        const facts = context.facts.get(line.componentId);
        if (!facts) {
          if (top) missing.push({ componentId: line.componentId, componentName: line.componentName, reason: "no_data" });
          continue;
        }
        const converted = convert(quantity, line.quantity.unit, facts.basisUnit, context.density.get(line.componentId) ?? null);
        const basis = Number(facts.basisQuantity);
        if (!converted.ok || !(basis > 0)) {
          if (top) missing.push({ componentId: line.componentId, componentName: line.componentName, reason: "unit" });
          continue;
        }
        const factor = Number(converted.value) / basis;
        contribution = zero();
        for (const key of NUTRIENTS) {
          const raw = facts.values[key];
          if (raw === "" || raw === undefined) {
            if (top) blanks[key].push(line.componentName);
            continue;
          }
          contribution[key] = Number(raw) * factor;
        }
      } else {
        if (path.has(line.componentId)) {
          if (top) missing.push({ componentId: line.componentId, componentName: line.componentName, reason: "cycle" });
          continue;
        }
        const child = context.tree.get(line.componentId);
        const childYield = child ? Number(child.yieldQuantity.value) : 0;
        const converted = child ? convert(quantity, line.quantity.unit, child.yieldQuantity.unit, null) : null;
        if (!child || !(childYield > 0) || !converted?.ok) {
          if (top) missing.push({ componentId: line.componentId, componentName: line.componentName, reason: child ? "unit" : "sub_recipe" });
          continue;
        }
        const nextPath = new Set(path).add(line.componentId);
        contribution = walk(child, Number(converted.value) / childYield, nextPath, false);
      }

      if (top) coveredLines += 1;
      for (const key of NUTRIENTS) sum[key] += contribution[key];
    }
    for (const key of NUTRIENTS) sum[key] *= scale;
    return sum;
  }

  const total = walk(root, 1, new Set([context.rootId]), true);
  const yieldIsCount = dimensionOf(root.yieldQuantity.unit) === "count";
  const portions = yieldIsCount && Number(root.yieldQuantity.value) > 0 ? Number(root.yieldQuantity.value) : 1;
  const perPortion = zero();
  for (const key of NUTRIENTS) perPortion[key] = total[key] / portions;

  return { total, perPortion, portions, yieldIsCount, missing, blanks, coveredLines, totalLines: root.lines.length };
}
