"use client";

/**
 * Availability records the catalogue API does not keep — FR-MNU-030, FR-MNU-032,
 * FR-MNU-034, FR-MNU-035.
 *
 * The 86 itself is real: `POST /catalogue/availability-rules/{id}/86` takes the
 * flag, a reason and an automatic re-enable time. What the API has no field
 * for is kept here:
 *
 *  - **The event log** — every 86, restore, override and automatic action
 *    the console performed, with who and why. An override of automatic
 *    unavailability (FR-MNU-032) is only acceptable if it is recorded, and
 *    this is the record; the server audits the underlying toggle as well.
 *  - **Daily limits** — "only 20 specials today". There is no limit field
 *    anywhere in the catalogue, so the limit is held here and the count sold
 *    is read from real orders. The console disables the item through the real
 *    endpoint when the count reaches the limit.
 */

import type { Id, IsoDate, IsoDateTime, Localised } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export type AvailabilityEventKind =
  /** Manual 86. */
  | "eighty_six"
  | "restore"
  /** FR-MNU-032 — an authorised user overriding automatic unavailability. */
  | "override"
  /** FR-MNU-035 — the daily limit reached zero. */
  | "limit_disabled"
  /** FR-MNU-035 — a new day reset a limit the console had disabled. */
  | "limit_reset"
  /** FR-MNU-030 — a due automatic re-enable, applied. */
  | "auto_reenabled";

export type AutomaticCause = "stock_out" | "daily_limit";

export interface AvailabilityEvent {
  id: Id;
  kind: AvailabilityEventKind;
  itemId: Id;
  itemName: Localised;
  branchId: Id | null;
  reason: string | null;
  /** FR-MNU-032 — what the override set aside. */
  cause: AutomaticCause | null;
  /** FR-MNU-032 — an override lapses; null means until the end of the business day. */
  overrideUntil: IsoDateTime | null;
  /** FR-MNU-035 — extra portions an override allows past the limit. */
  extraQuantity: number | null;
  autoReenableAt: IsoDateTime | null;
  actor: string;
  at: IsoDateTime;
}

/** FR-MNU-035 — a per-item, optionally per-branch, daily cap. */
export interface DailyLimit {
  /** `${itemId}:${branchId ?? "all"}` */
  id: string;
  itemId: Id;
  itemName: Localised;
  branchId: Id | null;
  limit: number;
  active: boolean;
  /** The business day the console auto-disabled the item on, so the next day can restore it. */
  disabledOn: IsoDate | null;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export function dailyLimitId(itemId: Id, branchId: Id | null): string {
  return `${itemId}:${branchId ?? "all"}`;
}

const events = localCollection<AvailabilityEvent>(
  {
    name: "menu-availability-events",
    idOf: (row) => row.id,
    search: (row) => [row.itemName, row.reason, row.actor],
    branchOf: (row) => row.branchId,
    filters: { kind: (row) => row.kind, itemId: (row) => row.itemId },
    sorters: { at: (row) => row.at },
    factory: (input, id) => ({
      id,
      kind: input.kind ?? "eighty_six",
      itemId: input.itemId ?? "",
      itemName: input.itemName ?? { en: "", ar: "" },
      branchId: input.branchId ?? null,
      reason: input.reason ?? null,
      cause: input.cause ?? null,
      overrideUntil: input.overrideUntil ?? null,
      extraQuantity: input.extraQuantity ?? null,
      autoReenableAt: input.autoReenableAt ?? null,
      actor: input.actor ?? "",
      at: input.at ?? nowIso(),
    }),
  },
  () => getActiveTenantId(),
);

const limits = localCollection<DailyLimit>(
  {
    name: "menu-daily-limits",
    idOf: (row) => row.id,
    search: (row) => [row.itemName],
    branchOf: (row) => row.branchId,
    factory: (input) => ({
      id: dailyLimitId(input.itemId ?? "", input.branchId ?? null),
      itemId: input.itemId ?? "",
      itemName: input.itemName ?? { en: "", ar: "" },
      branchId: input.branchId ?? null,
      limit: input.limit ?? 0,
      active: input.active ?? true,
      disabledOn: null,
      updatedBy: input.updatedBy ?? "",
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  () => getActiveTenantId(),
);

export interface MenuAvailabilityService {
  events: typeof events;
  limits: typeof limits;
  log(event: Omit<AvailabilityEvent, "id" | "at">): Promise<AvailabilityEvent>;
  /** Create or replace the limit for an item at a branch. */
  setLimit(input: Pick<DailyLimit, "itemId" | "itemName" | "branchId" | "limit" | "active" | "updatedBy">): Promise<DailyLimit>;
}

export const menuAvailabilityService: MenuAvailabilityService = {
  events,
  limits,
  async log(event) {
    return events.create({ ...event, at: nowIso() });
  },
  async setLimit(input) {
    const id = dailyLimitId(input.itemId, input.branchId);
    const existing = await limits.get(id);
    return existing ? limits.update(id, input) : limits.create(input);
  },
};
