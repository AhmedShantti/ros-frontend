"use client";

/**
 * Settlement statements for reconciliation — FR-FIN-011, FR-FIN-012.
 *
 * What the acquirer's batch report and the aggregator's payout statement
 * said. The backend has no settlement, payout or reconciliation resource, so
 * the imported statements, each aggregator's commercial terms and the
 * resolution of every flagged difference are kept in the browser-local store.
 * The system side of the match is not stored at all: it is read fresh from
 * the real orders (`services.sales.orders`) every time.
 *
 * Resolution history is append-only — how a difference was explained is the
 * audit trail of the reconciliation, and must not be rewritten.
 */

import type { Currency, Id, IsoDate, IsoDateTime } from "../types";
import { localCollection, localDocument, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

const tenantOf = () => getActiveTenantId();

// ---------------------------------------------------------------------------
// Card batches
// ---------------------------------------------------------------------------

export interface CardBatchLine {
  /** Lower-case scheme, as the payment records carry it: `visa`, `mada`… */
  scheme: string;
  count: number;
  amountMinor: number;
}

export interface CardBatch {
  id: Id;
  branchId: Id | null;
  /** The till the batch belongs to, when the report names one. */
  terminalName: string | null;
  acquirer: string;
  batchNumber: string;
  businessDay: IsoDate;
  currency: Currency;
  lines: CardBatchLine[];
  feesMinor: number;
  source: "manual" | "csv";
  importedAt: IsoDateTime;
  importedBy: string | null;
}

// ---------------------------------------------------------------------------
// Aggregator payouts
// ---------------------------------------------------------------------------

export interface PayoutOrderRef {
  ref: string;
  grossMinor: number;
}

export interface PayoutStatement {
  id: Id;
  aggregator: string;
  branchId: Id | null;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  currency: Currency;
  grossMinor: number;
  commissionMinor: number;
  feesMinor: number;
  adjustmentsMinor: number;
  netPayoutMinor: number;
  orderRefs: PayoutOrderRef[];
  source: "manual" | "csv";
  importedAt: IsoDateTime;
  importedBy: string | null;
}

/** An aggregator's contract terms, used to compute the expected payout. */
export interface AggregatorTerms {
  /** Aggregator name as it appears on statements; also the id. */
  aggregator: string;
  commissionPercent: number;
  /** Per-order fixed fee, minor units. */
  fixedFeeMinor: number;
  /** When set, only orders whose `aggregatorRef` starts with this belong to the aggregator. */
  refPrefix: string | null;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Resolutions
// ---------------------------------------------------------------------------

export type ResolutionStatus = "open" | "explained" | "written_off" | "disputed";

export interface ResolutionEntry {
  status: ResolutionStatus;
  note: string;
  by: string | null;
  at: IsoDateTime;
}

export interface DiscrepancyResolution {
  /** `card:<batchId>:<scheme>` or `payout:<statementId>:<key>`. */
  key: string;
  status: ResolutionStatus;
  history: ResolutionEntry[];
}

export interface ReconciliationPrefs {
  /** Differences at or below this are not flagged, minor units. */
  toleranceMinor: number;
}

const batches = localCollection<CardBatch>(
  {
    name: "finance-card-batches",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    search: (row) => [row.batchNumber, row.acquirer, row.terminalName],
    sorters: { businessDay: (row) => row.businessDay },
    factory: (input, id) => ({
      id,
      branchId: input.branchId ?? null,
      terminalName: input.terminalName ?? null,
      acquirer: input.acquirer ?? "",
      batchNumber: input.batchNumber ?? "",
      businessDay: input.businessDay ?? "",
      currency: input.currency ?? "EGP",
      lines: input.lines ?? [],
      feesMinor: input.feesMinor ?? 0,
      source: input.source ?? "manual",
      importedAt: nowIso(),
      importedBy: input.importedBy ?? null,
    }),
  },
  tenantOf,
);

const payouts = localCollection<PayoutStatement>(
  {
    name: "finance-payout-statements",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    search: (row) => [row.aggregator],
    sorters: { periodTo: (row) => row.periodTo },
    factory: (input, id) => ({
      id,
      aggregator: input.aggregator ?? "",
      branchId: input.branchId ?? null,
      periodFrom: input.periodFrom ?? "",
      periodTo: input.periodTo ?? "",
      currency: input.currency ?? "EGP",
      grossMinor: input.grossMinor ?? 0,
      commissionMinor: input.commissionMinor ?? 0,
      feesMinor: input.feesMinor ?? 0,
      adjustmentsMinor: input.adjustmentsMinor ?? 0,
      netPayoutMinor: input.netPayoutMinor ?? 0,
      orderRefs: input.orderRefs ?? [],
      source: input.source ?? "manual",
      importedAt: nowIso(),
      importedBy: input.importedBy ?? null,
    }),
  },
  tenantOf,
);

const terms = localCollection<AggregatorTerms>(
  {
    name: "finance-aggregator-terms",
    idOf: (row) => row.aggregator,
    factory: (input) => ({
      aggregator: input.aggregator ?? "",
      commissionPercent: input.commissionPercent ?? 0,
      fixedFeeMinor: input.fixedFeeMinor ?? 0,
      refPrefix: input.refPrefix ?? null,
      updatedAt: nowIso(),
    }),
  },
  tenantOf,
);

const resolutions = localCollection<DiscrepancyResolution>(
  {
    name: "finance-reconciliation-resolutions",
    idOf: (row) => row.key,
    factory: (input) => ({
      key: input.key ?? "",
      status: input.status ?? "open",
      history: input.history ?? [],
    }),
  },
  tenantOf,
);

const prefs = localDocument<ReconciliationPrefs>(
  "finance-reconciliation-prefs",
  () => ({ toleranceMinor: 100 }),
  tenantOf,
);

function validateBatch(input: Partial<CardBatch>): void {
  if (!input.batchNumber?.trim()) throw new ServiceError("VALIDATION", "A batch number is required.", 400);
  if (!input.businessDay || !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDay)) {
    throw new ServiceError("VALIDATION", "The business day must be a date (YYYY-MM-DD).", 400);
  }
  if (!input.lines?.length) throw new ServiceError("VALIDATION", "A batch needs at least one scheme line.", 400);
  for (const line of input.lines) {
    if (!line.scheme.trim() || !Number.isInteger(line.amountMinor) || !Number.isInteger(line.count) || line.count < 0) {
      throw new ServiceError("VALIDATION", "Every scheme line needs a scheme, a count and an amount.", 400);
    }
  }
}

function validatePayout(input: Partial<PayoutStatement>): void {
  if (!input.aggregator?.trim()) throw new ServiceError("VALIDATION", "Name the aggregator.", 400);
  if (!input.periodFrom || !input.periodTo || input.periodFrom > input.periodTo) {
    throw new ServiceError("VALIDATION", "The statement period is not a valid date range.", 400);
  }
  if (!Number.isInteger(input.netPayoutMinor)) {
    throw new ServiceError("VALIDATION", "The net payout is required.", 400);
  }
}

export interface SettlementService {
  batches: { all(): Promise<CardBatch[]>; create(input: Partial<CardBatch>): Promise<CardBatch>; remove(id: Id): Promise<void> };
  payouts: {
    all(): Promise<PayoutStatement[]>;
    create(input: Partial<PayoutStatement>): Promise<PayoutStatement>;
    remove(id: Id): Promise<void>;
  };
  terms: { all(): Promise<AggregatorTerms[]>; save(input: Omit<AggregatorTerms, "updatedAt">): Promise<AggregatorTerms> };
  resolutions: {
    all(): Promise<DiscrepancyResolution[]>;
    record(key: string, entry: { status: ResolutionStatus; note: string; by: string | null }): Promise<DiscrepancyResolution>;
  };
  prefs(): ReconciliationPrefs;
  setPrefs(next: ReconciliationPrefs): ReconciliationPrefs;
}

export const settlementService: SettlementService = {
  batches: {
    all: () => batches.all(),
    async create(input) {
      validateBatch(input);
      const existing = await batches.all();
      if (existing.some((row) => row.batchNumber === input.batchNumber && row.acquirer === input.acquirer)) {
        throw new ServiceError("CONFLICT", "That batch has already been imported.", 409);
      }
      return batches.create(input);
    },
    remove: (id) => batches.remove(id),
  },
  payouts: {
    all: () => payouts.all(),
    async create(input) {
      validatePayout(input);
      return payouts.create(input);
    },
    remove: (id) => payouts.remove(id),
  },
  terms: {
    all: () => terms.all(),
    async save(input) {
      if (!input.aggregator.trim()) throw new ServiceError("VALIDATION", "Name the aggregator.", 400);
      if (!(input.commissionPercent >= 0 && input.commissionPercent <= 100)) {
        throw new ServiceError("VALIDATION", "Commission must be between 0 and 100%.", 400);
      }
      const existing = await terms.get(input.aggregator);
      const next = { ...input, updatedAt: nowIso() };
      return existing ? terms.update(input.aggregator, next) : terms.create(next);
    },
  },
  resolutions: {
    all: () => resolutions.all(),
    async record(key, entry) {
      const note = entry.note.trim();
      if (entry.status !== "open" && note.length < 10) {
        throw new ServiceError("VALIDATION", "Record how the difference was resolved, in at least ten characters.", 400);
      }
      const next: ResolutionEntry = { status: entry.status, note, by: entry.by, at: nowIso() };
      const existing = await resolutions.get(key);
      return existing
        ? resolutions.update(key, { status: entry.status, history: [next, ...existing.history] })
        : resolutions.create({ key, status: entry.status, history: [next] });
    },
  },
  prefs: () => prefs.read(),
  setPrefs(next) {
    const safe = { toleranceMinor: Math.max(0, Math.round(next.toleranceMinor)) };
    prefs.write(safe);
    return safe;
  },
};
