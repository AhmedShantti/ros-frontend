/**
 * Inventory costing — SRS §11.3, FR-INV-012 / FR-INV-013.
 *
 * Three methods, chosen per item:
 *
 *   - **Weighted average.** `(existing_value + received_value) /
 *     (existing_qty + received_qty)`, recomputed on every receipt. Issues
 *     leave at the average in force when they happen, so an issue never
 *     moves the average.
 *   - **FIFO.** Every receipt is a layer; an issue eats the oldest layers
 *     first and is costed at what those layers cost.
 *   - **Standard.** Everything moves at the item's standard cost; the gap
 *     to what was actually paid is a purchase price variance, not stock
 *     value.
 *
 * The server does this for real on each movement. This module replays a
 * movement ledger the same way so the console can (a) show a buyer what a
 * receipt *will* do to cost before posting it, and (b) value stock at any
 * past date from the ledger alone (FR-INV-015) without a server report.
 *
 * Money is integer minor units throughout. Quantities arrive as decimal
 * strings and are handled as numbers only inside a replay, where every
 * value is rounded back to minor units at the point it becomes money.
 */

import type { CostingMethod, StockMovement } from "./types";

/** One FIFO layer: what is left of a receipt, and what each unit cost. */
export interface CostLayer {
  quantity: number;
  unitCostMinor: number;
  /** When the layer was received — FIFO order. */
  receivedAt: string;
  batchId: string | null;
}

export interface CostPosition {
  quantity: number;
  valueMinor: number;
  /** Value ÷ quantity, or the last known unit cost when nothing is on hand. */
  unitCostMinor: number;
  /** FIFO only; empty for the other methods. */
  layers: CostLayer[];
  /**
   * Standard only — the running purchase-price variance: what receipts
   * actually cost minus what they were booked at. Positive is adverse.
   */
  priceVarianceMinor: number;
  /**
   * Quantity issued with nothing on hand to cost it against. Negative stock
   * is permitted (FR-INV-014); its cost is taken at the last known unit cost
   * and reported rather than silently absorbed.
   */
  uncostedIssues: number;
}

export function emptyPosition(): CostPosition {
  return { quantity: 0, valueMinor: 0, unitCostMinor: 0, layers: [], priceVarianceMinor: 0, uncostedIssues: 0 };
}

const round = (value: number) => Math.round(value);

/**
 * FR-INV-012 — weighted average after a receipt.
 *
 * Exposed separately because the goods-receipt preview and the item editor
 * both want the one formula without replaying anything.
 */
export function weightedAverageAfterReceipt(
  existingQty: number,
  existingValueMinor: number,
  receivedQty: number,
  receivedUnitCostMinor: number,
): { quantity: number; valueMinor: number; unitCostMinor: number } {
  const quantity = existingQty + receivedQty;
  const valueMinor = existingValueMinor + round(receivedQty * receivedUnitCostMinor);
  // With nothing (or less than nothing) on hand afterwards there is no
  // meaningful average; the receipt's own cost is the best estimate.
  const unitCostMinor = quantity > 0 ? valueMinor / quantity : receivedUnitCostMinor;
  return { quantity, valueMinor, unitCostMinor };
}

/**
 * Apply one signed quantity to a position under a costing method.
 *
 * `unitCostMinor` is what the movement itself says each unit cost: the
 * purchase price on a receipt, the sender's cost on a transfer in. It is
 * ignored for issues under weighted average and FIFO, which cost issues
 * from the position rather than from the movement.
 */
export function applyMovement(
  position: CostPosition,
  method: CostingMethod,
  signedQuantity: number,
  unitCostMinor: number,
  context: { at: string; batchId: string | null; standardCostMinor: number },
): CostPosition {
  const next: CostPosition = { ...position, layers: position.layers.map((layer) => ({ ...layer })) };
  if (!Number.isFinite(signedQuantity) || signedQuantity === 0) return next;

  if (method === "standard") {
    const standard = context.standardCostMinor;
    if (signedQuantity > 0) {
      next.priceVarianceMinor += round(signedQuantity * (unitCostMinor - standard));
    }
    next.quantity += signedQuantity;
    next.valueMinor = round(next.quantity * standard);
    next.unitCostMinor = standard;
    return next;
  }

  if (method === "weighted_average") {
    if (signedQuantity > 0) {
      const after = weightedAverageAfterReceipt(next.quantity, next.valueMinor, signedQuantity, unitCostMinor);
      next.quantity = after.quantity;
      next.valueMinor = after.valueMinor;
      next.unitCostMinor = after.unitCostMinor;
      return next;
    }
    const issue = -signedQuantity;
    const available = Math.max(0, next.quantity);
    if (issue > available) next.uncostedIssues += issue - available;
    const cost = next.unitCostMinor || unitCostMinor;
    next.quantity -= issue;
    next.valueMinor = next.quantity > 0 ? round(next.valueMinor - issue * cost) : round(next.quantity * cost);
    if (next.quantity > 0 && next.valueMinor < 0) next.valueMinor = 0;
    return next;
  }

  // FIFO — FR-INV-013: layers in receipt order, consumption from the front.
  if (signedQuantity > 0) {
    next.layers.push({
      quantity: signedQuantity,
      unitCostMinor,
      receivedAt: context.at,
      batchId: context.batchId,
    });
    next.quantity += signedQuantity;
    next.valueMinor += round(signedQuantity * unitCostMinor);
    next.unitCostMinor = unitCostMinor;
    return next;
  }

  let remaining = -signedQuantity;
  let lastCost = next.unitCostMinor || unitCostMinor;
  while (remaining > 1e-9 && next.layers.length > 0) {
    const head = next.layers[0]!;
    const take = Math.min(head.quantity, remaining);
    head.quantity -= take;
    remaining -= take;
    lastCost = head.unitCostMinor;
    if (head.quantity <= 1e-9) next.layers.shift();
  }
  if (remaining > 1e-9) next.uncostedIssues += remaining;
  next.quantity += signedQuantity;
  const layered = next.layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostMinor, 0);
  // Stock below zero has no layer to value it; carry it at the last cost.
  next.valueMinor = next.quantity < 0 ? round(next.quantity * lastCost) : round(layered);
  next.unitCostMinor = next.quantity > 0 ? next.valueMinor / next.quantity : lastCost;
  return next;
}

/**
 * Replay a ledger for one (item, location) up to and including `asOf`.
 *
 * Movements are sorted by `occurredAt` here rather than trusted to arrive
 * in order — the ledger endpoints return newest first.
 */
export function replayPosition(
  movements: StockMovement[],
  method: CostingMethod,
  standardCostMinor: number,
  asOf?: string,
): CostPosition {
  const cutoff = asOf ? new Date(asOf).getTime() : Number.POSITIVE_INFINITY;
  const ordered = movements
    .filter((row) => new Date(row.occurredAt).getTime() <= cutoff)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  let position = emptyPosition();
  for (const movement of ordered) {
    position = applyMovement(position, method, Number(movement.quantity.value), movement.unitCost.amount, {
      at: movement.occurredAt,
      batchId: movement.batchId,
      standardCostMinor,
    });
  }
  return position;
}

/**
 * FR-INV-012 — "what would this receipt do?" for all three methods side by
 * side, so the choice of method is made against numbers rather than names.
 */
export function receiptPreview(input: {
  onHandQty: number;
  onHandUnitCostMinor: number;
  receivedQty: number;
  receivedUnitCostMinor: number;
  standardCostMinor: number;
}): Record<CostingMethod, { unitCostMinor: number; valueMinor: number; varianceMinor: number }> {
  const existingValue = round(input.onHandQty * input.onHandUnitCostMinor);
  const average = weightedAverageAfterReceipt(
    input.onHandQty,
    existingValue,
    input.receivedQty,
    input.receivedUnitCostMinor,
  );
  const quantity = input.onHandQty + input.receivedQty;
  return {
    weighted_average: { unitCostMinor: average.unitCostMinor, valueMinor: average.valueMinor, varianceMinor: 0 },
    // FIFO keeps both layers; the next issue is costed at the *older* one.
    fifo: {
      unitCostMinor: input.onHandQty > 0 ? input.onHandUnitCostMinor : input.receivedUnitCostMinor,
      valueMinor: average.valueMinor,
      varianceMinor: 0,
    },
    standard: {
      unitCostMinor: input.standardCostMinor,
      valueMinor: round(quantity * input.standardCostMinor),
      varianceMinor: round(input.receivedQty * (input.receivedUnitCostMinor - input.standardCostMinor)),
    },
  };
}
