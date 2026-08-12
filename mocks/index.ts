/**
 * Seed data — the world as it was at boot.
 *
 * Nothing in here changes. Everything the current shift moves lives in the
 * live store (`lib/console/live/`), which is seeded from these fixtures and
 * then owns its own state.
 *
 * Two rules apply to every module behind this barrel, and breaking either
 * one produces a hydration mismatch rather than a visible bug:
 *
 *   1. No `Math.random()`. Use the seeded generator in `mock/rng.ts`.
 *   2. No `Date.now()` or `new Date()` with no argument. Use the fixed
 *      anchor in `mock/clock.ts`.
 *
 * Pages must not import from here. They go through `@/services`.
 */

export * from "@/lib/console/mock/accounts";
export * from "@/lib/console/mock/clock";
export { createRng } from "@/lib/console/mock/rng";

export {
  ACTIVE_TENANT_ID,
  branches,
  brands,
  centralKitchens,
  tenants,
  warehouses,
} from "@/lib/console/mock/org";

export {
  buildSession,
  demoUserForRole,
  roleById,
  roleByKey,
  roles,
  userById,
  users,
} from "@/lib/console/mock/governance";
