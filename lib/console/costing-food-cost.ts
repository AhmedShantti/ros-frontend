/**
 * Food cost % by dimension — FR-CST-003, FR-CST-004.
 *
 * Pure. Given orders (with their lines), it cuts COGS ÷ net sales by item,
 * category, branch, brand, day-part, order type, inside a business-day range.
 *
 * ## Cost is the snapshot, never today's recipe cost (FR-CST-002)
 *
 * Every figure here reads `OrderLine.unitCostSnapshot` — the cost frozen on
 * the line when it was sold. Nothing looks up the current recipe or the
 * current ingredient price, so a supplier price rise next month cannot
 * rewrite last month's food cost.
 *
 * The snapshot is not stored with one meaning everywhere yet: the backend
 * wire field is per unit (the http mapper multiplies it by quantity), while
 * the in-browser demo engine stores the line's total. `snapshotIsLineTotal`
 * says which one the caller is holding, rather than this module guessing.
 *
 * ## Net sales at line level
 *
 * FR-CST-003 defines net sales as gross − discounts − refunds − tax. A line
 * carries its own discount and tax; order-level discounts and refunds are
 * spread across the order's lines in proportion to their billable value, so
 * the lines of one order always add back up to the order's net.
 */

import type { Branch, Currency, Id, Localised, Order, OrderLine, OrderType } from "./types";

export type FoodCostDimension =
  | "item"
  | "category"
  | "branch"
  | "brand"
  | "dayPart"
  | "orderType";

/**
 * The day-part bands, by local hour of the order opening in the branch's
 * own time zone. Stated here once so the screen can print them.
 */
export type DayPart = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";

export const DAY_PARTS: { id: DayPart; from: number; to: number; label: Localised }[] = [
  { id: "breakfast", from: 5, to: 11, label: { en: "Breakfast (05:00–11:00)", ar: "الإفطار (05:00–11:00)" } },
  { id: "lunch", from: 11, to: 15, label: { en: "Lunch (11:00–15:00)", ar: "الغداء (11:00–15:00)" } },
  { id: "afternoon", from: 15, to: 18, label: { en: "Afternoon (15:00–18:00)", ar: "العصر (15:00–18:00)" } },
  { id: "dinner", from: 18, to: 22, label: { en: "Dinner (18:00–22:00)", ar: "العشاء (18:00–22:00)" } },
  { id: "late", from: 22, to: 5, label: { en: "Late night (22:00–05:00)", ar: "آخر الليل (22:00–05:00)" } },
];

export function dayPartOfHour(hour: number): DayPart {
  for (const part of DAY_PARTS) {
    if (part.from < part.to ? hour >= part.from && hour < part.to : hour >= part.from || hour < part.to) {
      return part.id;
    }
  }
  return "late";
}

/** Local hour in the branch's time zone; falls back to the viewer's. */
export function localHour(iso: string, timeZone?: string | null): number {
  const date = new Date(iso);
  if (timeZone) {
    try {
      const text = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(date);
      const hour = Number(text);
      if (Number.isFinite(hour)) return hour % 24;
    } catch {
      // Unknown zone — fall through to the viewer's clock.
    }
  }
  return date.getHours();
}

export interface FoodCostContext {
  branches: Map<Id, Branch>;
  brandNames: Map<Id, Localised>;
  /** menuItemId → category id and name. */
  itemCategory: Map<Id, { id: Id; name: Localised }>;
  /** See the module note — the demo engine stores a line total. */
  snapshotIsLineTotal: boolean;
  from: string | null;
  to: string | null;
}

export interface FoodCostBreakdownRow {
  key: string;
  label: Localised;
  netSales: number;
  cogs: number;
  foodCostPercent: number | null;
  units: number;
  orders: number;
  /** Lines counted whose snapshot was zero — usually an item with no recipe. */
  uncostedLines: number;
}

export interface FoodCostBreakdown {
  rows: FoodCostBreakdownRow[];
  currency: Currency;
  netSales: number;
  cogs: number;
  foodCostPercent: number | null;
  ordersUsed: number;
  ordersWithoutLines: number;
}

const COUNTED_STATES = new Set<Order["state"]>(["completed", "partially_refunded", "refunded"]);

/** FR-CST-002 — cost as frozen on the line at sale time. */
export function lineCostSnapshot(line: OrderLine, snapshotIsLineTotal: boolean): number {
  const amount = line.unitCostSnapshot?.amount ?? 0;
  return snapshotIsLineTotal ? amount : amount * line.quantity;
}

function refundedOf(order: Order): number {
  return order.payments
    .filter((payment) => payment.amount.amount < 0)
    .reduce((total, payment) => total + Math.abs(payment.amount.amount), 0);
}

/**
 * Whether the order's prices already contained the tax. Read from the
 * order's own totals: inclusive orders' grand total does not add tax on top.
 */
function taxInclusive(order: Order): boolean {
  const base =
    order.subtotal.amount - order.discountTotal.amount + order.serviceChargeTotal.amount + order.roundingAdjustment.amount;
  return Math.abs(order.grandTotal.amount - base) <= Math.abs(order.grandTotal.amount - (base + order.taxTotal.amount));
}

const ORDER_TYPE_LABEL: Record<OrderType, Localised> = {
  dine_in: { en: "Dine-in", ar: "داخل المطعم" },
  takeaway: { en: "Takeaway", ar: "سفري" },
  delivery: { en: "Delivery", ar: "توصيل" },
  drive_thru: { en: "Drive-through", ar: "خدمة السيارات" },
  pickup: { en: "Pickup", ar: "استلام" },
  aggregator: { en: "Aggregator", ar: "منصات التوصيل" },
};

const UNKNOWN: Localised = { en: "Unassigned", ar: "غير محدد" };

export function foodCostBreakdown(
  orders: Order[],
  dimension: FoodCostDimension,
  context: FoodCostContext,
): FoodCostBreakdown {
  const groups = new Map<string, FoodCostBreakdownRow & { orderIds: Set<Id> }>();
  let ordersUsed = 0;
  let ordersWithoutLines = 0;
  const currency = orders[0]?.currency ?? "EGP";

  for (const order of orders) {
    if (!COUNTED_STATES.has(order.state)) continue;
    if (context.from && order.businessDay < context.from) continue;
    if (context.to && order.businessDay > context.to) continue;
    const lines = order.lines.filter((line) => line.state !== "voided");
    if (lines.length === 0) {
      ordersWithoutLines += 1;
      continue;
    }
    ordersUsed += 1;

    const inclusive = taxInclusive(order);
    const billable = lines.map((line) => Math.max(0, line.lineTotal.amount - (inclusive ? line.taxAmount.amount : 0)));
    const billableTotal = billable.reduce((a, b) => a + b, 0);
    // Order-level discount (beyond the line discounts) and refunds, spread by value.
    const lineDiscounts = lines.reduce((sum, line) => sum + line.lineDiscount.amount, 0);
    const orderLevelDiscount = Math.max(0, order.discountTotal.amount - lineDiscounts);
    const deductions = orderLevelDiscount + refundedOf(order);

    const branch = context.branches.get(order.branchId);
    const hour = localHour(order.openedAt, branch?.timezone);

    lines.forEach((line, index) => {
      const share = billableTotal === 0 ? 0 : billable[index]! / billableTotal;
      const net = Math.max(0, billable[index]! - deductions * share);
      const cost = lineCostSnapshot(line, context.snapshotIsLineTotal);

      let key: string;
      let label: Localised;
      switch (dimension) {
        case "item":
          key = line.menuItemId;
          label = line.itemNameSnapshot;
          break;
        case "category": {
          const category = context.itemCategory.get(line.menuItemId);
          key = category?.id ?? "unknown";
          label = category?.name ?? UNKNOWN;
          break;
        }
        case "branch":
          key = order.branchId;
          label = order.branchName;
          break;
        case "brand": {
          const brandId = branch?.brandId ?? "unknown";
          key = brandId;
          label = context.brandNames.get(brandId) ?? UNKNOWN;
          break;
        }
        case "dayPart": {
          const part = dayPartOfHour(hour);
          key = part;
          label = DAY_PARTS.find((row) => row.id === part)!.label;
          break;
        }
        default:
          key = order.orderType;
          label = ORDER_TYPE_LABEL[order.orderType] ?? UNKNOWN;
      }

      const entry =
        groups.get(key) ??
        { key, label, netSales: 0, cogs: 0, foodCostPercent: null, units: 0, orders: 0, uncostedLines: 0, orderIds: new Set<Id>() };
      entry.netSales += net;
      entry.cogs += cost;
      entry.units += line.quantity;
      if (cost === 0) entry.uncostedLines += 1;
      entry.orderIds.add(order.id);
      groups.set(key, entry);
    });
  }

  const rows = [...groups.values()]
    .map(({ orderIds, ...row }) => ({
      ...row,
      netSales: Math.round(row.netSales),
      cogs: Math.round(row.cogs),
      orders: orderIds.size,
      foodCostPercent: row.netSales > 0 ? (row.cogs / row.netSales) * 100 : null,
    }))
    .sort((a, b) => (b.foodCostPercent ?? -1) - (a.foodCostPercent ?? -1));

  const netSales = rows.reduce((sum, row) => sum + row.netSales, 0);
  const cogs = rows.reduce((sum, row) => sum + row.cogs, 0);

  return {
    rows,
    currency,
    netSales,
    cogs,
    // Weighted by sales — never a mean of the row percentages.
    foodCostPercent: netSales > 0 ? (cogs / netSales) * 100 : null,
    ordersUsed,
    ordersWithoutLines,
  };
}
