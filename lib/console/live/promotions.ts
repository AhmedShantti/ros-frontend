/**
 * Promotions at the till — FR-CRM-025 … FR-CRM-030 on the simulator.
 *
 * The console authors promotions; this module is how they reach an order.
 * It does not evaluate anything itself: every decision about whether a
 * promotion applies and what it is worth is `evaluatePromotions` in
 * `../crm-promotion-engine`, the one function the console's simulator also
 * calls (FR-CRM-027). What lives here is the plumbing either side of it:
 *
 *   - building the engine's cart from an order, with the sale time taken
 *     from the order (never the clock) in the branch's own timezone;
 *   - counting past redemptions: the ones the CRM service has recorded, plus
 *     sales this till has closed but not yet reported (FR-CRM-026 must hold
 *     while that write is still in flight, or offline);
 *   - turning the engine's per-line allocations into discount records the
 *     existing FR-POS-045/049 machinery already totals, taxes and reports;
 *   - deciding, through the same `resolveStacking` a manual discount goes
 *     through, whether the promotions or a manual discount win (FR-POS-051,
 *     FR-CRM-030).
 *
 * Pure: the reducer calls `reconcilePromotions` after every action.
 */

import type { Id, IsoDateTime, Localised, Order, OrderDiscount, OrderLine, Promotion } from "../types";
import {
  evaluatePromotions,
  type AppliedPromotion,
  type PromotionCart,
  type PromotionRedemption,
  type RejectionReason,
} from "../crm-promotion-engine";
import type { EarnInput } from "../loyalty-earn";
import { money } from "../format";
import { resolveStacking, type StackingPolicy } from "./engine";

/** A mirror of the CRM service's promotions and redemptions, synced in. */
export interface PromotionBook {
  promotions: Promotion[];
  redemptions: (PromotionRedemption & { orderId: Id | null })[];
  syncedAt: IsoDateTime | null;
}

export const EMPTY_PROMOTION_BOOK: PromotionBook = { promotions: [], redemptions: [], syncedAt: null };

/** Why a promotion that applied to this order earlier no longer does. */
export type LapseReason = RejectionReason | "manual_discount" | "declined";

export interface OrderPromotionState {
  /** The attached customer's profile, as far as the engine needs it. */
  customer: PromotionCart["customer"];
  /** FR-CRM-028 — coupons validated at the till for this order. */
  coupons: { code: string; promotionId: Id }[];
  /** Promotions the cashier took off this order. */
  declined: Id[];
  /** The sale time the engine was given, `YYYY-MM-DDTHH:MM`. */
  at: string;
  /** What is in force: discounts and the points multiplier. */
  applied: AppliedPromotion[];
  rejected: { promotionId: Id; reason: RejectionReason }[];
  /** FR-POS-051 — a manual discount worth more holds the promotions off. */
  blockedByManual: boolean;
  /** Every promotion that has applied to this order at some point. */
  everApplied: Id[];
  pointsMultiplier: number;
  /** FR-CRM-026 — when the redemptions were recorded with the CRM service. */
  redeemedAt: IsoDateTime | null;
  /** FR-CRM-016 — when loyalty earning was posted for this sale. */
  earnedAt: IsoDateTime | null;
}

export function emptyOrderPromotionState(): OrderPromotionState {
  return {
    customer: null,
    coupons: [],
    declined: [],
    at: "",
    applied: [],
    rejected: [],
    blockedByManual: false,
    everApplied: [],
    pointsMultiplier: 1,
    redeemedAt: null,
    earnedAt: null,
  };
}

const PRESET_PREFIX = "promotion:";

export function isPromotionDiscount(record: OrderDiscount): boolean {
  return typeof record.presetId === "string" && record.presetId.startsWith(PRESET_PREFIX);
}

export function promotionIdOf(record: OrderDiscount): Id | null {
  return isPromotionDiscount(record) ? record.presetId!.slice(PRESET_PREFIX.length) : null;
}

const ENGINE_ACTOR: Localised = { en: "Promotion engine", ar: "محرك العروض" };

/** `YYYY-MM-DDTHH:MM` in the branch's timezone — the engine's sale time. */
export function saleTimeOf(iso: IsoDateTime, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function unitGross(line: OrderLine): number {
  return line.unitPrice.amount + line.modifiers.reduce((sum, m) => sum + m.priceDelta.amount, 0);
}

/** Lines that can carry a promotion: sold, not voided, not comped. */
function promotableLines(order: Order): OrderLine[] {
  return order.lines.filter((line) => line.state !== "voided" && !line.isComp && line.quantity > 0);
}

export function promotionCartOf(
  order: Order,
  context: OrderPromotionState,
  input: { at: string; categoryOf: (menuItemId: Id) => Id | null },
): PromotionCart {
  return {
    at: input.at,
    branchId: order.branchId,
    orderType: order.orderType,
    channel: order.channel,
    lines: promotableLines(order).map((line) => ({
      lineId: line.id,
      itemId: line.menuItemId,
      categoryId: input.categoryOf(line.menuItemId),
      quantity: line.quantity,
      unitPriceMinor: unitGross(line),
    })),
    // A profile loaded for a customer since detached is not this order's.
    customer: context.customer && context.customer.id === order.customerId ? context.customer : null,
    couponPromotionIds: context.coupons.map((c) => c.promotionId),
    // The simulator has no delivery fee, so free delivery has nothing to take.
    deliveryFeeMinor: 0,
  };
}

/**
 * FR-CRM-026 — past redemptions for the limits: the service's, plus closed
 * sales on this till whose redemptions have not been recorded there yet.
 */
export function redemptionsFor(
  book: PromotionBook,
  orders: Record<Id, Order>,
  contexts: Record<Id, OrderPromotionState>,
): PromotionRedemption[] {
  const recorded = new Set(book.redemptions.map((r) => `${r.orderId ?? ""}|${r.promotionId}`));
  const rows: PromotionRedemption[] = book.redemptions.map(({ promotionId, customerId, day }) => ({
    promotionId,
    customerId,
    day,
  }));
  for (const [orderId, context] of Object.entries(contexts)) {
    const order = orders[orderId];
    // Counted until the mirror carries the service's own row for it, whether
    // or not this till has finished recording it — never zero, never twice.
    if (!order || order.state !== "completed") continue;
    for (const applied of context.applied) {
      if (recorded.has(`${orderId}|${applied.promotionId}`)) continue;
      rows.push({ promotionId: applied.promotionId, customerId: order.customerId, day: context.at.slice(0, 10) });
    }
  }
  return rows;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Re-evaluates one order and brings its promotion discount records into line.
 *
 * Records are keyed by promotion and line and reused, so re-evaluating an
 * unchanged order changes nothing, and a promotion that lapses and comes
 * back revives its record rather than piling up new ones. A record that
 * stops applying is marked removed with the engine's reason, never deleted
 * (FR-POS-049). Returns null when nothing changed.
 */
export function reconcileOrderPromotions(
  order: Order,
  previous: OrderPromotionState | undefined,
  input: {
    at: IsoDateTime;
    saleTime: string;
    book: PromotionBook;
    redemptions: PromotionRedemption[];
    policy: StackingPolicy;
    categoryOf: (menuItemId: Id) => Id | null;
  },
): { order: Order; context: OrderPromotionState } | null {
  const base = previous ?? emptyOrderPromotionState();
  // A sale time fixed at the first evaluation: the order is judged as of
  // when it was opened, so a later action cannot move it out of a window.
  const saleTime = base.at || input.saleTime;
  const context: OrderPromotionState = { ...base, at: saleTime };
  const cart = promotionCartOf(order, context, { at: saleTime, categoryOf: input.categoryOf });

  // FR-CRM-027 — the one evaluation. Declined promotions are not offered.
  const offered = input.book.promotions.filter((p) => !context.declined.includes(p.id));
  let result: ReturnType<typeof evaluatePromotions>;
  try {
    result = evaluatePromotions(offered, cart, input.redemptions);
  } catch {
    // A malformed promotion in the mirror must never take the till down;
    // the order keeps whatever it last had until the mirror is fixed.
    return null;
  }

  const byId = new Map(input.book.promotions.map((p) => [p.id, p]));
  const discounts = result.applied.filter((a) => a.pointsMultiplier === null && a.discountMinor > 0);
  const multipliers = result.applied.filter((a) => a.pointsMultiplier !== null);

  // FR-POS-051 / FR-CRM-030 — the promotions, taken together, are one
  // candidate against the manual discounts, judged exactly as a manual one is.
  const manual = order.discounts.filter((d) => !isPromotionDiscount(d) && isActive(order, d));
  const promoValue = discounts.reduce((sum, a) => sum + a.discountMinor, 0);
  const exclusive = discounts.some((a) => !byId.get(a.promotionId)?.stackable);
  const verdict =
    promoValue > 0
      ? resolveStacking(
          manual.map((d) => ({ id: d.id, amountMinor: d.amount.amount, exclusive: d.exclusive === true })),
          { amountMinor: promoValue, exclusive },
          input.policy,
        )
      : null;
  const blockedByManual = verdict?.outcome === "keep_existing";
  const superseded = new Set(verdict?.outcome === "replace" ? verdict.conflictIds : []);
  const effective = blockedByManual ? multipliers : [...discounts, ...multipliers];

  // Wanted records, keyed by promotion and line.
  const liveLineIds = new Set(promotableLines(order).map((l) => l.id));
  const wanted = new Map<string, { promotionId: Id; lineId: Id; amountMinor: number }>();
  if (!blockedByManual) {
    for (const applied of discounts) {
      for (const share of applied.allocations) {
        if (!liveLineIds.has(share.lineId) || share.discountMinor <= 0) continue;
        wanted.set(`${applied.promotionId}|${share.lineId}`, {
          promotionId: applied.promotionId,
          lineId: share.lineId,
          amountMinor: share.discountMinor,
        });
      }
    }
  }

  const reasonFor = (promotionId: Id): LapseReason =>
    context.declined.includes(promotionId)
      ? "declined"
      : blockedByManual && discounts.some((a) => a.promotionId === promotionId)
        ? "manual_discount"
        : (result.rejected.find((r) => r.promotionId === promotionId)?.reason ?? "inactive");

  const seen = new Set<string>();
  const nextDiscounts: OrderDiscount[] = order.discounts.map((record) => {
    if (superseded.has(record.id)) {
      return { ...record, removedAt: input.at, removedReason: "Superseded by a promotion worth more (FR-POS-051)" };
    }
    const promotionId = promotionIdOf(record);
    if (!promotionId || !record.lineId) return record;
    const key = `${promotionId}|${record.lineId}`;
    const want = seen.has(key) ? undefined : wanted.get(key);
    seen.add(key);
    const promotion = byId.get(promotionId);
    if (want) {
      const next: OrderDiscount = {
        ...record,
        reason: promotion?.name ?? record.reason,
        amount: money(want.amountMinor, order.currency),
        exclusive: promotion ? !promotion.stackable : record.exclusive,
        removedAt: null,
        removedReason: null,
      };
      return sameJson(next, record) ? record : next;
    }
    if (record.removedAt) return record;
    return { ...record, removedAt: input.at, removedReason: `Promotion no longer applies: ${reasonFor(promotionId)} (FR-CRM-027)` };
  });

  for (const [key, want] of wanted) {
    if (seen.has(key)) continue;
    const promotion = byId.get(want.promotionId);
    nextDiscounts.push({
      id: `${order.id}:promo:${want.promotionId}:${want.lineId}`,
      reason: promotion?.name ?? { en: want.promotionId, ar: want.promotionId },
      percentage: null,
      amount: money(want.amountMinor, order.currency),
      appliedBy: ENGINE_ACTOR,
      approvedBy: null,
      appliedAt: input.at,
      lineId: want.lineId,
      // Not an employee's discount: it never counts toward FR-POS-047 limits.
      appliedById: null,
      approvedById: null,
      approvalMethod: null,
      context: null,
      presetId: `${PRESET_PREFIX}${want.promotionId}`,
      exclusive: promotion ? !promotion.stackable : true,
      removedAt: null,
      removedReason: null,
    });
  }

  const everApplied = [...new Set([...context.everApplied, ...effective.map((a) => a.promotionId)])].sort();
  const nextContext: OrderPromotionState = {
    ...context,
    applied: effective,
    rejected: result.rejected,
    blockedByManual,
    everApplied,
    pointsMultiplier: multipliers[0]?.pointsMultiplier ?? 1,
  };

  const discountsChanged = !sameJson(nextDiscounts, order.discounts);
  if (!discountsChanged && previous && sameJson(nextContext, previous)) return null;
  return { order: discountsChanged ? { ...order, discounts: nextDiscounts } : order, context: nextContext };
}

function isActive(order: Order, record: OrderDiscount): boolean {
  if (record.removedAt) return false;
  if (!record.lineId) return true;
  const line = order.lines.find((l) => l.id === record.lineId);
  return Boolean(line) && line!.state !== "voided" && !line!.isComp;
}

/** Promotions that applied to this order earlier and no longer do, with why. */
export function lapsedPromotions(context: OrderPromotionState): { promotionId: Id; reason: LapseReason }[] {
  const now = new Set(context.applied.map((a) => a.promotionId));
  return context.everApplied
    .filter((id) => !now.has(id))
    .map((promotionId) => ({
      promotionId,
      reason: context.declined.includes(promotionId)
        ? "declined"
        : context.blockedByManual && !context.rejected.some((r) => r.promotionId === promotionId)
          ? "manual_discount"
          : (context.rejected.find((r) => r.promotionId === promotionId)?.reason ?? "inactive"),
    }));
}

/**
 * FR-CRM-016 — the loyalty earning input for a closed sale, with the
 * promotion's points multiplier passed through.
 */
export function earnInputOf(
  order: Order,
  context: OrderPromotionState | undefined,
  options: { taxInclusive: boolean; minorPerMajor: number },
): EarnInput {
  const live = order.lines.filter((l) => l.state !== "voided");
  const orderDiscountMinor = order.discounts
    .filter((d) => !d.lineId && !d.removedAt)
    .reduce((sum, d) => sum + d.amount.amount, 0);
  return {
    lines: live.map((line) => ({
      grossMinor: line.isComp ? 0 : unitGross(line) * line.quantity,
      lineDiscountMinor: line.isComp ? 0 : line.lineDiscount.amount,
      taxMinor: line.taxAmount.amount,
    })),
    orderDiscountMinor,
    taxInclusive: options.taxInclusive,
    minorPerMajor: options.minorPerMajor,
    pointsMultiplier: context?.pointsMultiplier ?? 1,
  };
}
