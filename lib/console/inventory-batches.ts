/**
 * Batch rules — SRS §11.4, FR-INV-021 … FR-INV-023.
 *
 * Pure functions, so the stock item editor, the batch register and any
 * receiving form apply exactly the same rule.
 */

import type { Batch, IsoDate } from "./types";

export type BatchStrategy = "fifo" | "fefo";

/**
 * FR-INV-023 — FEFO is the default wherever expiry is tracked.
 *
 * FIFO and FEFO only disagree when a later delivery expires sooner, which in
 * fresh produce and dairy is most weeks: suppliers rotate their own stock.
 * An item without expiry tracking has no expiry to order by, so FIFO.
 */
export function defaultBatchStrategy(expiryTracked: boolean): BatchStrategy {
  return expiryTracked ? "fefo" : "fifo";
}

/** Whether a configured strategy departs from the SRS default and should say so. */
export function strategyNeedsWarning(strategy: BatchStrategy, expiryTracked: boolean): boolean {
  return expiryTracked && strategy === "fifo";
}

/**
 * FR-INV-022 — the order batches are consumed in under a strategy.
 *
 * FIFO orders by when the stock arrived. The batch record carries a
 * production date rather than a receipt date, so that stands in for
 * receipt order, with the batch number (issued in sequence) breaking ties
 * and filling in where no date was captured. FEFO orders by expiry, oldest
 * receipt first among equal expiries.
 */
export function consumptionOrder<T extends Pick<Batch, "id" | "expiryDate" | "productionDate" | "batchNumber">>(
  batches: T[],
  strategy: BatchStrategy,
): T[] {
  const receiptKey = (batch: T) => `${batch.productionDate ?? "9999-12-31"}|${batch.batchNumber}`;
  return [...batches].sort((a, b) => {
    if (strategy === "fefo") {
      const byExpiry = a.expiryDate.localeCompare(b.expiryDate);
      if (byExpiry !== 0) return byExpiry;
    }
    return receiptKey(a).localeCompare(receiptKey(b));
  });
}

export interface BatchAllocation {
  batchId: string;
  batchNumber: string;
  expiryDate: IsoDate;
  quantity: number;
}

/**
 * Which batches an issue of `quantity` would draw from, and how much of each.
 * `shortfall` is what no batch covers — permitted (FR-INV-014), but shown.
 */
export function allocateIssue(
  batches: Pick<Batch, "id" | "expiryDate" | "productionDate" | "batchNumber" | "quantity">[],
  strategy: BatchStrategy,
  quantity: number,
): { allocations: BatchAllocation[]; shortfall: number } {
  let remaining = quantity;
  const allocations: BatchAllocation[] = [];
  for (const batch of consumptionOrder(batches, strategy)) {
    if (remaining <= 0) break;
    const available = Number(batch.quantity.value);
    if (!(available > 0)) continue;
    const take = Math.min(available, remaining);
    allocations.push({ batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity: take });
    remaining -= take;
  }
  return { allocations, shortfall: Math.max(0, remaining) };
}

/**
 * FR-INV-021 — the expiry date a receipt defaults to.
 *
 * Shelf life runs from receipt for bought-in goods and from production for
 * anything made (the item profile's `shelfLifeBasis`). With production as
 * the basis and no production date captured, the receipt date is used.
 * Null when the item has no shelf life to default from.
 * The date is always a default: the receiving form lets it be overridden.
 */
export function defaultExpiryDate(input: {
  shelfLifeDays: number | null;
  basis: "receipt" | "production";
  receivedOn: IsoDate;
  productionDate?: IsoDate | null;
}): IsoDate | null {
  if (input.shelfLifeDays === null || !Number.isFinite(input.shelfLifeDays) || input.shelfLifeDays < 0) return null;
  const from = input.basis === "production" && input.productionDate ? input.productionDate : input.receivedOn;
  const date = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + input.shelfLifeDays);
  return date.toISOString().slice(0, 10);
}
