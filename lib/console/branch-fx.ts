/**
 * Currency conversion for consolidated reporting — FR-BRN-003, FR-BRN-004.
 *
 * BR-CORE-001 forbids adding money in different currencies, and that rule is
 * kept: nothing here adds an EGP amount to a SAR amount. A consolidated total
 * is a *separate* figure, produced by converting each original amount at a
 * rate that is named — its value, where it came from and the date it applies
 * to — so a reader can redo the arithmetic. An amount with no rate on or
 * before the report date is never guessed: it is left out of the total and
 * the total is marked incomplete, naming the missing pair.
 *
 * The arithmetic is exact. Rates are decimal strings scaled to integers
 * (1e8), and the product with minor units is done in BigInt with half-up
 * rounding, so converting 1,234.56 at 0.07712 lands on the same minor unit
 * on every device.
 */

import { currencyExponent } from "./format";
import type { Currency, Id, IsoDate, IsoDateTime, Money } from "./types";

export const REPORTING_CURRENCIES: Currency[] = ["EGP", "SAR", "AED"];

/** One quoted rate: 1 unit of `base` buys `rate` units of `quote`. */
export interface FxRate {
  id: Id;
  base: Currency;
  quote: Currency;
  /** Decimal string, up to 8 places. Never a float on the way in. */
  rate: string;
  /** Central bank, treasury desk, contract rate… shown next to every conversion. */
  source: string;
  /** The day the rate applies from. */
  rateDate: IsoDate;
  enteredBy: string | null;
  enteredAt: IsoDateTime;
}

const SCALE = 100_000_000n;

/** A decimal string as an integer scaled by 1e8, or null if it is not a positive decimal. */
export function scaledRate(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const scaled = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(8, "0"));
  return scaled > 0n ? scaled : null;
}

/** Validation message for a rate being entered, or null when it is usable. */
export function rateProblem(input: { base: string; quote: string; rate: string; source: string; rateDate: string }): string | null {
  if (!input.base || !input.quote) return "Choose both currencies.";
  if (input.base === input.quote) return "A rate converts between two different currencies.";
  if (scaledRate(input.rate) === null) return "The rate must be a positive decimal with at most 8 places.";
  if (!input.source.trim()) return "Name the rate source — a consolidated total with an unstated rate cannot be checked.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.rateDate)) return "Give the date the rate applies from.";
  return null;
}

export interface AppliedRate {
  rateId: Id;
  /** As quoted, in the direction it was entered. */
  quoted: string;
  base: Currency;
  quote: Currency;
  /** True when the conversion used 1 ÷ the quoted rate. */
  inverted: boolean;
  source: string;
  rateDate: IsoDate;
}

/**
 * The rate in force for `from → to` on `asOf`: the latest dated on or before
 * it, in either direction (a direct quote wins a tie with an inverse one).
 */
export function findRate(rates: FxRate[], from: Currency, to: Currency, asOf: IsoDate): AppliedRate | null {
  const candidates = rates
    .filter((row) => row.rateDate <= asOf && scaledRate(row.rate) !== null)
    .filter((row) => (row.base === from && row.quote === to) || (row.base === to && row.quote === from))
    .sort((a, b) => {
      if (a.rateDate !== b.rateDate) return b.rateDate.localeCompare(a.rateDate);
      const direct = (row: FxRate) => (row.base === from ? 0 : 1);
      if (direct(a) !== direct(b)) return direct(a) - direct(b);
      return b.enteredAt.localeCompare(a.enteredAt);
    });
  const row = candidates[0];
  if (!row) return null;
  return {
    rateId: row.id,
    quoted: row.rate,
    base: row.base,
    quote: row.quote,
    inverted: row.base !== from,
    source: row.source,
    rateDate: row.rateDate,
  };
}

/** Half-up integer division for signed BigInts. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
}

/** Convert minor units exactly. Same currency is returned untouched. */
export function convertMoney(money: Money, to: Currency, applied: AppliedRate | null): Money | null {
  if (money.currency === to) return money;
  if (!applied) return null;
  const scaled = scaledRate(applied.quoted);
  if (scaled === null) return null;
  const shift = currencyExponent(to) - currencyExponent(money.currency);
  const amount = BigInt(money.amount);
  const power = 10n ** BigInt(Math.abs(shift));
  let numerator: bigint;
  let denominator: bigint;
  if (applied.inverted) {
    numerator = amount * SCALE;
    denominator = scaled;
  } else {
    numerator = amount * scaled;
    denominator = SCALE;
  }
  if (shift >= 0) numerator *= power;
  else denominator *= power;
  return { amount: Number(divideHalfUp(numerator, denominator)), currency: to };
}

/** The effective multiplier as a readable decimal, e.g. "0.0771". */
export function effectiveRate(applied: AppliedRate): string {
  const scaled = scaledRate(applied.quoted);
  if (scaled === null) return "—";
  const value = applied.inverted ? Number(SCALE) / Number(scaled) : Number(scaled) / Number(SCALE);
  return value.toPrecision(6).replace(/\.?0+$/, "");
}

export interface ConsolidatedLine<K extends string = string> {
  key: K;
  original: Money;
  converted: Money | null;
  rate: AppliedRate | null;
}

export interface Consolidation<K extends string = string> {
  reportingCurrency: Currency;
  asOf: IsoDate;
  lines: ConsolidatedLine<K>[];
  /** Sum of what could be converted. */
  total: Money;
  /** Original-currency subtotals — shown beside the converted total. */
  byCurrency: Money[];
  /** Pairs with no rate on or before `asOf`. */
  missing: Currency[];
  complete: boolean;
}

/** FR-BRN-004 — originals, per-line conversion with the rate named, and a converted total. */
export function consolidate<K extends string>(
  amounts: { key: K; money: Money }[],
  reportingCurrency: Currency,
  rates: FxRate[],
  asOf: IsoDate,
): Consolidation<K> {
  const lines = amounts.map<ConsolidatedLine<K>>(({ key, money }) => {
    const rate = money.currency === reportingCurrency ? null : findRate(rates, money.currency, reportingCurrency, asOf);
    return { key, original: money, rate, converted: convertMoney(money, reportingCurrency, rate) };
  });
  const byCurrencyMap = new Map<Currency, number>();
  for (const line of lines) {
    byCurrencyMap.set(line.original.currency, (byCurrencyMap.get(line.original.currency) ?? 0) + line.original.amount);
  }
  const missing = [...new Set(lines.filter((line) => line.converted === null).map((line) => line.original.currency))];
  return {
    reportingCurrency,
    asOf,
    lines,
    total: {
      amount: lines.reduce((sum, line) => sum + (line.converted?.amount ?? 0), 0),
      currency: reportingCurrency,
    },
    byCurrency: [...byCurrencyMap.entries()].map(([currency, amount]) => ({ amount, currency })),
    missing,
    complete: missing.length === 0,
  };
}
