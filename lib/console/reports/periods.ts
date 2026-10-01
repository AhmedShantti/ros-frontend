/**
 * Comparison periods — SRS §19.3 ("Sales by Branch: comparative with
 * variance to prior period").
 *
 * Pure date arithmetic, no clock and no React, so the rules are testable and
 * identical wherever they run.
 *
 * Both comparisons are like-for-like: the previous period covers the same
 * number of days as the current one. Comparing Saturday–Wednesday of this
 * week with a whole seven-day previous week would make every figure look
 * worse than it is.
 *
 *   week  this week so far        vs the same days of the previous week
 *   year  1 January to today      vs 1 January to the same date last year
 */

export type CompareMode = "off" | "week" | "year";

export interface Span {
  from: string;
  to: string;
}

export interface ComparisonPeriods {
  mode: Exclude<CompareMode, "off">;
  current: Span;
  previous: Span;
}

/** Egypt (and most of MENA) starts the week on Saturday. 0 = Sunday. */
export const WEEK_STARTS_ON = 6;

const DAY_MS = 86_400_000;

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return format(new Date(parse(iso).getTime() + days * DAY_MS));
}

/** Same calendar date `years` earlier or later; 29 February falls to the 28th. */
export function addYears(iso: string, years: number): string {
  const date = parse(iso);
  const month = date.getUTCMonth();
  const shifted = new Date(Date.UTC(date.getUTCFullYear() + years, month, date.getUTCDate()));
  if (shifted.getUTCMonth() !== month) {
    return format(new Date(Date.UTC(date.getUTCFullYear() + years, month + 1, 0)));
  }
  return format(shifted);
}

export function startOfWeek(iso: string, weekStartsOn = WEEK_STARTS_ON): string {
  const back = (parse(iso).getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(iso, -back);
}

/** Inclusive number of days in a span. */
export function spanDays(span: Span): number {
  return Math.round((parse(span.to).getTime() - parse(span.from).getTime()) / DAY_MS) + 1;
}

export function inSpan(iso: string, span: Span): boolean {
  const day = iso.slice(0, 10);
  return day >= span.from && day <= span.to;
}

export function resolveComparison(
  mode: CompareMode,
  today: string,
  weekStartsOn = WEEK_STARTS_ON,
): ComparisonPeriods | null {
  if (mode === "week") {
    const start = startOfWeek(today, weekStartsOn);
    return {
      mode,
      current: { from: start, to: today },
      previous: { from: addDays(start, -7), to: addDays(today, -7) },
    };
  }
  if (mode === "year") {
    const jan1 = `${today.slice(0, 4)}-01-01`;
    return {
      mode,
      current: { from: jan1, to: today },
      previous: { from: addYears(jan1, -1), to: addYears(today, -1) },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

export interface Delta {
  /** current − previous, in the figure's own units. */
  change: number;
  /** Null when there is no previous figure to divide by. */
  percent: number | null;
  direction: "up" | "down" | "flat";
}

export function delta(current: number, previous: number): Delta {
  const change = current - previous;
  return {
    change,
    percent: previous === 0 ? null : (change / Math.abs(previous)) * 100,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

/**
 * How much of the previous period the data actually reaches.
 *
 * `earliest` is the first day the source has anything for. A comparison
 * against a period the source cannot see is not a comparison: it would show
 * every figure as a 100% rise.
 */
export type Coverage = "full" | "partial" | "none";

export function coverageOf(earliest: string | null, previous: Span): Coverage {
  if (!earliest) return "none";
  if (earliest <= previous.from) return "full";
  if (earliest > previous.to) return "none";
  return "partial";
}
