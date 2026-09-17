/**
 * Employee metrics and ranking — FR-HRM-031, FR-HRM-032. Pure.
 *
 * ## Who made the food
 *
 * A kitchen ticket records when it was fired, started and bumped, and what
 * was on it — not which cook pressed the button; the station screen is
 * shared and nobody signs on to bump. So a ticket is attributed to whoever
 * was *assigned to that station at the moment it was bumped*, from the
 * station assignments a kitchen manager keeps. When two cooks shared a
 * station, both are credited and the ticket is counted as shared, which is
 * said on screen: an average that silently halves credit misleads more than
 * one that names its limitation.
 */

import type { Id, KitchenTicket, Localised, Order } from "./types";
import { localDateIso } from "./workforce-rules";

export interface StationAssignment {
  id: Id;
  employeeId: Id;
  employeeName: Localised;
  stationId: Id;
  stationName: Localised;
  branchId: Id | null;
  date: string;
  startTime: string;
  endTime: string;
  createdAt: string;
}

export interface KitchenItemMetric {
  name: Localised;
  count: number;
  averagePrepSeconds: number | null;
}

export interface KitchenEmployeeMetric {
  employeeId: Id;
  employeeName: Localised;
  tickets: number;
  sharedTickets: number;
  itemsPrepared: number;
  averagePrepSeconds: number | null;
  remakeCount: number;
  byItem: KitchenItemMetric[];
}

function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Whether a local instant falls inside an assignment's date and HH:MM window. */
export function assignmentCovers(assignment: StationAssignment, at: Date): boolean {
  const start = minutesOfDay(assignment.startTime);
  const end = minutesOfDay(assignment.endTime);
  const minute = at.getHours() * 60 + at.getMinutes();
  const date = localDateIso(at);
  if (end > start) return date === assignment.date && minute >= start && minute < end;
  // Overnight: the evening part on the date, the early part the day after.
  const next = localDateIso(new Date(new Date(`${assignment.date}T12:00:00`).getTime() + 86_400_000));
  return (date === assignment.date && minute >= start) || (date === next && minute < end);
}

/** Prep time is bump minus start, or minus fire when nobody pressed Start. */
export function prepSecondsOf(ticket: KitchenTicket): number | null {
  if (!ticket.bumpedAt) return null;
  const from = Date.parse(ticket.startedAt ?? ticket.firedAt);
  const seconds = (Date.parse(ticket.bumpedAt) - from) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

/**
 * FR-HRM-031 — items prepared, average prep time by item, remake count.
 *
 * Only bumped tickets count as prepared work. A remake is a ticket raised
 * with the `remake` priority: the kitchen made it twice, and the second time
 * is the one on the record.
 */
export function kitchenMetrics(
  tickets: KitchenTicket[],
  assignments: StationAssignment[],
  period: { from: string; to: string },
): { rows: KitchenEmployeeMetric[]; unattributed: number } {
  const byEmployee = new Map<
    Id,
    {
      name: Localised;
      tickets: number;
      shared: number;
      items: number;
      prepTotal: number;
      prepCount: number;
      remakes: number;
      items_: Map<string, { name: Localised; count: number; prepTotal: number; prepCount: number }>;
    }
  >();
  let unattributed = 0;

  for (const ticket of tickets) {
    if (ticket.state !== "bumped" || !ticket.bumpedAt) continue;
    const bumped = new Date(ticket.bumpedAt);
    const day = localDateIso(bumped);
    if (day < period.from || day > period.to) continue;

    const cooks = assignments.filter(
      (a) => a.stationId === ticket.stationId && assignmentCovers(a, bumped),
    );
    const unique = [...new Map(cooks.map((c) => [c.employeeId, c])).values()];
    if (unique.length === 0) {
      unattributed += 1;
      continue;
    }

    const prep = prepSecondsOf(ticket);
    for (const cook of unique) {
      const entry =
        byEmployee.get(cook.employeeId) ??
        {
          name: cook.employeeName,
          tickets: 0,
          shared: 0,
          items: 0,
          prepTotal: 0,
          prepCount: 0,
          remakes: 0,
          items_: new Map(),
        };
      entry.tickets += 1;
      if (unique.length > 1) entry.shared += 1;
      if (ticket.priority === "remake") entry.remakes += 1;
      if (prep !== null) {
        entry.prepTotal += prep;
        entry.prepCount += 1;
      }
      for (const line of ticket.lines) {
        if (line.state === "voided") continue;
        entry.items += line.quantity;
        const key = line.name.en || line.name.ar;
        const item = entry.items_.get(key) ?? { name: line.name, count: 0, prepTotal: 0, prepCount: 0 };
        item.count += line.quantity;
        if (prep !== null) {
          item.prepTotal += prep;
          item.prepCount += 1;
        }
        entry.items_.set(key, item);
      }
      byEmployee.set(cook.employeeId, entry);
    }
  }

  const rows = [...byEmployee.entries()].map(([employeeId, e]) => ({
    employeeId,
    employeeName: e.name,
    tickets: e.tickets,
    sharedTickets: e.shared,
    itemsPrepared: e.items,
    averagePrepSeconds: e.prepCount ? Math.round(e.prepTotal / e.prepCount) : null,
    remakeCount: e.remakes,
    byItem: [...e.items_.values()]
      .map((item) => ({
        name: item.name,
        count: item.count,
        averagePrepSeconds: item.prepCount ? Math.round(item.prepTotal / item.prepCount) : null,
      }))
      .sort((a, b) => b.count - a.count),
  }));
  rows.sort((a, b) => b.itemsPrepared - a.itemsPrepared);
  return { rows, unattributed };
}

// ---------------------------------------------------------------------------
// Front-of-house metrics from orders, for a period
// ---------------------------------------------------------------------------

export interface ServiceEmployeeMetric {
  employeeId: Id;
  employeeName: Localised;
  branchId: Id;
  netSalesMinor: number;
  orderCount: number;
  averageOrderMinor: number;
  discountMinor: number;
  voidedLines: number;
}

/** Completed orders in the period, credited to the server (or the opener). */
export function serviceMetrics(orders: Order[], period: { from: string; to: string }): ServiceEmployeeMetric[] {
  const map = new Map<string, ServiceEmployeeMetric>();
  for (const order of orders) {
    if (order.state !== "completed") continue;
    const day = order.businessDay || order.openedAt.slice(0, 10);
    if (day < period.from || day > period.to) continue;
    const employeeId = order.servedBy ?? order.openedBy;
    const name = order.servedByName ?? order.openedByName;
    const key = `${employeeId}::${order.branchId}`;
    const row =
      map.get(key) ??
      {
        employeeId,
        employeeName: name,
        branchId: order.branchId,
        netSalesMinor: 0,
        orderCount: 0,
        averageOrderMinor: 0,
        discountMinor: 0,
        voidedLines: 0,
      };
    row.netSalesMinor += order.grandTotal.amount - order.taxTotal.amount;
    row.orderCount += 1;
    row.discountMinor += order.discountTotal.amount;
    row.voidedLines += order.lines.filter((line) => line.state === "voided").length;
    row.averageOrderMinor = Math.round(row.netSalesMinor / row.orderCount);
    map.set(key, row);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Ranking — FR-HRM-032
// ---------------------------------------------------------------------------

export interface Ranked<T> {
  row: T;
  value: number | null;
  /** Competition ranking: 1, 2, 2, 4. Null when the metric has no value. */
  rank: number | null;
  /** Share of the group ranked below this row, 0–100. */
  percentile: number | null;
  groupKey: string;
  groupSize: number;
}

/**
 * FR-HRM-032 — rank on any metric, within a group.
 *
 * Deterministic: equal values share a rank and are ordered by the tiebreak
 * key, so the same data always produces the same table. Rows with no value
 * (a cook with no timed tickets has no average) are listed after the ranked
 * ones rather than being ranked last, which would read as a verdict.
 */
export function rankWithin<T>(
  rows: T[],
  options: {
    value: (row: T) => number | null;
    higherIsBetter: boolean;
    groupOf: (row: T) => string;
    tiebreak: (row: T) => string;
  },
): Ranked<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = options.groupOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const out: Ranked<T>[] = [];
  for (const [groupKey, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const valued = members
      .map((row) => ({ row, value: options.value(row) }))
      .filter((entry): entry is { row: T; value: number } => entry.value !== null && Number.isFinite(entry.value));
    valued.sort((a, b) => {
      const diff = options.higherIsBetter ? b.value - a.value : a.value - b.value;
      return diff !== 0 ? diff : options.tiebreak(a.row).localeCompare(options.tiebreak(b.row));
    });
    let previous: number | null = null;
    let rank = 0;
    valued.forEach((entry, index) => {
      if (previous === null || entry.value !== previous) rank = index + 1;
      previous = entry.value;
      const below = valued.filter((other) =>
        options.higherIsBetter ? other.value < entry.value : other.value > entry.value,
      ).length;
      out.push({
        row: entry.row,
        value: entry.value,
        rank,
        percentile: valued.length > 1 ? Math.round((below / (valued.length - 1)) * 100) : 100,
        groupKey,
        groupSize: members.length,
      });
    });
    for (const row of members) {
      if (valued.some((entry) => entry.row === row)) continue;
      out.push({ row, value: null, rank: null, percentile: null, groupKey, groupSize: members.length });
    }
  }
  return out;
}
