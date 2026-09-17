"use client";

/**
 * Adjusting entries against closed cash sessions — FR-FIN-007.
 *
 * A closed session is immutable: its counted cash, its expected cash and its
 * variance are the record of what happened at the close, and a later
 * correction must not rewrite them. A correction is therefore a new entry
 * that *references* the session, carries its own author, time and reason,
 * and is itself never edited or removed.
 *
 * The backend has no adjusting-entry resource (and no cash-session index), so
 * entries live in the browser-local store. `update` and `remove` are refused
 * here, not merely hidden in the UI, so a second screen cannot break the rule.
 */

import type { Id, IsoDate, IsoDateTime, Money } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export type CashAdjustmentKind = "counted_cash" | "misposted_tender" | "movement" | "other";

export const CASH_ADJUSTMENT_KINDS: CashAdjustmentKind[] = [
  "counted_cash",
  "misposted_tender",
  "movement",
  "other",
];

export interface CashAdjustment {
  id: Id;
  /** The closed session this corrects. */
  sessionId: Id;
  branchId: Id;
  businessDay: IsoDate;
  kind: CashAdjustmentKind;
  /** Signed, minor units: positive raises the counted side, negative lowers it. */
  amount: Money;
  reason: string;
  by: string | null;
  at: IsoDateTime;
}

const store = localCollection<CashAdjustment>(
  {
    name: "finance-cash-adjustments",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    filters: { sessionId: (row) => row.sessionId },
    sorters: { at: (row) => row.at },
    factory: (input, id) => ({
      id,
      sessionId: input.sessionId ?? "",
      branchId: input.branchId ?? "",
      businessDay: input.businessDay ?? "",
      kind: input.kind ?? "other",
      amount: input.amount ?? { amount: 0, currency: "EGP" },
      reason: input.reason ?? "",
      by: input.by ?? null,
      at: nowIso(),
    }),
  },
  () => getActiveTenantId(),
);

export interface RecordAdjustmentInput {
  session: { id: Id; branchId: Id; businessDay: IsoDate; status: string; closedAt: IsoDateTime | null };
  kind: CashAdjustmentKind;
  amount: Money;
  reason: string;
  by: string | null;
}

export interface CashAdjustmentService {
  all(): Promise<CashAdjustment[]>;
  forSession(sessionId: Id): Promise<CashAdjustment[]>;
  /** Append-only. Refuses open sessions, zero amounts and blank reasons. */
  record(input: RecordAdjustmentInput): Promise<CashAdjustment>;
}

export const cashAdjustmentService: CashAdjustmentService = {
  async all() {
    return store.all();
  },

  async forSession(sessionId) {
    const rows = await store.all();
    return rows.filter((row) => row.sessionId === sessionId).sort((a, b) => b.at.localeCompare(a.at));
  },

  async record(input) {
    // An open session is still being counted; it is corrected by its own
    // close, not by an adjusting entry.
    if (input.session.status !== "closed" || !input.session.closedAt) {
      throw new ServiceError(
        "CONFLICT",
        "Adjusting entries are only recorded against a closed session.",
        409,
      );
    }
    if (!Number.isInteger(input.amount.amount) || input.amount.amount === 0) {
      throw new ServiceError("VALIDATION", "An adjusting entry needs a non-zero amount.", 400);
    }
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw new ServiceError("VALIDATION", "Explain the correction in at least ten characters.", 400);
    }
    return store.create({
      sessionId: input.session.id,
      branchId: input.session.branchId,
      businessDay: input.session.businessDay,
      kind: input.kind,
      amount: input.amount,
      reason,
      by: input.by,
    });
  },
};
