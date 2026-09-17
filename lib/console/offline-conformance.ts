/**
 * The shared-logic conformance corpus — FR-OFF-050.
 *
 * Business logic that must give identical answers on the till and on the
 * server is specified here as data: each vector names the function, its
 * inputs and the expected output, in plain JSON with minor-unit integers and
 * no language-specific types. The same corpus is exported from the console
 * as a JSON file for the server's TypeScript suite and the Dart client suite
 * to execute; this module is the browser client's runner for it.
 *
 * Scope covered by this client runner: tax computation and rounding, cash
 * rounding, minor-unit allocation (discount and combo distribution),
 * modifier price by context, price resolution, and discount stacking. Loyalty
 * accrual and recipe expansion are in the SRS corpus scope but have no pure
 * client function in this build, so they have no vectors here.
 */

import type { CountryPack, MenuItem, MenuItemVariant, ModifierPriceRule, PriceList } from "./types";
import {
  allocateMinor,
  applyTax,
  resolveModifierDelta,
  resolvePrice,
  resolveStacking,
  roundCash,
  type StackEntry,
  type StackingPolicy,
} from "./live/engine";

export type ConformanceArea =
  | "tax"
  | "cash_rounding"
  | "allocation"
  | "modifier_price"
  | "price_resolution"
  | "discount_stacking";

export const CONFORMANCE_AREAS: ConformanceArea[] = [
  "tax",
  "cash_rounding",
  "allocation",
  "modifier_price",
  "price_resolution",
  "discount_stacking",
];

export interface ConformanceVector {
  id: string;
  area: ConformanceArea;
  description: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface ConformanceCorpus {
  corpus: "ros-shared-logic";
  version: string;
  vectors: ConformanceVector[];
}

export interface VectorOutcome {
  vector: ConformanceVector;
  pass: boolean;
  actual: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

const pack = (pricingMode: "tax_inclusive" | "tax_exclusive", roundingMode: "HALF_UP" | "HALF_EVEN" | "DOWN" = "HALF_UP") => ({
  pricingMode,
  roundingMode,
});

const list = (partial: Record<string, unknown>) => ({
  id: "pl",
  scope: "branch",
  scopeId: null,
  orderTypes: [],
  priority: 0,
  recurrence: null,
  active: true,
  entries: [],
  ...partial,
});

export const CORPUS: ConformanceCorpus = {
  corpus: "ros-shared-logic",
  version: "2026.09.1",
  vectors: [
    // -- Tax ---------------------------------------------------------------
    { id: "tax-eg-inclusive-14-exact-001", area: "tax", description: "EG tax-inclusive 14%: gross 114.00 splits to 100.00 net + 14.00 tax",
      input: { amountMinor: 11400, currency: "EGP", rate: 14, pack: pack("tax_inclusive") },
      expected: { netMinor: 10000, taxMinor: 1400, grossMinor: 11400 } },
    { id: "tax-eg-inclusive-14-rounding-002", area: "tax", description: "EG tax-inclusive 14%: 10.00 gross, net rounds half-up and tax takes the remainder",
      input: { amountMinor: 1000, currency: "EGP", rate: 14, pack: pack("tax_inclusive") },
      expected: { netMinor: 877, taxMinor: 123, grossMinor: 1000 } },
    { id: "tax-sa-exclusive-15-003", area: "tax", description: "SA tax-exclusive 15%: 19.99 net, tax 2.9985 rounds to 3.00",
      input: { amountMinor: 1999, currency: "SAR", rate: 15, pack: pack("tax_exclusive") },
      expected: { netMinor: 1999, taxMinor: 300, grossMinor: 2299 } },
    { id: "tax-exclusive-half-up-004", area: "tax", description: "Tax-exclusive 5% on 2.50: exactly half a minor unit rounds up",
      input: { amountMinor: 250, currency: "AED", rate: 5, pack: pack("tax_exclusive") },
      expected: { netMinor: 250, taxMinor: 13, grossMinor: 263 } },
    { id: "tax-exempt-null-rate-005", area: "tax", description: "Exempt (no rate) produces no tax at all",
      input: { amountMinor: 5000, currency: "EGP", rate: null, pack: pack("tax_inclusive") },
      expected: { netMinor: 5000, taxMinor: 0, grossMinor: 5000 } },
    { id: "tax-zero-rated-006", area: "tax", description: "Zero-rated is taxed at zero",
      input: { amountMinor: 5000, currency: "SAR", rate: 0, pack: pack("tax_exclusive") },
      expected: { netMinor: 5000, taxMinor: 0, grossMinor: 5000 } },

    // -- Cash rounding -----------------------------------------------------
    { id: "cash-egp-half-up-down-001", area: "cash_rounding", description: "EGP to the 0.25 coin: 12.60 rounds down to 12.50",
      input: { amountMinor: 1260, currency: "EGP", pack: pack("tax_inclusive", "HALF_UP") },
      expected: { roundedMinor: 1250, adjustmentMinor: -10 } },
    { id: "cash-egp-half-up-up-002", area: "cash_rounding", description: "EGP to the 0.25 coin: 12.63 rounds up to 12.75",
      input: { amountMinor: 1263, currency: "EGP", pack: pack("tax_inclusive", "HALF_UP") },
      expected: { roundedMinor: 1275, adjustmentMinor: 12 } },
    { id: "cash-sar-down-003", area: "cash_rounding", description: "SAR rounding DOWN to 0.05: 19.98 becomes 19.95",
      input: { amountMinor: 1998, currency: "SAR", pack: pack("tax_exclusive", "DOWN") },
      expected: { roundedMinor: 1995, adjustmentMinor: -3 } },
    { id: "cash-exact-004", area: "cash_rounding", description: "An amount already on the coin is unchanged",
      input: { amountMinor: 1275, currency: "EGP", pack: pack("tax_inclusive", "HALF_UP") },
      expected: { roundedMinor: 1275, adjustmentMinor: 0 } },

    // -- Allocation --------------------------------------------------------
    { id: "alloc-thirds-001", area: "allocation", description: "10.00 across three equal weights: the extra unit goes to the first",
      input: { totalMinor: 1000, weights: [1, 1, 1] }, expected: { parts: [334, 333, 333] } },
    { id: "alloc-largest-remainder-002", area: "allocation", description: "10.01 split 2:1 — the leftover unit goes to the larger remainder",
      input: { totalMinor: 1001, weights: [2, 1] }, expected: { parts: [667, 334] } },
    { id: "alloc-zero-weights-003", area: "allocation", description: "All-zero weights fall back to an equal split",
      input: { totalMinor: 500, weights: [0, 0] }, expected: { parts: [250, 250] } },
    { id: "alloc-exact-004", area: "allocation", description: "Weights that divide exactly allocate exactly",
      input: { totalMinor: 100, weights: [1, 2, 3, 4] }, expected: { parts: [10, 20, 30, 40] } },
    { id: "alloc-sevens-005", area: "allocation", description: "0.07 across three: parts always sum to the total",
      input: { totalMinor: 7, weights: [1, 1, 1] }, expected: { parts: [3, 2, 2] } },

    // -- Modifier price by context ----------------------------------------
    { id: "mod-default-001", area: "modifier_price", description: "No matching rule: the modifier's own delta applies",
      input: { modifier: { id: "m1", priceDeltaMinor: 500, currency: "EGP" }, rules: [], context: { orderType: "dine_in", branchId: "b1", priceListId: null } },
      expected: { priceDeltaMinor: 500, ruleId: null } },
    { id: "mod-order-type-beats-branch-002", area: "modifier_price", description: "A rule naming the order type beats one naming only the branch",
      input: {
        modifier: { id: "m1", priceDeltaMinor: 500, currency: "EGP" },
        rules: [
          { id: "r-branch", modifierId: "m1", orderType: null, branchId: "b1", priceListId: null, priceDeltaMinor: 300, updatedAt: "2026-01-02T00:00:00Z" },
          { id: "r-dine", modifierId: "m1", orderType: "dine_in", branchId: null, priceListId: null, priceDeltaMinor: 0, updatedAt: "2026-01-01T00:00:00Z" },
        ],
        context: { orderType: "dine_in", branchId: "b1", priceListId: null },
      },
      expected: { priceDeltaMinor: 0, ruleId: "r-dine" } },
    { id: "mod-non-matching-type-003", area: "modifier_price", description: "Delivery does not match the dine-in rule; the branch rule applies",
      input: {
        modifier: { id: "m1", priceDeltaMinor: 500, currency: "EGP" },
        rules: [
          { id: "r-branch", modifierId: "m1", orderType: null, branchId: "b1", priceListId: null, priceDeltaMinor: 300, updatedAt: "2026-01-02T00:00:00Z" },
          { id: "r-dine", modifierId: "m1", orderType: "dine_in", branchId: null, priceListId: null, priceDeltaMinor: 0, updatedAt: "2026-01-01T00:00:00Z" },
        ],
        context: { orderType: "delivery", branchId: "b1", priceListId: null },
      },
      expected: { priceDeltaMinor: 300, ruleId: "r-branch" } },
    { id: "mod-newest-breaks-tie-004", area: "modifier_price", description: "Two equally specific rules: the most recently updated wins",
      input: {
        modifier: { id: "m1", priceDeltaMinor: 500, currency: "EGP" },
        rules: [
          { id: "r-old", modifierId: "m1", orderType: null, branchId: "b1", priceListId: null, priceDeltaMinor: 250, updatedAt: "2026-01-01T00:00:00Z" },
          { id: "r-new", modifierId: "m1", orderType: null, branchId: "b1", priceListId: null, priceDeltaMinor: 400, updatedAt: "2026-03-01T00:00:00Z" },
        ],
        context: { orderType: "takeaway", branchId: "b1", priceListId: null },
      },
      expected: { priceDeltaMinor: 400, ruleId: "r-new" } },

    // -- Price resolution --------------------------------------------------
    { id: "price-base-001", area: "price_resolution", description: "No price list: the variant's base price",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "dine_in", branchId: "b1", brandId: "br1", minuteOfDay: 720, priceLists: [] } },
      expected: { priceMinor: 2500, source: "base", priceListId: null } },
    { id: "price-override-002", area: "price_resolution", description: "A manual override wins over everything",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "dine_in", branchId: "b1", brandId: "br1", minuteOfDay: 720, overrideMinor: 1800,
        priceLists: [list({ id: "pl-branch", scope: "branch", scopeId: "b1", entries: [{ variantId: "v1", priceMinor: 2300 }] })] } },
      expected: { priceMinor: 1800, source: "override", priceListId: null } },
    { id: "price-branch-beats-brand-003", area: "price_resolution", description: "A branch list beats a brand list",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "dine_in", branchId: "b1", brandId: "br1", minuteOfDay: 720,
        priceLists: [
          list({ id: "pl-brand", scope: "brand", scopeId: "br1", entries: [{ variantId: "v1", priceMinor: 2400 }] }),
          list({ id: "pl-branch", scope: "branch", scopeId: "b1", entries: [{ variantId: "v1", priceMinor: 2300 }] }),
        ] } },
      expected: { priceMinor: 2300, source: "branch_price_list", priceListId: "pl-branch" } },
    { id: "price-happy-hour-in-window-004", area: "price_resolution", description: "Inside 15:00–18:00 the recurring list wins",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "dine_in", branchId: "b1", brandId: "br1", minuteOfDay: 960,
        priceLists: [
          list({ id: "pl-branch", scope: "branch", scopeId: "b1", entries: [{ variantId: "v1", priceMinor: 2300 }] }),
          list({ id: "pl-happy", scope: "branch", scopeId: "b1", recurrence: "daily 15:00-18:00", entries: [{ variantId: "v1", priceMinor: 2000 }] }),
        ] } },
      expected: { priceMinor: 2000, source: "time_price_list", priceListId: "pl-happy" } },
    { id: "price-happy-hour-outside-005", area: "price_resolution", description: "At 19:00 the recurring list is closed; the branch list applies",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "dine_in", branchId: "b1", brandId: "br1", minuteOfDay: 1140,
        priceLists: [
          list({ id: "pl-branch", scope: "branch", scopeId: "b1", entries: [{ variantId: "v1", priceMinor: 2300 }] }),
          list({ id: "pl-happy", scope: "branch", scopeId: "b1", recurrence: "daily 15:00-18:00", entries: [{ variantId: "v1", priceMinor: 2000 }] }),
        ] } },
      expected: { priceMinor: 2300, source: "branch_price_list", priceListId: "pl-branch" } },
    { id: "price-order-type-006", area: "price_resolution", description: "A delivery-only list applies to a delivery order",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "delivery", branchId: "b1", brandId: "br1", minuteOfDay: 720,
        priceLists: [
          list({ id: "pl-branch", scope: "branch", scopeId: "b1", entries: [{ variantId: "v1", priceMinor: 2300 }] }),
          list({ id: "pl-delivery", scope: "brand", scopeId: "br1", orderTypes: ["delivery"], entries: [{ variantId: "v1", priceMinor: 2600 }] }),
        ] } },
      expected: { priceMinor: 2600, source: "order_type_price_list", priceListId: "pl-delivery" } },
    { id: "price-inactive-ignored-007", area: "price_resolution", description: "An inactive list is never used",
      input: { variant: { id: "v1", basePriceMinor: 2500, currency: "EGP" }, context: { orderType: "dine_in", branchId: "b1", brandId: "br1", minuteOfDay: 720,
        priceLists: [list({ id: "pl-off", scope: "branch", scopeId: "b1", active: false, entries: [{ variantId: "v1", priceMinor: 1000 }] })] } },
      expected: { priceMinor: 2500, source: "base", priceListId: null } },

    // -- Discount stacking -------------------------------------------------
    { id: "stack-apply-001", area: "discount_stacking", description: "Nothing on the order: the discount applies",
      input: { active: [], candidate: { amountMinor: 500, exclusive: false }, policy: "stack" },
      expected: { outcome: "apply", conflictIds: [] } },
    { id: "stack-exclusive-replaces-002", area: "discount_stacking", description: "An exclusive discount worth more replaces what it conflicts with",
      input: { active: [{ id: "d1", amountMinor: 300, exclusive: false }], candidate: { amountMinor: 500, exclusive: true }, policy: "stack" },
      expected: { outcome: "replace", conflictIds: ["d1"] } },
    { id: "stack-exclusive-loses-003", area: "discount_stacking", description: "An exclusive discount worth less than the combined ones does not apply",
      input: { active: [{ id: "d1", amountMinor: 300, exclusive: false }, { id: "d2", amountMinor: 300, exclusive: false }], candidate: { amountMinor: 500, exclusive: true }, policy: "stack" },
      expected: { outcome: "keep_existing", conflictIds: ["d1", "d2"] } },
    { id: "stack-best-single-tie-004", area: "discount_stacking", description: "Best-single policy: a tie keeps what is already there",
      input: { active: [{ id: "d1", amountMinor: 300, exclusive: false }], candidate: { amountMinor: 300, exclusive: false }, policy: "best_single" },
      expected: { outcome: "keep_existing", conflictIds: ["d1"] } },
    { id: "stack-joins-non-exclusive-005", area: "discount_stacking", description: "Stacking policy: a non-exclusive discount joins non-exclusive ones",
      input: { active: [{ id: "d1", amountMinor: 300, exclusive: false }], candidate: { amountMinor: 200, exclusive: false }, policy: "stack" },
      expected: { outcome: "apply", conflictIds: [] } },
  ],
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Input = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const m = (amount: number, currency: string) => ({ amount, currency }) as never;

function packOf(input: Input): CountryPack {
  return { pricingMode: input.pricingMode, roundingMode: input.roundingMode } as CountryPack;
}

function execute(vector: ConformanceVector): Record<string, unknown> {
  const input = vector.input as Input;
  switch (vector.area) {
    case "tax": {
      const out = applyTax(m(input.amountMinor, input.currency), input.rate, packOf(input.pack));
      return { netMinor: out.net.amount, taxMinor: out.tax.amount, grossMinor: out.gross.amount };
    }
    case "cash_rounding": {
      const out = roundCash(m(input.amountMinor, input.currency), packOf(input.pack));
      return { roundedMinor: out.rounded.amount, adjustmentMinor: out.adjustment.amount };
    }
    case "allocation":
      return { parts: allocateMinor(input.totalMinor, input.weights) };
    case "modifier_price": {
      const rules = (input.rules as Input[]).map(
        (rule) => ({ ...rule, priceDelta: m(rule.priceDeltaMinor, input.modifier.currency) }) as unknown as ModifierPriceRule,
      );
      const out = resolveModifierDelta(
        { id: input.modifier.id, priceDelta: m(input.modifier.priceDeltaMinor, input.modifier.currency) },
        rules,
        input.context,
      );
      return { priceDeltaMinor: out.priceDelta.amount, ruleId: out.ruleId };
    }
    case "price_resolution": {
      const currency = input.variant.currency;
      const variant = { id: input.variant.id, basePrice: m(input.variant.basePriceMinor, currency) } as unknown as MenuItemVariant;
      const priceLists = (input.context.priceLists as Input[]).map(
        (entry) =>
          ({
            ...entry,
            name: { en: entry.id, ar: entry.id },
            entries: (entry.entries as Input[]).map((row) => ({ variantId: row.variantId, price: m(row.priceMinor, currency) })),
          }) as unknown as PriceList,
      );
      const out = resolvePrice({} as MenuItem, variant, { ...input.context, priceLists });
      return { priceMinor: out.price.amount, source: out.source, priceListId: out.priceListId };
    }
    case "discount_stacking": {
      const out = resolveStacking(input.active as StackEntry[], input.candidate, input.policy as StackingPolicy);
      return { outcome: out.outcome, conflictIds: out.conflictIds };
    }
    default:
      throw new Error(`No runner for area "${String(vector.area)}"`);
  }
}

/** Key-order-independent JSON, so `{a,b}` and `{b,a}` compare equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function runVector(vector: ConformanceVector): VectorOutcome {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  try {
    const actual = execute(vector);
    // Only the keys the vector specifies are compared.
    const projected = Object.fromEntries(Object.keys(vector.expected).map((key) => [key, actual[key]]));
    return { vector, pass: canonical(projected) === canonical(vector.expected), actual, error: null, durationMs: elapsed() };
  } catch (error) {
    return { vector, pass: false, actual: null, error: error instanceof Error ? error.message : String(error), durationMs: elapsed() };
  }
}

export function runCorpus(corpus: ConformanceCorpus): VectorOutcome[] {
  return corpus.vectors.map(runVector);
}

/** Validates an imported corpus file before running it. */
export function parseCorpus(text: string): { corpus: ConformanceCorpus | null; error: string | null } {
  try {
    const raw = JSON.parse(text) as Partial<ConformanceCorpus>;
    if (!raw || !Array.isArray(raw.vectors)) return { corpus: null, error: "vectors" };
    for (const vector of raw.vectors) {
      if (
        !vector ||
        typeof vector.id !== "string" ||
        !CONFORMANCE_AREAS.includes(vector.area) ||
        typeof vector.input !== "object" ||
        typeof vector.expected !== "object"
      ) {
        return { corpus: null, error: typeof vector?.id === "string" ? vector.id : "vector" };
      }
    }
    return {
      corpus: { corpus: "ros-shared-logic", version: String(raw.version ?? "imported"), vectors: raw.vectors as ConformanceVector[] },
      error: null,
    };
  } catch {
    return { corpus: null, error: "json" };
  }
}
