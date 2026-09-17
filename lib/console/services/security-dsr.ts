"use client";

/**
 * Data subject requests — FR-SEC-062.
 *
 * The customer screen can already export one person's data and anonymise
 * them (FR-CRM-009). What was missing is the register a tenant answers a
 * regulator from: which requests arrived, through which channel, whether
 * the requester's identity was checked, what was done, and whether it was
 * done inside the statutory window. That is this.
 *
 * The register does not re-implement export or erasure — the screen drives
 * `services.crm.customers.exportOne` / `.erase` for the linked customer and
 * the request records that it happened. Erasure is anonymisation: the
 * financial record stays, as the requirement says.
 *
 * No endpoint exists for a DSR register, so it is kept per tenant in
 * browser storage behind this interface. Rows are written through a strict
 * schema (FR-SEC-047), and a finished request cannot be reopened or edited.
 */

import { z } from "zod";

import type { Id, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { requireActiveTenantId } from "./tenant-context";
import { ServiceError, type CollectionService } from "./types";
import { securityEventService } from "./security-events";
import { parseAtBoundary } from "../security-policy";
import type { Actor } from "./security-settings";

export const DSR_TYPES = ["access", "rectification", "erasure"] as const;
export type DsrType = (typeof DSR_TYPES)[number];

export const DSR_STATUSES = ["received", "verifying", "in_progress", "completed", "rejected"] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];

export const DSR_CHANNELS = ["email", "phone", "in_person", "web", "post"] as const;
export type DsrChannel = (typeof DSR_CHANNELS)[number];

/** Days allowed to answer. GDPR and the GCC data-protection laws both use one month. */
export const DSR_RESPONSE_DAYS = 30;

export interface DsrHistoryEntry {
  at: IsoDateTime;
  by: string;
  status: DsrStatus;
  note: string;
}

export interface DataSubjectRequest {
  id: Id;
  tenantId: Id;
  reference: string;
  type: DsrType;
  status: DsrStatus;
  channel: DsrChannel;
  subjectName: string;
  subjectContact: string;
  customerId: Id | null;
  receivedAt: IsoDateTime;
  dueAt: IsoDateTime;
  identityVerified: boolean;
  details: string;
  completedAt: IsoDateTime | null;
  history: DsrHistoryEntry[];
}

const createSchema = z.strictObject({
  type: z.enum(DSR_TYPES),
  channel: z.enum(DSR_CHANNELS),
  subjectName: z.string().trim().min(2).max(120),
  subjectContact: z.string().trim().min(3).max(160),
  customerId: z.string().min(1).nullable(),
  receivedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
  details: z.string().trim().max(2000),
});
export type DsrCreateInput = z.infer<typeof createSchema>;

const advanceSchema = z.strictObject({
  status: z.enum(DSR_STATUSES),
  note: z.string().trim().max(2000),
  identityVerified: z.boolean().optional(),
  customerId: z.string().min(1).nullable().optional(),
});
export type DsrAdvanceInput = z.infer<typeof advanceSchema>;

const NEXT: Record<DsrStatus, DsrStatus[]> = {
  received: ["verifying", "rejected"],
  verifying: ["in_progress", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

export function allowedNext(status: DsrStatus): DsrStatus[] {
  return NEXT[status];
}

export function isOverdue(request: DataSubjectRequest, now = Date.now()): boolean {
  return request.status !== "completed" && request.status !== "rejected" && Date.parse(request.dueAt) < now;
}

const store = localCollection<DataSubjectRequest>(
  {
    name: "sec-dsr",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.subjectName, row.subjectContact],
    filters: { status: (row) => row.status, type: (row) => row.type },
    sorters: { receivedAt: (row) => row.receivedAt, dueAt: (row) => row.dueAt },
  },
  () => requireActiveTenantId(),
);

export interface DsrService {
  requests: Pick<CollectionService<DataSubjectRequest>, "list" | "get">;
  create(input: unknown, actor: Actor): Promise<DataSubjectRequest>;
  advance(id: Id, input: unknown, actor: Actor): Promise<DataSubjectRequest>;
}

export const dsrService: DsrService = {
  requests: { list: store.list, get: store.get },

  async create(input, actor) {
    const value = parseAtBoundary(createSchema, input, "Data subject request");
    const all = await store.all();
    const receivedAt = new Date(value.receivedAt).toISOString();
    const row: DataSubjectRequest = {
      id: `dsr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      tenantId: requireActiveTenantId(),
      reference: `DSR-${String(all.length + 1).padStart(4, "0")}`,
      type: value.type,
      status: "received",
      channel: value.channel,
      subjectName: value.subjectName,
      subjectContact: value.subjectContact,
      customerId: value.customerId,
      receivedAt,
      dueAt: new Date(Date.parse(receivedAt) + DSR_RESPONSE_DAYS * 86_400_000).toISOString(),
      identityVerified: false,
      details: value.details,
      completedAt: null,
      history: [{ at: nowIso(), by: actor.actorName, status: "received", note: value.details }],
    };
    await store.replace([row, ...all]);
    await securityEventService.record({
      kind: "dsr.created",
      ...actor,
      subjectType: "data_subject_request",
      subjectId: row.id,
      detail: { reference: row.reference, type: row.type, channel: row.channel, linkedCustomer: row.customerId },
    });
    return row;
  },

  async advance(id, input, actor) {
    const value = parseAtBoundary(advanceSchema, input, "Request update");
    const current = await store.get(id);
    if (!current) throw new ServiceError("NOT_FOUND", "That request no longer exists.", 404);
    if (!NEXT[current.status].includes(value.status)) {
      throw new ServiceError(
        "INVALID_TRANSITION",
        `A request that is ${current.status.replace("_", " ")} cannot move to ${value.status.replace("_", " ")}.`,
        409,
        "Completed and rejected requests are closed and cannot be edited.",
      );
    }
    const identityVerified = value.identityVerified ?? current.identityVerified;
    if ((value.status === "in_progress" || value.status === "completed") && !identityVerified) {
      throw new ServiceError(
        "IDENTITY_UNVERIFIED",
        "Confirm the requester's identity before acting on the request.",
        422,
      );
    }
    if ((value.status === "completed" || value.status === "rejected") && !value.note) {
      throw new ServiceError("VALIDATION_FAILED", "Record what was done, or why the request was refused.", 422);
    }
    const next: DataSubjectRequest = {
      ...current,
      status: value.status,
      identityVerified,
      customerId: value.customerId !== undefined ? value.customerId : current.customerId,
      completedAt: value.status === "completed" || value.status === "rejected" ? nowIso() : null,
      history: [...current.history, { at: nowIso(), by: actor.actorName, status: value.status, note: value.note }],
    };
    const all = await store.all();
    await store.replace(all.map((row) => (row.id === id ? next : row)));
    await securityEventService.record({
      kind: "dsr.updated",
      ...actor,
      subjectType: "data_subject_request",
      subjectId: id,
      detail: { reference: current.reference, from: current.status, to: value.status, identityVerified },
    });
    return next;
  },
};
