"use client";

/**
 * Tenant lifecycle — FR-PLT-021, FR-PLT-022, FR-PLT-023.
 *
 * The API has no export-job, termination or plan-state endpoints. This
 * service keeps the *record* of each request per tenant, behind the
 * interface the server will take over, and is explicit about what it
 * cannot do:
 *
 *   - Exports are generated in the browser from the same services the
 *     screens read (`lib/console/tenant-export.ts`). The job record — what
 *     was requested, when, by whom, what each entity file held and its
 *     SHA-256 — persists; the archive itself lives only for the tab, because
 *     browser storage cannot hold it.
 *   - Termination is recorded with its 30-day window, and can be cancelled
 *     inside it. Nothing here deletes anything. The purge date is shown as
 *     "no earlier than", which is the requirement's wording, and a live
 *     deployment is told the request has not reached a server.
 *   - Suspension and restriction come from the tenant's `state`. In the demo
 *     the state can be previewed so the read-only mode can be seen; that
 *     preview is refused against a live backend.
 */

import { z } from "zod";

import type { Id, IsoDateTime, TenantState } from "../types";
import { localDocument, nowIso } from "../local-store";
import { requireActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";
import { securityEventService } from "./security-events";
import { parseAtBoundary, type DataClass } from "../security-policy";
import type { Actor } from "./security-settings";
import { DATA_MODE } from "@/lib/api/config";

export const TERMINATION_WINDOW_DAYS = 30;
export const EXPORT_DEADLINE_HOURS = 24;

export interface ExportEntityResult {
  entity: string;
  file: string;
  rows: number;
  sha256: string | null;
  classification: DataClass;
  /** Why this entity could not be exported, when it could not. */
  error: string | null;
}

export type ExportJobStatus = "building" | "ready" | "partial" | "failed";

export interface ExportJob {
  id: Id;
  requestedAt: IsoDateTime;
  requestedBy: string;
  deadlineAt: IsoDateTime;
  status: ExportJobStatus;
  completedAt: IsoDateTime | null;
  filename: string;
  sizeBytes: number;
  entities: ExportEntityResult[];
}

export interface TerminationRecord {
  id: Id;
  initiatedAt: IsoDateTime;
  initiatedBy: string;
  reason: string;
  purgeNotBefore: IsoDateTime;
  cancelledAt: IsoDateTime | null;
  cancelledBy: string | null;
  confirmedAt: IsoDateTime | null;
  confirmedBy: string | null;
}

interface LifecycleDoc {
  exports: ExportJob[];
  terminations: TerminationRecord[];
  /** Demo only — see the module note. */
  previewState: TenantState | null;
}

const lifecycleDoc = localDocument<LifecycleDoc>(
  "tenant-lifecycle",
  () => ({ exports: [], terminations: [], previewState: null }),
  () => requireActiveTenantId(),
);

const initiateSchema = z.strictObject({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.string(),
});

export function activeTermination(doc: { terminations: TerminationRecord[] }): TerminationRecord | null {
  return doc.terminations.find((row) => row.cancelledAt === null) ?? null;
}

export interface TenantLifecycleService {
  read(): Promise<LifecycleDoc>;
  startExport(actor: Actor): Promise<ExportJob>;
  finishExport(id: Id, result: Pick<ExportJob, "status" | "entities" | "sizeBytes" | "filename">, actor: Actor): Promise<ExportJob>;
  initiateTermination(input: unknown, tenantSlug: string, actor: Actor): Promise<TerminationRecord>;
  cancelTermination(actor: Actor): Promise<TerminationRecord>;
  confirmTermination(confirmation: string, tenantSlug: string, actor: Actor): Promise<TerminationRecord>;
  setPreviewState(state: TenantState | null, actor: Actor): Promise<void>;
}

async function tick<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 60));
  return value;
}

export const tenantLifecycleService: TenantLifecycleService = {
  async read() {
    return tick(lifecycleDoc.read());
  },

  async startExport(actor) {
    const doc = lifecycleDoc.read();
    const requestedAt = nowIso();
    const job: ExportJob = {
      id: `exp_${Date.now().toString(36)}`,
      requestedAt,
      requestedBy: actor.actorName,
      deadlineAt: new Date(Date.parse(requestedAt) + EXPORT_DEADLINE_HOURS * 3_600_000).toISOString(),
      status: "building",
      completedAt: null,
      filename: "",
      sizeBytes: 0,
      entities: [],
    };
    lifecycleDoc.write({ ...doc, exports: [job, ...doc.exports].slice(0, 50) });
    await securityEventService.record({
      kind: "tenant.export_requested",
      ...actor,
      subjectType: "tenant",
      subjectId: requireActiveTenantId(),
      detail: { jobId: job.id },
    });
    return job;
  },

  async finishExport(id, result, actor) {
    const doc = lifecycleDoc.read();
    const job = doc.exports.find((row) => row.id === id);
    if (!job) throw new ServiceError("NOT_FOUND", "That export request no longer exists.", 404);
    const next: ExportJob = { ...job, ...result, completedAt: nowIso() };
    lifecycleDoc.write({ ...doc, exports: doc.exports.map((row) => (row.id === id ? next : row)) });
    await securityEventService.record({
      kind: "tenant.export_completed",
      ...actor,
      subjectType: "tenant",
      subjectId: requireActiveTenantId(),
      detail: {
        jobId: id,
        status: next.status,
        entities: next.entities.length,
        rows: next.entities.reduce((sum, row) => sum + row.rows, 0),
        failed: next.entities.filter((row) => row.error).length,
      },
    });
    return next;
  },

  async initiateTermination(input, tenantSlug, actor) {
    const value = parseAtBoundary(initiateSchema, input, "Termination request");
    if (value.confirmation !== tenantSlug) {
      throw new ServiceError("CONFIRMATION_MISMATCH", "Type the organisation's identifier exactly to continue.", 422);
    }
    const doc = lifecycleDoc.read();
    if (activeTermination(doc)) {
      throw new ServiceError("ALREADY_TERMINATING", "A termination is already in progress for this organisation.", 409);
    }
    const initiatedAt = nowIso();
    const record: TerminationRecord = {
      id: `term_${Date.now().toString(36)}`,
      initiatedAt,
      initiatedBy: actor.actorName,
      reason: value.reason,
      purgeNotBefore: new Date(Date.parse(initiatedAt) + TERMINATION_WINDOW_DAYS * 86_400_000).toISOString(),
      cancelledAt: null,
      cancelledBy: null,
      confirmedAt: null,
      confirmedBy: null,
    };
    lifecycleDoc.write({ ...doc, terminations: [record, ...doc.terminations] });
    await securityEventService.record({
      kind: "tenant.termination_initiated",
      ...actor,
      subjectType: "tenant",
      subjectId: requireActiveTenantId(),
      detail: { terminationId: record.id, purgeNotBefore: record.purgeNotBefore },
    });
    return record;
  },

  async cancelTermination(actor) {
    const doc = lifecycleDoc.read();
    const current = activeTermination(doc);
    if (!current) throw new ServiceError("NOT_TERMINATING", "There is no termination to cancel.", 409);
    if (Date.now() >= Date.parse(current.purgeNotBefore) && current.confirmedAt) {
      throw new ServiceError("WINDOW_CLOSED", "The 30-day window has closed and the termination was confirmed.", 409);
    }
    const next = { ...current, cancelledAt: nowIso(), cancelledBy: actor.actorName };
    lifecycleDoc.write({ ...doc, terminations: doc.terminations.map((row) => (row.id === current.id ? next : row)) });
    await securityEventService.record({
      kind: "tenant.termination_cancelled",
      ...actor,
      subjectType: "tenant",
      subjectId: requireActiveTenantId(),
      detail: { terminationId: current.id, wasConfirmed: Boolean(current.confirmedAt) },
    });
    return next;
  },

  async confirmTermination(confirmation, tenantSlug, actor) {
    if (confirmation !== tenantSlug) {
      throw new ServiceError("CONFIRMATION_MISMATCH", "Type the organisation's identifier exactly to continue.", 422);
    }
    const doc = lifecycleDoc.read();
    const current = activeTermination(doc);
    if (!current) throw new ServiceError("NOT_TERMINATING", "Start a termination before confirming it.", 409);
    if (current.confirmedAt) throw new ServiceError("ALREADY_CONFIRMED", "This termination is already confirmed.", 409);
    const next = { ...current, confirmedAt: nowIso(), confirmedBy: actor.actorName };
    lifecycleDoc.write({ ...doc, terminations: doc.terminations.map((row) => (row.id === current.id ? next : row)) });
    await securityEventService.record({
      kind: "tenant.termination_confirmed",
      ...actor,
      subjectType: "tenant",
      subjectId: requireActiveTenantId(),
      // The purge date does not move: confirmation never shortens the window.
      detail: { terminationId: current.id, purgeNotBefore: current.purgeNotBefore },
    });
    return next;
  },

  async setPreviewState(state, actor) {
    if (DATA_MODE === "http") {
      throw new ServiceError(
        "NOT_IMPLEMENTED",
        "A live organisation's state is set by the platform, not from this screen.",
        501,
        "Tenant state changes have no endpoint in api/openapi.json.",
      );
    }
    const doc = lifecycleDoc.read();
    lifecycleDoc.write({ ...doc, previewState: state });
    await securityEventService.record({
      kind: "tenant.state_previewed",
      ...actor,
      subjectType: "tenant",
      subjectId: requireActiveTenantId(),
      detail: { state: state ?? "cleared" },
    });
  },
};

/** Synchronous read for the shell banner. Returns null when storage is unavailable. */
export function readLifecycleNow(): LifecycleDoc | null {
  try {
    return lifecycleDoc.read();
  } catch {
    return null;
  }
}
