/**
 * Batch traceability — SRS FR-INV-027.
 *
 * "Given a batch, list every order that consumed it (forward trace); given
 * an order, list every batch consumed (backward trace)." In an incident this
 * is the difference between recalling one supplier's delivery and closing
 * the kitchen.
 *
 * Both directions are walks over the movement ledger, which already records
 * the batch each consumption drew from (FR-INV-013) and the document that
 * caused it. The walk follows stock through the two places it changes form
 * or place:
 *
 *   - **Production.** A batch consumed by a production run is in every batch
 *     that run produced, so the forward trace continues from the output
 *     batch, and the backward trace from an output batch continues into the
 *     run's inputs. Runs are joined on the movement's reference id, which is
 *     the production order for both legs.
 *   - **Transfers.** A batch sent to another location keeps its batch id on
 *     the receiving leg, so consumption there is found by the same batch id.
 *
 * Depth is capped so a malformed ledger (a run that consumes its own output)
 * cannot loop.
 */

import type { Id, IsoDateTime, Localised, MovementType, StockMovement } from "./types";

const MAX_DEPTH = 6;

export interface TraceEvent {
  movementId: Id;
  movementType: MovementType;
  occurredAt: IsoDateTime;
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  batchId: Id | null;
  /** Always positive — the direction is the movement type's. */
  quantity: number;
  unit: string;
  referenceType: string;
  referenceId: Id;
  /** 0 for the batch or order asked about; 1 after one production step, … */
  depth: number;
  /** For a production step, the batch this event came through. */
  viaBatchId: Id | null;
}

const CONSUMING: ReadonlySet<MovementType> = new Set([
  "sale_depletion",
  "production_input",
  "waste",
  "expiry_writeoff",
  "transfer_out",
  "purchase_return",
  "count_adjustment",
  "manual_adjustment",
]);

function eventOf(row: StockMovement, depth: number, viaBatchId: Id | null): TraceEvent {
  return {
    movementId: row.id,
    movementType: row.movementType,
    occurredAt: row.occurredAt,
    itemId: row.itemId,
    itemName: row.itemName,
    locationId: row.locationId,
    locationName: row.locationName,
    batchId: row.batchId,
    quantity: Math.abs(Number(row.quantity.value)),
    unit: row.quantity.unit,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    depth,
    viaBatchId,
  };
}

export interface ForwardTrace {
  /** Where the batch came from: receipts or production outputs carrying it. */
  origins: TraceEvent[];
  /** Everything that took stock out of the batch, directly or downstream. */
  consumption: TraceEvent[];
  /** Distinct orders that consumed the batch, at any depth. */
  orders: { referenceId: Id; firstAt: IsoDateTime; lastAt: IsoDateTime; quantity: number; items: Set<Id>; depth: number }[];
  /** Batches produced from this one, for the recall list. */
  derivedBatches: Id[];
}

export function traceForward(movements: StockMovement[], batchId: Id): ForwardTrace {
  const byBatch = new Map<Id, StockMovement[]>();
  const byReference = new Map<string, StockMovement[]>();
  for (const row of movements) {
    if (row.batchId) byBatch.set(row.batchId, [...(byBatch.get(row.batchId) ?? []), row]);
    const key = `${row.referenceType}|${row.referenceId}`;
    byReference.set(key, [...(byReference.get(key) ?? []), row]);
  }

  const origins = (byBatch.get(batchId) ?? [])
    .filter((row) => row.movementType === "purchase_receipt" || row.movementType === "production_output" || row.movementType === "opening_balance")
    .map((row) => eventOf(row, 0, null));

  const consumption: TraceEvent[] = [];
  const derived: Id[] = [];
  const seen = new Set<Id>([batchId]);
  const queue: { batch: Id; depth: number }[] = [{ batch: batchId, depth: 0 }];

  while (queue.length > 0) {
    const { batch, depth } = queue.shift()!;
    for (const row of byBatch.get(batch) ?? []) {
      if (!CONSUMING.has(row.movementType)) continue;
      consumption.push(eventOf(row, depth, depth === 0 ? null : batch));
      if (row.movementType !== "production_input" || depth >= MAX_DEPTH) continue;
      // Every batch the same run produced carries this batch forward.
      for (const output of byReference.get(`${row.referenceType}|${row.referenceId}`) ?? []) {
        if (output.movementType !== "production_output" || !output.batchId || seen.has(output.batchId)) continue;
        seen.add(output.batchId);
        derived.push(output.batchId);
        queue.push({ batch: output.batchId, depth: depth + 1 });
      }
    }
  }

  const orders = new Map<Id, ForwardTrace["orders"][number]>();
  for (const event of consumption) {
    if (event.movementType !== "sale_depletion") continue;
    const existing = orders.get(event.referenceId);
    if (existing) {
      existing.quantity += event.quantity;
      existing.items.add(event.itemId);
      if (event.occurredAt < existing.firstAt) existing.firstAt = event.occurredAt;
      if (event.occurredAt > existing.lastAt) existing.lastAt = event.occurredAt;
      existing.depth = Math.min(existing.depth, event.depth);
    } else {
      orders.set(event.referenceId, {
        referenceId: event.referenceId,
        firstAt: event.occurredAt,
        lastAt: event.occurredAt,
        quantity: event.quantity,
        items: new Set([event.itemId]),
        depth: event.depth,
      });
    }
  }

  return {
    origins,
    consumption: consumption.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    orders: [...orders.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt)),
    derivedBatches: derived,
  };
}

export interface BackwardTrace {
  /** Movements the order itself caused. */
  direct: TraceEvent[];
  /** Direct consumption that recorded no batch — not traceable further. */
  unbatched: TraceEvent[];
  /** Batches consumed, directly or through production, with their origin. */
  batches: { batchId: Id; itemId: Id; itemName: Localised; quantity: number; unit: string; depth: number; origin: TraceEvent | null }[];
}

export function traceBackward(movements: StockMovement[], referenceIds: Id[]): BackwardTrace {
  const wanted = new Set(referenceIds);
  const direct = movements
    .filter((row) => wanted.has(row.referenceId) && (row.referenceType === "order" || row.movementType === "sale_depletion"))
    .map((row) => eventOf(row, 0, null));

  const byBatch = new Map<Id, StockMovement[]>();
  const byReference = new Map<string, StockMovement[]>();
  for (const row of movements) {
    if (row.batchId) byBatch.set(row.batchId, [...(byBatch.get(row.batchId) ?? []), row]);
    const key = `${row.referenceType}|${row.referenceId}`;
    byReference.set(key, [...(byReference.get(key) ?? []), row]);
  }

  const batches: BackwardTrace["batches"] = [];
  const seen = new Set<Id>();
  const queue: { event: TraceEvent; depth: number }[] = direct
    .filter((event) => event.batchId)
    .map((event) => ({ event, depth: 0 }));

  while (queue.length > 0) {
    const { event, depth } = queue.shift()!;
    const batchId = event.batchId!;
    const key = `${batchId}|${depth}`;
    if (seen.has(key)) {
      const existing = batches.find((row) => row.batchId === batchId && row.depth === depth);
      if (existing) existing.quantity += event.quantity;
      continue;
    }
    seen.add(key);
    const ledger = byBatch.get(batchId) ?? [];
    const originRow = ledger.find(
      (row) => row.movementType === "purchase_receipt" || row.movementType === "production_output" || row.movementType === "opening_balance",
    );
    const origin = originRow ? eventOf(originRow, depth, null) : null;
    batches.push({
      batchId,
      itemId: event.itemId,
      itemName: event.itemName,
      quantity: event.quantity,
      unit: event.unit,
      depth,
      origin,
    });

    // A produced batch: its run's inputs are in this order too.
    if (originRow?.movementType === "production_output" && depth < MAX_DEPTH) {
      for (const input of byReference.get(`${originRow.referenceType}|${originRow.referenceId}`) ?? []) {
        if (input.movementType !== "production_input" || !input.batchId) continue;
        queue.push({ event: eventOf(input, depth + 1, batchId), depth: depth + 1 });
      }
    }
  }

  return {
    direct,
    unbatched: direct.filter((event) => !event.batchId),
    batches,
  };
}
