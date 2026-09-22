import { describe, expect, it } from "vitest";
import {
  channelPrice,
  comboBlockedSlots,
  comboPrice,
  comboRegularPrice,
  normalizeItem,
  priceSummary,
  ruleText,
} from "./menu";
import type { MmItem } from "./types";

/*
 * MENU-MANAGEMENT — the pricing rules the workspace shows on every row, in
 * the editor summaries and in the customer preview.
 */

const item = (patch: Partial<MmItem>): MmItem => normalizeItem({ id: 1, name: "Item", price: 10, ...patch });

describe("menu-management pricing", () => {
  it("uses the base price on every channel for a single-price item", () => {
    const burger = item({ price: 12 });
    expect(channelPrice(burger, "dineIn")).toBe(12);
    expect(channelPrice(burger, "delivery")).toBe(12);
  });

  it("uses a channel override only where one is set", () => {
    const burger = item({ pricingMode: "channel", price: 12, channelPrices: { takeaway: null, delivery: 13.5 } });
    expect(channelPrice(burger, "dineIn")).toBe(12);
    expect(channelPrice(burger, "takeaway")).toBe(12);
    expect(channelPrice(burger, "delivery")).toBe(13.5);
    expect(priceSummary(burger).sub).toBe("+1 channel price");
  });

  it("prices a sized item by its cheapest size", () => {
    const pizza = item({ pricingMode: "size", sizes: [{ id: "s1", name: "Small", price: 9 }, { id: "s2", name: "Large", price: 14 }] });
    expect(channelPrice(pizza)).toBe(9);
    expect(priceSummary(pizza).sub).toBe("2 sizes");
    expect(priceSummary(pizza).main).toContain("From");
  });

  it("describes customization rules", () => {
    expect(ruleText({ required: false, multiple: false, maxSelections: null })).toBe("Optional · choose 1");
    expect(ruleText({ required: true, multiple: true, maxSelections: 2 })).toBe("Required · up to 2");
    expect(ruleText({ required: false, multiple: true, maxSelections: "" })).toBe("Optional · any number");
  });
});

describe("menu-management combos", () => {
  const index = {
    "1": item({ id: 1, price: 12 }),
    "2": item({ id: 2, price: 3, status: "unavailable" }),
    "3": item({ id: 3, price: 2.5 }),
  };
  const slots = [
    { id: "a", label: "Main", itemIds: [1] },
    { id: "b", label: "Drink", itemIds: [2, 3] },
  ];

  it("sums the default (first) choice of each part", () => {
    expect(comboRegularPrice({ slots }, index)).toBe(15);
  });

  it("applies a fixed price or a percentage discount", () => {
    expect(comboPrice({ slots, pricing: "fixed", price: 13, discountPercent: null }, index)).toBe(13);
    expect(comboPrice({ slots, pricing: "discount", price: null, discountPercent: 20 }, index)).toBe(12);
  });

  it("flags a part with no available item", () => {
    expect(comboBlockedSlots({ slots }, index)).toHaveLength(0);
    const soldOutDrink = [{ id: "b", label: "Drink", itemIds: [2] }];
    expect(comboBlockedSlots({ slots: soldOutDrink }, index).map((s) => s.label)).toEqual(["Drink"]);
  });
});
