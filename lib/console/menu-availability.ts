/**
 * Availability arithmetic — FR-MNU-030, FR-MNU-032, FR-MNU-034, FR-MNU-035.
 *
 * Pure: the board renders from these and the enforcement pass acts on the
 * same answers, so what the screen says will happen is what happens.
 */

import type { Id, Integration, IsoDate, MenuItem, Order } from "./types";
import type { AutomaticCause, AvailabilityEvent, DailyLimit } from "./services/menu-availability";

/** Lines that count as sold: not voided, on orders that were not cancelled. */
const DEAD_ORDER = new Set(["cancelled", "draft", "merged"]);

/** FR-MNU-035 — portions sold today per item, from real order lines. */
export function soldOn(orders: Order[], businessDay: IsoDate, branchId: Id | null): Map<Id, number> {
  const sold = new Map<Id, number>();
  for (const order of orders) {
    if (order.businessDay !== businessDay) continue;
    if (branchId && order.branchId !== branchId) continue;
    if (DEAD_ORDER.has(order.state)) continue;
    for (const line of order.lines) {
      if (line.state === "voided") continue;
      sold.set(line.menuItemId, (sold.get(line.menuItemId) ?? 0) + line.quantity);
    }
  }
  return sold;
}

/** The limit that governs an item at a branch: the branch's own, else the all-branch one. */
export function limitFor(limits: DailyLimit[], itemId: Id, branchId: Id | null): DailyLimit | null {
  const own = branchId ? limits.find((row) => row.itemId === itemId && row.branchId === branchId) : undefined;
  return own ?? limits.find((row) => row.itemId === itemId && row.branchId === null) ?? null;
}

/** FR-MNU-032 — the override in force for an item, if any. */
export function activeOverride(
  events: AvailabilityEvent[],
  itemId: Id,
  cause: AutomaticCause,
  now: Date,
  businessDay: IsoDate,
): AvailabilityEvent | null {
  const candidates = events
    .filter((event) => event.kind === "override" && event.itemId === itemId && event.cause === cause)
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const event of candidates) {
    if (event.overrideUntil) {
      if (new Date(event.overrideUntil).getTime() > now.getTime()) return event;
    } else if (event.at.slice(0, 10) >= businessDay) {
      // No end given: until the end of the business day it was granted on.
      return event;
    }
  }
  return null;
}

export interface ItemAvailability {
  item: MenuItem;
  limit: DailyLimit | null;
  sold: number;
  /** Limit − sold + any override allowance. Null without an active limit. */
  remainingToday: number | null;
  /** FR-MNU-032 — what would make the item unavailable on its own. */
  automatic: AutomaticCause | null;
  override: AvailabilityEvent | null;
  /** FR-MNU-030 — a manual 86 whose automatic re-enable time has passed. */
  reenableDue: boolean;
}

export function describeItem(
  item: MenuItem,
  context: { limits: DailyLimit[]; sold: Map<Id, number>; events: AvailabilityEvent[]; branchId: Id | null; now: Date; businessDay: IsoDate },
): ItemAvailability {
  const limit = limitFor(context.limits, item.id, context.branchId);
  const sold = context.sold.get(item.id) ?? 0;

  const limitOverride = activeOverride(context.events, item.id, "daily_limit", context.now, context.businessDay);
  const stockOverride = activeOverride(context.events, item.id, "stock_out", context.now, context.businessDay);

  const remainingToday =
    limit && limit.active ? limit.limit - sold + (limitOverride?.extraQuantity ?? 0) : null;

  let automatic: AutomaticCause | null = null;
  if (remainingToday !== null && remainingToday <= 0 && !limitOverride) automatic = "daily_limit";
  else if (item.remainingSellable === 0 && !stockOverride) automatic = "stock_out";

  const override =
    remainingToday !== null && limit && limit.limit - sold <= 0 ? limitOverride : item.remainingSellable === 0 ? stockOverride : null;

  const reenableDue = Boolean(
    !item.available && item.autoReenableAt && new Date(item.autoReenableAt).getTime() <= context.now.getTime(),
  );

  return { item, limit, sold, remainingToday, automatic, override, reenableDue };
}

export type EnforcementAction =
  | { kind: "reenable"; row: ItemAvailability }
  | { kind: "limit_disable"; row: ItemAvailability }
  | { kind: "limit_reset"; row: ItemAvailability };

/**
 * What the console should do right now, and nothing more.
 *
 *  - a due automatic re-enable restores the item (FR-MNU-030);
 *  - a limit at zero with no override takes the item off (FR-MNU-035);
 *  - a limit the console disabled on an earlier day brings it back.
 *
 * Each is idempotent against the state it reads, so running the pass twice
 * does nothing the second time.
 */
export function planEnforcement(rows: ItemAvailability[], businessDay: IsoDate): EnforcementAction[] {
  const actions: EnforcementAction[] = [];
  for (const row of rows) {
    if (row.reenableDue) {
      actions.push({ kind: "reenable", row });
      continue;
    }
    if (row.limit?.active && row.limit.disabledOn && row.limit.disabledOn < businessDay && !row.item.available) {
      actions.push({ kind: "limit_reset", row });
      continue;
    }
    if (row.automatic === "daily_limit" && row.item.available) {
      actions.push({ kind: "limit_disable", row });
    }
  }
  return actions;
}

// ---------------------------------------------------------------------------
// FR-MNU-034 — aggregator propagation
// ---------------------------------------------------------------------------

export type PropagationState =
  /** The connector is off, failing or tripped: nothing is reaching the platform. */
  | "blocked"
  /** The connector has succeeded since the change; per-item confirmation is not reported. */
  | "synced_after"
  /** No success since the change, still inside the 60-second target. */
  | "waiting"
  /** No success since the change, past the 60-second target. */
  | "overdue";

export const PROPAGATION_TARGET_MS = 60_000;

export function propagationState(integration: Integration, changedAt: string, now: Date): PropagationState {
  if (!integration.enabled || integration.circuitOpen || integration.status === "failing" || integration.status === "disabled" || integration.status === "not_configured") {
    return "blocked";
  }
  const changed = new Date(changedAt).getTime();
  const success = integration.lastSuccessAt ? new Date(integration.lastSuccessAt).getTime() : null;
  if (success !== null && success >= changed) return "synced_after";
  return now.getTime() - changed > PROPAGATION_TARGET_MS ? "overdue" : "waiting";
}
