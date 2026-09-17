"use client";

/**
 * Tenant security configuration — FR-SEC-025, FR-SEC-034, FR-SEC-035,
 * FR-SEC-052, FR-SEC-053.
 *
 * The API has no endpoints for password policy, IP allow-lists, SIEM sinks,
 * approval escalation or offline approval codes, so the configuration is
 * kept per tenant in browser storage behind this interface — the same
 * backend-later seam the rest of the console uses. Screens that show it say
 * where it is kept and which parts only the server can enforce (an IP
 * allow-list in a browser allows nothing and blocks nobody).
 *
 * Every write goes through `parseAtBoundary` with a strict schema
 * (FR-SEC-047): an unknown field is refused, not dropped, and so is a value
 * outside the rule — a 9-character minimum cannot be saved by any route.
 * Every accepted write is recorded in the security event log with what
 * changed.
 */

import { z } from "zod";

import type { Id, IsoDateTime } from "../types";
import { localCollection, localDocument, nowIso } from "../local-store";
import { requireActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";
import { securityEventService, type EventDetail } from "./security-events";
import { newSecret, totp, verifyTotp } from "../totp";
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_IP_ALLOW_LIST,
  DEFAULT_PASSWORD_POLICY,
  DEFAULT_SIEM,
  approvalPolicySchema,
  ipAllowListSchema,
  parseAtBoundary,
  passwordPolicySchema,
  siemConfigSchema,
  type ApprovalPolicy,
  type IpAllowList,
  type PasswordPolicy,
  type SiemConfig,
} from "../security-policy";

export interface Actor {
  actorId: Id | null;
  actorName: string;
}

interface Stamped<T> {
  value: T;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

function doc<T>(name: string, initial: T) {
  return localDocument<Stamped<T>>(
    name,
    () => ({ value: structuredClone(initial), updatedAt: null, updatedBy: null }),
    () => requireActiveTenantId(),
  );
}

const passwordDoc = doc<PasswordPolicy>("sec-password-policy", DEFAULT_PASSWORD_POLICY);
const ipDoc = doc<IpAllowList>("sec-ip-allowlist", DEFAULT_IP_ALLOW_LIST);
const siemDoc = doc<SiemConfig>("sec-siem", DEFAULT_SIEM);
const approvalDoc = doc<ApprovalPolicy>("sec-approval-policy", DEFAULT_APPROVAL_POLICY);

/** Which top-level fields differ — the event says what changed, not just that something did. */
function changedFields(before: object, after: object): string {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return Object.keys(b)
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .join(",");
}

async function settle<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 60));
  return value;
}

// ---------------------------------------------------------------------------
// Offline approval codes — FR-SEC-035
// ---------------------------------------------------------------------------

export interface OfflineCodeEnrolment {
  employeeId: Id;
  employeeName: string;
  /** Base32 TOTP secret. Provisioned to the tills of this tenant. */
  secret: string;
  provisionedAt: IsoDateTime;
  provisionedBy: string;
  /** The last time step accepted, so one code cannot approve twice. */
  lastStep: number | null;
}

const offlineCodes = localCollection<OfflineCodeEnrolment>(
  { name: "sec-offline-codes", idOf: (row) => row.employeeId },
  () => requireActiveTenantId(),
);

export interface OfflineCodeStatus {
  enrolled: boolean;
  provisionedAt: IsoDateTime | null;
  provisionedBy: string | null;
}

// ---------------------------------------------------------------------------

export interface SecuritySettingsService {
  passwordPolicy(): Promise<Stamped<PasswordPolicy>>;
  savePasswordPolicy(input: unknown, actor: Actor): Promise<Stamped<PasswordPolicy>>;
  ipAllowList(): Promise<Stamped<IpAllowList>>;
  saveIpAllowList(input: unknown, actor: Actor): Promise<Stamped<IpAllowList>>;
  siem(): Promise<Stamped<SiemConfig>>;
  /**
   * `token` is write-only: when given it is fingerprinted and discarded. It
   * is never stored, never returned and never logged.
   */
  saveSiem(input: unknown, token: string | null, actor: Actor): Promise<Stamped<SiemConfig>>;
  approvalPolicy(): Promise<Stamped<ApprovalPolicy>>;
  /** Synchronous read for the till, which decides inside an event handler. */
  approvalPolicyNow(): ApprovalPolicy;
  saveApprovalPolicy(input: unknown, actor: Actor): Promise<Stamped<ApprovalPolicy>>;

  offlineCodeStatus(employeeId: Id): Promise<OfflineCodeStatus>;
  /** Returns the secret once, for an authenticator app. */
  provisionOfflineCode(employeeId: Id, employeeName: string, actor: Actor): Promise<string>;
  revokeOfflineCode(employeeId: Id, actor: Actor): Promise<void>;
  /** The code the manager would read out right now — shown only to that manager. */
  currentOfflineCode(employeeId: Id): Promise<string | null>;
  /** True once per valid code; a replayed code is refused. */
  verifyOfflineCode(employeeId: Id, code: string): Promise<boolean>;
}

export const securitySettingsService: SecuritySettingsService = {
  async passwordPolicy() {
    return settle(passwordDoc.read());
  },

  async savePasswordPolicy(input, actor) {
    // FR-SEC-047 — strict: unknown fields and a minimum below 10 are refused.
    const value = parseAtBoundary(passwordPolicySchema, input, "Password policy");
    const before = passwordDoc.read();
    const next = { value, updatedAt: nowIso(), updatedBy: actor.actorName };
    passwordDoc.write(next);
    await securityEventService.record({
      kind: "policy.password_changed",
      ...actor,
      subjectType: "password_policy",
      subjectId: requireActiveTenantId(),
      detail: { changed: changedFields(before.value, value), minLength: value.minLength, historyCount: value.historyCount },
    });
    return next;
  },

  async ipAllowList() {
    return settle(ipDoc.read());
  },

  async saveIpAllowList(input, actor) {
    const value = parseAtBoundary(ipAllowListSchema, input, "IP allow-list");
    const cidrs = value.entries.map((entry) => entry.cidr);
    if (new Set(cidrs).size !== cidrs.length) {
      throw new ServiceError("VALIDATION_FAILED", "The same address block is listed twice.", 422);
    }
    if ((value.dashboardEnabled || value.apiEnabled) && value.entries.length === 0) {
      throw new ServiceError(
        "VALIDATION_FAILED",
        "An enabled allow-list with no entries would block everyone. Add at least one address first.",
        422,
      );
    }
    const before = ipDoc.read();
    const next = { value, updatedAt: nowIso(), updatedBy: actor.actorName };
    ipDoc.write(next);
    await securityEventService.record({
      kind: "policy.ip_allowlist_changed",
      ...actor,
      subjectType: "ip_allowlist",
      subjectId: requireActiveTenantId(),
      detail: {
        dashboardEnabled: value.dashboardEnabled,
        apiEnabled: value.apiEnabled,
        entries: value.entries.length,
        changed: changedFields(before.value, value),
      },
    });
    return next;
  },

  async siem() {
    return settle(siemDoc.read());
  },

  async saveSiem(input, token, actor) {
    const before = siemDoc.read();
    let tokenSetAt = before.value.tokenSetAt;
    let tokenFingerprint = before.value.tokenFingerprint;
    if (token && token.trim()) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.trim()));
      tokenFingerprint = [...new Uint8Array(digest)]
        .slice(0, 4)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      tokenSetAt = nowIso();
    }
    const candidate =
      input && typeof input === "object" ? { ...(input as object), tokenSetAt, tokenFingerprint } : input;
    const value = parseAtBoundary(siemConfigSchema, candidate, "SIEM forwarding");
    if (value.enabled && !value.endpoint) {
      throw new ServiceError("VALIDATION_FAILED", "Forwarding cannot be switched on without an endpoint.", 422);
    }
    const next = { value, updatedAt: nowIso(), updatedBy: actor.actorName };
    siemDoc.write(next);
    const detail: EventDetail = {
      enabled: value.enabled,
      format: value.format,
      categories: value.categories.join(","),
      tokenRotated: Boolean(token && token.trim()),
      changed: changedFields(before.value, value),
    };
    await securityEventService.record({
      kind: "policy.siem_changed",
      ...actor,
      subjectType: "siem_sink",
      subjectId: requireActiveTenantId(),
      detail,
    });
    return next;
  },

  async approvalPolicy() {
    return settle(approvalDoc.read());
  },

  approvalPolicyNow() {
    return approvalDoc.read().value;
  },

  async saveApprovalPolicy(input, actor) {
    const value = parseAtBoundary(approvalPolicySchema, input, "Approval policy");
    const before = approvalDoc.read();
    const next = { value, updatedAt: nowIso(), updatedBy: actor.actorName };
    approvalDoc.write(next);
    await securityEventService.record({
      kind: "policy.approval_changed",
      ...actor,
      subjectType: "approval_policy",
      subjectId: requireActiveTenantId(),
      detail: {
        escalateAfterMinutes: value.escalateAfterMinutes,
        maxLevels: value.maxLevels,
        offlinePolicy: value.offlinePolicy,
        changed: changedFields(before.value, value),
      },
    });
    return next;
  },

  async offlineCodeStatus(employeeId) {
    const row = await offlineCodes.get(employeeId);
    return { enrolled: Boolean(row), provisionedAt: row?.provisionedAt ?? null, provisionedBy: row?.provisionedBy ?? null };
  },

  async provisionOfflineCode(employeeId, employeeName, actor) {
    const id = z.string().min(1).parse(employeeId);
    const secret = newSecret();
    const row: OfflineCodeEnrolment = {
      employeeId: id,
      employeeName,
      secret,
      provisionedAt: nowIso(),
      provisionedBy: actor.actorName,
      lastStep: null,
    };
    const all = (await offlineCodes.all()).filter((existing) => existing.employeeId !== id);
    await offlineCodes.replace([row, ...all]);
    await securityEventService.record({
      kind: "offline_code.provisioned",
      ...actor,
      subjectType: "employee",
      subjectId: id,
      detail: { employeeName },
    });
    return secret;
  },

  async revokeOfflineCode(employeeId, actor) {
    const all = await offlineCodes.all();
    await offlineCodes.replace(all.filter((row) => row.employeeId !== employeeId));
    await securityEventService.record({
      kind: "offline_code.revoked",
      ...actor,
      subjectType: "employee",
      subjectId: employeeId,
    });
  },

  async currentOfflineCode(employeeId) {
    const row = await offlineCodes.get(employeeId);
    return row ? totp(row.secret) : null;
  },

  async verifyOfflineCode(employeeId, code) {
    const row = await offlineCodes.get(employeeId);
    if (!row) return false;
    const step = await verifyTotp(row.secret, code);
    if (step === null || (row.lastStep !== null && step <= row.lastStep)) return false;
    // `replace`, not `update`: burning a used code must work even while the
    // tenant is read-only, or a replayed code would be accepted.
    const all = await offlineCodes.all();
    await offlineCodes.replace(all.map((existing) => (existing.employeeId === employeeId ? { ...existing, lastStep: step } : existing)));
    return true;
  },
};
