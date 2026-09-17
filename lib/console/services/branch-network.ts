"use client";

/**
 * Multi-branch records the backend has no resource for — SRS ch.17.
 *
 * `api/openapi.json` carries branches, brands and menus-per-branch, but no
 * branch groups, FX rates, brand standards, recipe overrides, transfer
 * pricing, franchise agreements or royalty statements. They live here, in
 * browser-local collections behind the interface a server will implement,
 * and every write is validated with the same pure rules the screens show
 * (`lib/console/branch-network.ts`, `lib/console/franchise.ts`,
 * `lib/console/branch-fx.ts`) — a refused save is refused here, not only
 * greyed out in a form.
 */

import type { Id, IsoDate, IsoDateTime } from "../types";
import {
  groupProblem,
  type BrandStandard,
  type BranchGroup,
  type RecipeOverride,
  type TransferPricingPolicy,
  evaluationFor,
} from "../branch-network";
import { agreementProblem, type FranchiseAgreement, type RoyaltyStatement } from "../franchise";
import { rateProblem, type FxRate } from "../branch-fx";
import { localCollection, nowIso, type LocalCollection } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

const tenantOf = () => getActiveTenantId();

/** FR-BRN-012 — one captured ranking, so movement can be read on any metric. */
export interface RankingSnapshot {
  /** `${businessDay}|${brandId ?? "all"}` */
  id: string;
  businessDay: IsoDate;
  brandId: Id | null;
  capturedAt: IsoDateTime;
  /** Raw (unnormalised) metric values by branch. */
  rows: { branchId: Id; values: Record<string, number | null> }[];
}

function refuse(message: string | null): void {
  if (message) throw new ServiceError("VALIDATION", message, 422);
}

// -- Branch groups — FR-BRN-005 ----------------------------------------------

const groupStore = localCollection<BranchGroup>(
  {
    name: "branch-groups",
    idOf: (row) => row.id,
    search: (row) => [row.name, row.code],
    filters: { kind: (row) => row.kind },
    sorters: { code: (row) => row.code, updatedAt: (row) => row.updatedAt },
    factory: (input, id) => ({
      id,
      name: input.name ?? { en: "", ar: "" },
      kind: input.kind ?? "region",
      code: (input.code ?? "").trim(),
      branchIds: input.branchIds ?? [],
      parentId: input.parentId ?? null,
      notes: input.notes ?? "",
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
    guardRemove: (row, all) => {
      const child = all.find((other) => other.parentId === row.id);
      return child ? `"${child.code}" sits inside this group. Move or delete it first.` : null;
    },
  },
  tenantOf,
);

const groups: LocalCollection<BranchGroup> = {
  ...groupStore,
  async create(input) {
    const all = await groupStore.all();
    refuse(groupProblem({ id: "", code: input.code ?? "", kind: input.kind ?? "region", branchIds: input.branchIds ?? [], parentId: input.parentId ?? null }, all));
    return groupStore.create(input);
  },
  async update(id, patch) {
    const all = await groupStore.all();
    const current = all.find((row) => row.id === id);
    if (!current) throw new ServiceError("NOT_FOUND", "That group no longer exists.", 404);
    refuse(groupProblem({ ...current, ...patch }, all));
    return groupStore.update(id, patch);
  },
};

// -- Keyed documents (one row per brand / kitchen / branch) ------------------

function keyed<T extends { id: Id }>(name: string, stamp: (row: T) => T) {
  const store = localCollection<T>(
    {
      name,
      idOf: (row) => row.id,
      factory: (input, id) => stamp({ ...(input as T), id: input.id ?? id }),
      onUpdate: (row, patch) => stamp({ ...row, ...patch }),
    },
    tenantOf,
  );
  return {
    ...store,
    /** Create or replace the row with this id. */
    async put(row: T): Promise<T> {
      const existing = await store.get(row.id);
      return existing ? store.update(row.id, row) : store.create(row);
    },
  };
}

const standards = keyed<BrandStandard>("brand-standards", (row) => ({ ...row, updatedAt: nowIso() }));

const transferPricingStore = keyed<TransferPricingPolicy>("transfer-pricing", (row) => ({
  ...row,
  // FR-BRN-030 — the evaluation follows the method; it is not a free choice.
  evaluatedAs: evaluationFor(row.method),
  updatedAt: nowIso(),
}));

const transferPricing = {
  ...transferPricingStore,
  async put(row: TransferPricingPolicy) {
    if (row.method === "cost_plus" && !(row.markupPercent >= 0 && row.markupPercent <= 500)) {
      refuse("A cost-plus markup must be between 0% and 500%.");
    }
    if (row.method === "fixed" && Object.values(row.fixedPrices).some((value) => !Number.isInteger(value) || value < 0)) {
      refuse("Fixed transfer prices must be whole minor units, not negative.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveFrom)) refuse("Give the date the policy takes effect.");
    return transferPricingStore.put(row);
  },
};

const agreementStore = keyed<FranchiseAgreement>("franchise-agreements", (row) => ({ ...row, updatedAt: nowIso() }));

const franchiseAgreements = {
  ...agreementStore,
  async put(row: FranchiseAgreement) {
    refuse(agreementProblem(row));
    return agreementStore.put({ ...row, id: row.branchId });
  },
};

// -- Recipe overrides — FR-BRN-007 --------------------------------------------

const recipeOverrides = localCollection<RecipeOverride>(
  {
    name: "recipe-overrides",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    search: (row) => [row.recipeName, row.reason],
    filters: { status: (row) => row.status, branchId: (row) => row.branchId },
    sorters: { requestedAt: (row) => row.requestedAt },
    factory: (input, id) => {
      if (!input.branchId || !input.recipeId) throw new ServiceError("VALIDATION", "Choose a branch and a recipe.", 422);
      if (!input.reason?.trim()) throw new ServiceError("VALIDATION", "Say why this branch departs from the brand recipe.", 422);
      const lines = input.lines ?? [];
      if (!lines.some((line) => line.branchQuantity !== line.standardQuantity)) {
        throw new ServiceError("VALIDATION", "Change at least one quantity — an override identical to the standard is not an override.", 422);
      }
      if (lines.some((line) => !/^\d+(\.\d+)?$/.test(line.branchQuantity.trim()))) {
        throw new ServiceError("VALIDATION", "Quantities must be non-negative decimals.", 422);
      }
      return {
        id,
        branchId: input.branchId,
        recipeId: input.recipeId,
        recipeName: input.recipeName ?? { en: "", ar: "" },
        recipeVersion: input.recipeVersion ?? 1,
        lines,
        reason: input.reason.trim(),
        status: input.status ?? "pending",
        requestedBy: input.requestedBy ?? null,
        requestedAt: nowIso(),
        decidedBy: null,
        decidedAt: null,
      };
    },
  },
  tenantOf,
);

// -- FX rates — FR-BRN-004 ----------------------------------------------------

const fxStore = localCollection<FxRate>(
  {
    name: "fx-rates",
    idOf: (row) => row.id,
    search: (row) => [row.base, row.quote, row.source],
    filters: { base: (row) => row.base, quote: (row) => row.quote },
    sorters: { rateDate: (row) => row.rateDate },
    factory: (input, id) => ({
      id,
      base: input.base!,
      quote: input.quote!,
      rate: (input.rate ?? "").trim(),
      source: (input.source ?? "").trim(),
      rateDate: input.rateDate ?? "",
      enteredBy: input.enteredBy ?? null,
      enteredAt: nowIso(),
    }),
  },
  tenantOf,
);

const fxRates: LocalCollection<FxRate> = {
  ...fxStore,
  async create(input) {
    refuse(rateProblem({ base: input.base ?? "", quote: input.quote ?? "", rate: input.rate ?? "", source: input.source ?? "", rateDate: input.rateDate ?? "" }));
    const all = await fxStore.all();
    const duplicate = all.find((row) => row.base === input.base && row.quote === input.quote && row.rateDate === input.rateDate && row.source === input.source?.trim());
    if (duplicate) refuse(`A ${input.base}→${input.quote} rate from ${duplicate.source} is already recorded for ${duplicate.rateDate}. Rates are kept, not overwritten — delete that one first if it was wrong.`);
    return fxStore.create(input);
  },
  async update() {
    // A rate a published report was converted at must stay readable.
    throw new ServiceError("NOT_SUPPORTED", "Rates are not edited. Record a new rate with its own date.", 400);
  },
};

// -- Royalty statements — FR-BRN-036 ------------------------------------------

const statementStore = localCollection<RoyaltyStatement>(
  {
    name: "royalty-statements",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    filters: { status: (row) => row.status, branchId: (row) => row.branchId },
    sorters: { periodStart: (row) => row.periodStart, computedAt: (row) => row.computedAt },
    factory: (input, id) => ({ ...(input as RoyaltyStatement), id, status: input.status ?? "draft", computedAt: nowIso(), issuedAt: null, issuedBy: null }),
    guardRemove: (row) => (row.status === "issued" ? "An issued statement is kept; void it instead." : null),
  },
  tenantOf,
);

const royaltyStatements = {
  ...statementStore,
  async issue(id: Id, by: string | null): Promise<RoyaltyStatement> {
    const all = await statementStore.all();
    const row = all.find((entry) => entry.id === id);
    if (!row) throw new ServiceError("NOT_FOUND", "That statement no longer exists.", 404);
    if (row.status !== "draft") refuse("Only a draft statement can be issued.");
    if (row.truncated) refuse("This statement was computed from a capped order read and may be incomplete. Recompute over a shorter period before issuing.");
    const overlap = all.find(
      (other) => other.id !== id && other.branchId === row.branchId && other.status === "issued" && other.periodStart <= row.periodEnd && other.periodEnd >= row.periodStart,
    );
    if (overlap) refuse(`An issued statement already covers ${overlap.periodStart} – ${overlap.periodEnd} for this franchisee. Void it first.`);
    return statementStore.update(id, { status: "issued", issuedAt: nowIso(), issuedBy: by });
  },
  async void(id: Id): Promise<RoyaltyStatement> {
    return statementStore.update(id, { status: "void" });
  },
};

// -- Ranking snapshots — FR-BRN-012 --------------------------------------------

const snapshotStore = keyed<RankingSnapshot>("ranking-snapshots", (row) => ({ ...row, capturedAt: nowIso() }));

export const branchNetworkService = {
  groups,
  standards,
  recipeOverrides,
  async decideOverride(id: Id, status: "approved" | "rejected", by: string | null): Promise<RecipeOverride> {
    return recipeOverrides.update(id, { status, decidedBy: by, decidedAt: nowIso() });
  },
  fxRates,
  transferPricing,
  franchiseAgreements,
  royaltyStatements,
  rankingSnapshots: snapshotStore,
};

export type BranchNetworkService = typeof branchNetworkService;
