import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./nav";
import { ROLE_DEFINITIONS } from "./permissions";

/*
 * TABLE-MANAGEMENT-AND-POS-OPEN-ORDERS-CORRECTION-P0
 *
 * Proves the "Console → Operations → Tables" navigation path an Owner or
 * Branch Manager actually needs exists and is reachable. This was never the
 * bug — the item is already correctly present and gated on a permission
 * both roles hold — the real gap was downstream, inside the page itself
 * (see `app/(console)/operations/tables/page.test.tsx`): Create/Edit was
 * gated on a permission (`ops.live.manage`) that existed nowhere, in this
 * catalogue or the backend, so nobody could ever manage a table once they
 * arrived. This test documents that the navigation half was never broken.
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
