/**
 * How a modifier group behaves at the till — FR-MNU-011, FR-POS-023.
 *
 * The rules a group declares (min, max, required, repeat, free quantity) are
 * only as good as their combination: "required, max 0" or "min 3 of two
 * options without repeat" are groups nobody can ever satisfy, and the till
 * would block the line forever. `groupProblems` catches those before save;
 * `evaluateSelection` is what the simulator and the POS apply to a choice.
 */

import type { ModifierGroup } from "./types";

export interface GroupRules {
  minSelections: number;
  maxSelections: number;
  required: boolean;
  allowRepeat: boolean;
  freeQuantityThreshold: number | null;
}

export type RuleProblem =
  | "max_zero"
  | "min_above_max"
  | "required_needs_min"
  | "min_unreachable"
  | "max_unreachable"
  | "free_above_max"
  | "negative";

/** Everything that makes a group impossible or pointless to satisfy. */
export function groupProblems(rules: GroupRules, modifierCount: number): RuleProblem[] {
  const out: RuleProblem[] = [];
  const { minSelections: min, maxSelections: max } = rules;
  if (min < 0 || max < 0 || (rules.freeQuantityThreshold ?? 0) < 0) out.push("negative");
  if (max < 1) out.push("max_zero");
  if (min > max) out.push("min_above_max");
  if (rules.required && min < 1) out.push("required_needs_min");
  // Without repeat, each modifier counts once, so the group can never reach
  // more selections than it has modifiers.
  if (!rules.allowRepeat && modifierCount > 0 && min > modifierCount) out.push("min_unreachable");
  if (!rules.allowRepeat && modifierCount > 0 && max > modifierCount) out.push("max_unreachable");
  if (rules.freeQuantityThreshold !== null && rules.freeQuantityThreshold > max) out.push("free_above_max");
  return out;
}

export interface SelectionOutcome {
  count: number;
  satisfied: boolean;
  atMax: boolean;
  /** Minor units the guest pays for this group, after the free allowance. */
  charge: number;
  /** How many selections were free. */
  freeApplied: number;
}

/**
 * Price a selection. `picks` is in the order the guest chose — "first two
 * free, third charged" (FR-MNU-011) is about order, not about which option
 * is cheapest.
 */
export function evaluateSelection(
  group: Pick<ModifierGroup, "minSelections" | "maxSelections" | "freeQuantityThreshold">,
  picks: { priceMinor: number }[],
): SelectionOutcome {
  const free = group.freeQuantityThreshold ?? 0;
  let charge = 0;
  picks.forEach((pick, index) => {
    if (index >= free) charge += pick.priceMinor;
  });
  return {
    count: picks.length,
    satisfied: picks.length >= group.minSelections && picks.length <= group.maxSelections,
    atMax: picks.length >= group.maxSelections,
    charge,
    freeApplied: Math.min(free, picks.length),
  };
}

/** FR-POS-023 — nested groups to a depth of 2 below the item's own group. */
export const MAX_NESTING = 2;

/**
 * How deep a group's nesting goes: 0 when none of its modifiers open another
 * group. `children` maps a modifier id to the group it opens.
 */
export function nestingDepth(
  groupId: string,
  groups: Map<string, ModifierGroup>,
  children: Map<string, string>,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(groupId)) return Infinity; // a cycle is infinitely deep
  const group = groups.get(groupId);
  if (!group) return 0;
  const next = new Set(seen).add(groupId);
  let deepest = 0;
  for (const modifier of group.modifiers) {
    const child = children.get(modifier.id);
    if (child) deepest = Math.max(deepest, 1 + nestingDepth(child, groups, children, next));
  }
  return deepest;
}

/** Can this modifier open that group without a cycle or breaking the depth cap? */
export function canNest(
  parentGroupId: string,
  modifierId: string,
  childGroupId: string,
  groups: Map<string, ModifierGroup>,
  children: Map<string, string>,
): "ok" | "self" | "cycle" | "too_deep" {
  if (parentGroupId === childGroupId) return "self";
  const trial = new Map(children).set(modifierId, childGroupId);
  // Every group that can reach the parent must stay within the cap, and so
  // must the parent itself.
  for (const id of groups.keys()) {
    const depth = nestingDepth(id, groups, trial);
    if (depth === Infinity) return "cycle";
    if (depth > MAX_NESTING) return "too_deep";
  }
  return "ok";
}
