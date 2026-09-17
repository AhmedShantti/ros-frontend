/**
 * Tax-rate resolution from country-pack data — FR-FIN-033, FR-FIN-030.
 *
 * A rate is read from the pack's tax class, and where the pack's jurisdiction
 * differentiates by order type (dine-in against takeaway, say) the class
 * carries `orderTypeRates`. Nothing in this file names a country or a rate:
 * a pack that does not differentiate simply returns the class rate for every
 * order type, and `packDifferentiatesOrderTypes` lets the UI say so plainly
 * instead of implying a distinction the jurisdiction does not make.
 */

import type { CountryPack, OrderType, TaxClassCode } from "./types";

export const ORDER_TYPES: OrderType[] = [
  "dine_in",
  "takeaway",
  "delivery",
  "drive_thru",
  "pickup",
  "aggregator",
];

export const TAX_CLASS_CODES: TaxClassCode[] = ["standard", "reduced", "zero", "exempt"];

/** Rate in percent, or null when the class is exempt or the pack lacks it. */
export function rateFor(
  pack: CountryPack,
  taxClass: TaxClassCode,
  orderType: OrderType,
): { rate: number | null; defined: boolean; overridden: boolean } {
  const definition = pack.taxClasses.find((row) => row.code === taxClass);
  if (!definition) return { rate: null, defined: false, overridden: false };
  const specific = definition.orderTypeRates?.[orderType];
  if (typeof specific === "number") return { rate: specific, defined: true, overridden: true };
  return { rate: definition.rate, defined: true, overridden: false };
}

export function packDifferentiatesOrderTypes(pack: CountryPack): boolean {
  return pack.taxClasses.some(
    (row) =>
      row.orderTypeRates &&
      Object.values(row.orderTypeRates).some((rate) => typeof rate === "number" && rate !== row.rate),
  );
}

/** Net/tax/gross of a shelf amount under a pricing mode — for worked examples. */
export function splitTax(
  shelfMinor: number,
  rate: number | null,
  pricingMode: CountryPack["pricingMode"],
): { net: number; tax: number; gross: number } {
  if (rate === null || rate === 0) return { net: shelfMinor, tax: 0, gross: shelfMinor };
  if (pricingMode === "tax_inclusive") {
    const net = Math.round((shelfMinor * 100) / (100 + rate));
    return { net, tax: shelfMinor - net, gross: shelfMinor };
  }
  const tax = Math.round((shelfMinor * rate) / 100);
  return { net: shelfMinor, tax, gross: shelfMinor + tax };
}
