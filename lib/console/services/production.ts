"use client";

/**
 * Production and distribution orders — SRS §17.5, FR-BRN-021 … FR-BRN-028.
 *
 * The backend has recipes, a stock ledger and transfers, but no production
 * order and no distribution order. So the *documents* live here, behind an
 * interface a server can take over, and everything that moves stock goes to
 * the real ledger:
 *
 *   - completing a production order posts one `production_input` movement per
 *     input and one `production_output` for what was made, all referencing
 *     the order (`POST /inventory/movements`);
 *   - dispatching a distribution order creates one real transfer per branch.
 *
 * Neither is atomic on the server, so each leg's movement or transfer id is
 * written back onto the document as it lands. A run that fails part-way is
 * left in `posting_failed` with the legs that did post marked, and a retry
 * posts only the rest — never the same input twice.
 */

import type { Id, IsoDate, IsoDateTime, Localised, Money, Transfer, UnitCode } from "../types";
import type { AllocationRule, Overhead } from "../production";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type InventoryService } from "./types";

export type ProductionStatus = "planned" | "in_progress" | "posting_failed" | "completed" | "cancelled";

export interface ProductionInputLeg {
  itemId: Id;
  name: Localised;
  unit: UnitCode;
  /** What the recipe said for the target, gross. */
  theoretical: string;
  actual: string;
  /** Recipe proportion per yield, kept so yield variance can be recomputed later. */
  perBatch: string;
  optional: boolean;
  unitCostMinor: number;
  movementId: Id | null;
  error: string | null;
}

export interface ProductionCompletion {
  actualOutput: string;
  inputs: ProductionInputLeg[];
  outputMovementId: Id | null;
  outputError: string | null;
  overhead: Overhead;
  inputsCostMinor: number;
  overheadMinor: number;
  totalCostMinor: number;
  unitCostMinor: number | null;
  yieldPerBatch: string;
  theoreticalOutput: string | null;
  yieldVariance: string | null;
  yieldVariancePercent: number | null;
  batchNumber: string;
  productionDate: IsoDate;
  expiryDate: IsoDate | null;
  completedAt: IsoDateTime;
  completedBy: string | null;
}

export interface ProductionOrder {
  id: Id;
  number: string;
  kitchenId: Id;
  kitchenName: Localised;
  locationId: Id;
  recipeId: Id;
  recipeName: Localised;
  outputItemId: Id;
  outputName: Localised;
  unit: UnitCode;
  targetQuantity: string;
  targetDate: IsoDate;
  status: ProductionStatus;
  /** FR-BRN-022 — starting with a known shortage is allowed, but on the record. */
  shortageOverride: { note: string; by: string | null; at: IsoDateTime } | null;
  startedAt: IsoDateTime | null;
  startedBy: string | null;
  completion: ProductionCompletion | null;
  currency: Money["currency"];
  notes: string | null;
  createdAt: IsoDateTime;
  createdBy: string | null;
}

export type DistributionStatus = "draft" | "dispatched" | "partial";

export interface DistributionLine {
  branchId: Id;
  branchName: Localised;
  requested: string;
  priority: number;
  allocated: string;
  transferId: Id | null;
  error: string | null;
}

export interface DistributionOrder {
  id: Id;
  number: string;
  kitchenId: Id;
  kitchenName: Localised;
  fromLocationId: Id;
  itemId: Id;
  itemName: Localised;
  unit: UnitCode;
  unitCostMinor: number;
  currency: Money["currency"];
  productionOrderId: Id | null;
  batchNumber: string | null;
  available: string;
  rule: AllocationRule;
  lines: DistributionLine[];
  status: DistributionStatus;
  createdAt: IsoDateTime;
  createdBy: string | null;
  dispatchedAt: IsoDateTime | null;
}

function nextNumber(prefix: string, existing: { number: string }[]): string {
  const highest = existing.reduce((max, row) => {
    const n = Number(row.number.replace(/^\D+-?/, ""));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

const orders = localCollection<ProductionOrder>(
  {
    name: "production-orders",
    idOf: (row) => row.id,
    search: (row) => [row.number, row.outputName, row.recipeName, row.completion?.batchNumber ?? null],
    filters: {
      status: (row) => row.status,
      kitchenId: (row) => row.kitchenId,
      outputItemId: (row) => row.outputItemId,
    },
    sorters: {
      number: (row) => row.number,
      targetDate: (row) => row.targetDate,
      createdAt: (row) => row.createdAt,
    },
    factory: (input, id) => ({
      id,
      number: input.number ?? "",
      kitchenId: input.kitchenId ?? "",
      kitchenName: input.kitchenName ?? { en: "", ar: "" },
      locationId: input.locationId ?? input.kitchenId ?? "",
      recipeId: input.recipeId ?? "",
      recipeName: input.recipeName ?? { en: "", ar: "" },
      outputItemId: input.outputItemId ?? "",
      outputName: input.outputName ?? { en: "", ar: "" },
      unit: input.unit ?? "pc",
      targetQuantity: input.targetQuantity ?? "0",
      targetDate: input.targetDate ?? nowIso().slice(0, 10),
      status: "planned",
      shortageOverride: null,
      startedAt: null,
      startedBy: null,
      completion: null,
      currency: input.currency ?? "EGP",
      notes: input.notes ?? null,
      createdAt: nowIso(),
      createdBy: input.createdBy ?? null,
    }),
  },
  () => getActiveTenantId(),
);

const distributions = localCollection<DistributionOrder>(
  {
    name: "distribution-orders",
    idOf: (row) => row.id,
    search: (row) => [row.number, row.itemName, row.batchNumber],
    filters: { status: (row) => row.status, kitchenId: (row) => row.kitchenId },
    sorters: { number: (row) => row.number, createdAt: (row) => row.createdAt },
    factory: (input, id) => ({
      id,
      number: input.number ?? "",
      kitchenId: input.kitchenId ?? "",
      kitchenName: input.kitchenName ?? { en: "", ar: "" },
      fromLocationId: input.fromLocationId ?? "",
      itemId: input.itemId ?? "",
      itemName: input.itemName ?? { en: "", ar: "" },
      unit: input.unit ?? "pc",
      unitCostMinor: input.unitCostMinor ?? 0,
      currency: input.currency ?? "EGP",
      productionOrderId: input.productionOrderId ?? null,
      batchNumber: input.batchNumber ?? null,
      available: input.available ?? "0",
      rule: input.rule ?? "proportional",
      lines: input.lines ?? [],
      status: "draft",
      createdAt: nowIso(),
      createdBy: input.createdBy ?? null,
      dispatchedAt: null,
    }),
  },
  () => getActiveTenantId(),
);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Ledger = Pick<InventoryService, "postProductionMovement"> & { transfers: Pick<InventoryService["transfers"], "create"> };

export interface ProductionService {
  orders: typeof orders;
  distributions: typeof distributions;
  createOrder(input: Omit<Partial<ProductionOrder>, "id" | "number" | "status">): Promise<ProductionOrder>;
  start(id: Id, input: { by: string | null; shortageNote: string | null }): Promise<ProductionOrder>;
  cancel(id: Id): Promise<ProductionOrder>;
  /**
   * Record the run and post it. Saves the completion first, so a tab closed
   * mid-post still knows what it meant to do, then posts each missing leg.
   */
  complete(id: Id, completion: ProductionCompletion, ledger: Ledger): Promise<ProductionOrder>;
  /** Post whatever legs of a failed run have not landed. */
  retryPosting(id: Id, ledger: Ledger): Promise<ProductionOrder>;
  /** Output of this production order not yet on a dispatched distribution. */
  undistributed(orderId: Id): Promise<string>;
  createDistribution(input: Omit<Partial<DistributionOrder>, "id" | "number" | "status">): Promise<DistributionOrder>;
  saveDistribution(id: Id, patch: Pick<DistributionOrder, "rule" | "lines">): Promise<DistributionOrder>;
  /** One transfer per branch with something allocated; retry sends only what has none. */
  dispatch(id: Id, ledger: Ledger, requestedBy: Localised): Promise<DistributionOrder>;
  removeDistribution(id: Id): Promise<void>;
}

async function mustGet(id: Id): Promise<ProductionOrder> {
  const row = await orders.get(id);
  if (!row) throw new ServiceError("NOT_FOUND", "That production order no longer exists.", 404);
  return row;
}

async function post(order: ProductionOrder, ledger: Ledger): Promise<ProductionOrder> {
  const completion = order.completion;
  if (!completion) throw new ServiceError("CONFLICT", "Nothing has been recorded to post.", 409);

  const inputs: ProductionInputLeg[] = [];
  for (const leg of completion.inputs) {
    if (leg.movementId || Number(leg.actual) <= 0) {
      inputs.push({ ...leg, error: null });
      continue;
    }
    try {
      const { movementId } = await ledger.postProductionMovement({
        locationId: order.locationId,
        itemId: leg.itemId,
        direction: "input",
        quantity: leg.actual,
        referenceId: order.id,
        notes: `${order.number} · ${completion.batchNumber}`,
      });
      inputs.push({ ...leg, movementId, error: null });
    } catch (cause) {
      inputs.push({ ...leg, error: errorText(cause) });
    }
  }

  let outputMovementId = completion.outputMovementId;
  let outputError: string | null = null;
  if (!outputMovementId && Number(completion.actualOutput) > 0) {
    try {
      const posted = await ledger.postProductionMovement({
        locationId: order.locationId,
        itemId: order.outputItemId,
        direction: "output",
        quantity: completion.actualOutput,
        unitCostMinor: completion.unitCostMinor === null ? undefined : completion.unitCostMinor.toFixed(4),
        referenceId: order.id,
        notes: `${order.number} · ${completion.batchNumber}`,
      });
      outputMovementId = posted.movementId;
    } catch (cause) {
      outputError = errorText(cause);
    }
  }

  const failed = inputs.some((leg) => leg.error) || outputError !== null;
  return orders.update(order.id, {
    status: failed ? "posting_failed" : "completed",
    completion: { ...completion, inputs, outputMovementId, outputError },
  });
}

export const productionService: ProductionService = {
  orders,
  distributions,

  async createOrder(input) {
    if (!input.kitchenId || !input.recipeId || !input.outputItemId) {
      throw new ServiceError("VALIDATION", "Choose a kitchen, a recipe and what it makes.", 400);
    }
    if (!(Number(input.targetQuantity) > 0)) {
      throw new ServiceError("VALIDATION", "The target quantity must be more than zero.", 400);
    }
    if (!input.targetDate) throw new ServiceError("VALIDATION", "Give the order a target date.", 400);
    return orders.create({ ...input, number: nextNumber("PRD", await orders.all()) });
  },

  async start(id, input) {
    const order = await mustGet(id);
    if (order.status !== "planned") throw new ServiceError("CONFLICT", "Only a planned order can be started.", 409);
    return orders.update(id, {
      status: "in_progress",
      startedAt: nowIso(),
      startedBy: input.by,
      shortageOverride: input.shortageNote ? { note: input.shortageNote, by: input.by, at: nowIso() } : null,
    });
  },

  async cancel(id) {
    const order = await mustGet(id);
    if (order.status !== "planned" && order.status !== "in_progress") {
      throw new ServiceError("CONFLICT", "A run that has posted stock cannot be cancelled.", 409);
    }
    return orders.update(id, { status: "cancelled" });
  },

  async complete(id, completion, ledger) {
    const order = await mustGet(id);
    if (order.status !== "in_progress") throw new ServiceError("CONFLICT", "Only a started order can be completed.", 409);
    if (!(Number(completion.actualOutput) >= 0)) throw new ServiceError("VALIDATION", "Enter what was made.", 400);
    if (!completion.batchNumber.trim()) throw new ServiceError("VALIDATION", "The output batch needs a number.", 400);
    const saved = await orders.update(id, { status: "posting_failed", completion });
    return post(saved, ledger);
  },

  async retryPosting(id, ledger) {
    const order = await mustGet(id);
    if (order.status !== "posting_failed") return order;
    return post(order, ledger);
  },

  async undistributed(orderId) {
    const order = await mustGet(orderId);
    const made = Number(order.completion?.actualOutput ?? 0);
    const sent = (await distributions.all())
      .filter((row) => row.productionOrderId === orderId)
      .flatMap((row) => row.lines)
      .filter((line) => line.transferId)
      .reduce((sum, line) => sum + Number(line.allocated || 0), 0);
    return String(Math.max(0, Math.round((made - sent) * 1000) / 1000));
  },

  async createDistribution(input) {
    if (!input.kitchenId || !input.itemId || !input.fromLocationId) {
      throw new ServiceError("VALIDATION", "Choose the kitchen and the item to distribute.", 400);
    }
    return distributions.create({ ...input, number: nextNumber("DST", await distributions.all()) });
  },

  async saveDistribution(id, patch) {
    const row = await distributions.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That distribution order no longer exists.", 404);
    if (row.status !== "draft") throw new ServiceError("CONFLICT", "A dispatched distribution cannot be changed.", 409);
    return distributions.update(id, patch);
  },

  async dispatch(id, ledger, requestedBy) {
    const row = await distributions.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That distribution order no longer exists.", 404);
    const total = row.lines.reduce((sum, line) => sum + Number(line.allocated || 0), 0);
    if (total - Number(row.available) > 1e-9) {
      throw new ServiceError("VALIDATION", "More is allocated than there is to send.", 400);
    }
    // Drafts do not reserve anything, so another distribution of the same run
    // may have gone out since this one was drafted. Check against what is left now.
    if (row.productionOrderId) {
      const unsent = row.lines
        .filter((line) => !line.transferId)
        .reduce((sum, line) => sum + Number(line.allocated || 0), 0);
      const left = Number(await productionService.undistributed(row.productionOrderId));
      if (unsent - left > 1e-9) {
        throw new ServiceError(
          "CONFLICT",
          `Only ${left} is left of this run — another distribution has sent some of it. Lower the allocations and try again.`,
          409,
        );
      }
    }

    const lines: DistributionLine[] = [];
    for (const line of row.lines) {
      if (line.transferId || !(Number(line.allocated) > 0)) {
        lines.push({ ...line, error: null });
        continue;
      }
      try {
        const transfer = await ledger.transfers.create({
          reference: `${row.number}-${lines.length + 1}`,
          fromLocationId: row.fromLocationId,
          fromLocationName: row.kitchenName,
          toLocationId: line.branchId,
          toLocationName: line.branchName,
          requestedBy,
          lines: [
            {
              id: `${row.id}_${line.branchId}`,
              itemId: row.itemId,
              itemName: row.itemName,
              dispatched: { value: line.allocated, unit: row.unit },
              received: null,
              discrepancy: 0,
              unitCost: { amount: row.unitCostMinor, currency: row.currency },
            },
          ],
        } as Partial<Transfer>);
        lines.push({ ...line, transferId: transfer.id || `sent_${Date.now()}`, error: null });
      } catch (cause) {
        lines.push({ ...line, error: errorText(cause) });
      }
    }

    const pending = lines.some((line) => !line.transferId && Number(line.allocated) > 0);
    return distributions.update(id, {
      lines,
      status: pending ? "partial" : "dispatched",
      dispatchedAt: row.dispatchedAt ?? nowIso(),
    });
  },

  async removeDistribution(id) {
    const row = await distributions.get(id);
    if (row && row.status !== "draft") {
      throw new ServiceError("CONFLICT", "A distribution that has sent stock cannot be deleted.", 409);
    }
    await distributions.remove(id);
  },
};
