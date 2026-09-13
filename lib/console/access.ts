/**
 * Effective access from role assignments — FR-SEC-002 … FR-SEC-005, FR-SEC-017.
 *
 * One place that answers "what can this person do today, and does that
 * combination break segregation of duties?" — used by the users screen, the
 * assignment editor and the population-wide SoD report, so the three cannot
 * disagree about whether an expired elevation still counts. (It does not.)
 */

import type { IsoDate, Role, RoleAssignment, User } from "./types";
import { SOD_PAIRS, type PermissionKey, type SodPair } from "./permissions";

export function todayIso(now = new Date()): IsoDate {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

export type AssignmentState = "permanent" | "active" | "expiring" | "scheduled" | "expired";

/** Where an assignment stands on a date. Both ends of the window are inclusive. */
export function assignmentState(assignment: RoleAssignment, today = todayIso()): AssignmentState {
  if (assignment.validFrom && assignment.validFrom > today) return "scheduled";
  if (assignment.validTo && assignment.validTo < today) return "expired";
  if (!assignment.validTo) return "permanent";
  const days = daysBetween(today, assignment.validTo);
  return days <= 3 ? "expiring" : "active";
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** FR-SEC-005 — an elevation that has lapsed grants nothing, automatically. */
export function isInForce(assignment: RoleAssignment, today = todayIso()): boolean {
  const state = assignmentState(assignment, today);
  return state !== "scheduled" && state !== "expired";
}

/**
 * The union of permissions across the assignments in force — FR-SEC-004.
 *
 * Scopes are not collapsed here: the union is what the SoD check needs,
 * because a person who can create purchase orders at one branch and approve
 * them at another still approves their own, whichever branch it lands at.
 */
export function effectivePermissions(
  assignments: RoleAssignment[],
  rolesById: Map<string, Role>,
  today = todayIso(),
): Set<PermissionKey> {
  const held = new Set<PermissionKey>();
  for (const assignment of assignments) {
    if (!isInForce(assignment, today)) continue;
    for (const permission of rolesById.get(assignment.roleId)?.permissions ?? []) held.add(permission);
  }
  return held;
}

export interface UserSodFinding {
  pair: SodPair;
  /** True when no single role grants both halves — the conflict is in the combination. */
  acrossRoles: boolean;
  /** The roles contributing each half. */
  fromA: string[];
  fromB: string[];
}

export function sodFindingsFor(
  assignments: RoleAssignment[],
  rolesById: Map<string, Role>,
  today = todayIso(),
): UserSodFinding[] {
  const inForce = assignments.filter((assignment) => isInForce(assignment, today));
  const holders = (permission: PermissionKey) =>
    inForce
      .filter((assignment) => rolesById.get(assignment.roleId)?.permissions.includes(permission))
      .map((assignment) => assignment.roleId);

  return SOD_PAIRS.flatMap((pair) => {
    const fromA = holders(pair.a);
    const fromB = holders(pair.b);
    if (fromA.length === 0 || fromB.length === 0) return [];
    const acrossRoles = !fromA.some((roleId) => fromB.includes(roleId));
    return [{ pair, acrossRoles, fromA: [...new Set(fromA)], fromB: [...new Set(fromB)] }];
  });
}

export function userSodFindings(user: User, rolesById: Map<string, Role>, today = todayIso()): UserSodFinding[] {
  return sodFindingsFor(user.assignments, rolesById, today);
}
