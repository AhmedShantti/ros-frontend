/**
 * Fiscal document sequencing while offline — FR-OFF-017, FR-OFF-018.
 *
 * Pure. The strategy a jurisdiction uses to keep a strictly gapless fiscal
 * sequence is a property of its country pack (FR-OFF-017); this module holds
 * the three strategies, the rule a till follows under each when the link is
 * down, and the arithmetic over pre-allocated number blocks — which numbers
 * were issued, which are left, and which must be reported void once the
 * block has expired (FR-OFF-018: never silently discarded).
 *
 * The operational order number (FR-POS-002, `<branch>-<seq>`) is a different
 * thing and is not handled here: it is neither gapless nor globally ordered.
 */

import type { CountryCode, CountryPack, Id, IsoDateTime } from "./types";

/**
 * FR-OFF-017 — the three sequence strategies.
 *
 *   server_assigned_on_sync  the document is held provisional on the device;
 *                            the fiscal number is assigned when it syncs
 *   pre_allocated_block      the server issues each terminal a contiguous
 *                            block; unused numbers are reported void on expiry
 *   online_only              no offline issue at all; the till must be online
 */
export type SequenceStrategy = "server_assigned_on_sync" | "pre_allocated_block" | "online_only";

export const SEQUENCE_STRATEGIES: SequenceStrategy[] = [
  "server_assigned_on_sync",
  "pre_allocated_block",
  "online_only",
];

export interface FiscalSequencePolicy {
  /** The country code — one policy per pack. */
  id: CountryCode;
  countryCode: CountryCode;
  /** Whether the jurisdiction requires a strictly gapless sequence at all. */
  gapless: boolean;
  strategy: SequenceStrategy;
  /** Numbers per block, for `pre_allocated_block`. */
  blockSize: number;
  /** How long an issued block may be drawn from, in hours. */
  blockValidityHours: number;
  /** FR-OFF-018 — whether expired unused numbers must go to the authority. */
  voidReportingRequired: boolean;
  /** Below this share of a block remaining, the till warns. Percent. */
  lowWaterPercent: number;
  prefix: string;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface VoidReport {
  reportedAt: IsoDateTime;
  reportedBy: string;
  /** The reference the operator recorded for the submission. */
  reference: string;
  count: number;
}

export interface FiscalNumberBlock {
  id: Id;
  countryCode: CountryCode;
  branchId: Id;
  terminalId: Id;
  terminalName: string;
  /** Inclusive range. */
  start: number;
  end: number;
  issuedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  /** Numbers drawn, in the order they were issued. */
  used: number[];
  voidReport: VoidReport | null;
}

// ---------------------------------------------------------------------------
// Defaults from the country pack
// ---------------------------------------------------------------------------

/**
 * What a pack implies before anybody configures it.
 *
 * Egypt's ETA e-receipt keeps a gapless per-terminal sequence and the
 * product's published pack uses blocks of 500 with unused numbers reported
 * void. ZATCA's simplified invoices carry a device counter chained by hash,
 * which is assigned against the server record on sync. Anything without a
 * fiscal provider is not gapless and needs no strategy.
 */
export function defaultPolicy(pack: Pick<CountryPack, "code" | "fiscalProvider">, now: IsoDateTime): FiscalSequencePolicy {
  const base = {
    id: pack.code,
    countryCode: pack.code,
    blockValidityHours: 24,
    lowWaterPercent: 10,
    prefix: pack.code,
    updatedAt: now,
    updatedBy: "system",
  };
  if (!pack.fiscalProvider) {
    return { ...base, gapless: false, strategy: "server_assigned_on_sync", blockSize: 500, voidReportingRequired: false };
  }
  if (pack.code === "EG") {
    return { ...base, gapless: true, strategy: "pre_allocated_block", blockSize: 500, voidReportingRequired: true };
  }
  return { ...base, gapless: true, strategy: "server_assigned_on_sync", blockSize: 500, voidReportingRequired: false };
}

/** Plain-language problems with a policy, before it is saved. */
export function policyProblems(policy: FiscalSequencePolicy): ("block_size" | "validity" | "low_water" | "prefix")[] {
  const problems: ("block_size" | "validity" | "low_water" | "prefix")[] = [];
  if (policy.strategy === "pre_allocated_block") {
    if (!Number.isInteger(policy.blockSize) || policy.blockSize < 10 || policy.blockSize > 100_000) problems.push("block_size");
    if (!Number.isFinite(policy.blockValidityHours) || policy.blockValidityHours < 1 || policy.blockValidityHours > 24 * 31) problems.push("validity");
  }
  if (!Number.isFinite(policy.lowWaterPercent) || policy.lowWaterPercent < 0 || policy.lowWaterPercent > 90) problems.push("low_water");
  if (!/^[A-Z0-9-]{0,8}$/.test(policy.prefix)) problems.push("prefix");
  return problems;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type BlockState =
  | "active"
  | "exhausted"
  /** FR-OFF-018 — expired with numbers never issued, and not yet reported. */
  | "void_pending"
  | "void_reported"
  | "closed";

export interface NumberRange {
  from: number;
  to: number;
}

export function blockSize(block: Pick<FiscalNumberBlock, "start" | "end">): number {
  return block.end - block.start + 1;
}

/** Numbers in the block never drawn, compressed into contiguous ranges. */
export function unusedRanges(block: Pick<FiscalNumberBlock, "start" | "end" | "used">): NumberRange[] {
  const used = new Set(block.used);
  const ranges: NumberRange[] = [];
  let open: NumberRange | null = null;
  for (let n = block.start; n <= block.end; n += 1) {
    if (used.has(n)) {
      if (open) ranges.push(open);
      open = null;
    } else if (open) {
      open.to = n;
    } else {
      open = { from: n, to: n };
    }
  }
  if (open) ranges.push(open);
  return ranges;
}

export function unusedCount(block: Pick<FiscalNumberBlock, "start" | "end" | "used">): number {
  return blockSize(block) - new Set(block.used.filter((n) => n >= block.start && n <= block.end)).size;
}

export function isExpired(block: Pick<FiscalNumberBlock, "expiresAt">, now: Date): boolean {
  return Date.parse(block.expiresAt) <= now.getTime();
}

export function blockState(block: FiscalNumberBlock, now: Date): BlockState {
  const remaining = unusedCount(block);
  if (!isExpired(block, now)) return remaining > 0 ? "active" : "exhausted";
  if (remaining === 0) return "closed";
  return block.voidReport ? "void_reported" : "void_pending";
}

/**
 * The next contiguous range for a country.
 *
 * Blocks are allocated back to back across every terminal in the pack's
 * jurisdiction, so the fiscal sequence as a whole has no holes — the only
 * numbers that are never issued are the ones reported void.
 */
export function nextRange(blocks: readonly FiscalNumberBlock[], countryCode: CountryCode, size: number): NumberRange {
  const last = blocks
    .filter((block) => block.countryCode === countryCode)
    .reduce((max, block) => Math.max(max, block.end), 0);
  return { from: last + 1, to: last + size };
}

/** The next number a block would issue: always after the highest drawn. */
export function nextNumber(block: Pick<FiscalNumberBlock, "start" | "end" | "used">): number | null {
  const highest = block.used.length > 0 ? Math.max(...block.used) : block.start - 1;
  return highest + 1 <= block.end ? highest + 1 : null;
}

export function formatFiscalNumber(prefix: string, n: number): string {
  return `${prefix ? `${prefix}-` : ""}${String(n).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// The till's rule — FR-OFF-017
// ---------------------------------------------------------------------------

export type Link = "online" | "offline";

export type TillFiscalMode =
  /** No gapless requirement: issue normally, whatever the link. */
  | { kind: "not_required" }
  | { kind: "issue_online" }
  /** Offline under server-assigned: keep trading, documents held provisional. */
  | { kind: "provisional" }
  | { kind: "issue_from_block"; blockId: Id; next: number; remaining: number; low: boolean }
  /** Online with no usable block: fetch one before issuing. */
  | { kind: "request_block" }
  /** Offline and no way to issue a gapless number: the till must go online. */
  | { kind: "must_go_online"; reason: "online_only" | "no_block" | "block_exhausted" | "block_expired" };

export function tillFiscalMode(input: {
  policy: FiscalSequencePolicy | null;
  terminalBlocks: readonly FiscalNumberBlock[];
  link: Link;
  now: Date;
}): TillFiscalMode {
  const { policy, link, now } = input;
  if (!policy || !policy.gapless) return { kind: "not_required" };

  if (policy.strategy === "online_only") {
    return link === "online" ? { kind: "issue_online" } : { kind: "must_go_online", reason: "online_only" };
  }
  if (policy.strategy === "server_assigned_on_sync") {
    return link === "online" ? { kind: "issue_online" } : { kind: "provisional" };
  }

  const active = input.terminalBlocks
    .filter((block) => blockState(block, now) === "active")
    .sort((a, b) => a.start - b.start)[0];
  if (active) {
    const next = nextNumber(active);
    if (next !== null) {
      const remaining = unusedCount(active);
      const low = (remaining / blockSize(active)) * 100 <= policy.lowWaterPercent;
      return { kind: "issue_from_block", blockId: active.id, next, remaining, low };
    }
  }
  if (link === "online") return { kind: "request_block" };

  const latest = [...input.terminalBlocks].sort((a, b) => b.end - a.end)[0];
  const reason = !latest ? "no_block" : isExpired(latest, now) ? "block_expired" : "block_exhausted";
  return { kind: "must_go_online", reason };
}

// ---------------------------------------------------------------------------
// Void report — FR-OFF-018
// ---------------------------------------------------------------------------

export interface VoidReportRow {
  blockId: Id;
  countryCode: CountryCode;
  terminalName: string;
  blockRange: string;
  expiredAt: IsoDateTime;
  unusedRanges: string;
  unusedCount: number;
  status: "void_pending" | "void_reported";
  reference: string;
}

export function voidReportRows(blocks: readonly FiscalNumberBlock[], now: Date, prefixOf: (code: CountryCode) => string): VoidReportRow[] {
  return blocks
    .map((block) => ({ block, state: blockState(block, now) }))
    .filter((entry): entry is { block: FiscalNumberBlock; state: "void_pending" | "void_reported" } =>
      entry.state === "void_pending" || entry.state === "void_reported",
    )
    .map(({ block, state }) => {
      const prefix = prefixOf(block.countryCode);
      return {
        blockId: block.id,
        countryCode: block.countryCode,
        terminalName: block.terminalName,
        blockRange: `${formatFiscalNumber(prefix, block.start)} – ${formatFiscalNumber(prefix, block.end)}`,
        expiredAt: block.expiresAt,
        unusedRanges: unusedRanges(block)
          .map((range) =>
            range.from === range.to
              ? formatFiscalNumber(prefix, range.from)
              : `${formatFiscalNumber(prefix, range.from)}–${formatFiscalNumber(prefix, range.to)}`,
          )
          .join("; "),
        unusedCount: unusedCount(block),
        status: state,
        reference: block.voidReport?.reference ?? "",
      };
    });
}
