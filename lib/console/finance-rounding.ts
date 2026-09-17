/**
 * Rounding as the country pack specifies it — FR-FIN-035.
 *
 * The pack names two things: the rounding *mode* (HALF_UP, HALF_EVEN, DOWN)
 * and the rounding *point* (per line, then summed — or once, on the order
 * total). This module is the one reading of those two fields in the console.
 * It is pure so the tax page, the country-pack drawer and any future caller
 * reach the same number from the same inputs.
 *
 * It deliberately does not carry its own cash-coin table: the smallest coin
 * per currency comes from `cashIncrement` in the till engine, so the console
 * and the till cannot disagree about what a cash total rounds to.
 *
 * The consistency check at the bottom is honest about what a browser can
 * see. The till's arithmetic (`applyTax`, `roundCash` in the engine) is
 * callable here and is compared line for line against the pack policy. The
 * receipt prints the amounts stored on the order, so it inherits whatever the
 * till (demo) or server (live) computed. The server's and the fiscal
 * submission's arithmetic run elsewhere and cannot be observed from here —
 * those surfaces are reported as "not observable", never as matching.
 */

import type { CountryPack, Currency, TaxClassCode } from "./types";
import { applyTax, cashIncrement, roundCash } from "./live/engine";
import { money } from "./format";

export type RoundingMode = CountryPack["roundingMode"];
export type RoundingPoint = CountryPack["computationLevel"];

/** Round a fractional minor-unit amount to an integer under a mode. */
export function roundMinor(value: number, mode: RoundingMode): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Guard against binary noise: 12.5 computed as 12.499999999 must still be a half.
  const nudged = Math.round(abs * 1e6) / 1e6;
  const floor = Math.floor(nudged);
  const fraction = nudged - floor;

  let rounded: number;
  switch (mode) {
    case "DOWN":
      rounded = floor;
      break;
    case "HALF_EVEN":
      if (fraction > 0.5) rounded = floor + 1;
      else if (fraction < 0.5) rounded = floor;
      else rounded = floor % 2 === 0 ? floor : floor + 1;
      break;
    default:
      rounded = fraction >= 0.5 ? floor + 1 : floor;
  }
  return sign * rounded;
}

/** Round to a coin step (minor units) under a mode. */
export function roundToStep(value: number, step: number, mode: RoundingMode): number {
  if (step <= 1) return roundMinor(value, mode);
  return roundMinor(value / step, mode) * step;
}

/** The unrounded tax inside (inclusive) or on top of (exclusive) an amount. */
export function rawTax(
  amountMinor: number,
  rate: number | null,
  pricingMode: CountryPack["pricingMode"],
): number {
  if (rate === null || rate === 0) return 0;
  return pricingMode === "tax_inclusive"
    ? (amountMinor * rate) / (100 + rate)
    : (amountMinor * rate) / 100;
}

export interface RoundingLine {
  label: string;
  /** Shelf amount in minor units — gross under inclusive, net under exclusive. */
  amountMinor: number;
  rate: number | null;
  taxClass?: TaxClassCode;
}

export interface RoundedDocument {
  lineTax: number[];
  taxTotal: number;
  grandTotal: number;
  cashTotal: number;
  cashAdjustment: number;
}

/**
 * Compute a document's tax and totals with an explicit policy.
 *
 * `point: "line"` rounds each line's tax and sums (FR-FIN-034);
 * `point: "order"` sums the unrounded tax and rounds once.
 */
export function roundDocument(
  lines: RoundingLine[],
  policy: {
    mode: RoundingMode;
    point: RoundingPoint;
    pricingMode: CountryPack["pricingMode"];
    currency: Currency;
  },
): RoundedDocument {
  const raw = lines.map((line) => rawTax(line.amountMinor, line.rate, policy.pricingMode));
  const lineTax = raw.map((value) => roundMinor(value, policy.mode));
  const taxTotal =
    policy.point === "line"
      ? lineTax.reduce((sum, value) => sum + value, 0)
      : roundMinor(raw.reduce((sum, value) => sum + value, 0), policy.mode);
  const shelf = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const grandTotal = policy.pricingMode === "tax_inclusive" ? shelf : shelf + taxTotal;
  const cashTotal = roundToStep(grandTotal, cashIncrement(policy.currency), policy.mode);
  return { lineTax, taxTotal, grandTotal, cashTotal, cashAdjustment: cashTotal - grandTotal };
}

/** The policy a pack specifies — the only way callers should build one. */
export function packPolicy(pack: CountryPack) {
  return {
    mode: pack.roundingMode,
    point: pack.computationLevel,
    pricingMode: pack.pricingMode,
    currency: pack.currency,
  };
}

export type RoundingSurface = "pack" | "pos" | "receipt" | "server" | "fiscal";

export interface SurfaceResult {
  surface: RoundingSurface;
  /** Null when this surface's arithmetic cannot be observed from the browser. */
  result: RoundedDocument | null;
  /** How the figure was obtained. */
  source: "pack_policy" | "till_engine" | "stored_on_order" | "not_observable";
  /** True when `result` differs from the pack policy on any figure. */
  differs: boolean;
}

/**
 * FR-FIN-035 — the same sample lines through every surface we can observe.
 *
 * The till surface calls the engine's real `applyTax` per line and its real
 * `roundCash`; any disagreement with the pack policy is a defect worth
 * seeing, and is flagged rather than smoothed over.
 */
export function roundingConsistency(pack: CountryPack, lines: RoundingLine[]): SurfaceResult[] {
  const reference = roundDocument(lines, packPolicy(pack));

  const tillLineTax = lines.map(
    (line) => applyTax(money(line.amountMinor, pack.currency), line.rate, pack).tax.amount,
  );
  const tillTax = tillLineTax.reduce((sum, value) => sum + value, 0);
  const shelf = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const tillGrand = pack.pricingMode === "tax_inclusive" ? shelf : shelf + tillTax;
  const tillCash = roundCash(money(tillGrand, pack.currency), pack);
  const till: RoundedDocument = {
    lineTax: tillLineTax,
    taxTotal: tillTax,
    grandTotal: tillGrand,
    cashTotal: tillCash.rounded.amount,
    cashAdjustment: tillCash.adjustment.amount,
  };

  const same = (a: RoundedDocument, b: RoundedDocument) =>
    a.taxTotal === b.taxTotal &&
    a.grandTotal === b.grandTotal &&
    a.cashTotal === b.cashTotal &&
    a.lineTax.every((value, index) => value === b.lineTax[index]);

  const tillDiffers = !same(till, reference);

  return [
    { surface: "pack", result: reference, source: "pack_policy", differs: false },
    { surface: "pos", result: till, source: "till_engine", differs: tillDiffers },
    // A receipt prints the order's stored amounts, which the till computed.
    { surface: "receipt", result: till, source: "stored_on_order", differs: tillDiffers },
    { surface: "server", result: null, source: "not_observable", differs: false },
    { surface: "fiscal", result: null, source: "not_observable", differs: false },
  ];
}

/** Sample lines that exercise half-unit boundaries under the pack's rates. */
export function sampleLines(pack: CountryPack): RoundingLine[] {
  const standard = pack.taxClasses.find((row) => row.code === "standard")?.rate ?? null;
  const reduced = pack.taxClasses.find((row) => row.code === "reduced")?.rate ?? standard;
  return [
    { label: "A", amountMinor: 1_995, rate: standard, taxClass: "standard" },
    { label: "B", amountMinor: 4_250, rate: standard, taxClass: "standard" },
    { label: "C", amountMinor: 1_049, rate: reduced, taxClass: "reduced" },
    { label: "D", amountMinor: 333, rate: standard, taxClass: "standard" },
  ];
}
