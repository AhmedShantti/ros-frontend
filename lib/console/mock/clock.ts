/**
 * A fixed clock for the mock dataset.
 *
 * Every timestamp in the demo derives from this anchor rather than from the
 * wall clock, so the server render and the client render agree and the
 * numbers on screen stay coherent with one another (an order "12 minutes
 * ago" is still 12 minutes before the dashboard's "generated at").
 */

export const NOW = new Date("2026-08-05T14:20:00.000Z");
export const NOW_MS = NOW.getTime();
export const NOW_ISO = NOW.toISOString();

/** The business day the demo sits inside — SRS FR-FIN-024. */
export const BUSINESS_DAY = "2026-08-05";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function minutesAgo(n: number): string {
  return new Date(NOW_MS - n * MINUTE).toISOString();
}

export function hoursAgo(n: number): string {
  return new Date(NOW_MS - n * HOUR).toISOString();
}

export function daysAgo(n: number): string {
  return new Date(NOW_MS - n * DAY).toISOString();
}

export function daysAhead(n: number): string {
  return new Date(NOW_MS + n * DAY).toISOString();
}

export function dateAgo(n: number): string {
  return new Date(NOW_MS - n * DAY).toISOString().slice(0, 10);
}

export function dateAhead(n: number): string {
  return new Date(NOW_MS + n * DAY).toISOString().slice(0, 10);
}

/** Whole days between an ISO date and the anchor; negative means past. */
export function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`).getTime();
  const today = new Date(`${NOW_ISO.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.round((target - today) / DAY);
}

/** Today at a given local-ish hour, as ISO. */
export function todayAt(hour: number, minute = 0): string {
  return new Date(
    Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate(), hour, minute),
  ).toISOString();
}

/** Labels for the last N days, oldest first — chart axes. */
export function lastNDates(n: number): string[] {
  return Array.from({ length: n }, (_, i) => dateAgo(n - 1 - i));
}
