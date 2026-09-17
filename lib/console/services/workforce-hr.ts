"use client";

/**
 * Workforce records the backend has no endpoints for — SRS ch.14.
 *
 * The API serves employees, attendance clock-in/out and schedule creation.
 * It has no leave, no swap requests, no schedule publications or
 * acknowledgements, no break records, no clock-in photos and no station
 * assignments, so those live here on `localCollection` under both data
 * modes. The screens depend on this interface; the swap to a server is a
 * change to this file.
 *
 * Nothing here pretends to have delivered what only a server can: a
 * publication records that the mobile push is *awaiting* the notification
 * service, and it stays that way.
 */

import type { EmploymentType, Id, Localised } from "../types";
import { localCollection, localDocument, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type CollectionService } from "./types";
import { DATA_MODE } from "@/lib/api/config";
import { api } from "@/lib/api/endpoints";
import type {
  BreakKind,
  LeaveRequest,
  LeaveType,
  SwapShiftSnapshot,
} from "../workforce-rules";
import type { StationAssignment } from "../workforce-metrics";

const tenantOf = () => getActiveTenantId();

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** FR-HRM-015 — a published week, and who has seen it. */
export interface SchedulePublication {
  id: Id;
  branchId: Id;
  weekStart: string;
  shiftIds: Id[];
  employeeIds: Id[];
  employeeNames: Record<Id, Localised>;
  publishedAt: string;
  publishedBy: string;
  /**
   * The mobile push. There is no notification service behind this console,
   * so it is recorded as awaiting one — never as sent.
   */
  notification: { channel: "push"; status: "awaiting_server" };
  acknowledgements: {
    employeeId: Id;
    at: string;
    via: "terminal" | "manager" | "mobile";
    recordedBy: string | null;
  }[];
}

/** FR-HRM-016 */
export type SwapStatus =
  | "pending_peer"
  | "pending_manager"
  | "approved"
  | "rejected"
  | "declined"
  | "cancelled";

export interface SwapRequest {
  id: Id;
  give: SwapShiftSnapshot;
  take: SwapShiftSnapshot | null;
  fromEmployeeId: Id;
  fromName: Localised;
  toEmployeeId: Id;
  toName: Localised;
  reason: string;
  status: SwapStatus;
  /** The rule check at the moment of the last decision. */
  violations: string[];
  createdAt: string;
  peerRespondedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  /** Whether the roster itself was changed on approval. */
  applied: boolean;
  applyError: string | null;
}

/** FR-HRM-026 */
export interface BreakRecord {
  id: Id;
  employeeKey: string;
  employeeName: string;
  date: string;
  kind: BreakKind;
  startedAt: string;
  endedAt: string | null;
}

/** FR-HRM-027 */
export interface ClockPhoto {
  id: Id;
  employeeKey: string;
  employeeName: string;
  capturedAt: string;
  direction: "in" | "out";
  /** A small JPEG data URL, or null when the camera was not available. */
  image: string | null;
  unavailableReason: string | null;
  /** When this person was shown the notice this photo was taken under. */
  noticeAcknowledgedAt: string | null;
}

export interface PhotoNotice {
  employeeKey: string;
  acknowledgedAt: string;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const ALL_TYPES: EmploymentType[] = ["full_time", "part_time", "casual", "contractor", "trainee"];

const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  {
    id: "annual",
    name: { en: "Annual leave", ar: "إجازة سنوية" },
    paid: true,
    annualDays: 21,
    carryOverMaxDays: 5,
    eligibleTypes: ["full_time", "part_time", "trainee"],
    requiresNote: false,
    active: true,
  },
  {
    id: "sick",
    name: { en: "Sick leave", ar: "إجازة مرضية" },
    paid: true,
    annualDays: 15,
    carryOverMaxDays: 0,
    eligibleTypes: ["full_time", "part_time", "trainee"],
    requiresNote: true,
    active: true,
  },
  {
    id: "unpaid",
    name: { en: "Unpaid leave", ar: "إجازة بدون أجر" },
    paid: false,
    annualDays: null,
    carryOverMaxDays: 0,
    eligibleTypes: ALL_TYPES,
    requiresNote: false,
    active: true,
  },
];

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

const leaveTypesDoc = localDocument<LeaveType[]>("wf-leave-types", () => DEFAULT_LEAVE_TYPES, tenantOf);

const leaveStore = localCollection<LeaveRequest>(
  {
    name: "wf-leave-requests",
    idOf: (row) => row.id,
    search: (row) => [row.employeeName, row.note],
    branchOf: (row) => row.branchId,
    filters: {
      status: (row) => row.status,
      typeId: (row) => row.typeId,
      employeeId: (row) => row.employeeId,
    },
    sorters: { startDate: (row) => row.startDate, createdAt: (row) => row.createdAt },
    factory: (input, id) => ({
      id,
      employeeId: input.employeeId ?? "",
      employeeName: input.employeeName ?? { en: "", ar: "" },
      branchId: input.branchId ?? null,
      typeId: input.typeId ?? "annual",
      startDate: input.startDate ?? "",
      endDate: input.endDate ?? "",
      halfDay: input.halfDay ?? false,
      days: input.days ?? 0,
      note: input.note ?? "",
      status: "pending",
      createdAt: nowIso(),
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
    }),
  },
  tenantOf,
);

const swapStore = localCollection<SwapRequest>(
  {
    name: "wf-swaps",
    idOf: (row) => row.id,
    search: (row) => [row.fromName, row.toName, row.reason],
    branchOf: (row) => row.give.branchId,
    filters: { status: (row) => row.status },
    sorters: { createdAt: (row) => row.createdAt, date: (row) => row.give.date },
    factory: (input, id) => ({
      id,
      give: input.give!,
      take: input.take ?? null,
      fromEmployeeId: input.fromEmployeeId ?? input.give!.employeeId,
      fromName: input.fromName ?? { en: "", ar: "" },
      toEmployeeId: input.toEmployeeId ?? "",
      toName: input.toName ?? { en: "", ar: "" },
      reason: input.reason ?? "",
      status: "pending_peer",
      violations: input.violations ?? [],
      createdAt: nowIso(),
      peerRespondedAt: null,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      applied: false,
      applyError: null,
    }),
  },
  tenantOf,
);

const publicationStore = localCollection<SchedulePublication>(
  {
    name: "wf-publications",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    sorters: { publishedAt: (row) => row.publishedAt, weekStart: (row) => row.weekStart },
    factory: (input, id) => ({
      id,
      branchId: input.branchId ?? "",
      weekStart: input.weekStart ?? "",
      shiftIds: input.shiftIds ?? [],
      employeeIds: input.employeeIds ?? [],
      employeeNames: input.employeeNames ?? {},
      publishedAt: nowIso(),
      publishedBy: input.publishedBy ?? "",
      notification: { channel: "push", status: "awaiting_server" },
      acknowledgements: [],
    }),
  },
  tenantOf,
);

const breakStore = localCollection<BreakRecord>(
  {
    name: "wf-breaks",
    idOf: (row) => row.id,
    search: (row) => [row.employeeName],
    filters: { employeeKey: (row) => row.employeeKey, date: (row) => row.date, kind: (row) => row.kind },
    sorters: { startedAt: (row) => row.startedAt },
    factory: (input, id) => ({
      id,
      employeeKey: input.employeeKey ?? "",
      employeeName: input.employeeName ?? "",
      date: input.date ?? nowIso().slice(0, 10),
      kind: input.kind ?? "rest",
      startedAt: input.startedAt ?? nowIso(),
      endedAt: null,
    }),
  },
  tenantOf,
);

const photoStore = localCollection<ClockPhoto>(
  {
    name: "wf-clock-photos",
    idOf: (row) => row.id,
    search: (row) => [row.employeeName, row.employeeKey],
    sorters: { capturedAt: (row) => row.capturedAt },
    factory: (input, id) => ({
      id,
      employeeKey: input.employeeKey ?? "",
      employeeName: input.employeeName ?? "",
      capturedAt: nowIso(),
      direction: input.direction ?? "in",
      image: input.image ?? null,
      unavailableReason: input.unavailableReason ?? null,
      noticeAcknowledgedAt: input.noticeAcknowledgedAt ?? null,
    }),
  },
  tenantOf,
);

const noticeDoc = localDocument<PhotoNotice[]>("wf-photo-notices", () => [], tenantOf);

const assignmentStore = localCollection<StationAssignment>(
  {
    name: "wf-station-assignments",
    idOf: (row) => row.id,
    search: (row) => [row.employeeName, row.stationName],
    branchOf: (row) => row.branchId,
    filters: { stationId: (row) => row.stationId, date: (row) => row.date },
    sorters: { date: (row) => `${row.date} ${row.startTime}` },
    factory: (input, id) => ({
      id,
      employeeId: input.employeeId ?? "",
      employeeName: input.employeeName ?? { en: "", ar: "" },
      stationId: input.stationId ?? "",
      stationName: input.stationName ?? { en: "", ar: "" },
      branchId: input.branchId ?? null,
      date: input.date ?? nowIso().slice(0, 10),
      startTime: input.startTime ?? "08:00",
      endTime: input.endTime ?? "16:00",
      createdAt: nowIso(),
    }),
  },
  tenantOf,
);

/** Photos older than this are removed on read — the image is evidence, not an archive. */
const PHOTO_RETENTION_DAYS = 90;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface WorkforceHrService {
  /**
   * FR-HRM-002 / FR-HRM-005 — employment type, home branch and the branches
   * this person may cover. Live, the type goes through the real PATCH and
   * each added branch through `POST /workforce/employees/{id}/branches`; the
   * API has no way to remove a branch or move the home branch, so those are
   * refused with that said rather than faked.
   */
  assignEmployment(
    employee: { id: Id; homeBranchId: Id; permittedBranchIds: Id[]; employmentType: EmploymentType },
    next: { employmentType: EmploymentType; homeBranchId: Id; homeBranchName: Localised; permittedBranchIds: Id[] },
  ): Promise<void>;
  leave: {
    /** FR-HRM-017 — configured leave types. */
    types(): Promise<LeaveType[]>;
    saveTypes(next: LeaveType[]): Promise<LeaveType[]>;
    requests: CollectionService<LeaveRequest> & { all(): Promise<LeaveRequest[]> };
    decide(id: Id, status: "approved" | "rejected", by: string, note: string | null): Promise<LeaveRequest>;
    cancel(id: Id): Promise<LeaveRequest>;
  };
  swaps: CollectionService<SwapRequest> & {
    all(): Promise<SwapRequest[]>;
    /** The colleague asked to take the shift answers first. */
    respond(id: Id, accept: boolean): Promise<SwapRequest>;
    decide(
      id: Id,
      input: { approve: boolean; by: string; note: string | null; violations: string[]; applied: boolean; applyError: string | null },
    ): Promise<SwapRequest>;
  };
  publications: CollectionService<SchedulePublication> & {
    all(): Promise<SchedulePublication[]>;
    acknowledge(id: Id, employeeId: Id, via: "terminal" | "manager", recordedBy: string | null): Promise<SchedulePublication>;
  };
  breaks: CollectionService<BreakRecord> & {
    all(): Promise<BreakRecord[]>;
    open(employeeKey: string): Promise<BreakRecord | null>;
    start(input: { employeeKey: string; employeeName: string; kind: BreakKind }): Promise<BreakRecord>;
    end(id: Id): Promise<BreakRecord>;
  };
  photos: CollectionService<ClockPhoto> & {
    all(): Promise<ClockPhoto[]>;
    noticeFor(employeeKey: string): Promise<PhotoNotice | null>;
    acknowledgeNotice(employeeKey: string): Promise<PhotoNotice>;
  };
  stationAssignments: CollectionService<StationAssignment> & { all(): Promise<StationAssignment[]> };
}

async function mustGet<T>(get: Promise<T | null>): Promise<T> {
  const row = await get;
  if (!row) throw new ServiceError("NOT_FOUND", "That record no longer exists.", 404);
  return row;
}

export const workforceHrService: WorkforceHrService = {
  async assignEmployment(employee, next) {
    const permitted = [...new Set([next.homeBranchId, ...next.permittedBranchIds])];
    if (DATA_MODE === "http") {
      const current = new Set([employee.homeBranchId, ...employee.permittedBranchIds]);
      if (next.homeBranchId !== employee.homeBranchId) {
        throw new ServiceError("NOT_SUPPORTED", "The server cannot move an employee's home branch yet.", 501);
      }
      if ([...current].some((id) => !permitted.includes(id))) {
        throw new ServiceError("NOT_SUPPORTED", "The server cannot remove a branch assignment yet.", 501);
      }
      if (next.employmentType !== employee.employmentType) {
        await api.workforceEmployees.update(String(employee.id), { employmentType: next.employmentType });
      }
      for (const branchId of permitted) {
        if (!current.has(branchId)) {
          await api.workforceEmployees.addBranch(String(employee.id), { branchId: String(branchId) });
        }
      }
      return;
    }
    // Demo data: the employee collection is the registry's own, reached
    // lazily because the registry imports this module.
    const { services } = await import("./index");
    await services.workforce.employees.update(employee.id, {
      employmentType: next.employmentType,
      homeBranchId: next.homeBranchId,
      homeBranchName: next.homeBranchName,
      permittedBranchIds: permitted,
    });
  },

  leave: {
    async types() {
      return leaveTypesDoc.read();
    },
    async saveTypes(next) {
      const ids = new Set<string>();
      for (const type of next) {
        if (ids.has(type.id)) throw new ServiceError("VALIDATION", "Two leave types share an id.", 400);
        ids.add(type.id);
      }
      leaveTypesDoc.write(next);
      return next;
    },
    requests: leaveStore,
    async decide(id, status, by, note) {
      const row = await mustGet(leaveStore.get(id));
      if (row.status !== "pending") {
        throw new ServiceError("CONFLICT", "This request has already been decided.", 409);
      }
      if (status === "rejected" && !note?.trim()) {
        throw new ServiceError("VALIDATION", "A rejection needs a reason.", 400);
      }
      return leaveStore.update(id, { status, decidedAt: nowIso(), decidedBy: by, decisionNote: note });
    },
    async cancel(id) {
      const row = await mustGet(leaveStore.get(id));
      if (row.status === "rejected" || row.status === "cancelled") {
        throw new ServiceError("CONFLICT", "This request is already closed.", 409);
      }
      return leaveStore.update(id, { status: "cancelled", decidedAt: nowIso() });
    },
  },

  swaps: {
    ...swapStore,
    async respond(id, accept) {
      const row = await mustGet(swapStore.get(id));
      if (row.status !== "pending_peer") {
        throw new ServiceError("CONFLICT", "This swap is no longer waiting for the colleague.", 409);
      }
      return swapStore.update(id, {
        status: accept ? "pending_manager" : "declined",
        peerRespondedAt: nowIso(),
      });
    },
    async decide(id, input) {
      const row = await mustGet(swapStore.get(id));
      if (row.status !== "pending_manager") {
        throw new ServiceError("CONFLICT", "Only a swap the colleague has accepted can be decided.", 409);
      }
      if (input.approve && input.violations.some((key) => key.endsWith(".block"))) {
        throw new ServiceError("CONFLICT", "This swap breaks a rule that cannot be overridden.", 409);
      }
      if (!input.approve && !input.note?.trim()) {
        throw new ServiceError("VALIDATION", "A rejection needs a reason.", 400);
      }
      return swapStore.update(id, {
        status: input.approve ? "approved" : "rejected",
        decidedAt: nowIso(),
        decidedBy: input.by,
        decisionNote: input.note,
        violations: input.violations,
        applied: input.applied,
        applyError: input.applyError,
      });
    },
  },

  publications: {
    ...publicationStore,
    async acknowledge(id, employeeId, via, recordedBy) {
      const row = await mustGet(publicationStore.get(id));
      if (!row.employeeIds.includes(employeeId)) {
        throw new ServiceError("VALIDATION", "That person has no shift in this publication.", 400);
      }
      // Write-once per person: the first acknowledgement is the one that counts.
      if (row.acknowledgements.some((ack) => ack.employeeId === employeeId)) return row;
      return publicationStore.update(id, {
        acknowledgements: [...row.acknowledgements, { employeeId, at: nowIso(), via, recordedBy }],
      });
    },
  },

  breaks: {
    ...breakStore,
    async open(employeeKey) {
      const all = await breakStore.all();
      return all.find((row) => row.employeeKey === employeeKey && !row.endedAt) ?? null;
    },
    async start(input) {
      const open = await workforceHrService.breaks.open(input.employeeKey);
      if (open) throw new ServiceError("CONFLICT", "A break is already running.", 409);
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      return breakStore.create({ ...input, date, startedAt: now.toISOString() });
    },
    async end(id) {
      const row = await mustGet(breakStore.get(id));
      if (row.endedAt) return row;
      return breakStore.update(id, { endedAt: nowIso() });
    },
  },

  photos: {
    ...photoStore,
    async all() {
      const rows = await photoStore.all();
      const cutoff = Date.now() - PHOTO_RETENTION_DAYS * 86_400_000;
      const kept = rows.filter((row) => Date.parse(row.capturedAt) >= cutoff);
      if (kept.length !== rows.length) await photoStore.replace(kept);
      return kept;
    },
    async noticeFor(employeeKey) {
      return noticeDoc.read().find((row) => row.employeeKey === employeeKey) ?? null;
    },
    async acknowledgeNotice(employeeKey) {
      const existing = noticeDoc.read();
      const found = existing.find((row) => row.employeeKey === employeeKey);
      if (found) return found;
      const notice = { employeeKey, acknowledgedAt: nowIso() };
      noticeDoc.write([...existing, notice]);
      return notice;
    },
  },

  stationAssignments: assignmentStore,
};
