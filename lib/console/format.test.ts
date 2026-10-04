import { describe, expect, it } from "vitest";
import {
  compareMinorUnits,
  currencyExponent,
  excessPrecision,
  formatExactMoney,
  formatMoney,
  minorFromInput,
  signedMinorFromInput,
  toMajorUnits,
} from "./format";
import type { Currency } from "./types";

/** `Intl.NumberFormat` currency output uses a non-breaking space (ICU's own choice) between symbol and amount — normalize before comparing against a plain-space literal. */
const plain = (value: string): string => value.replace(/\s/g, " ");

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

/*
 * FR-INV-015 — a stock valuation total can exceed `Number.MAX_SAFE_INTEGER`
 * for a large enough tenant. `formatExactMoney`/`compareMinorUnits` are the
 * two places that value is ever touched after leaving the wire, and
 * neither may route it through `Number`/`parseInt`/`parseFloat`.
 */
describe("formatExactMoney — exact past Number.MAX_SAFE_INTEGER, never through Number()", () => {
  const BIG = "9007199254740993"; // Number(BIG) rounds to ...992 — the bug this guards against.

  it("matches formatMoney's own output for an ordinary value (same visual convention)", () => {
    expect(formatExactMoney("12550", "EGP", { locale: "en" })).toBe(
      formatMoney({ amount: 12550, currency: "EGP" }, { locale: "en" }),
    );
  });

  it("retains every digit for a value past Number.MAX_SAFE_INTEGER", () => {
    expect(String(Number(BIG))).not.toBe(BIG); // sanity: Number() really would corrupt it
    expect(plain(formatExactMoney(BIG, "EGP", { locale: "en" }))).toBe(
      "EGP 90,071,992,547,409.93",
    );
  });

  it("never renders the Number()-rounded neighbour value", () => {
    expect(formatExactMoney(BIG, "EGP", { locale: "en" })).not.toContain("409.92");
  });

  it("preserves the sign and every digit for a negative value past the safe-integer boundary", () => {
    expect(plain(formatExactMoney(`-${BIG}`, "EGP", { locale: "en" }))).toBe(
      "-EGP 90,071,992,547,409.93",
    );
  });

  it("handles zero and small values exactly, with the currency's own exponent", () => {
    expect(plain(formatExactMoney("0", "EGP", { locale: "en" }))).toBe("EGP 0.00");
    expect(plain(formatExactMoney("50", "EGP", { locale: "en" }))).toBe("EGP 0.50");
  });

  it("respects each currency's own exponent, never a hardcoded 100", () => {
    for (const currency of ["EGP", "SAR", "AED"] as Currency[]) {
      expect(plain(formatExactMoney("1234", currency, { locale: "en" }))).toContain("12.34");
    }
  });
});

describe("compareMinorUnits — exact signed-magnitude order, never Number(a) - Number(b)", () => {
  const BIG = "9007199254740993";

  it("orders two values straddling Number.MAX_SAFE_INTEGER correctly", () => {
    const justOver = "9007199254740995";
    const justUnder = "9007199254740990";
    expect(compareMinorUnits(justOver, justUnder)).toBeGreaterThan(0);
    expect(compareMinorUnits(justUnder, justOver)).toBeLessThan(0);
  });

  it("treats a value and itself as equal", () => {
    expect(compareMinorUnits(BIG, BIG)).toBe(0);
  });

  it("orders a negative value below every positive value, regardless of magnitude", () => {
    expect(compareMinorUnits(`-${BIG}`, "1")).toBeLessThan(0);
    expect(compareMinorUnits("1", `-${BIG}`)).toBeGreaterThan(0);
  });

  it("orders two negative values by magnitude, not lexically", () => {
    expect(compareMinorUnits("-100", "-9")).toBeLessThan(0); // -100 < -9
  });

  it("treats a leading-zero string the same as its normalized form", () => {
    expect(compareMinorUnits("007", "7")).toBe(0);
  });
});
