"use client";

/**
 * Day-close automation and trigger configuration — FR-FIN-025, FR-FIN-026.
 *
 * Per branch: whether the day closes itself at the branch's business-day
 * boundary, whether sessions still open at that moment are force-closed and
 * flagged, and which day-close triggers are configured (fiscal document
 * finalisation, inventory day-end snapshot, report pre-aggregation,
 * accounting export generation).
 *
 * This is configuration only. Running a close on a schedule, and running the
 * triggers, is the server's job — the browser is not awake at 04:00. The API
 * has no endpoint to store this configuration and `POST .../day-closes`
 * returns no trigger status, so the screen reports every trigger outcome as
 * "not reported by the backend" rather than as done.
 */

import type { Id, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export type DayCloseTrigger = "fiscal" | "inventorySnapshot" | "reportPreaggregation" | "accountingExport";

export const DAY_CLOSE_TRIGGERS: DayCloseTrigger[] = [
  "fiscal",
  "inventorySnapshot",
  "reportPreaggregation",
  "accountingExport",
];

export interface DayCloseAutomation {
  branchId: Id;
  autoClose: boolean;
  forceCloseOpenSessions: boolean;
  triggers: Record<DayCloseTrigger, boolean>;
  updatedAt: IsoDateTime;
  updatedBy: string | null;
}

export function defaultAutomation(branchId: Id): DayCloseAutomation {
  return {
    branchId,
    autoClose: false,
    forceCloseOpenSessions: true,
    triggers: { fiscal: true, inventorySnapshot: true, reportPreaggregation: true, accountingExport: false },
    updatedAt: "",
    updatedBy: null,
  };
}

const store = localCollection<DayCloseAutomation>(
  {
    name: "finance-day-close-automation",
    idOf: (row) => row.branchId,
    branchOf: (row) => row.branchId,
    factory: (input) => ({
      ...defaultAutomation(input.branchId ?? ""),
      ...input,
      updatedAt: nowIso(),
    }),
  },
  () => getActiveTenantId(),
);

export interface DayCloseConfigService {
  all(): Promise<DayCloseAutomation[]>;
  save(input: Omit<DayCloseAutomation, "updatedAt">): Promise<DayCloseAutomation>;
}

export const dayCloseConfigService: DayCloseConfigService = {
  all: () => store.all(),
  async save(input) {
    const existing = await store.get(input.branchId);
    return existing
      ? store.update(input.branchId, { ...input, updatedAt: nowIso() })
      : store.create(input);
  },
};

/**
 * The next moment the boundary falls, in the viewer's clock.
 *
 * The branch's timezone is not applied: the boundary is shown as the branch
 * states it ("04:00"), with the date it next occurs on.
 */
export function nextBoundary(boundary: string, now = new Date()): Date {
  const [h, m] = boundary.split(":").map((part) => Number(part));
  const next = new Date(now);
  next.setHours(Number.isFinite(h) ? h! : 4, Number.isFinite(m) ? m! : 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
