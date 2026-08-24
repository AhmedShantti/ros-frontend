/**
 * Formatting helpers.
 *
 * Money never becomes a float here. `Money.amount` is minor units, and the
 * only division by the exponent happens at the moment of display — which is
 * the one place a fractional value is harmless.
 */

import type { Currency, Locale, Localised, Money, Quantity, UnitCode } from "./types";

const CURRENCY_EXPONENT: Record<Currency, number> = {
  EGP: 2,
  SAR: 2,
  AED: 2,
};

const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  ar: "ar-EG",
};

export interface FormatOptions {
  locale: Locale;
  /** FR-LOC-005 — Arabic-Indic numerals are configurable, not implied. */
  arabicIndicNumerals?: boolean;
}

function intlLocale(opts: FormatOptions): string {
  if (opts.locale !== "ar") return LOCALE_TAG.en;
  // The `-u-nu-latn` extension keeps Western digits inside an Arabic locale.
  return opts.arabicIndicNumerals ? "ar-EG" : "ar-EG-u-nu-latn";
}

/** Pick the right side of a localised string, falling back per FR-LOC-007. */
export function tx(value: Localised | null | undefined, locale: Locale): string {
  if (!value) return "";
  const primary = value[locale];
  if (primary && primary.trim().length > 0) return primary;
  return locale === "ar" ? value.en : value.ar;
}

export function toMajorUnits(money: Money): number {
  return money.amount / 10 ** CURRENCY_EXPONENT[money.currency];
}

export function formatMoney(money: Money, opts: FormatOptions, compact = false): string {
  const exponent = CURRENCY_EXPONENT[money.currency];
  const value = money.amount / 10 ** exponent;
  return new Intl.NumberFormat(intlLocale(opts), {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: compact ? 0 : exponent,
    maximumFractionDigits: compact ? 0 : exponent,
    notation: compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}

/** Money without the currency symbol — for dense table columns. */
export function formatAmount(money: Money, opts: FormatOptions, compact = false): string {
  const exponent = CURRENCY_EXPONENT[money.currency];
  const value = money.amount / 10 ** exponent;
  return new Intl.NumberFormat(intlLocale(opts), {
    minimumFractionDigits: compact ? 0 : exponent,
    maximumFractionDigits: compact ? 0 : exponent,
    notation: compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
  }).format(value);
}

export function formatNumber(
  value: number,
  opts: FormatOptions,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat(intlLocale(opts), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(
  value: number,
  opts: FormatOptions,
  fractionDigits = 1,
): string {
  return `${new Intl.NumberFormat(intlLocale(opts), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)}%`;
}

/** A signed percentage-point delta, e.g. "+2.4 pp". */
export function formatPoints(value: number, opts: FormatOptions): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, opts, 1)} pp`;
}

const UNIT_LABEL: Record<UnitCode, Localised> = {
  g: { en: "g", ar: "جم" },
  kg: { en: "kg", ar: "كجم" },
  ml: { en: "ml", ar: "مل" },
  l: { en: "L", ar: "لتر" },
  pc: { en: "pc", ar: "قطعة" },
  dozen: { en: "dz", ar: "دستة" },
  case: { en: "case", ar: "صندوق" },
  pack: { en: "pack", ar: "عبوة" },
  tray: { en: "tray", ar: "صينية" },
  hour: { en: "h", ar: "ساعة" },
};

export function unitLabel(unit: UnitCode, locale: Locale): string {
  return tx(UNIT_LABEL[unit], locale);
}

export function formatQuantity(qty: Quantity, opts: FormatOptions): string {
  const numeric = Number(qty.value);
  // Trailing zeros on a 6dp store are noise; show at most 3 and trim.
  const digits = Number.isInteger(numeric) ? 0 : Math.min(3, decimalsOf(qty.value));
  return `${formatNumber(numeric, opts, digits)} ${unitLabel(qty.unit, opts.locale)}`;
}

function decimalsOf(value: string): number {
  const dot = value.indexOf(".");
  if (dot === -1) return 0;
  return value.slice(dot + 1).replace(/0+$/, "").length;
}

export function quantityValue(qty: Quantity): number {
  return Number(qty.value);
}

export function formatDate(iso: string, opts: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(opts), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, opts: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(opts), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatTime(iso: string, opts: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(opts), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "3m ago" / "منذ ٣ د" — for live operations and audit feeds. */
export function formatRelative(iso: string, opts: FormatOptions, now = Date.now()): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(opts), { numeric: "auto" });
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(Math.round(diffSeconds), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  return rtf.format(Math.round(diffSeconds / 86_400), "day");
}

/** Elapsed seconds as mm:ss — kitchen ticket timers. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(seconds: number, opts: FormatOptions): string {
  if (seconds < 60) return `${formatNumber(seconds, opts)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${formatNumber(minutes, opts, minutes < 10 ? 1 : 0)}m`;
  return `${formatNumber(seconds / 3600, opts, 1)}h`;
}

// ---------------------------------------------------------------------------
// Money arithmetic used by the mock layer and by page-level roll-ups
// ---------------------------------------------------------------------------

export function money(amount: number, currency: Currency): Money {
  return { amount: Math.round(amount), currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    // BR-CORE-001 — no implicit conversion between currencies.
    throw new Error(`Currency mismatch: ${a.currency} + ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function sumMoney(values: Money[], currency: Currency): Money {
  return values.reduce<Money>(
    (acc, v) => addMoney(acc, v),
    { amount: 0, currency },
  );
}

export function multiplyMoney(m: Money, factor: number): Money {
  return { amount: Math.round(m.amount * factor), currency: m.currency };
}

export function negateMoney(m: Money): Money {
  return { amount: -m.amount, currency: m.currency };
}

/**
 * BR-CORE-002 — distribute an amount across ratios so the parts sum exactly
 * to the whole, giving leftover minor units to the largest ratios first.
 */
export function allocateMoney(m: Money, ratios: number[]): Money[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  if (total === 0) return ratios.map(() => ({ amount: 0, currency: m.currency }));

  const raw = ratios.map((r) => (m.amount * r) / total);
  const floored = raw.map(Math.floor);
  let remainder = m.amount - floored.reduce((a, b) => a + b, 0);

  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { index } of order) {
    if (remainder <= 0) break;
    floored[index] += 1;
    remainder -= 1;
  }
  return floored.map((amount) => ({ amount, currency: m.currency }));
}

export function percentOf(part: Money, whole: Money): number {
  if (whole.amount === 0) return 0;
  return (part.amount / whole.amount) * 100;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Clamp for gauge widths so a 140% value does not overflow its track. */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// ---------------------------------------------------------------------------
// Reading numbers back out of a form
// ---------------------------------------------------------------------------

/**
 * A number typed by a person, or `null` if they have not typed one yet.
 *
 * The idiom this replaces was `Number(value || 0)`, which reads as a default
 * but is not one: `||` only substitutes for the empty string, so anything
 * unparseable still reaches `Number` and comes back `NaN`. From there it
 * poisons silently, because NaN survives arithmetic and *fails* every
 * comparison — `Math.max(0, NaN)` is NaN, and `Math.abs(NaN) > 2000` is
 * `false`, which is how a variance large enough to need a manager slipped
 * through an approval gate rather than tripping it.
 *
 * Returning `null` rather than `0` is the point: a field that cannot be read
 * is not a field containing zero, and the caller has to decide which it is.
 * `disabled` on the submit button is usually the right answer.
 *
 * `inputMode="decimal"` does not help — it is a hint to a mobile keyboard and
 * restricts nothing typed, pasted or autofilled.
 */
export function numberFromInput(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // Arabic-Indic digits reach these fields on an Arabic keyboard and `Number`
  // does not read them.
  const western = trimmed.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660),
  ).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const parsed = Number(western);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A money field as minor units, clamped at zero. `null` if unreadable. */
export function minorFromInput(value: string | null | undefined): number | null {
  const parsed = numberFromInput(value);
  if (parsed === null) return null;
  return Math.max(0, Math.round(parsed * 100));
}

/** A whole-number field — a denomination count — clamped at zero. */
export function countFromInput(value: string | null | undefined): number | null {
  const parsed = numberFromInput(value);
  if (parsed === null) return null;
  return Math.max(0, Math.floor(parsed));
}
