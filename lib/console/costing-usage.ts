/**
 * Usage build-up between stock counts — FR-CST-011, FR-CST-013, FR-CST-016,
 * FR-CST-017.
 *
 * Pure. For every pair of consecutive posted counts at one location, and
 * every item counted in both, it rebuilds the period from the ledger:
 *
 *   Actual usage  = Opening count + Purchases received + Transfers in
 *                   + Production output − Transfers out − Closing count
 *   Theoretical   = recipe-expanded sale depletions (net of reversals)
 *                   + production inputs
 *   Variance      = Actual − Theoretical                     (FR-CST-012)
 *   Unexplained   = Variance − Recorded waste                (FR-CST-013)
 *
 * Sale depletions are what the POS posts per sold line after expanding the
 * recipe (FR-CST-010), so the ledger already holds the theoretical figure;
 * nothing here re-expands recipes against today's versions.
 *
 * Count adjustments are excluded on purpose: they are the posting of the
 * count itself, and including them would make every variance zero.
 *
 * ## Granularity (FR-CST-016)
 *
 * When two counts are close enough to bracket one shift (≤ SHIFT_HOURS
 * apart) the period is reported as a shift. Otherwise the report falls back
 * to the count period and says so — it never pretends to shift precision
 * that the counts do not have.
 */

import type { CountSession, Id, Localised, StockMovement, UnitCode, WasteRecord } from "./types";
import { quantityValue } from "./format";

/** Longest gap between counts still treated as one shift. */
export const SHIFT_HOURS = 16;

export type UsageGranularity = "shift" | "count_period";

export interface UsageRow {
  key: string;
  locationId: Id;
  locationName: Localised;
  itemId: Id;
  itemName: Localised;
  sku: string;
  unit: UnitCode | null;
  periodStart: string;
  periodEnd: string;
  openingCountRef: string;
  closingCountRef: string;
  granularity: UsageGranularity;
  opening: number;
  purchases: number;
  transfersIn: number;
  productionOutput: number;
  transfersOut: number;
  closing: number;
  actualUsage: number;
  theoreticalUsage: number;
  varianceQty: number;
  /** Null when there was no theoretical usage to divide by. */
  variancePercent: number | null;
  recordedWaste: number;
  unexplainedQty: number;
  unitCostMinor: number;
  varianceValueMinor: number;
}

function countTime(session: CountSession): string {
  return session.submittedAt ?? session.postedAt ?? session.openedAt;
}

function within(iso: string, start: string, end: string): boolean {
  return iso > start && iso <= end;
}

export function buildUsage(
  counts: CountSession[],
  movements: StockMovement[],
  waste: WasteRecord[] = [],
): UsageRow[] {
  const posted = counts.filter((session) => session.status === "posted" && session.lines.length > 0);
  const byLocation = new Map<Id, CountSession[]>();
  for (const session of posted) {
    const list = byLocation.get(session.locationId) ?? [];
    list.push(session);
    byLocation.set(session.locationId, list);
  }

  // Index movements by location+item so each period scans only its own rows.
  const movementIndex = new Map<string, StockMovement[]>();
  for (const movement of movements) {
    const key = `${movement.locationId}:${movement.itemId}`;
    const list = movementIndex.get(key) ?? [];
    list.push(movement);
    movementIndex.set(key, list);
  }
  const wasteIndex = new Map<string, WasteRecord[]>();
  for (const record of waste) {
    const key = `${record.locationId}:${record.itemId}`;
    const list = wasteIndex.get(key) ?? [];
    list.push(record);
    wasteIndex.set(key, list);
  }

  const rows: UsageRow[] = [];

  for (const [locationId, sessions] of byLocation) {
    const ordered = [...sessions].sort((a, b) => countTime(a).localeCompare(countTime(b)));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      const start = countTime(previous);
      const end = countTime(current);
      const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
      const granularity: UsageGranularity = hours <= SHIFT_HOURS ? "shift" : "count_period";

      const openingLines = new Map(previous.lines.map((line) => [line.itemId, line]));

      for (const closingLine of current.lines) {
        const openingLine = openingLines.get(closingLine.itemId);
        if (!openingLine?.counted || !closingLine.counted) continue;

        const inPeriod = (movementIndex.get(`${locationId}:${closingLine.itemId}`) ?? []).filter((movement) =>
          within(movement.occurredAt, start, end),
        );
        const sum = (types: StockMovement["movementType"][]) =>
          inPeriod
            .filter((movement) => types.includes(movement.movementType))
            .reduce((total, movement) => total + quantityValue(movement.quantity), 0);

        const opening = quantityValue(openingLine.counted);
        const closing = quantityValue(closingLine.counted);
        // Signed ledger quantities: receipts positive, returns negative.
        const purchases = sum(["purchase_receipt", "purchase_return"]);
        const transfersIn = sum(["transfer_in"]);
        const productionOutput = sum(["production_output"]);
        const transfersOut = Math.abs(sum(["transfer_out"]));

        // FR-CST-011
        const actualUsage = opening + purchases + transfersIn + productionOutput - transfersOut - closing;
        const theoreticalUsage = Math.abs(sum(["sale_depletion", "sale_reversal", "production_input"]));

        // FR-CST-013 — recorded waste from the ledger, else from waste records.
        const ledgerWaste = Math.abs(sum(["waste", "expiry_writeoff"]));
        const recordWaste = (wasteIndex.get(`${locationId}:${closingLine.itemId}`) ?? [])
          .filter((record) => within(record.recordedAt, start, end))
          .reduce((total, record) => total + quantityValue(record.quantity), 0);
        const recordedWaste = ledgerWaste > 0 ? ledgerWaste : recordWaste;

        const varianceQty = actualUsage - theoreticalUsage;
        const unexplainedQty = varianceQty - recordedWaste;

        const costed = [...inPeriod].reverse().find((movement) => movement.unitCost.amount > 0);
        const unitCostMinor =
          costed?.unitCost.amount ??
          (closingLine.varianceQty !== 0 ? Math.abs(closingLine.varianceValue.amount / closingLine.varianceQty) : 0);

        rows.push({
          key: `${previous.id}:${current.id}:${closingLine.itemId}`,
          locationId,
          locationName: current.locationName,
          itemId: closingLine.itemId,
          itemName: closingLine.itemName,
          sku: closingLine.sku,
          unit: closingLine.counted.unit ?? null,
          periodStart: start,
          periodEnd: end,
          openingCountRef: previous.reference,
          closingCountRef: current.reference,
          granularity,
          opening,
          purchases,
          transfersIn,
          productionOutput,
          transfersOut,
          closing,
          actualUsage,
          theoreticalUsage,
          varianceQty,
          variancePercent: theoreticalUsage === 0 ? null : (varianceQty / theoreticalUsage) * 100,
          recordedWaste,
          unexplainedQty,
          unitCostMinor,
          varianceValueMinor: Math.round(varianceQty * unitCostMinor),
        });
      }
    }
  }

  // FR-CST-014 — largest financial loss first.
  return rows.sort((a, b) => Math.abs(b.varianceValueMinor) - Math.abs(a.varianceValueMinor));
}

export interface TrendPoint {
  periodEnd: string;
  label: string;
  variancePercent: number | null;
  granularity: UsageGranularity;
  locationName: Localised;
}

/** FR-CST-017 — one item's variance % over successive count periods. */
export function varianceTrend(rows: UsageRow[], itemId: Id, locationId?: Id | null): TrendPoint[] {
  return rows
    .filter((row) => row.itemId === itemId && (!locationId || row.locationId === locationId))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .map((row) => ({
      periodEnd: row.periodEnd,
      label: `${row.openingCountRef} → ${row.closingCountRef}`,
      variancePercent: row.variancePercent,
      granularity: row.granularity,
      locationName: row.locationName,
    }));
}
