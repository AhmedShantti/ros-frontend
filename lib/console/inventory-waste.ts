/**
 * Waste analysis and anomaly detection — SRS §11.7, FR-INV-060 / FR-INV-061.
 *
 * Pure functions over waste records, so the analysis screen can slice the
 * same rows seven ways without asking the server seven times.
 *
 * ## Shift and day-part
 *
 * A waste record carries a timestamp, not a shift. The shift is taken from
 * the hour in the branch's time zone against fixed bands (morning, evening,
 * night) and the day-part against the service periods a restaurant plans
 * around. Both are labelled as bands in the UI, not as rostered shifts: a
 * split shift that straddles 14:00 lands in two bands.
 *
 * ## Anomalies (FR-INV-061)
 *
 * "Theft is very often recorded as waste." The pattern the SRS names — a
 * high-value item written off consistently by one employee in one shift
 * pattern — is tested directly: for each item at each location, every
 * employee's waste value of that item is compared with their peers' (a
 * z-score against the other employees who recorded waste there), and a flag
 * is raised only when the outlier is also concentrated in one shift band and
 * worth enough to matter. A second test catches a sudden spike: an item's
 * waste in the latest week against its own trailing weekly baseline.
 *
 * Every flag carries its working. It is a prompt to look, never a finding.
 */

import type { Id, IsoDateTime, Localised, WasteRecord } from "./types";

export type ShiftBand = "morning" | "evening" | "night";
export type DayPart = "breakfast" | "lunch" | "afternoon" | "dinner" | "late";
export type WasteDimension = "item" | "reason" | "employee" | "station" | "shift" | "day_part" | "branch";

function hourIn(at: IsoDateTime, timeZone?: string): number {
  try {
    const text = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date(at));
    return Number(text) % 24;
  } catch {
    return new Date(at).getHours();
  }
}

export function shiftBandOf(at: IsoDateTime, timeZone?: string): ShiftBand {
  const hour = hourIn(at, timeZone);
  if (hour >= 6 && hour < 14) return "morning";
  if (hour >= 14 && hour < 22) return "evening";
  return "night";
}

export function dayPartOf(at: IsoDateTime, timeZone?: string): DayPart {
  const hour = hourIn(at, timeZone);
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "dinner";
  return "late";
}

// ---------------------------------------------------------------------------
// FR-INV-060 — grouping with a trend comparison
// ---------------------------------------------------------------------------

export interface WasteGroupRow {
  key: string;
  /** Localised label, or null when the caller must name it (station, band). */
  label: Localised | null;
  records: number;
  valueMinor: number;
  trueWasteMinor: number;
  quantity: number;
  previousValueMinor: number;
  previousRecords: number;
  /** (current − previous) / previous × 100; null when there was nothing before. */
  changePercent: number | null;
  share: number;
}

export function keyOf(record: WasteRecord, dimension: WasteDimension, timeZone?: string): string {
  switch (dimension) {
    case "item":
      return record.itemId || "—";
    case "reason":
      return record.reasonCode || "—";
    case "employee":
      return record.recordedBy || "—";
    case "station":
      return record.stationId ?? "—";
    case "shift":
      return shiftBandOf(record.recordedAt, timeZone);
    case "day_part":
      return dayPartOf(record.recordedAt, timeZone);
    case "branch":
      return record.locationId || "—";
  }
}

function labelOf(record: WasteRecord, dimension: WasteDimension): Localised | null {
  switch (dimension) {
    case "item":
      return record.itemName;
    case "reason":
      return record.reasonName;
    case "employee":
      return record.recordedByName;
    case "branch":
      return record.locationName;
    default:
      return null;
  }
}

/** The period of equal length immediately before [from, to). */
export function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span), to: new Date(from.getTime()) };
}

export function groupWaste(
  records: WasteRecord[],
  dimension: WasteDimension,
  period: { from: Date; to: Date },
  options: { trueWasteOnly?: boolean; timeZone?: string } = {},
): WasteGroupRow[] {
  const prior = previousPeriod(period.from, period.to);
  const within = (record: WasteRecord, range: { from: Date; to: Date }) => {
    const at = new Date(record.recordedAt).getTime();
    return at >= range.from.getTime() && at < range.to.getTime();
  };
  const rows = new Map<string, WasteGroupRow>();
  const touch = (record: WasteRecord) => {
    const key = keyOf(record, dimension, options.timeZone);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: labelOf(record, dimension),
        records: 0,
        valueMinor: 0,
        trueWasteMinor: 0,
        quantity: 0,
        previousValueMinor: 0,
        previousRecords: 0,
        changePercent: null,
        share: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  let total = 0;
  for (const record of records) {
    if (options.trueWasteOnly && !record.isTrueWaste) continue;
    if (within(record, period)) {
      const row = touch(record);
      row.records += 1;
      row.valueMinor += record.value.amount;
      if (record.isTrueWaste) row.trueWasteMinor += record.value.amount;
      row.quantity += Number(record.quantity.value) || 0;
      total += record.value.amount;
    } else if (within(record, prior)) {
      const row = touch(record);
      row.previousRecords += 1;
      row.previousValueMinor += record.value.amount;
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      share: total > 0 ? (row.valueMinor / total) * 100 : 0,
      changePercent:
        row.previousValueMinor > 0 ? ((row.valueMinor - row.previousValueMinor) / row.previousValueMinor) * 100 : null,
    }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
}

/** Value per day across a period and the one before it, for the trend chart. */
export function dailyTrend(
  records: WasteRecord[],
  period: { from: Date; to: Date },
  options: { trueWasteOnly?: boolean } = {},
): { date: string; valueMinor: number; previousMinor: number }[] {
  const prior = previousPeriod(period.from, period.to);
  const days = Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000));
  const out = Array.from({ length: days }, (_, index) => ({
    date: new Date(period.from.getTime() + index * 86_400_000).toISOString().slice(0, 10),
    valueMinor: 0,
    previousMinor: 0,
  }));
  for (const record of records) {
    if (options.trueWasteOnly && !record.isTrueWaste) continue;
    const at = new Date(record.recordedAt).getTime();
    if (at >= period.from.getTime() && at < period.to.getTime()) {
      const index = Math.floor((at - period.from.getTime()) / 86_400_000);
      if (out[index]) out[index].valueMinor += record.value.amount;
    } else if (at >= prior.from.getTime() && at < prior.to.getTime()) {
      const index = Math.floor((at - prior.from.getTime()) / 86_400_000);
      if (out[index]) out[index].previousMinor += record.value.amount;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FR-INV-061 — anomalies
// ---------------------------------------------------------------------------

export interface WasteAnomalyPolicy {
  /** Standard deviations above the peer mean before an employee is an outlier. */
  sigma: number;
  /** Fewest records of the item by the employee before a pattern is a pattern. */
  minRecords: number;
  /** Share of those records in one shift band to count as "a shift pattern", 0–1. */
  shiftConcentration: number;
  /** Ignore anything worth less than this in total (minor units). */
  minValueMinor: number;
  /** Peers needed at the location for a comparison to mean anything. */
  minPeers: number;
}

export const DEFAULT_WASTE_ANOMALY_POLICY: WasteAnomalyPolicy = {
  sigma: 2,
  minRecords: 3,
  shiftConcentration: 0.6,
  minValueMinor: 20_000,
  minPeers: 3,
};

export type WasteAnomalyKind = "employee_item_pattern" | "item_spike";

export interface WasteAnomaly {
  /** Stable across recomputation, so a review stays attached to its flag. */
  id: string;
  kind: WasteAnomalyKind;
  locationId: Id;
  locationName: Localised;
  itemId: Id;
  itemName: Localised;
  employeeId: Id | null;
  employeeName: Localised | null;
  shiftBand: ShiftBand | null;
  records: number;
  valueMinor: number;
  baselineMeanMinor: number;
  baselineStdevMinor: number;
  z: number;
  /** Share of the records in `shiftBand`, 0–1, for the employee pattern. */
  concentration: number | null;
  recordIds: Id[];
  firstAt: IsoDateTime;
  lastAt: IsoDateTime;
}

function stats(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length < 2 ? 0 : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, stdev: Math.sqrt(variance) };
}

export function detectWasteAnomalies(
  records: WasteRecord[],
  policy: WasteAnomalyPolicy = DEFAULT_WASTE_ANOMALY_POLICY,
  options: { timeZone?: string; asOf?: Date } = {},
): WasteAnomaly[] {
  const out: WasteAnomaly[] = [];
  // Controlled consumption is a policy decision, not a loss to explain.
  const trueWaste = records.filter((record) => record.isTrueWaste && record.itemId);

  // -- Employee × item pattern ------------------------------------------------
  const byItemLocation = new Map<string, WasteRecord[]>();
  for (const record of trueWaste) {
    const key = `${record.locationId}|${record.itemId}`;
    byItemLocation.set(key, [...(byItemLocation.get(key) ?? []), record]);
  }
  const employeesAt = new Map<Id, Set<Id>>();
  for (const record of trueWaste) {
    if (!record.recordedBy) continue;
    const set = employeesAt.get(record.locationId) ?? new Set<Id>();
    set.add(record.recordedBy);
    employeesAt.set(record.locationId, set);
  }

  for (const list of byItemLocation.values()) {
    const first = list[0]!;
    const peers = [...(employeesAt.get(first.locationId) ?? [])];
    if (peers.length < policy.minPeers) continue;

    const byEmployee = new Map<Id, WasteRecord[]>();
    for (const record of list) {
      if (!record.recordedBy) continue;
      byEmployee.set(record.recordedBy, [...(byEmployee.get(record.recordedBy) ?? []), record]);
    }
    // Every employee who records waste at the location is a peer, including
    // the ones who never wasted this item — their zero is the baseline.
    const totals = new Map(peers.map((id) => [id, (byEmployee.get(id) ?? []).reduce((s, r) => s + r.value.amount, 0)]));

    for (const [employeeId, own] of byEmployee) {
      const value = totals.get(employeeId) ?? 0;
      if (own.length < policy.minRecords || value < policy.minValueMinor) continue;
      const others = peers.filter((id) => id !== employeeId).map((id) => totals.get(id) ?? 0);
      const baseline = stats(others);
      // With identical peers σ is 0; any excess is then infinitely unusual,
      // which is not a useful number — floor σ at 10% of the mean or 1 unit.
      const spread = Math.max(baseline.stdev, baseline.mean * 0.1, 100);
      const z = (value - baseline.mean) / spread;
      if (z < policy.sigma) continue;

      const bands = new Map<ShiftBand, number>();
      for (const record of own) {
        const band = shiftBandOf(record.recordedAt, options.timeZone);
        bands.set(band, (bands.get(band) ?? 0) + 1);
      }
      const [band, count] = [...bands.entries()].sort((a, b) => b[1] - a[1])[0]!;
      const concentration = count / own.length;
      if (concentration < policy.shiftConcentration) continue;

      const times = own.map((record) => record.recordedAt).sort();
      out.push({
        id: `waste:emp:${first.locationId}:${first.itemId}:${employeeId}`,
        kind: "employee_item_pattern",
        locationId: first.locationId,
        locationName: first.locationName,
        itemId: first.itemId,
        itemName: first.itemName,
        employeeId,
        employeeName: own[0]!.recordedByName,
        shiftBand: band,
        records: own.length,
        valueMinor: value,
        baselineMeanMinor: Math.round(baseline.mean),
        baselineStdevMinor: Math.round(baseline.stdev),
        z: Math.round(z * 10) / 10,
        concentration,
        recordIds: own.map((record) => record.id),
        firstAt: times[0]!,
        lastAt: times[times.length - 1]!,
      });
    }
  }

  // -- Item spike: latest week against the trailing weeks ---------------------
  const asOf = options.asOf ?? new Date(Math.max(0, ...trueWaste.map((record) => new Date(record.recordedAt).getTime())));
  const WEEK = 7 * 86_400_000;
  for (const list of byItemLocation.values()) {
    const first = list[0]!;
    const weeks = [0, 0, 0, 0, 0];
    const latest: WasteRecord[] = [];
    for (const record of list) {
      const age = asOf.getTime() - new Date(record.recordedAt).getTime();
      if (age < 0) continue;
      const index = Math.floor(age / WEEK);
      if (index >= weeks.length) continue;
      weeks[index]! += record.value.amount;
      if (index === 0) latest.push(record);
    }
    const current = weeks[0]!;
    if (current < policy.minValueMinor || latest.length < policy.minRecords) continue;
    const baseline = stats(weeks.slice(1));
    const spread = Math.max(baseline.stdev, baseline.mean * 0.1, 100);
    const z = (current - baseline.mean) / spread;
    if (z < policy.sigma) continue;
    const times = latest.map((record) => record.recordedAt).sort();
    out.push({
      id: `waste:spike:${first.locationId}:${first.itemId}:${times[0]!.slice(0, 10)}`,
      kind: "item_spike",
      locationId: first.locationId,
      locationName: first.locationName,
      itemId: first.itemId,
      itemName: first.itemName,
      employeeId: null,
      employeeName: null,
      shiftBand: null,
      records: latest.length,
      valueMinor: current,
      baselineMeanMinor: Math.round(baseline.mean),
      baselineStdevMinor: Math.round(baseline.stdev),
      z: Math.round(z * 10) / 10,
      concentration: null,
      recordIds: latest.map((record) => record.id),
      firstAt: times[0]!,
      lastAt: times[times.length - 1]!,
    });
  }

  return out.sort((a, b) => b.z - a.z);
}
