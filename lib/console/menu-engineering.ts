/**
 * Menu engineering — FR-MNU-055, FR-MNU-056, FR-MNU-057.
 *
 * The Kasavana–Smith matrix, computed from order lines rather than from a
 * pre-aggregated report, because FR-MNU-056 wants it cut by branch, by
 * day-part and by date range and no endpoint offers those cuts:
 *
 *   popularity  = an item's share of units sold, against (1 ÷ items) × factor
 *                 (factor 70% is the classic rule; 100% is "the plain average")
 *   profitability = an item's contribution margin per unit, against the
 *                 menu's weighted average margin per unit
 *
 *   Star          popular, profitable
 *   Plough-horse  popular, unprofitable
 *   Puzzle        unpopular, profitable
 *   Dog           unpopular, unprofitable
 *
 * Items whose cost is unknown are left unclassified — calling a dish a Star
 * on a zero cost is how menus lose their best-selling loss-makers.
 */

import type { Id, IsoDate, Localised, MenuClassification, Order, OrderLine } from "./types";

export interface DayPart {
  id: string;
  label: Localised;
  /** "HH:MM", inclusive. */
  start: string;
  /** "HH:MM", exclusive. Earlier than start runs past midnight. */
  end: string;
}

export const DEFAULT_DAY_PARTS: DayPart[] = [
  { id: "breakfast", label: { en: "Breakfast", ar: "الإفطار" }, start: "06:00", end: "11:00" },
  { id: "lunch", label: { en: "Lunch", ar: "الغداء" }, start: "11:00", end: "16:00" },
  { id: "dinner", label: { en: "Dinner", ar: "العشاء" }, start: "16:00", end: "22:00" },
  { id: "late", label: { en: "Late night", ar: "آخر الليل" }, start: "22:00", end: "06:00" },
];

function minutes(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export function inDayPart(part: DayPart, iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const at = date.getHours() * 60 + date.getMinutes();
  const start = minutes(part.start);
  const end = minutes(part.end);
  if (start === end) return true;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

const COUNTED_ORDER = new Set(["completed", "partially_refunded", "open", "partially_paid", "held", "parked"]);

export interface EngineeringFilter {
  from: IsoDate;
  to: IsoDate;
  branchId: Id | null;
  dayPart: DayPart | null;
}

/** The orders that belong to the cut. */
export function ordersInCut(orders: Order[], filter: EngineeringFilter): Order[] {
  return orders.filter(
    (order) =>
      COUNTED_ORDER.has(order.state) &&
      order.businessDay >= filter.from &&
      order.businessDay <= filter.to &&
      (!filter.branchId || order.branchId === filter.branchId) &&
      (!filter.dayPart || inDayPart(filter.dayPart, order.openedAt)),
  );
}

/**
 * Item revenue of one line, net of tax and discount, without its modifiers.
 *
 * Tax-inclusive lines carry the tax inside the subtotal (total = subtotal);
 * tax-exclusive lines add it on top (total > subtotal). Either way the
 * answer is the pre-tax item amount. A comp line earns nothing.
 */
export function lineItemRevenue(line: OrderLine): number {
  if (line.isComp) return 0;
  const subtotal = line.lineSubtotal.amount;
  const preTax = line.lineTotal.amount > subtotal ? subtotal : subtotal - line.taxAmount.amount;
  return Math.max(0, preTax - line.modifierTotal.amount);
}

export type EngineeringClass = MenuClassification | "unclassified";

export interface EngineeringRow {
  menuItemId: Id;
  name: Localised;
  units: number;
  revenue: number;
  /** Null when no cost is known for any unit sold. */
  cost: number | null;
  unitPrice: number;
  unitCost: number | null;
  unitMargin: number | null;
  totalMargin: number | null;
  mixShare: number;
  classification: EngineeringClass;
}

export interface EngineeringResult {
  rows: EngineeringRow[];
  orders: number;
  units: number;
  /** Weighted average contribution margin per unit, over costed items. */
  averageUnitMargin: number | null;
  /** The mix share an item needs to count as popular. */
  popularityThreshold: number;
  currency: string;
}

export function engineer(
  orders: Order[],
  options: {
    popularityFactor: number;
    /** Standard portion cost; null when unknown. */
    costOf: (line: OrderLine) => number | null;
  },
): EngineeringResult {
  const byItem = new Map<Id, { name: Localised; units: number; revenue: number; cost: number; costedUnits: number }>();
  let currency = "EGP";

  for (const order of orders) {
    currency = order.currency;
    for (const line of order.lines) {
      if (line.state === "voided") continue;
      const bucket = byItem.get(line.menuItemId) ?? { name: line.itemNameSnapshot, units: 0, revenue: 0, cost: 0, costedUnits: 0 };
      bucket.units += line.quantity;
      bucket.revenue += lineItemRevenue(line);
      const unitCost = options.costOf(line);
      if (unitCost !== null) {
        bucket.cost += unitCost * line.quantity;
        bucket.costedUnits += line.quantity;
      }
      byItem.set(line.menuItemId, bucket);
    }
  }

  const totalUnits = [...byItem.values()].reduce((sum, row) => sum + row.units, 0);
  const itemCount = byItem.size;
  const popularityThreshold = itemCount > 0 ? (1 / itemCount) * options.popularityFactor : 0;

  const rows: EngineeringRow[] = [...byItem.entries()].map(([menuItemId, bucket]) => {
    // Cost is only trusted when every unit was costed.
    const costed = bucket.costedUnits === bucket.units && bucket.units > 0;
    const unitPrice = bucket.units > 0 ? bucket.revenue / bucket.units : 0;
    const unitCost = costed ? bucket.cost / bucket.units : null;
    const unitMargin = unitCost === null ? null : unitPrice - unitCost;
    return {
      menuItemId,
      name: bucket.name,
      units: bucket.units,
      revenue: bucket.revenue,
      cost: costed ? bucket.cost : null,
      unitPrice,
      unitCost,
      unitMargin,
      totalMargin: unitMargin === null ? null : unitMargin * bucket.units,
      mixShare: totalUnits > 0 ? bucket.units / totalUnits : 0,
      classification: "unclassified",
    };
  });

  const costedRows = rows.filter((row) => row.totalMargin !== null);
  const costedUnits = costedRows.reduce((sum, row) => sum + row.units, 0);
  const averageUnitMargin =
    costedUnits > 0 ? costedRows.reduce((sum, row) => sum + (row.totalMargin ?? 0), 0) / costedUnits : null;

  for (const row of rows) {
    if (row.unitMargin === null || averageUnitMargin === null) continue;
    const popular = row.mixShare >= popularityThreshold;
    const profitable = row.unitMargin >= averageUnitMargin;
    row.classification = popular ? (profitable ? "star" : "plough_horse") : profitable ? "puzzle" : "dog";
  }

  rows.sort((a, b) => (b.totalMargin ?? -Infinity) - (a.totalMargin ?? -Infinity));
  return { rows, orders: orders.length, units: totalUnits, averageUnitMargin, popularityThreshold, currency };
}

// ---------------------------------------------------------------------------
// FR-MNU-057 — modifier attachment rates
// ---------------------------------------------------------------------------

export type ModifierSuggestion = "raise" | "introduce_charge" | "lower" | "review" | "hold";

export interface ModifierAttachRow {
  key: string;
  name: Localised;
  kind: string;
  /** Lines carrying the modifier. */
  attached: number;
  /** Lines of the items this modifier was sold with at least once. */
  eligible: number;
  rate: number;
  /** Average charged delta per attachment, minor units. */
  averageDelta: number;
  suggestion: ModifierSuggestion;
  /** Suggested delta, minor units, before any price-point rounding. */
  suggestedDelta: number | null;
}

export function modifierAttachRates(
  orders: Order[],
  options: { high: number; low: number; step: number; minimumEligible: number },
): { rows: ModifierAttachRow[]; linesWithModifiers: number; lines: number } {
  const itemLines = new Map<Id, number>();
  const modifiers = new Map<string, { name: Localised; kind: string; attached: number; delta: number; items: Set<Id> }>();
  let lines = 0;
  let linesWithModifiers = 0;

  for (const order of orders) {
    for (const line of order.lines) {
      if (line.state === "voided") continue;
      lines += 1;
      itemLines.set(line.menuItemId, (itemLines.get(line.menuItemId) ?? 0) + 1);
      if (line.modifiers.length > 0) linesWithModifiers += 1;
      const seen = new Set<string>();
      for (const modifier of line.modifiers) {
        const key = `${modifier.kind}:${(modifier.name.en || modifier.name.ar).trim().toLowerCase()}`;
        const bucket = modifiers.get(key) ?? { name: modifier.name, kind: modifier.kind, attached: 0, delta: 0, items: new Set<Id>() };
        if (!seen.has(key)) {
          bucket.attached += 1;
          seen.add(key);
        }
        bucket.delta += modifier.priceDelta.amount;
        bucket.items.add(line.menuItemId);
        modifiers.set(key, bucket);
      }
    }
  }

  const rows = [...modifiers.entries()].map(([key, bucket]): ModifierAttachRow => {
    const eligible = [...bucket.items].reduce((sum, itemId) => sum + (itemLines.get(itemId) ?? 0), 0);
    const rate = eligible > 0 ? bucket.attached / eligible : 0;
    const averageDelta = bucket.attached > 0 ? bucket.delta / bucket.attached : 0;
    let suggestion: ModifierSuggestion = "hold";
    let suggestedDelta: number | null = null;

    // A removal ("no onion") is an instruction, not a product; it has no price to tune.
    if (bucket.kind !== "removal" && eligible >= options.minimumEligible) {
      if (rate >= options.high) {
        suggestion = averageDelta > 0 ? "raise" : "introduce_charge";
        suggestedDelta = averageDelta > 0 ? Math.round(averageDelta * (1 + options.step)) : null;
      } else if (rate <= options.low) {
        suggestion = averageDelta > 0 ? "lower" : "review";
        suggestedDelta = averageDelta > 0 ? Math.round(averageDelta * (1 - options.step)) : null;
      }
    }

    return { key, name: bucket.name, kind: bucket.kind, attached: bucket.attached, eligible, rate, averageDelta, suggestion, suggestedDelta };
  });

  rows.sort((a, b) => b.rate - a.rate);
  return { rows, linesWithModifiers, lines };
}
