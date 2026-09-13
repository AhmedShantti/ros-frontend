/**
 * Units, conversions and barcodes for the stock item master — SRS §11.2.
 *
 * Quantities are decimal strings everywhere in the domain, so conversions
 * here are done in scaled integers (BigInt) and come back as strings. A
 * float would turn "a case of 12 × 0.333 kg" into 3.9960000000000004 kg in
 * the first receipt and a variance nobody can explain in the month-end.
 *
 * FR-INV-004 is the rule with teeth: converting between mass and volume
 * needs a density, and without one the conversion is *refused*, not
 * approximated. Olive oil and flour both come in litres and kilograms, and
 * no single factor is right for both.
 */

import type { UnitCode } from "./types";

// ---------------------------------------------------------------------------
// Exact decimal arithmetic on strings
// ---------------------------------------------------------------------------

const SCALE = 6;
const FACTOR = BigInt(10 ** SCALE);

/** Parse a decimal string into a scaled integer. Null when it is not one. */
export function toScaled(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^-?\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === "." || trimmed === "-") {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace("-", "").split(".");
  const padded = (fraction + "0".repeat(SCALE)).slice(0, SCALE);
  const scaled = BigInt(whole || "0") * FACTOR + BigInt(padded || "0");
  return negative ? -scaled : scaled;
}

export function fromScaled(value: bigint): string {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = abs / FACTOR;
  const fraction = (abs % FACTOR).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function mul(a: bigint, b: bigint): bigint {
  return (a * b) / FACTOR;
}

function div(a: bigint, b: bigint): bigint {
  // Round half away from zero at the sixth place.
  const numerator = a * FACTOR * BigInt(10);
  const raw = numerator / b;
  const rounded = raw >= BigInt(0) ? raw + BigInt(5) : raw - BigInt(5);
  return rounded / BigInt(10);
}

// String-in, string-out forms of the above for callers outside this file —
// production scaling, allocation. Null wherever an operand is not a decimal.

export function decimalMul(a: string, b: string): string | null {
  const x = toScaled(a);
  const y = toScaled(b);
  return x === null || y === null ? null : fromScaled(mul(x, y));
}

export function decimalDiv(a: string, b: string): string | null {
  const x = toScaled(a);
  const y = toScaled(b);
  return x === null || y === null || y === BigInt(0) ? null : fromScaled(div(x, y));
}

export function decimalAdd(...values: string[]): string {
  return fromScaled(values.reduce((sum, value) => sum + (toScaled(value) ?? BigInt(0)), BigInt(0)));
}

export function decimalSub(a: string, b: string): string {
  return fromScaled((toScaled(a) ?? BigInt(0)) - (toScaled(b) ?? BigInt(0)));
}

export function decimalCompare(a: string, b: string): number {
  const d = (toScaled(a) ?? BigInt(0)) - (toScaled(b) ?? BigInt(0));
  return d > BigInt(0) ? 1 : d < BigInt(0) ? -1 : 0;
}

export function isPositiveDecimal(value: string): boolean {
  const scaled = toScaled(value);
  return scaled !== null && scaled > BigInt(0);
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export type Dimension = "mass" | "volume" | "count" | "time";

/** Each unit's dimension, and how many of the dimension's base unit it is. */
const UNIT_TABLE: Record<UnitCode, { dimension: Dimension; toBase: string }> = {
  g: { dimension: "mass", toBase: "1" },
  kg: { dimension: "mass", toBase: "1000" },
  ml: { dimension: "volume", toBase: "1" },
  l: { dimension: "volume", toBase: "1000" },
  pc: { dimension: "count", toBase: "1" },
  dozen: { dimension: "count", toBase: "12" },
  // Case, pack and tray have no fixed size — their size is the item's
  // purchase-unit conversion, not a property of the word.
  case: { dimension: "count", toBase: "0" },
  pack: { dimension: "count", toBase: "0" },
  tray: { dimension: "count", toBase: "0" },
  hour: { dimension: "time", toBase: "1" },
};

export function dimensionOf(unit: UnitCode): Dimension {
  return UNIT_TABLE[unit]?.dimension ?? "count";
}

/** True for units whose size is fixed (kg, l, dozen), false for case/pack/tray. */
export function hasFixedSize(unit: UnitCode): boolean {
  return UNIT_TABLE[unit]?.toBase !== "0";
}

export type ConversionResult =
  | { ok: true; value: string }
  | { ok: false; reason: "no_density" | "incompatible" | "variable_size" | "invalid" };

/**
 * Convert a quantity between two units — FR-INV-004.
 *
 * `densityGPerMl` is grams per millilitre. It is only consulted for a
 * mass↔volume conversion, and its absence is a refusal.
 */
export function convert(
  value: string,
  from: UnitCode,
  to: UnitCode,
  densityGPerMl: string | null,
): ConversionResult {
  const amount = toScaled(value);
  if (amount === null) return { ok: false, reason: "invalid" };
  if (from === to) return { ok: true, value: fromScaled(amount) };
  if (!hasFixedSize(from) || !hasFixedSize(to)) return { ok: false, reason: "variable_size" };

  const a = UNIT_TABLE[from];
  const b = UNIT_TABLE[to];
  const inBase = mul(amount, toScaled(a.toBase)!);

  if (a.dimension === b.dimension) {
    return { ok: true, value: fromScaled(div(inBase, toScaled(b.toBase)!)) };
  }

  const massVolume =
    (a.dimension === "mass" && b.dimension === "volume") ||
    (a.dimension === "volume" && b.dimension === "mass");
  if (!massVolume) return { ok: false, reason: "incompatible" };

  const density = densityGPerMl ? toScaled(densityGPerMl) : null;
  if (!density || density <= BigInt(0)) return { ok: false, reason: "no_density" };

  // grams → millilitres divides by density; millilitres → grams multiplies.
  const converted = a.dimension === "mass" ? div(inBase, density) : mul(inBase, density);
  return { ok: true, value: fromScaled(div(converted, toScaled(b.toBase)!)) };
}

/** How many base units one purchase unit holds, as a string. */
export function purchaseToBase(
  quantity: string,
  conversion: string,
): string | null {
  const q = toScaled(quantity);
  const c = toScaled(conversion);
  if (q === null || c === null) return null;
  return fromScaled(mul(q, c));
}

// ---------------------------------------------------------------------------
// Barcodes — FR-INV-001, FR-INV-005
// ---------------------------------------------------------------------------

export type BarcodeKind = "ean13" | "ean8" | "upca" | "code128" | "internal";

/** GS1 mod-10 check digit over every digit but the last. */
function gs1Valid(digits: string): boolean {
  const body = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    // Weights alternate 3,1 counting from the digit next to the check digit.
    const weight = (body.length - index) % 2 === 1 ? 3 : 1;
    sum += Number(body[index]) * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** The kind a scanned or typed code looks like. */
export function detectBarcodeKind(code: string): BarcodeKind {
  const trimmed = code.trim();
  if (/^\d{13}$/.test(trimmed)) return "ean13";
  if (/^\d{12}$/.test(trimmed)) return "upca";
  if (/^\d{8}$/.test(trimmed)) return "ean8";
  if (/^[\x20-\x7e]{1,48}$/.test(trimmed)) return "code128";
  return "internal";
}

/** Null when the code is acceptable for its kind; otherwise why it is not. */
export function barcodeProblem(code: string, kind: BarcodeKind): "empty" | "format" | "checksum" | null {
  const trimmed = code.trim();
  if (!trimmed) return "empty";
  switch (kind) {
    case "ean13":
      if (!/^\d{13}$/.test(trimmed)) return "format";
      return gs1Valid(trimmed) ? null : "checksum";
    case "ean8":
      if (!/^\d{8}$/.test(trimmed)) return "format";
      return gs1Valid(trimmed) ? null : "checksum";
    case "upca":
      if (!/^\d{12}$/.test(trimmed)) return "format";
      return gs1Valid(trimmed) ? null : "checksum";
    case "code128":
      return /^[\x20-\x7e]{1,48}$/.test(trimmed) ? null : "format";
    default:
      return trimmed.length <= 48 ? null : "format";
  }
}
