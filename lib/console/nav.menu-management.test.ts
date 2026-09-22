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

  it("keeps every existing menu screen", () => {
    const hrefs = menu!.items.map((item) => item.href);
    for (const href of ["/menu/menus", "/menu/categories", "/menu/items", "/menu/modifiers", "/menu/combos", "/menu/pricing", "/menu/recipes"]) {
      expect(hrefs).toContain(href);
    }
  });
});
