/**
 * The rules engine.
 *
 * Everything in this file is a pure function. Given the same order and the
 * same country pack it produces the same numbers on a terminal, in the
 * console, and in a test — which is what FR-POS-041 asks for.
 *
 * Nothing here touches storage, React, or the clock. Callers pass the
 * timestamp in. That keeps the seeded server render and the live client
 * render in agreement, and it is the reason the whole module can be
 * exercised without a browser.
 */

import type {
  Combo,
  ComboAllocationBasis,
  ComboPricingStrategy,
  ComboSlot,
  CountryPack,
  Currency,
  Id,
  KitchenTicket,
  MenuItem,
  MenuItemVariant,
  ModifierGroup,
  ModifierPriceRule,
  Money,
  Order,
  OrderLine,
  OrderLineModifier,
  OrderType,
  PriceList,
  Recipe,
  Station,
  StationType,
  TaxClassCode,
  TicketUrgency,
  UnitCode,
} from "../types";
import { modifierGroups } from "../mock/catalogue";
import { money, multiplyMoney } from "../format";

// ---------------------------------------------------------------------------
// Modifier attachment
// ---------------------------------------------------------------------------

/**
 * Which modifier groups an item offers.
 *
 * The fixture data carries an `attachedItemCount` but no join table, so the
 * attachment is derived from the item's category and station. It is a pure
 * function of the item, so the same item always offers the same groups.
 */
export function modifierGroupsForItem(item: MenuItem): ModifierGroup[] {
  const byId = new Map(modifierGroups.map((g) => [g.id, g]));
  const picked: ModifierGroup[] = [];
  const add = (id: string) => {
    const group = byId.get(id);
    if (group && !picked.includes(group)) picked.push(group);
  };

  const cat = item.categoryId;

  // Required choices first — they gate the line (FR-POS-013 / FR-POS-020).
  if (cat === "cat_burgers") add("mgp_0003"); // Protein choice
  if (cat === "cat_hot_drinks" || item.stationType === "barista") add("mgp_0004"); // Milk
  if (cat === "cat_shawarma" || cat === "cat_grills") add("mgp_0005"); // Spice level
  if (cat === "cat_grills") add("mgp_0006"); // Side choice

  // Then the optional ones.
  if (["cat_burgers", "cat_shawarma", "cat_pizza", "cat_pasta", "cat_grills", "cat_sides"].includes(cat)) {
    add("mgp_0001"); // Extras
    add("mgp_0002"); // Remove
  }
  if (["cat_cold_drinks", "cat_hot_drinks"].includes(cat)) {
    add("mgp_0001");
    add("mgp_0002");
  }

  return picked;
}

/** A required group with no selection yet blocks the line — FR-POS-020. */
export function unsatisfiedGroups(
  groups: ModifierGroup[],
  selected: Set<Id>,
): ModifierGroup[] {
  return groups.filter((group) => {
    if (!group.required) return false;
    const count = group.modifiers.filter((m) => selected.has(m.id)).length;
    return count < Math.max(1, group.minSelections);
  });
}

// ---------------------------------------------------------------------------
// Price resolution — FR-POS-040
// ---------------------------------------------------------------------------

export type PriceSource =
  | "override"
  | "promotion"
  | "time_price_list"
  | "order_type_price_list"
  | "branch_price_list"
  | "brand_price_list"
  | "base";

export interface PriceResolution {
  price: Money;
  /** FR-POS-042 — the rule that produced the price, recorded on the line. */
  source: PriceSource;
  priceListId: Id | null;
  priceListName: string | null;
}

export interface PriceContext {
  orderType: OrderType;
  branchId: Id;
  brandId: Id | null;
  /** Minutes past midnight, for happy-hour windows. */
  minuteOfDay: number;
  priceLists: PriceList[];
  /** A permission-gated manual price, in minor units. */
  overrideMinor?: number | null;
}

const SOURCE_BY_SCOPE: Record<PriceList["scope"], PriceSource> = {
  tenant: "brand_price_list",
  brand: "brand_price_list",
  branch: "branch_price_list",
};

/**
 * Walks the seven levels in order and stops at the first hit. The level that
 * won is returned alongside the money so the line can record it.
 */
export function resolvePrice(
  item: MenuItem,
  variant: MenuItemVariant,
  ctx: PriceContext,
): PriceResolution {
  if (ctx.overrideMinor != null) {
    return {
      price: money(ctx.overrideMinor, variant.basePrice.currency),
      source: "override",
      priceListId: null,
      priceListName: null,
    };
  }

  const candidates = ctx.priceLists
    .filter((list) => list.active)
    .filter((list) => entryFor(list, variant.id) !== undefined)
    .filter((list) => scopeMatches(list, ctx))
    .filter((list) => windowMatches(list, ctx.minuteOfDay));

  // A recurring window beats a plain list; then order-type-specific; then
  // branch; then brand. Priority breaks ties inside a level.
  const ranked = [...candidates].sort((a, b) => rank(a) - rank(b) || a.priority - b.priority);
  const winner = ranked[0];

  if (winner) {
    const entry = entryFor(winner, variant.id)!;
    return {
      price: entry.price,
      source:
        winner.recurrence != null
          ? "time_price_list"
          : winner.orderTypes.length > 0
            ? "order_type_price_list"
            : SOURCE_BY_SCOPE[winner.scope],
      priceListId: winner.id,
      priceListName: winner.name.en,
    };
  }

  return {
    price: variant.basePrice,
    source: "base",
    priceListId: null,
    priceListName: null,
  };
}

function rank(list: PriceList): number {
  if (list.recurrence != null) return 0;
  if (list.orderTypes.length > 0) return 1;
  if (list.scope === "branch") return 2;
  return 3;
}

function entryFor(list: PriceList, variantId: Id) {
  return list.entries.find((e) => e.variantId === variantId);
}

function scopeMatches(list: PriceList, ctx: PriceContext): boolean {
  if (list.orderTypes.length > 0 && !list.orderTypes.includes(ctx.orderType)) return false;
  if (list.scope === "branch") return list.scopeId === null || list.scopeId === ctx.branchId;
  if (list.scope === "brand") return list.scopeId === null || list.scopeId === ctx.brandId;
  return true;
}

/** "weekdays 15:00-18:00" and friends. Anything unparseable is always on. */
function windowMatches(list: PriceList, minuteOfDay: number): boolean {
  if (!list.recurrence) return true;
  const match = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/.exec(list.recurrence);
  if (!match) return true;
  const from = Number(match[1]) * 60 + Number(match[2]);
  const to = Number(match[3]) * 60 + Number(match[4]);
  return from <= to
    ? minuteOfDay >= from && minuteOfDay < to
    : minuteOfDay >= from || minuteOfDay < to; // window crossing midnight
}

// ---------------------------------------------------------------------------
// Modifier price by context — FR-POS-022
// ---------------------------------------------------------------------------

export interface ModifierPriceContext {
  orderType: OrderType;
  branchId: Id;
  /** The list that priced the item this modifier is on, if any (FR-POS-042). */
  priceListId: Id | null;
}

/**
 * How specific a rule is. Order type outweighs branch, which outweighs price
 * list, and the weights are powers of two so the sum orders rules
 * lexicographically: any rule naming the order type beats every rule that
 * does not, whatever else either names. The SRS's own example — free for
 * dine-in, charged for delivery — is an order-type decision, so that is the
 * dimension that has to win.
 */
function specificity(rule: ModifierPriceRule): number {
  return (rule.orderType ? 4 : 0) + (rule.branchId ? 2 : 0) + (rule.priceListId ? 1 : 0);
}

function ruleMatches(rule: ModifierPriceRule, ctx: ModifierPriceContext): boolean {
  if (rule.orderType && rule.orderType !== ctx.orderType) return false;
  if (rule.branchId && rule.branchId !== ctx.branchId) return false;
  if (rule.priceListId && rule.priceListId !== ctx.priceListId) return false;
  return true;
}

/**
 * The delta a modifier charges here, and the rule that set it.
 *
 * With no matching rule the modifier's own delta applies and `ruleId` is
 * null, so the line can say whether it was priced by context or by default.
 */
export function resolveModifierDelta(
  modifier: { id: Id; priceDelta: Money },
  rules: ModifierPriceRule[],
  ctx: ModifierPriceContext,
): { priceDelta: Money; ruleId: Id | null } {
  const winner = rules
    .filter((rule) => rule.modifierId === modifier.id && ruleMatches(rule, ctx))
    // Most specific first; the newest breaks a tie between two equal rules.
    .sort((a, b) => specificity(b) - specificity(a) || b.updatedAt.localeCompare(a.updatedAt))[0];
  return winner
    ? { priceDelta: money(winner.priceDelta.amount, modifier.priceDelta.currency), ruleId: winner.id }
    : { priceDelta: modifier.priceDelta, ruleId: null };
}

// ---------------------------------------------------------------------------
// Combos — FR-POS-030, FR-POS-031, FR-POS-032
// ---------------------------------------------------------------------------

export interface ComboPick {
  slotId: Id;
  menuItemId: Id;
}

export interface ComboComponentQuote {
  slot: ComboSlot;
  item: MenuItem;
  variant: MenuItemVariant;
  /** The component's own price in this context, minor units. */
  listMinor: number;
  premiumMinor: number;
  /** Its share of the combo, premium included — what its line is charged. */
  chargedMinor: number;
  costMinor: number;
}

export interface ComboQuote {
  strategy: ComboPricingStrategy;
  /** Every slot has a pick. The combo cannot be sold until it does. */
  complete: boolean;
  totalMinor: number;
  /** The components bought separately, premiums aside. */
  listTotalMinor: number;
  savingMinor: number;
  components: ComboComponentQuote[];
}

export interface ComboPricing {
  itemById: (id: Id) => MenuItem | undefined;
  /** The component's price as the till would charge it alone (FR-POS-040). */
  listPrice: (item: MenuItem, variant: MenuItemVariant) => number;
  unitCost: (variant: MenuItemVariant) => number;
}

/**
 * Splits a whole number of minor units across weights, exactly.
 *
 * Largest-remainder rounding: every share is floored, then the leftover
 * units go to the shares that lost the most in the flooring. The parts
 * always sum to the total — a combo's components adding up to one piastre
 * more than the combo is how a sales report stops reconciling.
 */
export function allocateMinor(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((s, w) => s + w, 0);
  // All-zero weights (no costs recorded, say) fall back to an equal split.
  const basis = sum > 0 ? safe : safe.map(() => 1);
  const basisSum = sum > 0 ? sum : basis.length;

  const exact = basis.map((w) => (total * w) / basisSum);
  const floored = exact.map((x) => Math.floor(x));
  let leftover = total - floored.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floored[i]! += 1;
    leftover -= 1;
  }
  return floored;
}

/**
 * What a combo costs with these picks, and what each component is charged.
 *
 * The three strategies of FR-POS-031:
 *
 *   fixed               the combo's own price, whatever was picked
 *   sum_minus_discount  the picks at their own prices, less the combo's discount
 *   component_override  each slot's override price, or the pick's own price
 *                       where a slot sets none
 *
 * Premiums for premium choices ride on top in every strategy and stay with
 * the component that earned them. The rest of the price is allocated across
 * components by the combo's basis (FR-POS-032), except under
 * `component_override`, where the override *is* each component's price and
 * there is nothing left to allocate.
 */
export function quoteCombo(combo: Combo, picks: ComboPick[], pricing: ComboPricing): ComboQuote {
  const components: ComboComponentQuote[] = [];
  for (const slot of combo.slots) {
    const pick = picks.find((p) => p.slotId === slot.id);
    const item = pick && slot.optionItemIds.includes(pick.menuItemId) ? pricing.itemById(pick.menuItemId) : undefined;
    const variant = item?.variants[0];
    if (!item || !variant) continue;
    const listMinor = pricing.listPrice(item, variant);
    components.push({
      slot,
      item,
      variant,
      listMinor,
      premiumMinor: slot.premiumItemIds?.includes(item.id) ? slot.priceDelta.amount : 0,
      chargedMinor: 0,
      costMinor: pricing.unitCost(variant),
    });
  }

  const complete = components.length === combo.slots.length && combo.slots.length > 0;
  const listTotalMinor = components.reduce((sum, c) => sum + c.listMinor, 0);
  const premiums = components.reduce((sum, c) => sum + c.premiumMinor, 0);

  if (combo.pricingStrategy === "component_override") {
    for (const c of components) {
      c.chargedMinor = (c.slot.overridePrice?.amount ?? c.listMinor) + c.premiumMinor;
    }
  } else {
    const base =
      combo.pricingStrategy === "fixed"
        ? combo.price.amount
        : Math.max(0, listTotalMinor - (combo.discount?.amount ?? 0));
    const shares = allocateMinor(base, weightsFor(combo.allocationBasis ?? "list_price", components));
    components.forEach((c, i) => {
      c.chargedMinor = shares[i]! + c.premiumMinor;
    });
  }

  const totalMinor = components.reduce((sum, c) => sum + c.chargedMinor, 0);
  return {
    strategy: combo.pricingStrategy,
    complete,
    totalMinor,
    listTotalMinor,
    savingMinor: listTotalMinor + premiums - totalMinor,
    components,
  };
}

function weightsFor(basis: ComboAllocationBasis, components: ComboComponentQuote[]): number[] {
  if (basis === "equal") return components.map(() => 1);
  if (basis === "cost") return components.map((c) => c.costMinor);
  return components.map((c) => c.listMinor);
}

// ---------------------------------------------------------------------------
// Discount stacking — FR-POS-051
// ---------------------------------------------------------------------------

export type StackingPolicy = "stack" | "best_single";

export interface StackEntry {
  id: string;
  amountMinor: number;
  exclusive: boolean;
}

export interface StackVerdict {
  /** apply: nothing conflicts. replace: the candidate wins and the conflicts go. keep_existing: it does not apply. */
  outcome: "apply" | "replace" | "keep_existing";
  conflictIds: string[];
  conflictValueMinor: number;
  candidateValueMinor: number;
}

/**
 * Whether a new discount may join the ones already on the order.
 *
 * An exclusive discount — or any discount at all under `best_single` — does
 * not combine with others. When one is involved, the guest gets whichever
 * side is worth more to them: the new discount alone, or the ones it would
 * have had to combine with. A tie keeps what is already there, so a cashier
 * re-applying the same promotion does not churn the record.
 *
 * Because every application goes through this, an order carrying an active
 * exclusive discount never carries anything else — which is what lets the
 * conflict set below be "the exclusive ones" in the stacking case.
 *
 * Comps are not discounts (FR-POS-050) and are never passed in.
 */
export function resolveStacking(
  active: StackEntry[],
  candidate: { amountMinor: number; exclusive: boolean },
  policy: StackingPolicy,
): StackVerdict {
  const conflicts =
    policy === "best_single" || candidate.exclusive ? active : active.filter((entry) => entry.exclusive);
  const conflictValueMinor = conflicts.reduce((sum, entry) => sum + entry.amountMinor, 0);
  const base = {
    conflictIds: conflicts.map((entry) => entry.id),
    conflictValueMinor,
    candidateValueMinor: candidate.amountMinor,
  };
  if (conflicts.length === 0) return { outcome: "apply", ...base };
  return candidate.amountMinor > conflictValueMinor
    ? { outcome: "replace", ...base }
    : { outcome: "keep_existing", ...base };
}

// ---------------------------------------------------------------------------
// Tax — country pack driven
// ---------------------------------------------------------------------------

/** `null` means exempt: no tax line at all, which is not the same as zero. */
export function taxRateFor(pack: CountryPack, taxClass: TaxClassCode): number | null {
  const definition = pack.taxClasses.find((c) => c.code === taxClass);
  if (!definition) return null;
  return definition.rate;
}

/**
 * Splits a gross amount into net and tax under tax-inclusive pricing, or
 * adds tax on top under tax-exclusive pricing. The caller decides which by
 * passing the pack; the two modes differ by jurisdiction, not by preference.
 */
/**
 * Rounds a fractional minor-unit amount by the pack's rounding mode
 * (FR-FIN-035). `Math.round` alone is HALF_UP for positives only and ignores
 * the pack, so a HALF_EVEN or DOWN jurisdiction drifted by a unit per line.
 */
export function roundMinor(value: number, mode: CountryPack["roundingMode"]): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Tolerate float noise such as 12.4999999 from a division.
  const floor = Math.floor(abs + 1e-9);
  const fraction = abs - floor;
  let result: number;
  if (mode === "DOWN") result = floor;
  else if (Math.abs(fraction - 0.5) < 1e-9) result = mode === "HALF_EVEN" ? (floor % 2 === 0 ? floor : floor + 1) : floor + 1;
  else result = fraction > 0.5 ? floor + 1 : floor;
  return sign * result;
}

export function applyTax(
  amount: Money,
  rate: number | null,
  pack: CountryPack,
): { net: Money; tax: Money; gross: Money } {
  if (rate == null || rate === 0) {
    return { net: amount, tax: money(0, amount.currency), gross: amount };
  }
  const factor = rate / 100;
  if (pack.pricingMode === "tax_inclusive") {
    const net = roundMinor(amount.amount / (1 + factor), pack.roundingMode);
    return {
      net: money(net, amount.currency),
      tax: money(amount.amount - net, amount.currency),
      gross: amount,
    };
  }
  const tax = roundMinor(amount.amount * factor, pack.roundingMode);
  return {
    net: amount,
    tax: money(tax, amount.currency),
    gross: money(amount.amount + tax, amount.currency),
  };
}

// ---------------------------------------------------------------------------
// Cash rounding — FR-POS-063
// ---------------------------------------------------------------------------

/**
 * The smallest coin actually in circulation, in minor units. Cash totals are
 * rounded to it and the difference is carried as its own ledger amount so
 * the tax base is never quietly altered.
 */
const CASH_INCREMENT: Record<Currency, number> = {
  EGP: 25,
  SAR: 5,
  AED: 25,
};

export function roundCash(
  amount: Money,
  pack: CountryPack,
): { rounded: Money; adjustment: Money } {
  const step = CASH_INCREMENT[amount.currency] ?? 1;
  if (step <= 1) return { rounded: amount, adjustment: money(0, amount.currency) };

  const quotient = amount.amount / step;
  // DOWN floors (never charges the customer up); the half modes follow the
  // pack like tax does rather than always rounding half up.
  const rounded =
    pack.roundingMode === "DOWN"
      ? Math.floor(quotient) * step
      : roundMinor(quotient, pack.roundingMode) * step;

  return {
    rounded: money(rounded, amount.currency),
    adjustment: money(rounded - amount.amount, amount.currency),
  };
}

export function cashIncrement(currency: Currency): number {
  return CASH_INCREMENT[currency] ?? 1;
}

// ---------------------------------------------------------------------------
// Line and order arithmetic
// ---------------------------------------------------------------------------

export interface LineDraft {
  item: MenuItem;
  variant: MenuItemVariant;
  quantity: number;
  modifiers: OrderLineModifier[];
  course: number;
  seatNumber: number | null;
  notes: string | null;
  isComp: boolean;
  /** Percentage off this line, 0–100. */
  discountPercent: number;
  price: PriceResolution;
  unitCostMinor: number;
}

/**
 * Recomputes every derived amount on a line. Modifier deltas are per unit,
 * so they scale with quantity — an "extra cheese" on two burgers is charged
 * twice, which is what the kitchen actually does.
 */
export function computeLine(
  line: OrderLine,
  taxClass: TaxClassCode,
  pack: CountryPack,
): OrderLine {
  const currency = line.unitPrice.currency;
  const modifierPerUnit = line.modifiers.reduce((sum, m) => sum + m.priceDelta.amount, 0);
  const gross = (line.unitPrice.amount + modifierPerUnit) * line.quantity;

  const discountRatio = line.lineDiscount.amount === 0 ? 0 : line.lineDiscount.amount / Math.max(1, gross);
  const subtotal = Math.max(0, gross - line.lineDiscount.amount);

  // FR-POS-050 — a comp zeroes revenue but keeps cost and depletion.
  const billable = line.isComp || line.state === "voided" ? 0 : subtotal;
  const { tax } = applyTax(money(billable, currency), taxRateFor(pack, taxClass), pack);

  return {
    ...line,
    modifierTotal: money(modifierPerUnit * line.quantity, currency),
    lineSubtotal: money(subtotal, currency),
    taxAmount: tax,
    lineTotal: money(billable, currency),
    // Kept so a percentage discount survives a quantity change.
    lineDiscount: money(Math.round(gross * discountRatio), currency),
  };
}

export interface OrderTotalsOptions {
  pack: CountryPack;
  /** FR-POS-055 — automatic service charge, percentage of net sales. */
  serviceChargePercent: number;
  /** FR-POS-058 — some jurisdictions tax the service charge, some do not. */
  serviceChargeTaxable: boolean;
  /** Order-level discount as a percentage of the line subtotal. */
  orderDiscountPercent?: number;
  orderDiscountAmountMinor?: number;
}

/**
 * Rebuilds every total on the order from its lines. Called after any edit,
 * so the displayed number and the stored number can never drift apart.
 */
export function computeOrderTotals(order: Order, options: OrderTotalsOptions): Order {
  const { pack } = options;
  const currency = order.currency;
  const zero = money(0, currency);

  const live = order.lines.filter((l) => l.state !== "voided");

  const subtotal = live.reduce((sum, l) => sum + l.lineSubtotal.amount, 0);
  const billable = live.reduce((sum, l) => sum + l.lineTotal.amount, 0);
  const lineDiscounts = live.reduce((sum, l) => sum + l.lineDiscount.amount, 0);
  const compValue = live.filter((l) => l.isComp).reduce((sum, l) => sum + l.lineSubtotal.amount, 0);

  const orderDiscount = options.orderDiscountAmountMinor
    ? Math.min(options.orderDiscountAmountMinor, billable)
    : Math.round((billable * (options.orderDiscountPercent ?? 0)) / 100);

  const afterDiscount = Math.max(0, billable - orderDiscount);

  // Service charge applies to dine-in only in this configuration; the caller
  // decides by passing 0 for other order types.
  const serviceCharge = Math.round((afterDiscount * options.serviceChargePercent) / 100);

  const lineTax = live.reduce((sum, l) => sum + l.taxAmount.amount, 0);
  const serviceTax = options.serviceChargeTaxable
    ? applyTax(money(serviceCharge, currency), taxRateFor(pack, "standard"), pack).tax.amount
    : 0;

  // Under tax-inclusive pricing the tax is already inside the line amounts,
  // so it is reported but not added again.
  const inclusive = pack.pricingMode === "tax_inclusive";
  const grandBeforeRounding =
    afterDiscount + serviceCharge + (inclusive ? 0 : lineTax + serviceTax);

  // The snapshot is per unit (FR-CST-002), as the API defines it.
  const cogs = live.reduce((sum, l) => sum + l.unitCostSnapshot.amount * l.quantity, 0);

  return {
    ...order,
    subtotal: money(subtotal, currency),
    discountTotal: money(lineDiscounts + orderDiscount + compValue, currency),
    serviceChargeTotal: money(serviceCharge, currency),
    taxTotal: money(lineTax + serviceTax, currency),
    roundingAdjustment: order.roundingAdjustment ?? zero,
    grandTotal: money(grandBeforeRounding, currency),
    cogsTotal: money(cogs, currency),
  };
}

export function balanceOf(order: Order): Money {
  return money(
    order.grandTotal.amount + order.roundingAdjustment.amount - order.paidTotal.amount,
    order.currency,
  );
}

// ---------------------------------------------------------------------------
// Recipe expansion — FR-POS-024, BR-INV-002
// ---------------------------------------------------------------------------

export interface StockDelta {
  itemId: Id;
  /** Base units. Negative depletes, positive returns to stock. */
  quantity: number;
  unit: UnitCode;
  costMinor: number;
}

/**
 * Expands a sold line into the stock items it actually consumed.
 *
 * Sub-recipes are expanded transitively, wastage is applied per component,
 * and modifier deltas are applied last so a "no cheese" burger genuinely
 * does not deplete cheese. Getting this wrong is what turns modifier usage
 * into unexplained variance.
 */
export function expandLineToStock(
  line: OrderLine,
  recipesById: Map<Id, Recipe>,
  modifiersById: Map<Id, { recipeDelta: { componentId: Id; operation: string; quantity?: { value: string; unit: UnitCode } }[] }>,
): StockDelta[] {
  if (!line.recipeVersionId) return [];
  const totals = new Map<Id, { quantity: number; unit: UnitCode; unitCostMinor: number }>();

  walkRecipe(line.recipeVersionId, 1, recipesById, totals, 0);

  // Modifier deltas act on the expanded component list.
  for (const applied of line.modifiers) {
    const definition = modifiersById.get(applied.id);
    if (!definition) continue;
    for (const delta of definition.recipeDelta) {
      const existing = totals.get(delta.componentId);
      if (delta.operation === "remove_all") {
        if (existing) totals.set(delta.componentId, { ...existing, quantity: 0 });
        continue;
      }
      if (delta.operation === "add" && delta.quantity) {
        const add = Number(delta.quantity.value);
        totals.set(delta.componentId, {
          quantity: (existing?.quantity ?? 0) + add,
          unit: existing?.unit ?? delta.quantity.unit,
          unitCostMinor: existing?.unitCostMinor ?? 0,
        });
      }
    }
  }

  return [...totals.entries()]
    .filter(([, v]) => v.quantity > 0)
    .map(([itemId, v]) => ({
      itemId,
      quantity: -v.quantity * line.quantity,
      unit: v.unit,
      costMinor: v.quantity * line.quantity * v.unitCostMinor,
    }));
}

function walkRecipe(
  recipeId: Id,
  scale: number,
  recipesById: Map<Id, Recipe>,
  into: Map<Id, { quantity: number; unit: UnitCode; unitCostMinor: number }>,
  depth: number,
): void {
  if (depth > 4) return; // a cycle in the fixture data must not hang the POS
  const recipe = recipesById.get(recipeId);
  if (!recipe) return;

  // FR-MNU-043 — a recipe that loses 18% to trim consumes more, not less.
  const yieldFactor = recipe.yieldPercentage > 0 ? 100 / recipe.yieldPercentage : 1;

  for (const line of recipe.lines) {
    const base = Number(line.quantity.value) * (1 + line.wastagePercentage / 100) * scale * yieldFactor;
    if (line.componentType === "sub_recipe") {
      const sub = recipesById.get(line.componentId);
      const perUnit = sub ? Number(sub.yieldQuantity.value) || 1 : 1;
      walkRecipe(line.componentId, base / perUnit, recipesById, into, depth + 1);
      continue;
    }
    const existing = into.get(line.componentId);
    into.set(line.componentId, {
      quantity: (existing?.quantity ?? 0) + base,
      unit: line.quantity.unit,
      unitCostMinor: line.unitCost.amount,
    });
  }
}

/** Theoretical cost of one portion, from the recipe. */
export function recipeCost(recipeId: Id | null, recipesById: Map<Id, Recipe>): Money {
  if (!recipeId) return money(0, "EGP");
  const recipe = recipesById.get(recipeId);
  return recipe ? recipe.computedCost : money(0, "EGP");
}

export function lineCost(line: OrderLine, recipesById: Map<Id, Recipe>): Money {
  return multiplyMoney(recipeCost(line.recipeVersionId, recipesById), line.quantity);
}

// ---------------------------------------------------------------------------
// Kitchen routing — FR-KDS-010
// ---------------------------------------------------------------------------

/** Which station type each menu category falls back to. */
const CATEGORY_FALLBACK: Record<string, StationType> = {
  cat_shawarma: "shawarma",
  cat_grills: "grill",
  cat_burgers: "grill",
  cat_pasta: "hot_line",
  cat_pizza: "bakery",
  cat_salads: "cold",
  cat_sides: "fryer",
  cat_hot_drinks: "barista",
  cat_cold_drinks: "beverage",
  cat_desserts: "dessert",
  cat_breakfast: "hot_line",
};

/**
 * Resolves a line to a station, walking the precedence in FR-KDS-010:
 * explicit override, modifier-driven rule, the item's own station, the
 * category default, then the branch fallback.
 */
export function routeLine(
  line: OrderLine,
  item: MenuItem | undefined,
  branchStations: Station[],
): Station | null {
  if (branchStations.length === 0) return null;
  const active = branchStations.filter((s) => s.active);
  if (active.length === 0) return null;

  // 1. Explicit override recorded on the line.
  if (line.stationId) {
    const explicit = active.find((s) => s.id === line.stationId);
    if (explicit) return explicit;
  }

  // 2. A modifier that reroutes — "make it crispy" belongs at the fryer.
  const reroute = line.modifiers.find((m) => /crispy|fried|grill/i.test(m.name.en));
  if (reroute) {
    const target: StationType = /crispy|fried/i.test(reroute.name.en) ? "fryer" : "grill";
    const station = active.find((s) => s.type === target);
    if (station) return station;
  }

  // 3. The item's configured station for this branch.
  if (item) {
    const byItem = active.find((s) => s.type === item.stationType);
    if (byItem) return byItem;

    // 4. Category default.
    const fallbackType = CATEGORY_FALLBACK[item.categoryId];
    if (fallbackType) {
      const byCategory = active.find((s) => s.type === fallbackType);
      if (byCategory) return byCategory;
    }
  }

  // 5. Branch fallback — the hot line, or whatever is not the pass.
  return active.find((s) => s.type === "hot_line") ?? active.find((s) => s.type !== "pass") ?? active[0]!;
}

export function passStation(branchStations: Station[]): Station | null {
  return branchStations.find((s) => s.type === "pass" && s.active) ?? null;
}

// ---------------------------------------------------------------------------
// Ticket timing — FR-KDS-022, FR-KDS-044
// ---------------------------------------------------------------------------

export function urgencyFor(elapsedSeconds: number, targetSeconds: number): TicketUrgency {
  if (targetSeconds <= 0) return "on_target";
  const ratio = elapsedSeconds / targetSeconds;
  if (ratio < 0.75) return "on_target";
  if (ratio < 1) return "approaching";
  if (ratio < 1.5) return "exceeded";
  return "critical";
}

export function ticketElapsed(ticket: KitchenTicket, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(ticket.firedAt).getTime()) / 1000));
}

/**
 * FR-KDS-012 — staggered release. Everything on the order should finish at
 * the same moment, so the salad is held back while the steak cooks.
 */
export function releaseOffsetSeconds(linePrepSeconds: number, orderPrepSeconds: number): number {
  return Math.max(0, orderPrepSeconds - linePrepSeconds);
}

// ---------------------------------------------------------------------------
// Search — FR-POS-011, FR-POS-012
// ---------------------------------------------------------------------------

/**
 * Arabic normalisation for menu search: alef forms collapse, taa marbuta
 * becomes haa, alef maqsura becomes yaa, and tashkeel is dropped. Without
 * this the search box silently fails on the spellings staff actually type.
 */
export function normaliseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "") // tashkeel and tatweel
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ → ا
    .replace(/ة/g, "ه") // ة → ه
    .replace(/ى/g, "ي") // ى → ي
    .replace(/[ؤئ]/g, "ء") // ؤ ئ → ء
    .trim();
}

export function matchesSearch(item: MenuItem, term: string): boolean {
  const needle = normaliseSearch(term);
  if (!needle) return true;
  const haystacks = [
    item.name.en,
    item.name.ar,
    item.kitchenName.en,
    item.kitchenName.ar,
    ...item.variants.map((v) => v.barcode ?? ""),
  ];
  return haystacks.some((h) => normaliseSearch(h).includes(needle));
}
