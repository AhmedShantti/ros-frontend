/**
 * Promotion evaluation — FR-CRM-025 … FR-CRM-030. Pure and deterministic.
 *
 * FR-CRM-027 — "deterministic and identical offline and online". The only
 * way to guarantee that is for there to be one function, with no hidden
 * inputs, that the till (offline) and the console (online) both call:
 *
 *   - **No clock.** The moment of sale is an argument (`cart.at`), never
 *     `Date.now()`, so a sale re-evaluated after sync gets the same answer.
 *   - **No storage.** Past redemptions (for the usage limits) are passed in.
 *   - **Integer money.** Minor units throughout; percentages are converted to
 *     basis points and rounded half-up once, in one place (`percentOf`).
 *   - **Total ordering.** Promotions are sorted by priority, then id; ties
 *     between equal discounts are broken the same way. Iteration order of an
 *     object or a network response can never change the result.
 *
 * `PROMOTION_TEST_VECTORS` at the bottom is the conformance table: inputs and
 * the exact expected output. `runPromotionConformance()` runs it, and the
 * promotions screen shows the result, so a change to this file that alters an
 * answer is visible immediately rather than on a receipt.
 */

import type { Id, OrderChannel, OrderType, Promotion } from "./types";

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface PromotionCartLine {
  lineId: Id;
  itemId: Id;
  categoryId: Id | null;
  /** Whole units. Weighed lines do not take part in unit-based effects. */
  quantity: number;
  unitPriceMinor: number;
  stockItemIds?: Id[];
}

export interface PromotionCart {
  /** Local wall-clock time of the sale, `YYYY-MM-DDTHH:MM`. */
  at: string;
  branchId: Id;
  orderType: OrderType;
  channel: OrderChannel;
  lines: PromotionCartLine[];
  customer: { id: Id; tags: string[]; tier: string | null; orderCount: number } | null;
  /** Promotions whose coupon was validated for this order. */
  couponPromotionIds: Id[];
  deliveryFeeMinor: number;
}

/** One past redemption, for FR-CRM-026 usage limits. */
export interface PromotionRedemption {
  promotionId: Id;
  customerId: Id | null;
  /** `YYYY-MM-DD`, local. */
  day: string;
}

export type RejectionReason =
  | "inactive"
  | "not_started"
  | "ended"
  | "outside_hours"
  | "wrong_day"
  | "wrong_branch"
  | "wrong_order_type"
  | "wrong_channel"
  | "below_minimum"
  | "no_qualifying_items"
  | "below_quantity"
  | "customer_required"
  | "customer_tag"
  | "customer_tier"
  | "not_first_order"
  | "not_nth_order"
  | "coupon_required"
  | "limit_total"
  | "limit_customer"
  | "limit_day"
  | "no_effect"
  | "not_best_value";

export interface AppliedPromotion {
  promotionId: Id;
  discountMinor: number;
  /** Lines the discount was taken from, with the amount on each. */
  allocations: { lineId: Id; discountMinor: number }[];
  pointsMultiplier: number | null;
}

export interface PromotionResult {
  subtotalMinor: number;
  applied: AppliedPromotion[];
  rejected: { promotionId: Id; reason: RejectionReason }[];
  discountMinor: number;
  pointsMultiplier: number;
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** `percent` of `amount`, half-up, via integer basis points. */
export function percentOf(amountMinor: number, percent: number): number {
  const bp = Math.round(percent * 100);
  return Math.floor((amountMinor * bp + 5000) / 10000);
}

function lineTotal(line: PromotionCartLine): number {
  return line.quantity * line.unitPriceMinor;
}

/**
 * Spread a discount across lines in proportion to their value, largest
 * remainder, ties to the earlier line — so the allocation is exact and stable.
 */
function allocate(discountMinor: number, lines: PromotionCartLine[]): { lineId: Id; discountMinor: number }[] {
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  if (total <= 0 || discountMinor <= 0) return [];
  const shares = lines.map((line, index) => {
    const exact = (discountMinor * lineTotal(line)) / total;
    return { lineId: line.lineId, base: Math.floor(exact), rest: exact - Math.floor(exact), index };
  });
  let left = discountMinor - shares.reduce((sum, share) => sum + share.base, 0);
  const order = [...shares].sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const share of order) {
    if (left <= 0) break;
    share.base += 1;
    left -= 1;
  }
  return shares.filter((share) => share.base > 0).map((share) => ({ lineId: share.lineId, discountMinor: share.base }));
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function qualifyingLines(promotion: Promotion, cart: PromotionCart): PromotionCartLine[] {
  const c = promotion.conditions;
  const scoped = c.itemIds.length > 0 || c.categoryIds.length > 0 || c.stockItemIds.length > 0;
  if (!scoped) return cart.lines;
  return cart.lines.filter(
    (line) =>
      c.itemIds.includes(line.itemId) ||
      (line.categoryId !== null && c.categoryIds.includes(line.categoryId)) ||
      (line.stockItemIds ?? []).some((id) => c.stockItemIds.includes(id)),
  );
}

function dayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/**
 * FR-CRM-026 — usage limits, counted from the redemptions passed in.
 * A per-customer limit cannot be honoured for an anonymous sale, so it
 * refuses rather than letting an unidentified guest redeem without limit.
 */
export function usageRejection(
  promotion: Promotion,
  cart: Pick<PromotionCart, "at" | "customer">,
  redemptions: PromotionRedemption[],
): RejectionReason | null {
  const mine = redemptions.filter((row) => row.promotionId === promotion.id);
  const { totalRedemptions, perCustomer, perDay } = promotion.usage;
  if (totalRedemptions !== null && mine.length >= totalRedemptions) return "limit_total";
  if (perCustomer !== null) {
    if (!cart.customer) return "customer_required";
    if (mine.filter((row) => row.customerId === cart.customer!.id).length >= perCustomer) return "limit_customer";
  }
  if (perDay !== null && mine.filter((row) => row.day === cart.at.slice(0, 10)).length >= perDay) return "limit_day";
  return null;
}

export function eligibility(
  promotion: Promotion,
  cart: PromotionCart,
  redemptions: PromotionRedemption[],
): RejectionReason | null {
  const c = promotion.conditions;
  const day = cart.at.slice(0, 10);
  const time = cart.at.slice(11, 16);
  const subtotal = cart.lines.reduce((sum, line) => sum + lineTotal(line), 0);

  if (!promotion.active) return "inactive";
  if (promotion.startsOn && day < promotion.startsOn) return "not_started";
  if (promotion.endsOn && day > promotion.endsOn) return "ended";
  if (c.startsAt && time < c.startsAt) return "outside_hours";
  if (c.endsAt && time >= c.endsAt) return "outside_hours";
  if (c.daysOfWeek.length > 0 && !c.daysOfWeek.includes(dayOfWeek(day))) return "wrong_day";
  if (c.branchIds.length > 0 && !c.branchIds.includes(cart.branchId)) return "wrong_branch";
  if (c.orderTypes.length > 0 && !c.orderTypes.includes(cart.orderType)) return "wrong_order_type";
  if (c.channels.length > 0 && !c.channels.includes(cart.channel)) return "wrong_channel";
  if (c.minimumOrderMinor !== null && subtotal < c.minimumOrderMinor) return "below_minimum";

  const qualifying = qualifyingLines(promotion, cart);
  if (qualifying.length === 0) return "no_qualifying_items";
  const units = qualifying.reduce((sum, line) => sum + line.quantity, 0);
  if (c.minimumQuantity !== null && units < c.minimumQuantity) return "below_quantity";

  const needsCustomer =
    c.customerTags.length > 0 || c.customerTiers.length > 0 || c.firstOrderOnly || c.nthOrder !== null;
  if (needsCustomer && !cart.customer) return "customer_required";
  if (cart.customer) {
    if (c.customerTags.length > 0 && !c.customerTags.some((tag) => cart.customer!.tags.includes(tag))) return "customer_tag";
    if (c.customerTiers.length > 0 && !(cart.customer.tier && c.customerTiers.includes(cart.customer.tier))) {
      return "customer_tier";
    }
    if (c.firstOrderOnly && cart.customer.orderCount > 0) return "not_first_order";
    if (c.nthOrder !== null && c.nthOrder > 0 && (cart.customer.orderCount + 1) % c.nthOrder !== 0) return "not_nth_order";
  }
  if (c.requiresCoupon && !cart.couponPromotionIds.includes(promotion.id)) return "coupon_required";

  return usageRejection(promotion, cart, redemptions);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Unit prices of the qualifying lines, one entry per unit, most expensive first. */
function unitsOf(lines: PromotionCartLine[]): { lineId: Id; priceMinor: number; index: number }[] {
  const units: { lineId: Id; priceMinor: number; index: number }[] = [];
  lines.forEach((line, index) => {
    for (let i = 0; i < Math.max(0, Math.floor(line.quantity)); i += 1) {
      units.push({ lineId: line.lineId, priceMinor: line.unitPriceMinor, index });
    }
  });
  return units.sort((a, b) => b.priceMinor - a.priceMinor || a.index - b.index);
}

function freeUnits(units: { lineId: Id; priceMinor: number }[]): AppliedPromotion["allocations"] {
  const byLine = new Map<Id, number>();
  for (const unit of units) byLine.set(unit.lineId, (byLine.get(unit.lineId) ?? 0) + unit.priceMinor);
  return [...byLine.entries()].map(([lineId, discountMinor]) => ({ lineId, discountMinor }));
}

export function applyEffect(promotion: Promotion, cart: PromotionCart): AppliedPromotion | null {
  const effect = promotion.effect;
  const qualifying = qualifyingLines(promotion, cart);
  const subtotal = cart.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const qualifyingTotal = qualifying.reduce((sum, line) => sum + lineTotal(line), 0);
  const result = (allocations: AppliedPromotion["allocations"], pointsMultiplier: number | null = null) => {
    const discountMinor = allocations.reduce((sum, row) => sum + row.discountMinor, 0);
    return discountMinor > 0 || pointsMultiplier !== null
      ? { promotionId: promotion.id, discountMinor, allocations, pointsMultiplier }
      : null;
  };

  switch (effect.type) {
    case "percent_off_order":
      return result(allocate(percentOf(subtotal, Math.min(100, effect.value)), cart.lines));
    case "percent_off_items":
      return result(allocate(percentOf(qualifyingTotal, Math.min(100, effect.value)), qualifying));
    case "amount_off_order":
      return result(allocate(Math.min(subtotal, Math.max(0, Math.round(effect.value))), cart.lines));
    case "free_item": {
      const line = cart.lines
        .filter((row) => row.itemId === effect.targetItemId && row.quantity >= 1)
        .sort((a, b) => a.unitPriceMinor - b.unitPriceMinor || a.lineId.localeCompare(b.lineId))[0];
      return line ? result([{ lineId: line.lineId, discountMinor: line.unitPriceMinor }]) : null;
    }
    case "buy_x_get_y": {
      const x = Math.max(1, effect.buyQuantity ?? 1);
      const y = Math.max(1, effect.getQuantity ?? 1);
      const units = unitsOf(qualifying);
      const free: typeof units = [];
      // Most expensive first; in every block of x + y, the last y go free.
      for (let start = 0; start + x + y <= units.length; start += x + y) {
        free.push(...units.slice(start + x, start + x + y));
      }
      return result(freeUnits(free));
    }
    case "cheapest_free": {
      const units = unitsOf(qualifying);
      const needed = Math.max(2, promotion.conditions.minimumQuantity ?? 2);
      return units.length >= needed ? result(freeUnits([units[units.length - 1]!])) : null;
    }
    case "bundle_price": {
      const price = Math.max(0, Math.round(effect.value));
      return qualifyingTotal > price ? result(allocate(qualifyingTotal - price, qualifying)) : null;
    }
    case "free_delivery":
      return cart.deliveryFeeMinor > 0
        ? { promotionId: promotion.id, discountMinor: cart.deliveryFeeMinor, allocations: [], pointsMultiplier: null }
        : null;
    case "points_multiplier":
      return effect.value > 1 ? result([], effect.value) : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function byPriority(a: Promotion, b: Promotion): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}

/**
 * FR-CRM-027 — the one evaluation, used by the till and the console alike.
 *
 * FR-CRM-030 — non-stackable promotions compete and the best value wins;
 * stackable ones combine with each other. The better of "best single
 * non-stackable" and "all stackable together" is applied. Points multipliers
 * do not reduce the price, so they do not compete on value: the highest
 * eligible one applies alongside.
 */
export function evaluatePromotions(
  promotions: Promotion[],
  cart: PromotionCart,
  redemptions: PromotionRedemption[] = [],
): PromotionResult {
  const subtotalMinor = cart.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const rejected: PromotionResult["rejected"] = [];
  const candidates: { promotion: Promotion; applied: AppliedPromotion }[] = [];

  for (const promotion of [...promotions].sort(byPriority)) {
    const reason = eligibility(promotion, cart, redemptions);
    if (reason) {
      rejected.push({ promotionId: promotion.id, reason });
      continue;
    }
    const applied = applyEffect(promotion, cart);
    if (!applied) {
      rejected.push({ promotionId: promotion.id, reason: "no_effect" });
      continue;
    }
    candidates.push({ promotion, applied });
  }

  const multipliers = candidates.filter((c) => c.applied.pointsMultiplier !== null);
  const discounts = candidates.filter((c) => c.applied.pointsMultiplier === null);

  const cap = subtotalMinor + cart.deliveryFeeMinor;
  const exclusive = discounts
    .filter((c) => !c.promotion.stackable)
    .sort((a, b) => b.applied.discountMinor - a.applied.discountMinor || byPriority(a.promotion, b.promotion));
  const bestExclusive = exclusive[0] ?? null;
  const stackable = discounts.filter((c) => c.promotion.stackable);
  const stackTotal = Math.min(cap, stackable.reduce((sum, c) => sum + c.applied.discountMinor, 0));

  let chosen: typeof candidates = [];
  if (bestExclusive && bestExclusive.applied.discountMinor >= stackTotal) chosen = [bestExclusive];
  else chosen = stackable;

  for (const c of discounts) {
    if (!chosen.includes(c)) rejected.push({ promotionId: c.promotion.id, reason: "not_best_value" });
  }

  // Never discount below zero: later stackable promotions are trimmed.
  let remaining = cap;
  const applied: AppliedPromotion[] = [];
  for (const c of chosen) {
    const take = Math.min(remaining, c.applied.discountMinor);
    if (take <= 0) {
      rejected.push({ promotionId: c.promotion.id, reason: "no_effect" });
      continue;
    }
    remaining -= take;
    applied.push(
      take === c.applied.discountMinor
        ? c.applied
        : { ...c.applied, discountMinor: take, allocations: allocate(take, cart.lines.filter((line) => c.applied.allocations.some((a) => a.lineId === line.lineId))) },
    );
  }

  const bestMultiplier = [...multipliers].sort(
    (a, b) => (b.applied.pointsMultiplier ?? 0) - (a.applied.pointsMultiplier ?? 0) || byPriority(a.promotion, b.promotion),
  )[0];
  for (const c of multipliers) {
    if (c !== bestMultiplier) rejected.push({ promotionId: c.promotion.id, reason: "not_best_value" });
  }
  if (bestMultiplier) applied.push(bestMultiplier.applied);

  rejected.sort((a, b) => a.promotionId.localeCompare(b.promotionId));
  return {
    subtotalMinor,
    applied,
    rejected,
    discountMinor: applied.reduce((sum, row) => sum + row.discountMinor, 0),
    pointsMultiplier: bestMultiplier?.applied.pointsMultiplier ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Conformance — FR-CRM-027
// ---------------------------------------------------------------------------

function promo(id: string, part: {
  effect: Partial<Promotion["effect"]> & { type: Promotion["effect"]["type"] };
  conditions?: Partial<Promotion["conditions"]>;
  usage?: Partial<Promotion["usage"]>;
  stackable?: boolean;
  priority?: number;
  active?: boolean;
  startsOn?: string | null;
  endsOn?: string | null;
}): Promotion {
  return {
    id,
    tenantId: "t",
    name: { en: id, ar: id },
    description: { en: "", ar: "" },
    kind: "promotion",
    conditions: {
      startsAt: null,
      endsAt: null,
      daysOfWeek: [],
      branchIds: [],
      orderTypes: [],
      channels: [],
      minimumOrderMinor: null,
      itemIds: [],
      categoryIds: [],
      stockItemIds: [],
      minimumQuantity: null,
      customerTags: [],
      customerTiers: [],
      firstOrderOnly: false,
      nthOrder: null,
      requiresCoupon: false,
      ...part.conditions,
    },
    effect: { value: 0, targetItemId: null, buyQuantity: null, getQuantity: null, ...part.effect },
    usage: { totalRedemptions: null, perCustomer: null, perDay: null, ...part.usage },
    stackable: part.stackable ?? false,
    priority: part.priority ?? 100,
    active: part.active ?? true,
    startsOn: part.startsOn ?? null,
    endsOn: part.endsOn ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    redemptions: 0,
    discountCost: { amount: 0, currency: "EGP" },
    attributedRevenue: { amount: 0, currency: "EGP" },
  };
}

function cart(part: Partial<PromotionCart> = {}): PromotionCart {
  return {
    at: "2026-03-04T12:30", // a Wednesday
    branchId: "b1",
    orderType: "dine_in",
    channel: "pos",
    lines: [
      { lineId: "l1", itemId: "burger", categoryId: "mains", quantity: 2, unitPriceMinor: 12_000 },
      { lineId: "l2", itemId: "fries", categoryId: "sides", quantity: 1, unitPriceMinor: 3_500 },
      { lineId: "l3", itemId: "cola", categoryId: "drinks", quantity: 3, unitPriceMinor: 2_000 },
    ],
    customer: { id: "c1", tags: ["vip"], tier: "gold", orderCount: 4 },
    couponPromotionIds: [],
    deliveryFeeMinor: 0,
    ...part,
  };
}

export interface PromotionTestVector {
  name: string;
  promotions: Promotion[];
  cart: PromotionCart;
  redemptions: PromotionRedemption[];
  expect: { discountMinor: number; applied: Id[]; rejected?: Record<Id, RejectionReason>; pointsMultiplier?: number };
}

/** Subtotal of the default cart: 2×12000 + 3500 + 3×2000 = 33,500. */
export const PROMOTION_TEST_VECTORS: PromotionTestVector[] = [
  {
    name: "10% off the order, half-up rounding",
    promotions: [promo("p10", { effect: { type: "percent_off_order", value: 10 } })],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 3_350, applied: ["p10"] },
  },
  {
    name: "12.5% off one category only",
    promotions: [promo("mains", { effect: { type: "percent_off_items", value: 12.5 }, conditions: { categoryIds: ["mains"] } })],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 3_000, applied: ["mains"] },
  },
  {
    name: "Non-stackable: best value wins, the other is rejected",
    promotions: [
      promo("small", { effect: { type: "amount_off_order", value: 2_000 }, priority: 1 }),
      promo("big", { effect: { type: "percent_off_order", value: 15 }, priority: 2 }),
    ],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 5_025, applied: ["big"], rejected: { small: "not_best_value" } },
  },
  {
    name: "Stackable promotions combine when together they beat the best single one",
    promotions: [
      promo("s1", { effect: { type: "amount_off_order", value: 3_000 }, stackable: true }),
      promo("s2", { effect: { type: "amount_off_order", value: 2_500 }, stackable: true }),
      promo("x", { effect: { type: "percent_off_order", value: 10 } }),
    ],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 5_500, applied: ["s1", "s2"], rejected: { x: "not_best_value" } },
  },
  {
    name: "Buy 2 get 1: cheapest unit in each block of three is free",
    promotions: [promo("b2g1", { effect: { type: "buy_x_get_y", buyQuantity: 2, getQuantity: 1, value: 1 }, conditions: { categoryIds: ["drinks"] } })],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 2_000, applied: ["b2g1"] },
  },
  {
    name: "Usage limit — total redemptions reached",
    promotions: [promo("cap", { effect: { type: "percent_off_order", value: 10 }, usage: { totalRedemptions: 2 } })],
    cart: cart(),
    redemptions: [
      { promotionId: "cap", customerId: "c9", day: "2026-03-01" },
      { promotionId: "cap", customerId: "c8", day: "2026-03-02" },
    ],
    expect: { discountMinor: 0, applied: [], rejected: { cap: "limit_total" } },
  },
  {
    name: "Usage limit — per customer counts only this customer",
    promotions: [promo("once", { effect: { type: "amount_off_order", value: 1_000 }, usage: { perCustomer: 1 } })],
    cart: cart(),
    redemptions: [{ promotionId: "once", customerId: "c2", day: "2026-03-04" }],
    expect: { discountMinor: 1_000, applied: ["once"] },
  },
  {
    name: "Usage limit — per customer refuses an anonymous sale",
    promotions: [promo("once", { effect: { type: "amount_off_order", value: 1_000 }, usage: { perCustomer: 1 } })],
    cart: cart({ customer: null }),
    redemptions: [],
    expect: { discountMinor: 0, applied: [], rejected: { once: "customer_required" } },
  },
  {
    name: "Usage limit — per day counts only the sale's own day",
    promotions: [promo("daily", { effect: { type: "amount_off_order", value: 1_000 }, usage: { perDay: 1 } })],
    cart: cart(),
    redemptions: [
      { promotionId: "daily", customerId: "c3", day: "2026-03-03" },
      { promotionId: "daily", customerId: "c4", day: "2026-03-04" },
    ],
    expect: { discountMinor: 0, applied: [], rejected: { daily: "limit_day" } },
  },
  {
    name: "Day of week and window come from the sale time, not the clock",
    promotions: [
      promo("weekend", { effect: { type: "percent_off_order", value: 20 }, conditions: { daysOfWeek: [5, 6] } }),
      promo("expired", { effect: { type: "percent_off_order", value: 20 }, endsOn: "2026-03-03" }),
    ],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 0, applied: [], rejected: { expired: "ended", weekend: "wrong_day" } },
  },
  {
    name: "Coupon-only promotion needs its validated coupon",
    promotions: [promo("coupon", { effect: { type: "amount_off_order", value: 5_000 }, conditions: { requiresCoupon: true } })],
    cart: cart({ couponPromotionIds: ["coupon"] }),
    redemptions: [],
    expect: { discountMinor: 5_000, applied: ["coupon"] },
  },
  {
    name: "Discount never exceeds the order",
    promotions: [promo("huge", { effect: { type: "amount_off_order", value: 99_999 } })],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 33_500, applied: ["huge"] },
  },
  {
    name: "Points multiplier applies alongside a discount",
    promotions: [
      promo("double", { effect: { type: "points_multiplier", value: 2 } }),
      promo("p10", { effect: { type: "percent_off_order", value: 10 } }),
    ],
    cart: cart(),
    redemptions: [],
    expect: { discountMinor: 3_350, applied: ["p10", "double"], pointsMultiplier: 2 },
  },
];

export interface ConformanceResult {
  name: string;
  passed: boolean;
  expected: PromotionTestVector["expect"];
  actual: { discountMinor: number; applied: Id[]; rejected: Record<Id, RejectionReason>; pointsMultiplier: number };
}

export function runPromotionConformance(vectors: PromotionTestVector[] = PROMOTION_TEST_VECTORS): ConformanceResult[] {
  return vectors.map((vector) => {
    // Evaluated twice with the promotions in reverse order: the answer must
    // not depend on the order they arrive in (FR-CRM-027).
    const first = evaluatePromotions(vector.promotions, vector.cart, vector.redemptions);
    const second = evaluatePromotions([...vector.promotions].reverse(), vector.cart, [...vector.redemptions].reverse());
    const actual = {
      discountMinor: first.discountMinor,
      applied: first.applied.map((row) => row.promotionId),
      rejected: Object.fromEntries(first.rejected.map((row) => [row.promotionId, row.reason])),
      pointsMultiplier: first.pointsMultiplier,
    };
    const stable = JSON.stringify(first) === JSON.stringify(second);
    const expectedRejected = vector.expect.rejected ?? {};
    const passed =
      stable &&
      actual.discountMinor === vector.expect.discountMinor &&
      JSON.stringify(actual.applied) === JSON.stringify(vector.expect.applied) &&
      Object.entries(expectedRejected).every(([id, reason]) => actual.rejected[id] === reason) &&
      (vector.expect.pointsMultiplier === undefined || actual.pointsMultiplier === vector.expect.pointsMultiplier);
    return { name: vector.name, passed, expected: vector.expect, actual };
  });
}
