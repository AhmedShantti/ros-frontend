/**
 * Cycle counting — SRS §11.6, FR-INV-048.
 *
 * "A rolling schedule that counts high-value or high-variance items
 * frequently and low-risk items rarely, so that a full count is never
 * required." The SRS classes:
 *
 *   A — top 20% by value, or high historical variance → counted most often
 *   B — the next 30% by value                          → less often
 *   C — the rest                                        → rarely
 *
 * Classification is per location (an item that is class A at the central
 * kitchen may be class C at a small branch), recomputed from the current
 * levels and the count history each time the schedule is drawn, so a class
 * follows the stock rather than a spreadsheet from last year. The tenant can
 * pin an item to a class.
 */

import type { CountSession, Id, IsoDate, IsoDateTime, Localised, StockLevel } from "./types";

export type CycleClass = "A" | "B" | "C";

export interface CyclePolicy {
  /** Cumulative value share that makes an item class A, as a percent. */
  aValueShare: number;
  /** Cumulative value share up to which items are class B. */
  bValueShare: number;
  /** Mean absolute count variance, in percent, that promotes an item to A. */
  highVariancePercent: number;
  /** Days between counts per class. */
  frequencyDays: Record<CycleClass, number>;
  /** Most lines to put on one day's cycle count sheet. */
  maxLinesPerCount: number;
}

export const DEFAULT_CYCLE_POLICY: CyclePolicy = {
  aValueShare: 20,
  bValueShare: 50,
  highVariancePercent: 5,
  frequencyDays: { A: 7, B: 30, C: 90 },
  maxLinesPerCount: 40,
};

export interface CycleRow {
  itemId: Id;
  itemName: Localised;
  sku: string;
  locationId: Id;
  valueMinor: number;
  /** Cumulative value share at this item, in percent. */
  cumulativeShare: number;
  /** Mean |variance %| across posted counts, or null with no history. */
  historicalVariance: number | null;
  countsSeen: number;
  computedClass: CycleClass;
  /** The tenant's pin, if any. */
  pinnedClass: CycleClass | null;
  cycleClass: CycleClass;
  reason: "value" | "variance" | "pinned";
  lastCountedAt: IsoDateTime | null;
  dueOn: IsoDate;
  /** Negative when overdue. */
  daysUntilDue: number;
}

function isoDay(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

/** Mean absolute variance per item from counts that were actually posted. */
export function varianceHistory(sessions: CountSession[], locationId: Id): Map<Id, { mean: number; count: number }> {
  const sums = new Map<Id, { total: number; count: number }>();
  for (const session of sessions) {
    if (session.locationId !== locationId || session.status !== "posted") continue;
    for (const line of session.lines) {
      if (!line.counted) continue;
      const entry = sums.get(line.itemId) ?? { total: 0, count: 0 };
      entry.total += Math.abs(line.variancePercent);
      entry.count += 1;
      sums.set(line.itemId, entry);
    }
  }
  return new Map([...sums.entries()].map(([id, entry]) => [id, { mean: entry.total / entry.count, count: entry.count }]));
}

/** Latest posted count per item, from session history. */
export function lastCountedFromSessions(sessions: CountSession[], locationId: Id): Map<Id, IsoDateTime> {
  const out = new Map<Id, IsoDateTime>();
  for (const session of sessions) {
    if (session.locationId !== locationId || session.status !== "posted") continue;
    const at = session.postedAt ?? session.submittedAt ?? session.openedAt;
    for (const line of session.lines) {
      if (!line.counted) continue;
      const previous = out.get(line.itemId);
      if (!previous || at > previous) out.set(line.itemId, at);
    }
  }
  return out;
}

export function classifyForCycle(input: {
  levels: StockLevel[];
  locationId: Id;
  sessions: CountSession[];
  policy: CyclePolicy;
  pins: Record<Id, CycleClass>;
  /** Extra "last counted" evidence, e.g. cycle counts started from this screen. */
  lastCounted?: Map<Id, IsoDateTime>;
  today: Date;
}): CycleRow[] {
  const levels = input.levels.filter((level) => level.locationId === input.locationId);
  const variance = varianceHistory(input.sessions, input.locationId);
  const fromSessions = lastCountedFromSessions(input.sessions, input.locationId);
  const total = levels.reduce((sum, level) => sum + Math.max(0, level.value.amount), 0);

  const ranked = [...levels].sort((a, b) => Math.max(0, b.value.amount) - Math.max(0, a.value.amount));
  let running = 0;

  return ranked.map((level) => {
    // Share *before* this item: the first item is in class A even when it
    // alone is 60% of the value.
    const shareBefore = total > 0 ? (running / total) * 100 : 100;
    running += Math.max(0, level.value.amount);
    const history = variance.get(level.itemId) ?? null;

    let computedClass: CycleClass = shareBefore < input.policy.aValueShare ? "A" : shareBefore < input.policy.bValueShare ? "B" : "C";
    let reason: CycleRow["reason"] = "value";
    if (computedClass !== "A" && history && history.mean >= input.policy.highVariancePercent) {
      computedClass = "A";
      reason = "variance";
    }
    const pinnedClass = input.pins[level.itemId] ?? null;
    const cycleClass = pinnedClass ?? computedClass;
    if (pinnedClass) reason = "pinned";

    const candidates = [level.lastCountedAt, fromSessions.get(level.itemId), input.lastCounted?.get(level.itemId)].filter(
      (value): value is string => Boolean(value),
    );
    const lastCountedAt = candidates.sort().at(-1) ?? null;
    const frequency = input.policy.frequencyDays[cycleClass];
    // Never counted means due today, not due in `frequency` days.
    const due = lastCountedAt ? new Date(new Date(lastCountedAt).getTime() + frequency * 86_400_000) : input.today;
    const daysUntilDue = Math.floor((new Date(isoDay(due)).getTime() - new Date(isoDay(input.today)).getTime()) / 86_400_000);

    return {
      itemId: level.itemId,
      itemName: level.itemName,
      sku: level.sku,
      locationId: level.locationId,
      valueMinor: level.value.amount,
      cumulativeShare: total > 0 ? (running / total) * 100 : 100,
      historicalVariance: history?.mean ?? null,
      countsSeen: history?.count ?? 0,
      computedClass,
      pinnedClass,
      cycleClass,
      reason,
      lastCountedAt,
      dueOn: isoDay(due),
      daysUntilDue,
    };
  });
}

/**
 * Today's sheet: everything due or overdue, most overdue first and class A
 * before B before C among equals, capped at the policy's line limit. The
 * rest roll to tomorrow — that is what makes the count *cycle*.
 */
export function dueToday(rows: CycleRow[], policy: CyclePolicy): CycleRow[] {
  const order: Record<CycleClass, number> = { A: 0, B: 1, C: 2 };
  return rows
    .filter((row) => row.daysUntilDue <= 0)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue || order[a.cycleClass] - order[b.cycleClass])
    .slice(0, policy.maxLinesPerCount);
}

/** How many line-counts a class generates per year — the workload check. */
export function annualWorkload(rows: CycleRow[], policy: CyclePolicy): Record<CycleClass, number> {
  const out: Record<CycleClass, number> = { A: 0, B: 0, C: 0 };
  for (const row of rows) out[row.cycleClass] += 365 / policy.frequencyDays[row.cycleClass];
  return { A: Math.round(out.A), B: Math.round(out.B), C: Math.round(out.C) };
}
