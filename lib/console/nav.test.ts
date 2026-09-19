import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./nav";
import { ROLE_DEFINITIONS } from "./permissions";

/*
 * TABLE-MANAGEMENT-AND-POS-OPEN-ORDERS-CORRECTION-P0,
 * TABLES-SIDEBAR-PRODUCTION-PERMISSION-CORRECTION-P0
 *
 * Proves the "Console → Operations → Tables" navigation path an Owner or
 * Branch Manager actually needs exists and is reachable via the
 * ROLE-HEURISTIC permission model (`ROLE_DEFINITIONS`, this catalogue's own
 * demo/fallback role→permission lists).
 *
 * This is deliberately NOT the whole story: the first pass at this task
 * concluded the nav item "was never broken" from exactly this kind of
 * heuristic-only check, which is what let the real production bug through
 * — the item's gate (`ops.live.view`, replaced by
 * `settings.branch.read`/`settings.branch.manage` under
 * TABLES-SIDEBAR-PRODUCTION-PERMISSION-CORRECTION-P0) was a string the real
 * backend never issues, so on a LIVE session (`useSession().can` trusting
 * `GET /auth/permissions`'s real granted set instead of this heuristic) it
 * was unconditionally invisible. See
 * `nav-live-permissions.test.tsx` for the test that actually proves
 * production visibility, against a simulated real granted-permission set,
 * not this file's role heuristic.
 *
 * The Create/Edit gap TABLE-MANAGEMENT-AND-POS-OPEN-ORDERS-CORRECTION-P0
 * fixed (`app/(console)/operations/tables/page.test.tsx`) — a permission,
 * `ops.live.manage`, that existed nowhere at all — is a separate,
 * already-fixed bug from this sidebar-visibility one.
 */
describe("Console navigation — Operations > Tables discoverability", () => {
  it("has a Tables item under the Operations section, pointing at /operations/tables", () => {
    const operations = NAV_SECTIONS.find((section) => section.id === "operations");
    expect(operations).toBeDefined();

    const tables = operations!.items.find((item) => item.href === "/operations/tables");
    expect(tables).toBeDefined();
    expect(tables!.stub).not.toBe(true);
    expect(tables!.external).not.toBe(true);
  });

  it("Owner and Branch Manager both hold every permission the Tables nav item requires", () => {
    const operations = NAV_SECTIONS.find((section) => section.id === "operations")!;
    const tables = operations.items.find((item) => item.href === "/operations/tables")!;

    for (const roleKey of ["owner", "branch_manager"] as const) {
      const granted = new Set(ROLE_DEFINITIONS[roleKey].permissions);
      const visible = tables.permissions.length === 0 || tables.permissions.some((p) => granted.has(p));
      expect(visible).toBe(true);
    }
  });
});
