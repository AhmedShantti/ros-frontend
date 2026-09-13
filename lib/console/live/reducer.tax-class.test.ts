import { describe, expect, it } from "vitest";
import { liveReducer } from "./reducer";
import { initialLiveState } from "./state";
import { menuItems, menuItemById, DEMO_ZERO_TAX_CLASS_CODE } from "../mock/catalogue";
import { activeEmployees } from "../mock/workforce";
import type { MenuItem } from "../types";

/*
 * DEMO-TAX-CLASS-TEMPORARY-UNBLOCK — proves the demo "Test — Zero Tax"
 * class unblocks POS testing for demo items that shipped with no tax class,
 * without weakening FR-MNU-004 for anything else:
 *
 *  - a demo item formerly missing a tax class is sellable and taxes at 0
 *  - an item that already has a real tax class is untouched
 *  - a menu item that is still genuinely missing a tax class (outside the
 *    demo assignment) remains blocked from ever reaching an order
 */

const AT = "2026-01-01T10:00:00.000Z";

function openOrder() {
  const employee = activeEmployees[0]!;
  let state = liveReducer(initialLiveState(), {
    type: "SHIFT_OPEN",
    at: AT,
    employeeId: employee.id,
    openingFloatMinor: 100_000,
  });
  state = liveReducer(state, {
    type: "ORDER_NEW",
    at: AT,
    orderType: "dine_in",
    tableId: null,
    guestCount: 2,
  });
  const orderId = state.activeOrderId!;
  return { state, orderId };
}

function addLine(state: ReturnType<typeof initialLiveState>, orderId: string, item: MenuItem) {
  return liveReducer(state, {
    type: "LINE_ADD",
    at: AT,
    orderId,
    menuItemId: item.id,
    variantId: item.variants[0]!.id,
    quantity: 1,
    modifierIds: [],
    course: 1,
    seatNumber: null,
    notes: null,
  });
}

describe("DEMO-TAX-CLASS-TEMPORARY-UNBLOCK", () => {
  it("assigns the demo zero-rate class only to demo items that had no tax class", () => {
    const demoItem = menuItems.find((m) => m.name.en === "Tax test item (demo)");
    expect(demoItem).toBeDefined();
    expect(demoItem!.taxClassId).toBe(DEMO_ZERO_TAX_CLASS_CODE);
  });

  it("leaves an item that already has a real tax class untouched", () => {
    const realItem = menuItems.find((m) => m.name.en === "Chicken shawarma sandwich");
    expect(realItem).toBeDefined();
    expect(realItem!.taxClassId).toBe("standard");
  });

  it("a demo item formerly missing a tax class is sellable: order add succeeds and tax computes as 0", () => {
    const demoItem = menuItems.find((m) => m.name.en === "Tax test item (demo)")!;
    const { state, orderId } = openOrder();

    const next = addLine(state, orderId, demoItem);
    const order = next.orders[orderId]!;

    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]!.menuItemId).toBe(demoItem.id);
    expect(order.lines[0]!.taxAmount.amount).toBe(0);
  });

  it("a menu item genuinely missing a tax class (outside the demo assignment) still fails closed", () => {
    // A hand-built item standing in for "genuinely missing," bypassing the
    // demo seed's assignment entirely — the exact case FR-MNU-004 must
    // still refuse, on or off the demo path.
    const blocked: MenuItem = {
      ...menuItems[0]!,
      id: "mit_test_no_tax_class",
      taxClassId: null,
    };
    menuItemById.set(blocked.id, blocked);
    try {
      const { state, orderId } = openOrder();
      const next = addLine(state, orderId, blocked);
      const order = next.orders[orderId]!;

      expect(order.lines).toHaveLength(0);
    } finally {
      menuItemById.delete(blocked.id);
    }
  });
});
