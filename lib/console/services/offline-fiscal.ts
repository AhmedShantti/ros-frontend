"use client";

/**
 * Fiscal sequence policies and the number-block ledger — FR-OFF-017/018.
 *
 * The backend publishes no fiscal-block endpoints (block issue happens on the
 * sync path the terminals use, with no list or report route), so the
 * policies a tenant sets and the ledger a manager reports voids from are kept
 * here, behind the interface a server implementation will take over. The
 * demo seeds a few blocks so the register can be exercised — one active, one
 * expired with numbers left over — and a live deployment is never seeded.
 *
 * "Recording a void report" records that the operator submitted the unused
 * range and the reference they received. It does not itself contact any
 * fiscal authority: this build has no fiscal gateway, and the screen says so.
 */

import type { CountryCode, Id, IsoDateTime } from "../types";
import { DATA_MODE } from "@/lib/api/config";
import { localCollection, localId, nowIso } from "../local-store";
import {
  blockState,
  nextNumber,
  nextRange,
  type FiscalNumberBlock,
  type FiscalSequencePolicy,
} from "../offline-fiscal";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export interface FiscalSequenceService {
  policies(): Promise<FiscalSequencePolicy[]>;
  savePolicy(policy: FiscalSequencePolicy): Promise<FiscalSequencePolicy>;
  blocks(): Promise<FiscalNumberBlock[]>;
  /** Refused while the terminal still holds an active block for the country. */
  allocate(input: {
    policy: FiscalSequencePolicy;
    branchId: Id;
    terminalId: Id;
    terminalName: string;
  }): Promise<FiscalNumberBlock>;
  /** Draws the next number from a block; refused once it is expired or spent. */
  issue(blockId: Id): Promise<{ block: FiscalNumberBlock; number: number }>;
  /** FR-OFF-018 — only for expired blocks with unused numbers. */
  recordVoidReport(blockIds: Id[], input: { by: string; reference: string }): Promise<FiscalNumberBlock[]>;
}

const hoursFromNow = (hours: number): IsoDateTime => new Date(Date.now() + hours * 3_600_000).toISOString();

function seedBlocks(): FiscalNumberBlock[] {
  if (DATA_MODE === "http") return [];
  const used = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  return [
    {
      id: "fblk_seed_1",
      countryCode: "EG",
      branchId: "br_zamalek",
      terminalId: "term_pos_1",
      terminalName: "POS 1",
      start: 1,
      end: 500,
      issuedAt: hoursFromNow(-50),
      expiresAt: hoursFromNow(-26),
      used: used(1, 412),
      voidReport: null,
    },
    {
      id: "fblk_seed_2",
      countryCode: "EG",
      branchId: "br_zamalek",
      terminalId: "term_pos_2",
      terminalName: "POS 2",
      start: 501,
      end: 1000,
      issuedAt: hoursFromNow(-49),
      expiresAt: hoursFromNow(-25),
      used: used(501, 500),
      voidReport: null,
    },
    {
      id: "fblk_seed_3",
      countryCode: "EG",
      branchId: "br_zamalek",
      terminalId: "term_pos_1",
      terminalName: "POS 1",
      start: 1001,
      end: 1500,
      issuedAt: hoursFromNow(-6),
      expiresAt: hoursFromNow(18),
      used: used(1001, 463),
      voidReport: null,
    },
  ];
}

const policyStore = localCollection<FiscalSequencePolicy>(
  { name: "fiscalSequencePolicies", idOf: (row) => row.id },
  getActiveTenantId,
);

const blockStore = localCollection<FiscalNumberBlock>(
  { name: "fiscalNumberBlocks", idOf: (row) => row.id, seed: seedBlocks },
  getActiveTenantId,
);

export const fiscalSequenceService: FiscalSequenceService = {
  policies: () => policyStore.all(),

  async savePolicy(policy) {
    const rows = await policyStore.all();
    const saved = { ...policy, updatedAt: nowIso() };
    await policyStore.replace([saved, ...rows.filter((row) => row.id !== policy.id)]);
    return saved;
  },

  blocks: () => blockStore.all(),

  async allocate({ policy, branchId, terminalId, terminalName }) {
    if (policy.strategy !== "pre_allocated_block") {
      throw new ServiceError("CONFLICT", "This country pack does not use pre-allocated blocks.", 409);
    }
    const rows = await blockStore.all();
    const now = new Date();
    const holding = rows.find(
      (row) =>
        row.terminalId === terminalId &&
        row.countryCode === policy.countryCode &&
        blockState(row, now) === "active",
    );
    if (holding) {
      throw new ServiceError("CONFLICT", "This terminal still holds an active block.", 409);
    }
    const range = nextRange(rows, policy.countryCode as CountryCode, policy.blockSize);
    const block: FiscalNumberBlock = {
      id: localId("fblk"),
      countryCode: policy.countryCode,
      branchId,
      terminalId,
      terminalName,
      start: range.from,
      end: range.to,
      issuedAt: nowIso(),
      expiresAt: hoursFromNow(policy.blockValidityHours),
      used: [],
      voidReport: null,
    };
    await blockStore.replace([block, ...rows]);
    return block;
  },

  async issue(blockId) {
    const rows = await blockStore.all();
    const block = rows.find((row) => row.id === blockId);
    if (!block) throw new ServiceError("NOT_FOUND", "That block no longer exists.", 404);
    if (blockState(block, new Date()) !== "active") {
      throw new ServiceError("CONFLICT", "The block is expired or spent; no number can be drawn from it.", 409);
    }
    const number = nextNumber(block);
    if (number === null) throw new ServiceError("CONFLICT", "The block is spent.", 409);
    const updated = { ...block, used: [...block.used, number] };
    await blockStore.replace(rows.map((row) => (row.id === blockId ? updated : row)));
    return { block: updated, number };
  },

  async recordVoidReport(blockIds, { by, reference }) {
    if (!reference.trim()) {
      throw new ServiceError("VALIDATION", "A submission reference is required.", 422);
    }
    const rows = await blockStore.all();
    const now = new Date();
    const updated: FiscalNumberBlock[] = [];
    const next = rows.map((row) => {
      if (!blockIds.includes(row.id)) return row;
      if (blockState(row, now) !== "void_pending") {
        throw new ServiceError("CONFLICT", "Only expired blocks with unreported unused numbers can be reported.", 409);
      }
      const size = row.end - row.start + 1;
      const report = {
        reportedAt: nowIso(),
        reportedBy: by,
        reference: reference.trim(),
        count: size - new Set(row.used).size,
      };
      const changed = { ...row, voidReport: report };
      updated.push(changed);
      return changed;
    });
    await blockStore.replace(next);
    return updated;
  },
};
