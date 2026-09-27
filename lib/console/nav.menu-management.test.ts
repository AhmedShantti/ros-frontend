import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./nav";

/*
 * MENU-MANAGEMENT — the workspace is reachable from the Menu section, first
 * in the list, and every existing menu screen is still there beside it.
 */
describe("Console navigation — Menu > Menu Management", () => {
  const menu = NAV_SECTIONS.find((section) => section.id === "menu");

  it("lists Menu Management first in the Menu section", () => {
    expect(menu).toBeDefined();
    const first = menu!.items[0]!;
    expect(first.href).toBe("/menu/management");
    expect(first.labelKey).toBe("nav.menuManagement");
    expect(first.permissions).toEqual(["menu.item.read"]);
    expect(first.stub).not.toBe(true);
  });

  it("contains only Menu Management and Recipes — every legacy Menu screen was removed", () => {
    const hrefs = menu!.items.map((item) => item.href);
    expect(hrefs).toEqual(["/menu/management", "/menu/recipes"]);
    for (const href of ["/menu/menus", "/menu/categories", "/menu/items", "/menu/modifiers", "/menu/combos"]) {
      expect(hrefs).not.toContain(href);
    }
  });

  it("no longer offers a Price List workspace — pricing is direct, not a separate screen", () => {
    const hrefs = menu!.items.map((item) => item.href);
    expect(hrefs).not.toContain("/menu/pricing");
  });
});
