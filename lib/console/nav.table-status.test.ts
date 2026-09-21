import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./nav";

/*
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — nav wiring.
 *
 * "Table status" (live occupancy, `GET /orders/tables/status`) and "Tables"
 * (Organisation table SETUP, `/org/branches/{id}/tables`) are two different
 * screens behind two different permissions. The live one is gated on the real
 * back-office order grant its route requires, and never on the
 * `settings.branch.*` codes the setup page uses.
 */

const operations = () => NAV_SECTIONS.find((group) => group.id === "operations")!.items;

describe("nav — Operations > Table status", () => {
  it("has a Table status item pointing at /operations/table-status, gated on pos.order.view_history ONLY", () => {
    const item = operations().find((i) => i.href === "/operations/table-status");

    expect(item).toBeDefined();
    expect(item!.labelKey).toBe("nav.tableStatus");
    expect(item!.permissions).toEqual(["pos.order.view_history"]);
    expect(item!.stub).not.toBe(true);
    expect(item!.external).not.toBe(true);
  });

  it("does not borrow the table-setup permissions (settings.branch.read / manage)", () => {
    const item = operations().find((i) => i.href === "/operations/table-status")!;
    expect(item.permissions).not.toContain("settings.branch.read");
    expect(item.permissions).not.toContain("settings.branch.manage");
  });

  it("the setup page keeps its own item and permissions, relabelled 'Tables'", () => {
    const setup = operations().find((i) => i.href === "/operations/tables")!;

    expect(setup.labelKey).toBe("nav.tables");
    expect(setup.permissions).toEqual(["settings.branch.read", "settings.branch.manage"]);
  });
});
