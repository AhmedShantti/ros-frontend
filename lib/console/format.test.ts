import { describe, expect, it } from "vitest";
import { currencyExponent, excessPrecision, formatMoney, minorFromInput, signedMinorFromInput, toMajorUnits } from "./format";
import type { Currency } from "./types";

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-2-PRICING — exact minor-unit round trips.
 *
 * A variant price write must never persist a float as truth. `minorFromInput`
 * is the one place a shelf price a person TYPED becomes the minor-unit
 * integer that gets written — this pins that it is exact, currency-exponent
 * aware (never a hardcoded "divide/multiply by 100"), and that entering more
 * fractional digits than the currency allows is caught rather than silently
 * rounded away.
 */

const CURRENCIES: Currency[] = ["EGP", "SAR", "AED"];

describe("minorFromInput / toMajorUnits — exact round trip", () => {
  it.each(CURRENCIES)("%s: a typed shelf price round-trips exactly through minor units", (currency) => {
    const exponent = currencyExponent(currency);
    const typed = "60.00";
    const minor = minorFromInput(typed, exponent);
    expect(minor).toBe(6000);
    expect(toMajorUnits({ amount: minor!, currency })).toBe(60);
  });

  it("reads the exponent it is given, never a hardcoded 100 — a 0-decimal amount is not silently multiplied by 100", () => {
    // Nothing in THIS tenant's currency set (EGP/SAR/AED) is 0-decimal, but
    // the conversion itself must still honor whatever exponent it's passed —
    // never assume 2 unless the caller says so.
    expect(minorFromInput("60", 0)).toBe(60);
    expect(minorFromInput("60", 2)).toBe(6000);
    expect(minorFromInput("60", 3)).toBe(60000);
  });

  it("clamps a negative amount to zero rather than writing a negative price", () => {
    expect(minorFromInput("-5", 2)).toBe(0);
  });

  it("returns null for unreadable input — never coerces it to zero silently", () => {
    expect(minorFromInput("", 2)).toBeNull();
    expect(minorFromInput("abc", 2)).toBeNull();
    expect(minorFromInput(null, 2)).toBeNull();
  });

  it("rounds a sub-unit fraction rather than truncating or drifting", () => {
    expect(minorFromInput("12.005", 2)).toBe(1201); // 12.005 * 100 = 1200.5 -> rounds to 1201
  });
});

describe("excessPrecision — currency-exponent-aware, not a hardcoded '2 decimals'", () => {
  it("flags a third decimal digit for a 2-decimal currency", () => {
    expect(excessPrecision("12.345", 2)).toBe(true);
  });

  it("does not flag exactly the currency's own number of decimals", () => {
    expect(excessPrecision("12.34", 2)).toBe(false);
    expect(excessPrecision("12", 2)).toBe(false);
  });

  it("permits a third decimal digit once the exponent itself is 3 — never assumes 2 for every currency", () => {
    expect(excessPrecision("12.345", 3)).toBe(false);
    expect(excessPrecision("12.3456", 3)).toBe(true);
  });
});

describe("formatMoney — respects the currency's own exponent", () => {
  it.each(CURRENCIES)("%s formats with its own exponent's decimal places", (currency) => {
    const exponent = currencyExponent(currency);
    const text = formatMoney({ amount: 6000, currency }, { locale: "en" });
    const decimals = text.replace(/[^\d.]/g, "").split(".")[1] ?? "";
    expect(decimals).toHaveLength(exponent);
  });
});

/*
 * MENU-MANAGEMENT-SLICE-2-PHASE-3-AVAILABILITY-MODIFIERS —
 * `Modifier.priceDelta` is a signed minor-unit integer: "no cheese" is a
 * genuine discount, not a price floored at zero. `signedMinorFromInput` is
 * `minorFromInput` minus the zero-floor — this pins that positive, zero and
 * negative amounts all round-trip exactly, still currency-exponent-aware.
 */
describe("signedMinorFromInput — a negative amount is a real discount, never clamped to zero", () => {
  it("a positive amount converts exactly", () => {
    expect(signedMinorFromInput("12.34", 2)).toBe(1234);
  });

  it("zero converts to exactly 0", () => {
    expect(signedMinorFromInput("0", 2)).toBe(0);
  });

  it("a negative amount is preserved, not floored at zero", () => {
    expect(signedMinorFromInput("-3", 2)).toBe(-300);
    expect(signedMinorFromInput("-12.34", 2)).toBe(-1234);
  });

  it("respects the given exponent, never a hardcoded 100", () => {
    expect(signedMinorFromInput("-3", 0)).toBe(-3);
    expect(signedMinorFromInput("-3", 3)).toBe(-3000);
  });

  it("returns null for unreadable input, same as minorFromInput", () => {
    expect(signedMinorFromInput("", 2)).toBeNull();
    expect(signedMinorFromInput("abc", 2)).toBeNull();
    expect(signedMinorFromInput(null, 2)).toBeNull();
  });

  it("rounds a sub-unit fraction rather than truncating (JS `Math.round` ties toward +Infinity, same for a negative amount)", () => {
    expect(signedMinorFromInput("-12.005", 2)).toBe(-1200);
  });
});
