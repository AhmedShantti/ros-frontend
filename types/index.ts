/**
 * Domain types — the public entry point.
 *
 * The definitions live in `lib/console/types.ts`, which predates this
 * directory. Rather than move 1,700 lines of type declarations and touch
 * every import in the tree, this barrel is the address the brief asks for
 * and the old path stays valid. New code should import from `@/types`.
 */

export type * from "@/lib/console/types";

export {
  ALL_PERMISSIONS,
  MFA_REQUIRED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_GROUPS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  ROLE_LIST,
  SOD_PAIRS,
  findSodConflicts,
  homeRouteForRole,
  permissionsForRole,
  roleRequiresMfa,
  surfacesForRole,
} from "@/lib/console/permissions";

// `PermissionKey` and `RoleKey` are deliberately absent: `lib/console/types`
// already re-exports both, and naming them twice is an ambiguous re-export.
export type {
  PermissionDefinition,
  PermissionGroup,
  RoleDefinition,
  SodPair,
  Surface,
} from "@/lib/console/permissions";
