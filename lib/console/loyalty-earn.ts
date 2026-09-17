/**
 * Loyalty points: earning and redemption arithmetic — FR-CRM-016, FR-CRM-017.
 * Pure and integer-only, so the till and the console agree to the point.
 *
 * ## Earning (FR-CRM-016)
 *
 * Points are earned on *net* spend:
 *
 *   - **excluding tax** — when prices include tax, the line's tax is taken
 *     out first; tax collected for the state is not spend with the restaurant;
 *   - **excluding already-discounted amounts** — the discount itself never
 *     earns (a line of 100 discounted by 30 earns on 70), order-level
 *     discounts are spread across the lines by value, and with the
 *     programme's `excludeDiscountedLines` set, a line that carried any
 *     discount earns nothing at all.
 *
 * Both exclusions are per tenant (the programme settings). The result is
 * floored to whole points: a fraction of a point is never promised.
 *
 * ## Redemption (FR-CRM-017)
 *
 * A point is worth `redeemValueMinor` of discount. Redemption never produces
 * change: only whole points are taken, never paying more than is owed, and a
 * remainder smaller than one point's value is left for another tender.
 */

import type { LoyaltyProgramme } from "./types";

export interface EarnLine {
  /** Price × quantity, before any discount, as charged (tax-inclusive or not). */
  grossMinor: number;
  /** Discount taken on this line. */
  lineDiscountMinor: number;
  /** Tax on this line after discount. */
  taxMinor: number;
}

export interface EarnInput {
  lines: EarnLine[];
  /** Whole-order discounts, spread across the lines by value. */
  orderDiscountMinor: number;
  /** Whether `grossMinor` includes tax. */
  taxInclusive: boolean;
  /** Minor units per major unit — 100 for EGP/SAR/AED, 1000 for KWD/BHD/OMR. */
  minorPerMajor: number;
  /** FR-CRM-* promotions may multiply earning; 1 when none applies. */
  pointsMultiplier?: number;
}

export interface EarnBreakdown {
  grossMinor: number;
  discountExcludedMinor: number;
  discountedLinesExcludedMinor: number;
  taxExcludedMinor: number;
  eligibleMinor: number;
  points: number;
}

type EarnRules = Pick<LoyaltyProgramme, "earnRatePerUnit" | "excludeTax" | "excludeDiscountedLines">;

/** FR-CRM-016 */
export function pointsEarned(input: EarnInput, programme: EarnRules): EarnBreakdown {
  const gross = input.lines.reduce((sum, line) => sum + line.grossMinor, 0);
  const afterLine = input.lines.map((line) => Math.max(0, line.grossMinor - line.lineDiscountMinor));
  const afterLineTotal = afterLine.reduce((sum, value) => sum + value, 0);

  // Spread the order discount by value, largest remainder, ties to the earlier line.
  const orderDiscount = Math.min(afterLineTotal, Math.max(0, input.orderDiscountMinor));
  const shares = afterLine.map((value, index) => {
    const exact = afterLineTotal > 0 ? (orderDiscount * value) / afterLineTotal : 0;
    return { index, base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = orderDiscount - shares.reduce((sum, share) => sum + share.base, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.index - b.index)) {
    if (left <= 0) break;
    share.base += 1;
    left -= 1;
  }

  let discountExcluded = 0;
  let discountedLinesExcluded = 0;
  let taxExcluded = 0;
  let eligible = 0;

  input.lines.forEach((line, index) => {
    const orderShare = shares[index]!.base;
    const lineDiscount = Math.min(line.grossMinor, line.lineDiscountMinor) + orderShare;
    const net = Math.max(0, line.grossMinor - lineDiscount);
    discountExcluded += Math.min(line.grossMinor, lineDiscount);

    if (programme.excludeDiscountedLines && lineDiscount > 0) {
      discountedLinesExcluded += net;
      return;
    }
    const tax = programme.excludeTax && input.taxInclusive ? Math.min(net, line.taxMinor) : 0;
    taxExcluded += tax;
    eligible += net - tax;
  });

  const multiplier = input.pointsMultiplier && input.pointsMultiplier > 0 ? input.pointsMultiplier : 1;
  // Integer path: points = floor(eligible × rate × multiplier / minorPerMajor),
  // with the rate held to four decimal places.
  const rate = Math.round(programme.earnRatePerUnit * multiplier * 10_000);
  const points = Math.floor((eligible * rate) / (input.minorPerMajor * 10_000));

  return {
    grossMinor: gross,
    discountExcludedMinor: discountExcluded,
    discountedLinesExcludedMinor: discountedLinesExcluded,
    taxExcludedMinor: taxExcluded,
    eligibleMinor: eligible,
    points: Math.max(0, points),
  };
}

/** FR-CRM-017 — what a number of points pays, and what an amount costs in points. */
export function redemptionFor(
  input: { amountMinor: number; balance: number; requestedPoints?: number | null; capMinor?: number | null },
  programme: Pick<LoyaltyProgramme, "redeemValueMinor">,
): { points: number; valueMinor: number; maxPoints: number } {
  const unit = Math.max(1, Math.round(programme.redeemValueMinor));
  const ceiling = Math.max(0, Math.min(input.amountMinor, input.capMinor ?? Number.POSITIVE_INFINITY));
  // Enough whole points to cover the ceiling, but no more than the balance,
  // and never more value than the ceiling (no change is given in points).
  const coverPoints = Math.floor(ceiling / unit);
  const maxPoints = Math.max(0, Math.min(input.balance, coverPoints));
  const points = Math.max(0, Math.min(maxPoints, Math.floor(input.requestedPoints ?? maxPoints)));
  return { points, valueMinor: points * unit, maxPoints };
}

export interface EarnTestVector {
  name: string;
  input: EarnInput;
  programme: EarnRules;
  expectPoints: number;
}

const RULES: EarnRules = { earnRatePerUnit: 1, excludeTax: true, excludeDiscountedLines: false };

/** FR-CRM-016 — worked examples the calculator and any port must reproduce. */
export const EARN_TEST_VECTORS: EarnTestVector[] = [
  {
    name: "Tax-exclusive prices: tax never enters the base",
    input: { lines: [{ grossMinor: 10_000, lineDiscountMinor: 0, taxMinor: 1_400 }], orderDiscountMinor: 0, taxInclusive: false, minorPerMajor: 100 },
    programme: RULES,
    expectPoints: 100,
  },
  {
    name: "Tax-inclusive prices: tax is taken out first",
    input: { lines: [{ grossMinor: 11_400, lineDiscountMinor: 0, taxMinor: 1_400 }], orderDiscountMinor: 0, taxInclusive: true, minorPerMajor: 100 },
    programme: RULES,
    expectPoints: 100,
  },
  {
    name: "A line discount does not earn",
    input: { lines: [{ grossMinor: 10_000, lineDiscountMinor: 3_000, taxMinor: 0 }], orderDiscountMinor: 0, taxInclusive: false, minorPerMajor: 100 },
    programme: RULES,
    expectPoints: 70,
  },
  {
    name: "An order discount is spread by value and does not earn",
    input: {
      lines: [
        { grossMinor: 7_500, lineDiscountMinor: 0, taxMinor: 0 },
        { grossMinor: 2_500, lineDiscountMinor: 0, taxMinor: 0 },
      ],
      orderDiscountMinor: 1_001,
      taxInclusive: false,
      minorPerMajor: 100,
    },
    programme: RULES,
    expectPoints: 89,
  },
  {
    name: "Discounted lines excluded entirely when configured",
    input: {
      lines: [
        { grossMinor: 5_000, lineDiscountMinor: 500, taxMinor: 0 },
        { grossMinor: 5_000, lineDiscountMinor: 0, taxMinor: 0 },
      ],
      orderDiscountMinor: 0,
      taxInclusive: false,
      minorPerMajor: 100,
    },
    programme: { ...RULES, excludeDiscountedLines: true },
    expectPoints: 50,
  },
  {
    name: "Three-decimal currency, fractional rate, floored",
    input: { lines: [{ grossMinor: 12_345, lineDiscountMinor: 0, taxMinor: 0 }], orderDiscountMinor: 0, taxInclusive: false, minorPerMajor: 1000 },
    programme: { ...RULES, earnRatePerUnit: 2.5 },
    expectPoints: 30,
  },
  {
    name: "Tax kept in the base when the tenant does not exclude it",
    input: { lines: [{ grossMinor: 11_400, lineDiscountMinor: 0, taxMinor: 1_400 }], orderDiscountMinor: 0, taxInclusive: true, minorPerMajor: 100 },
    programme: { ...RULES, excludeTax: false },
    expectPoints: 114,
  },
];

export function runEarnConformance(): { name: string; passed: boolean; actual: number; expected: number }[] {
  return EARN_TEST_VECTORS.map((vector) => {
    const actual = pointsEarned(vector.input, vector.programme).points;
    return { name: vector.name, passed: actual === vector.expectPoints, actual, expected: vector.expectPoints };
  });
}
