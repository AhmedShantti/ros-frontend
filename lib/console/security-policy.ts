/**
 * Tenant security policy — the pure rules behind the security settings.
 *
 * Nothing in here touches storage, the network or React, so the settings
 * screen, the change-password form, the till and the approvals inbox all
 * judge a password, an address or an overdue request identically.
 *
 * Covers:
 *   FR-SEC-025  password policy (minimum ≥ 10, complexity, history, age)
 *   FR-SEC-034  approval escalation after a configured period
 *   FR-SEC-035  offline approval policy (block, or permit + retrospective)
 *   FR-SEC-047  explicit, strict schema validation at the service boundary
 *   FR-SEC-052  IP allow-list entries as validated CIDR blocks
 *   FR-SEC-060  data classification and the controls each class carries
 */

import { z } from "zod";

import type { IsoDateTime } from "./types";
import type { PermissionKey, RoleKey } from "./permissions";
import { ServiceError } from "./services/types";

// ---------------------------------------------------------------------------
// FR-SEC-047 — strict parsing at the service boundary
// ---------------------------------------------------------------------------

/**
 * Parse `input` against `schema` or refuse the write.
 *
 * Schemas passed here are built with `z.strictObject`, so a field the schema
 * does not name is an error rather than silently dropped — FR-SEC-047's
 * "rejecting unknown fields rather than ignoring them". The server repeats
 * the check; this is what stops the console sending it in the first place.
 */
export function parseAtBoundary<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const unknownKeys = result.error.issues
    .filter((issue) => issue.code === "unrecognized_keys")
    .flatMap((issue) => ("keys" in issue ? (issue.keys as string[]) : []));
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || what}: ${issue.message}`)
    .join("; ");

  throw new ServiceError(
    unknownKeys.length > 0 ? "UNKNOWN_FIELDS" : "VALIDATION_FAILED",
    unknownKeys.length > 0
      ? `${what} was refused: unexpected field ${unknownKeys.join(", ")}.`
      : `${what} was refused: the values did not pass validation.`,
    422,
    detail,
  );
}

// ---------------------------------------------------------------------------
// FR-SEC-025 — password policy
// ---------------------------------------------------------------------------

/** The SRS floor. A tenant may raise it, never lower it. */
export const PASSWORD_MIN_FLOOR = 10;

export const passwordPolicySchema = z.strictObject({
  minLength: z.number().int().min(PASSWORD_MIN_FLOOR).max(128),
  requireLower: z.boolean(),
  requireUpper: z.boolean(),
  requireDigit: z.boolean(),
  requireSymbol: z.boolean(),
  /** Previous passwords that may not be reused. 0 turns the rule off. */
  historyCount: z.number().int().min(0).max(24),
  /** Days before a password must be changed. 0 means never. */
  maxAgeDays: z.number().int().min(0).max(730),
  /** Refuse a password that contains the account's email name. */
  rejectEmailName: z.boolean(),
  /** FR-SEC-025 says SHALL — the schema only accepts `true`. */
  breachCheck: z.literal(true),
});
export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireLower: true,
  requireUpper: true,
  requireDigit: true,
  requireSymbol: false,
  historyCount: 5,
  maxAgeDays: 0,
  rejectEmailName: true,
  breachCheck: true,
};

export type PasswordRule = "length" | "lower" | "upper" | "digit" | "symbol" | "emailName";

export interface PasswordRuleResult {
  rule: PasswordRule;
  ok: boolean;
}

/** Every rule the policy switches on, and whether `password` meets it. */
export function passwordRuleResults(
  password: string,
  policy: PasswordPolicy,
  email?: string | null,
): PasswordRuleResult[] {
  const out: PasswordRuleResult[] = [{ rule: "length", ok: [...password].length >= policy.minLength }];
  if (policy.requireLower) out.push({ rule: "lower", ok: /\p{Ll}/u.test(password) });
  if (policy.requireUpper) out.push({ rule: "upper", ok: /\p{Lu}/u.test(password) });
  if (policy.requireDigit) out.push({ rule: "digit", ok: /\d/.test(password) });
  if (policy.requireSymbol) out.push({ rule: "symbol", ok: /[^\p{L}\p{N}\s]/u.test(password) });
  const name = email?.split("@")[0]?.trim().toLowerCase() ?? "";
  if (policy.rejectEmailName && name.length >= 3) {
    out.push({ rule: "emailName", ok: !password.toLowerCase().includes(name) });
  }
  return out;
}

export function passwordMeetsPolicy(password: string, policy: PasswordPolicy, email?: string | null): boolean {
  return passwordRuleResults(password, policy, email).every((result) => result.ok);
}

// ---------------------------------------------------------------------------
// FR-SEC-052 — IP allow-list
// ---------------------------------------------------------------------------

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

export function parseIp(text: string): ParsedIp | null {
  const raw = text.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    const parts = raw.split(".").map(Number);
    if (parts.some((part) => part > 255)) return null;
    // Leading zeros are ambiguous (octal in some parsers) — refuse them.
    if (raw.split(".").some((part) => part.length > 1 && part.startsWith("0"))) return null;
    return { version: 4, value: parts.reduce((acc, part) => (acc << 8n) + BigInt(part), 0n) };
  }
  return parseIpv6(raw);
}

function parseIpv6(raw: string): ParsedIp | null {
  if (!raw.includes(":") || !/^[0-9a-fA-F:.]+$/.test(raw)) return null;
  const doubles = raw.split("::");
  if (doubles.length > 2) return null;

  const expand = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i]!;
      // An embedded IPv4 tail, e.g. ::ffff:192.0.2.1
      if (piece.includes(".") && i === pieces.length - 1) {
        const v4 = parseIp(piece);
        if (!v4 || v4.version !== 4) return null;
        groups.push(Number((v4.value >> 16n) & 0xffffn), Number(v4.value & 0xffffn));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  const head = expand(doubles[0]!);
  const tail = doubles.length === 2 ? expand(doubles[1]!) : [];
  if (!head || !tail) return null;

  let groups: number[];
  if (doubles.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return { version: 6, value: groups.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n) };
}

export type CidrProblem = "format" | "prefix" | "hostBits";

export type CidrParse =
  | { ok: true; version: 4 | 6; network: bigint; prefix: number; canonical: string }
  | { ok: false; problem: CidrProblem; suggestion?: string };

function formatIp(version: 4 | 6, value: bigint): string {
  if (version === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".");
  }
  const groups = Array.from({ length: 8 }, (_, i) => ((value >> BigInt((7 - i) * 16)) & 0xffffn).toString(16));
  // Compress the longest run of zero groups, per RFC 5952.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== "0") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === "0") j += 1;
    if (j - i > bestLength && j - i > 1) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestStart === -1) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

/**
 * A single address or a CIDR block. A bare address is its own /32 or /128.
 * Host bits set below the prefix (`10.0.0.5/24`) are refused with the block
 * the person probably meant, rather than silently widened or narrowed.
 */
export function parseCidr(text: string): CidrParse {
  const [address, prefixText, extra] = text.trim().split("/");
  if (extra !== undefined || !address) return { ok: false, problem: "format" };
  const ip = parseIp(address);
  if (!ip) return { ok: false, problem: "format" };
  const width = ip.version === 4 ? 32 : 128;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return { ok: false, problem: "prefix" };
  const prefix = prefixText === undefined ? width : Number(prefixText);
  if (prefix > width) return { ok: false, problem: "prefix" };
  const hostBits = BigInt(width - prefix);
  const mask = ((1n << BigInt(width)) - 1n) ^ ((1n << hostBits) - 1n);
  const network = ip.value & mask;
  if (network !== ip.value) {
    return { ok: false, problem: "hostBits", suggestion: `${formatIp(ip.version, network)}/${prefix}` };
  }
  return { ok: true, version: ip.version, network, prefix, canonical: `${formatIp(ip.version, network)}/${prefix}` };
}

export function cidrContains(cidr: string, address: string): boolean {
  const block = parseCidr(cidr);
  const ip = parseIp(address);
  if (!block.ok || !ip || block.version !== ip.version) return false;
  const width = block.version === 4 ? 32 : 128;
  const hostBits = BigInt(width - block.prefix);
  return ip.value >> hostBits === block.network >> hostBits;
}

/** A block wide enough to make the list pointless — 0.0.0.0/0 and friends. */
export function cidrTooBroad(cidr: string): boolean {
  const block = parseCidr(cidr);
  if (!block.ok) return false;
  return block.version === 4 ? block.prefix < 8 : block.prefix < 16;
}

export const ipAllowEntrySchema = z.strictObject({
  id: z.string().min(1),
  cidr: z.string().refine((value) => parseCidr(value).ok, "Not a valid IPv4/IPv6 address or CIDR block"),
  label: z.string().trim().min(1).max(80),
  addedAt: z.string(),
  addedBy: z.string(),
});
export type IpAllowEntry = z.infer<typeof ipAllowEntrySchema>;

export const ipAllowListSchema = z.strictObject({
  /** FR-SEC-052 — dashboard (Enterprise tier) and API access are separate switches. */
  dashboardEnabled: z.boolean(),
  apiEnabled: z.boolean(),
  entries: z.array(ipAllowEntrySchema).max(200),
});
export type IpAllowList = z.infer<typeof ipAllowListSchema>;

export const DEFAULT_IP_ALLOW_LIST: IpAllowList = { dashboardEnabled: false, apiEnabled: false, entries: [] };

// ---------------------------------------------------------------------------
// FR-SEC-053 — SIEM forwarding
// ---------------------------------------------------------------------------

export const SIEM_FORMATS = ["json", "cef", "leef", "syslog"] as const;
export type SiemFormat = (typeof SIEM_FORMATS)[number];

export const SIEM_CATEGORIES = ["authentication", "authorisation", "approvals", "data_access", "configuration", "tenant"] as const;
export type SiemCategory = (typeof SIEM_CATEGORIES)[number];

export const siemConfigSchema = z.strictObject({
  enabled: z.boolean(),
  endpoint: z
    .string()
    .trim()
    .max(400)
    .refine((value) => value === "" || /^(https:\/\/|syslog\+tls:\/\/)[^\s/$.?#].[^\s]*$/i.test(value), "Use https:// or syslog+tls://"),
  format: z.enum(SIEM_FORMATS),
  categories: z.array(z.enum(SIEM_CATEGORIES)).max(SIEM_CATEGORIES.length),
  /**
   * Write-only: the token itself is never stored or echoed back. Only when
   * it was set and a short SHA-256 fingerprint to tell two tokens apart.
   */
  tokenSetAt: z.string().nullable(),
  tokenFingerprint: z.string().max(16).nullable(),
});
export type SiemConfig = z.infer<typeof siemConfigSchema>;

export const DEFAULT_SIEM: SiemConfig = {
  enabled: false,
  endpoint: "",
  format: "json",
  categories: ["authentication", "authorisation", "approvals", "data_access"],
  tokenSetAt: null,
  tokenFingerprint: null,
};

// ---------------------------------------------------------------------------
// FR-SEC-034 / FR-SEC-035 — approval routing policy
// ---------------------------------------------------------------------------

export const ESCALATION_LADDER: RoleKey[] = ["branch_manager", "operations_director", "owner"];

export const OFFLINE_POLICIES = ["block", "retrospective"] as const;
export type OfflineApprovalPolicy = (typeof OFFLINE_POLICIES)[number];

export const approvalPolicySchema = z.strictObject({
  escalationEnabled: z.boolean(),
  /** Minutes without a decision before a request moves up one level. */
  escalateAfterMinutes: z.number().int().min(5).max(7 * 24 * 60),
  /** How many levels above the first approver it may climb. */
  maxLevels: z.number().int().min(1).max(ESCALATION_LADDER.length - 1),
  offlinePolicy: z.enum(OFFLINE_POLICIES),
  /** Hours a retrospective approval may stay unreviewed before it is overdue. */
  retrospectiveReviewHours: z.number().int().min(1).max(168),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  escalationEnabled: true,
  escalateAfterMinutes: 240,
  maxLevels: 2,
  offlinePolicy: "retrospective",
  retrospectiveReviewHours: 24,
};

export interface EscalationState {
  /** 0 is the first approver; each step up is one more. */
  level: number;
  role: RoleKey;
  escalatedAt: IsoDateTime | null;
  /** When it moves again, or null when it cannot climb further. */
  nextAt: IsoDateTime | null;
  atTop: boolean;
}

/**
 * FR-SEC-034 — where an undecided request sits on the ladder at `now`.
 *
 * Derived from the request's age and the tenant's policy, the same way the
 * server's routing would place it, so the inbox can say "with the operations
 * director since 14:20, owner at 18:20" rather than just "escalated".
 */
export function escalationStateOf(
  requestedAt: IsoDateTime,
  policy: ApprovalPolicy,
  now: number,
): EscalationState {
  const started = Date.parse(requestedAt);
  const period = policy.escalateAfterMinutes * 60_000;
  if (!policy.escalationEnabled || Number.isNaN(started)) {
    return { level: 0, role: ESCALATION_LADDER[0]!, escalatedAt: null, nextAt: null, atTop: true };
  }
  const steps = Math.max(0, Math.floor((now - started) / period));
  const level = Math.min(steps, policy.maxLevels);
  const atTop = level >= policy.maxLevels;
  return {
    level,
    role: ESCALATION_LADDER[level]!,
    escalatedAt: level > 0 ? new Date(started + level * period).toISOString() : null,
    nextAt: atTop ? null : new Date(started + (level + 1) * period).toISOString(),
    atTop,
  };
}

// ---------------------------------------------------------------------------
// FR-SEC-060 — data classification
// ---------------------------------------------------------------------------

export const DATA_CLASSES = ["public", "internal", "confidential", "restricted"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export interface ClassControls {
  tone: "muted" | "neutral" | "warn" | "bad";
  /** Masked on screen until someone with the permission reveals it. */
  maskByDefault: boolean;
  /** Who may reveal or export it; null means any session that can see the screen. */
  permission: PermissionKey | null;
  /** Every reveal and export is written to the security event log. */
  logged: boolean;
  /** Exports carry the class in the filename and the manifest. */
  labelExports: boolean;
}

/**
 * The four classes and the console-side controls each carries. Encryption
 * at rest and per-tenant data keys belong to the server and are not claimed
 * here; these are the controls a screen can actually apply.
 */
export const CLASS_CONTROLS: Record<DataClass, ClassControls> = {
  public: { tone: "muted", maskByDefault: false, permission: null, logged: false, labelExports: false },
  internal: { tone: "neutral", maskByDefault: false, permission: null, logged: false, labelExports: true },
  confidential: { tone: "warn", maskByDefault: false, permission: "report.export", logged: true, labelExports: true },
  restricted: { tone: "bad", maskByDefault: true, permission: "security.user.manage", logged: true, labelExports: true },
};
