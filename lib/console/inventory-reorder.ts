/**
 * Suggested order quantities — SRS §11.9, FR-INV-067 … FR-INV-070.
 *
 * Pure: no services, no React. The reorder screen and the purchasing
 * module's suggested purchase orders (FR-PRC-022) both call `suggestReorder`
 * with whatever ledger, levels and calendar they already hold, so the two can
 * never disagree about a number.
 *
 * The SRS formula, per (item, location):
 *
 *   forecast_demand = average_daily_usage(last N days, day-of-week weighted)
 *                     × (supplier_lead_time_days + review_period_days)
 *   safety_stock    = z × σ(daily_usage) × √(lead_time)
 *   target_level    = forecast_demand + safety_stock
 *   suggested       = max(0, target_level − on_hand − on_order)
 *
 * with three refinements, each reported in the breakdown so a buyer can see
 * why a number is what it is:
 *
 *   - FR-INV-070 — history is de-seasonalised before averaging (a Ramadan
 *     fortnight in the lookback would otherwise inflate every forecast after
 *     it), and each day of the horizon is re-seasonalised with the multiplier
 *     of the event in force on that day.
 *   - FR-INV-069 — known future demand (events, catering orders, promotions)
 *     is added on the days it falls, as explicit quantities or as an uplift.
 *   - FR-INV-068 — for a perishable item the suggestion is capped at what the
 *     forecast can consume between the delivery arriving and the goods
 *     expiring, after the stock already held is used first.
 */

import type { Id, IsoDate, Localised, StockMovement } from "./types";
import { addIsoDays, multiplierOn, type SeasonalEvent } from "./inventory-seasonality";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ReorderParameters {
  /** N in "average daily usage over the last N days". */
  lookbackDays: number;
  leadTimeDays: number;
  reviewPeriodDays: number;
  /** Target probability of not stocking out during the lead time, e.g. 0.95. */
  serviceLevel: number;
  /** Order in multiples of this many base units; null for any quantity. */
  packSize: number | null;
}

export const DEFAULT_REORDER_PARAMETERS: ReorderParameters = {
  lookbackDays: 28,
  leadTimeDays: 2,
  reviewPeriodDays: 7,
  serviceLevel: 0.95,
  packSize: null,
};

export type DemandEventKind = "event" | "catering" | "promotion";

/** FR-INV-069 — demand the history cannot know about. */
export interface DemandEvent {
  id: Id;
  kind: DemandEventKind;
  name: string;
  from: IsoDate;
  to: IsoDate;
  /** Null for every location. */
  locationId: Id | null;
  /** Extra base units of an item over the whole event, spread across its days. */
  lines: { itemId: Id; quantity: string }[];
  /** A percentage uplift on the baseline of every item (a promotion), or null. */
  upliftPercent: number | null;
  /** Restrict the uplift to these items; empty means every item. */
  upliftItemIds: Id[];
}

/** Movement types that are the item being used, net of reversals. */
const USAGE_TYPES = new Set(["sale_depletion", "sale_reversal", "production_input"]);

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Inverse standard normal CDF (Acklam's rational approximation, relative
 * error < 1.15e-9) — the z for a service level.
 */
export function zForServiceLevel(p: number): number {
  const level = Math.min(0.9999, Math.max(0.5, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (level <= high) {
    const q = level - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - level));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

/** Day of week of an ISO date, 0 = Sunday, independent of the viewer's zone. */
function weekday(date: IsoDate): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

// ---------------------------------------------------------------------------
// Usage history
// ---------------------------------------------------------------------------

export interface DailyUsage {
  date: IsoDate;
  quantity: number;
}

/**
 * Consumption per calendar day over the `lookbackDays` ending on `asOf`,
 * zero-filled — a day with no sale is a day of zero usage, not a missing
 * sample, and leaving it out would overstate the average.
 */
export function dailyUsage(
  movements: StockMovement[],
  input: { itemId: Id; locationId: Id; asOf: IsoDate; lookbackDays: number },
): DailyUsage[] {
  const first = addIsoDays(input.asOf, -(input.lookbackDays - 1));
  const byDay = new Map<IsoDate, number>();
  for (let day = first; day <= input.asOf; day = addIsoDays(day, 1)) byDay.set(day, 0);

  for (const row of movements) {
    if (row.itemId !== input.itemId || row.locationId !== input.locationId) continue;
    if (!USAGE_TYPES.has(row.movementType)) continue;
    const day = row.occurredAt.slice(0, 10);
    if (!byDay.has(day)) continue;
    // Usage is the outflow: a depletion of −5 is 5 used; a reversal of +2 gives 2 back.
    byDay.set(day, byDay.get(day)! - Number(row.quantity.value));
  }
  return [...byDay.entries()].map(([date, quantity]) => ({ date, quantity: Math.max(0, quantity) }));
}

// ---------------------------------------------------------------------------
// The suggestion
// ---------------------------------------------------------------------------

export interface ReorderInput {
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  unit: string;
  onHand: number;
  onOrder: number;
  /** Null when the item does not perish, or its shelf life is unknown. */
  shelfLifeDays: number | null;
  supplierId: Id | null;
  unitCostMinor: number;
  history: DailyUsage[];
  parameters: ReorderParameters;
  /** The last day of history; the horizon starts the day after. */
  asOf: IsoDate;
  seasons: SeasonalEvent[];
  demandEvents: DemandEvent[];
  /**
   * FR-INV-065 — the configured reorder point and quantity. Used only when
   * there is no usage history at all to forecast from, and flagged when it is.
   */
  reorderPoint?: number;
  reorderQuantity?: number;
}

export interface ReorderSuggestion {
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  supplierId: Id | null;
  unit: string;
  onHand: number;
  onOrder: number;
  /** De-seasonalised mean daily usage over the lookback. */
  averageDailyUsage: number;
  /** σ of de-seasonalised daily usage. */
  usageStdev: number;
  /** Days in the lookback with any usage — a thin history is flagged, not hidden. */
  activeDays: number;
  horizonDays: number;
  /** Baseline demand over the horizon, day-of-week weighted, before seasonality. */
  baselineDemand: number;
  /** What seasonality added (or removed) over the horizon. */
  seasonalAdjustment: number;
  /** What known future demand added over the horizon. */
  knownDemand: number;
  forecastDemand: number;
  z: number;
  safetyStock: number;
  targetLevel: number;
  /** max(0, target − on hand − on order), before any cap or rounding. */
  uncapped: number;
  /** FR-INV-068 — the most that can be used before it expires; null if not perishable. */
  shelfLifeCap: number | null;
  capped: boolean;
  suggested: number;
  valueMinor: number;
  /** The events that touched the horizon, for the explanation. */
  seasonsApplied: SeasonalEvent[];
  eventsApplied: DemandEvent[];
  /** Why the number may be unreliable. */
  warnings: ("thin_history" | "no_history" | "negative_on_hand" | "pack_rounded_down" | "reorder_point_fallback")[];
}

function eventApplies(event: DemandEvent, locationId: Id): boolean {
  return event.locationId === null || event.locationId === locationId;
}

function eventDays(event: DemandEvent): number {
  const ms = new Date(`${event.to}T00:00:00Z`).getTime() - new Date(`${event.from}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * Forecast for each day in [start, start + days), with the day-of-week
 * weighting, seasonality and known demand applied. Returned per day so the
 * shelf-life window can reuse it.
 */
export function dailyForecast(
  input: Pick<ReorderInput, "itemId" | "locationId" | "history" | "seasons" | "demandEvents">,
  start: IsoDate,
  days: number,
): { date: IsoDate; baseline: number; seasonal: number; known: number }[] {
  // De-seasonalise the history first (FR-INV-070).
  const clean = input.history.map((row) => ({
    date: row.date,
    quantity: row.quantity / (multiplierOn(row.date, input.seasons).multiplier || 1),
  }));
  const overall = mean(clean.map((row) => row.quantity));

  // Day-of-week index: that weekday's mean over the overall mean. Needs at
  // least two samples of the weekday to mean anything; otherwise flat.
  const index = Array.from({ length: 7 }, (_, dow) => {
    const samples = clean.filter((row) => weekday(row.date) === dow).map((row) => row.quantity);
    return samples.length >= 2 && overall > 0 ? mean(samples) / overall : 1;
  });

  const out: { date: IsoDate; baseline: number; seasonal: number; known: number }[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addIsoDays(start, offset);
    const baseline = overall * index[weekday(date)]!;
    const { multiplier } = multiplierOn(date, input.seasons);
    let known = 0;
    let uplift = 0;
    for (const event of input.demandEvents) {
      if (date < event.from || date > event.to || !eventApplies(event, input.locationId)) continue;
      const line = event.lines.find((row) => row.itemId === input.itemId);
      if (line) known += Number(line.quantity) / eventDays(event);
      if (event.upliftPercent && (event.upliftItemIds.length === 0 || event.upliftItemIds.includes(input.itemId))) {
        uplift += event.upliftPercent / 100;
      }
    }
    const seasonal = baseline * multiplier;
    out.push({ date, baseline, seasonal: seasonal * (1 + uplift), known });
  }
  return out;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function suggestReorder(input: ReorderInput): ReorderSuggestion {
  const p = input.parameters;
  const warnings: ReorderSuggestion["warnings"] = [];
  const horizonDays = Math.max(1, Math.round(p.leadTimeDays + p.reviewPeriodDays));
  const start = addIsoDays(input.asOf, 1);

  const clean = input.history.map((row) => row.quantity / (multiplierOn(row.date, input.seasons).multiplier || 1));
  const averageDailyUsage = mean(clean);
  const usageStdev = stdev(clean);
  const activeDays = input.history.filter((row) => row.quantity > 0).length;
  if (activeDays === 0) warnings.push("no_history");
  else if (activeDays < 7) warnings.push("thin_history");
  if (input.onHand < 0) warnings.push("negative_on_hand");

  const days = dailyForecast(input, start, horizonDays);
  const baselineDemand = days.reduce((sum, day) => sum + day.baseline, 0);
  const seasonalDemand = days.reduce((sum, day) => sum + day.seasonal, 0);
  const knownDemand = days.reduce((sum, day) => sum + day.known, 0);
  const forecastDemand = seasonalDemand + knownDemand;

  const z = zForServiceLevel(p.serviceLevel);
  const safetyStock = z * usageStdev * Math.sqrt(Math.max(0, p.leadTimeDays));
  const targetLevel = forecastDemand + safetyStock;
  // Negative stock is a recording problem, not stock to replace twice; it
  // counts as zero here and is flagged.
  const position = Math.max(0, input.onHand) + Math.max(0, input.onOrder);
  let uncapped = Math.max(0, targetLevel - position);

  // With nothing to forecast from, the configured reorder point is the only
  // signal there is. It is used, and said to be used, rather than suggesting
  // zero for an item that is visibly below its reorder point.
  if (activeDays === 0 && knownDemand === 0 && input.reorderPoint && position <= input.reorderPoint) {
    uncapped = Math.max(input.reorderQuantity ?? 0, input.reorderPoint - position);
    warnings.push("reorder_point_fallback");
  }

  // FR-INV-068 — cap by what can be used before expiry.
  let shelfLifeCap: number | null = null;
  // Without a forecast there is no consumption rate to cap by; the fallback
  // quantity stands as configured and is flagged as such.
  if (input.shelfLifeDays !== null && input.shelfLifeDays > 0 && !warnings.includes("reorder_point_fallback")) {
    const lead = Math.max(0, Math.round(p.leadTimeDays));
    const window = dailyForecast(input, start, lead + input.shelfLifeDays);
    const duringLead = window.slice(0, lead).reduce((sum, day) => sum + day.seasonal + day.known, 0);
    const afterArrival = window.slice(lead).reduce((sum, day) => sum + day.seasonal + day.known, 0);
    // Stock already held is consumed first; whatever of it is left when the
    // delivery lands competes with the delivery for the same demand.
    const leftAtArrival = Math.max(0, position - duringLead);
    shelfLifeCap = Math.max(0, afterArrival - leftAtArrival);
  }

  let suggested = shelfLifeCap === null ? uncapped : Math.min(uncapped, shelfLifeCap);
  const capped = shelfLifeCap !== null && shelfLifeCap < uncapped;

  if (p.packSize && p.packSize > 0 && suggested > 0) {
    const up = Math.ceil(suggested / p.packSize) * p.packSize;
    // Rounding up past the shelf-life cap buys stock that will expire.
    if (shelfLifeCap !== null && up > shelfLifeCap) {
      suggested = Math.floor(suggested / p.packSize) * p.packSize;
      warnings.push("pack_rounded_down");
    } else {
      suggested = up;
    }
  }

  const seasonsApplied = input.seasons.filter((event) => event.to >= start && event.from <= addIsoDays(start, horizonDays - 1));
  const end = addIsoDays(start, horizonDays - 1);
  const eventsApplied = input.demandEvents.filter(
    (event) => eventApplies(event, input.locationId) && event.to >= start && event.from <= end,
  );

  return {
    itemId: input.itemId,
    itemName: input.itemName,
    locationId: input.locationId,
    locationName: input.locationName,
    supplierId: input.supplierId,
    unit: input.unit,
    onHand: input.onHand,
    onOrder: input.onOrder,
    averageDailyUsage: round3(averageDailyUsage),
    usageStdev: round3(usageStdev),
    activeDays,
    horizonDays,
    baselineDemand: round3(baselineDemand),
    seasonalAdjustment: round3(seasonalDemand - baselineDemand),
    knownDemand: round3(knownDemand),
    forecastDemand: round3(forecastDemand),
    z: Math.round(z * 1000) / 1000,
    safetyStock: round3(safetyStock),
    targetLevel: round3(targetLevel),
    uncapped: round3(uncapped),
    shelfLifeCap: shelfLifeCap === null ? null : round3(shelfLifeCap),
    capped,
    suggested: round3(suggested),
    valueMinor: Math.round(suggested * input.unitCostMinor),
    seasonsApplied,
    eventsApplied,
    warnings,
  };
}

/** FR-PRC-022 helper — suggestions grouped by supplier, largest value first. */
export function groupBySupplier(rows: ReorderSuggestion[]): { supplierId: Id | null; rows: ReorderSuggestion[]; valueMinor: number }[] {
  const groups = new Map<string, ReorderSuggestion[]>();
  for (const row of rows) {
    if (row.suggested <= 0) continue;
    const key = row.supplierId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      supplierId: key || null,
      rows: list,
      valueMinor: list.reduce((sum, row) => sum + row.valueMinor, 0),
    }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
}
