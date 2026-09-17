"use client";

/**
 * The security event log — append-only and hash-chained.
 *
 * Several requirements need somewhere to write "who did this sensitive thing,
 * and when" that the server does not yet offer an endpoint for:
 *
 *   FR-SEC-033  approval decisions — approver, time, decision, comment —
 *               immutable once written
 *   FR-SEC-035  offline approvals granted with a manager code, and their
 *               retrospective review
 *   FR-SEC-042  a masked sensitive field being revealed
 *   FR-AUD-007  the audit log itself being viewed, opened or exported
 *   FR-PLT-004  a branch moving between brands
 *   FR-SEC-053  the stream a SIEM sink would receive
 *
 * ## Immutability, and what it is worth here
 *
 * The service has `record`, `list` and `verify`. There is no update and no
 * remove — not hidden, absent — so no screen can edit a decision after the
 * fact. Each event carries the SHA-256 of its own content plus the previous
 * event's hash (the same construction as FR-AUD-004), so an edit made
 * outside the console — someone changing browser storage by hand — breaks
 * the chain and `verify` names the first broken entry.
 *
 * It is still browser storage. It proves the console never rewrites
 * history; it cannot stop a determined person deleting the whole log. The
 * server's audit store is the record that has to survive that, and the
 * screens that read this say it is kept on this device.
 */

import type { Id, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { requireActiveTenantId } from "./tenant-context";
import type { SiemCategory } from "../security-policy";

// ---------------------------------------------------------------------------
// ULID — FR-AUD-002 wants sortable, time-prefixed ids
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A 26-character ULID: 48-bit millisecond time + 80 random bits. */
export function ulid(at = Date.now()): string {
  let time = "";
  let remaining = at;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[remaining % 32]! + time;
    remaining = Math.floor(remaining / 32);
  }
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let random = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      random += CROCKFORD[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  return time + random.slice(0, 16);
}

/** The millisecond timestamp a ULID carries, or null when it is not one. */
export function ulidTime(id: string): number | null {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return null;
  let value = 0;
  for (const char of id.slice(0, 10)) value = value * 32 + CROCKFORD.indexOf(char);
  return value;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SecurityEventKind =
  | "approval.decided"
  | "approval.offline_granted"
  | "approval.retrospective_reviewed"
  | "offline_code.provisioned"
  | "offline_code.revoked"
  | "field.revealed"
  | "audit.viewed"
  | "audit.entry_opened"
  | "audit.exported"
  | "policy.password_changed"
  | "policy.ip_allowlist_changed"
  | "policy.siem_changed"
  | "policy.approval_changed"
  | "password.breach_refused"
  | "branch.brand_reassigned"
  | "record.tenant_move_refused"
  | "tenant.export_requested"
  | "tenant.export_completed"
  | "tenant.termination_initiated"
  | "tenant.termination_cancelled"
  | "tenant.termination_confirmed"
  | "tenant.state_previewed"
  | "dsr.created"
  | "dsr.updated";

export const EVENT_CATEGORY: Record<SecurityEventKind, SiemCategory> = {
  "approval.decided": "approvals",
  "approval.offline_granted": "approvals",
  "approval.retrospective_reviewed": "approvals",
  "offline_code.provisioned": "authentication",
  "offline_code.revoked": "authentication",
  "field.revealed": "data_access",
  "audit.viewed": "data_access",
  "audit.entry_opened": "data_access",
  "audit.exported": "data_access",
  "policy.password_changed": "configuration",
  "policy.ip_allowlist_changed": "configuration",
  "policy.siem_changed": "configuration",
  "policy.approval_changed": "configuration",
  "password.breach_refused": "authentication",
  "branch.brand_reassigned": "configuration",
  "record.tenant_move_refused": "authorisation",
  "tenant.export_requested": "tenant",
  "tenant.export_completed": "tenant",
  "tenant.termination_initiated": "tenant",
  "tenant.termination_cancelled": "tenant",
  "tenant.termination_confirmed": "tenant",
  "tenant.state_previewed": "tenant",
  "dsr.created": "data_access",
  "dsr.updated": "data_access",
};

export type EventDetail = Record<string, string | number | boolean | null>;

export interface SecurityEvent {
  /** ULID. */
  id: Id;
  seq: number;
  tenantId: Id;
  at: IsoDateTime;
  kind: SecurityEventKind;
  category: SiemCategory;
  actorId: Id | null;
  actorName: string;
  subjectType: string;
  subjectId: string;
  detail: EventDetail;
  /** Groups the events of one flow — a request and its decision, say. */
  correlationId: string;
  userAgent: string;
  previousHash: string;
  hash: string;
}

export interface SecurityEventInput {
  kind: SecurityEventKind;
  actorId: Id | null;
  actorName: string;
  subjectType: string;
  subjectId: string;
  detail?: EventDetail;
  correlationId?: string;
}

export interface SecurityEventFilter {
  kinds?: SecurityEventKind[];
  subjectId?: string;
  correlationId?: string;
}

export interface SecurityEventService {
  record(input: SecurityEventInput): Promise<SecurityEvent>;
  /** Newest first. */
  list(filter?: SecurityEventFilter): Promise<SecurityEvent[]>;
  verify(): Promise<{ intact: boolean; brokenAt: Id | null; count: number }>;
}

const store = localCollection<SecurityEvent>(
  { name: "security-events", idOf: (row) => row.id },
  () => requireActiveTenantId(),
);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Everything but the hash, in a fixed key order, so the digest is stable. */
function canonical(event: Omit<SecurityEvent, "hash">): string {
  const detail = Object.keys(event.detail)
    .sort()
    .map((key) => [key, event.detail[key]]);
  return JSON.stringify([
    event.id,
    event.seq,
    event.tenantId,
    event.at,
    event.kind,
    event.category,
    event.actorId,
    event.actorName,
    event.subjectType,
    event.subjectId,
    detail,
    event.correlationId,
    event.userAgent,
    event.previousHash,
  ]);
}

/**
 * Browser storage is small. Past this many events the oldest are dropped;
 * `verify` then checks the chain from the oldest event still held.
 */
const MAX_EVENTS = 5000;

// Writes are serialised: two events recorded in the same tick must not both
// chain onto the same predecessor.
let queue: Promise<unknown> = Promise.resolve();

export const securityEventService: SecurityEventService = {
  record(input) {
    const run = async () => {
      const tenantId = requireActiveTenantId();
      const rows = await store.all();
      const head = rows[0];
      const draft: Omit<SecurityEvent, "hash"> = {
        id: ulid(),
        seq: (head?.seq ?? 0) + 1,
        tenantId,
        at: nowIso(),
        kind: input.kind,
        category: EVENT_CATEGORY[input.kind],
        actorId: input.actorId,
        actorName: input.actorName,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        detail: input.detail ?? {},
        correlationId: input.correlationId ?? ulid(),
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent.slice(0, 160),
        previousHash: head?.hash ?? "",
      };
      const event: SecurityEvent = { ...draft, hash: await sha256Hex(canonical(draft)) };
      await store.replace([event, ...rows].slice(0, MAX_EVENTS));
      return Object.freeze(event);
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  },

  async list(filter = {}) {
    const rows = await store.all();
    return rows.filter(
      (row) =>
        (!filter.kinds || filter.kinds.includes(row.kind)) &&
        (!filter.subjectId || row.subjectId === filter.subjectId) &&
        (!filter.correlationId || row.correlationId === filter.correlationId),
    );
  },

  async verify() {
    const rows = await store.all();
    // Oldest first: each entry must hash to itself and point at the one before.
    const ordered = [...rows].reverse();
    // The oldest event held may point at one already rotated out; only an
    // event numbered 1 must start from nothing.
    let previous = ordered[0] && ordered[0].seq > 1 ? ordered[0].previousHash : "";
    for (const row of ordered) {
      const { hash, ...rest } = row;
      if (row.previousHash !== previous || (await sha256Hex(canonical(rest))) !== hash) {
        return { intact: false, brokenAt: row.id, count: rows.length };
      }
      previous = hash;
    }
    return { intact: true, brokenAt: null, count: rows.length };
  },
};
