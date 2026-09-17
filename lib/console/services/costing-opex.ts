"use client";

/**
 * Branch operating expenses — FR-CST-036.
 *
 * The backend has no expense or operating-cost resource (see
 * `unsupported.ts`), so these live in the browser-local store behind the
 * ordinary collection interface, validated by the same rules the form uses.
 */

import type { Id } from "../types";
import { localCollection, nowIso } from "../local-store";
import { validateExpense, type OperatingExpense } from "../costing-opex";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

const store = localCollection<OperatingExpense>(
  {
    name: "costing-operating-expenses",
    idOf: (row) => row.id,
    search: (row) => [row.description],
    filters: { category: (row) => row.category, recurrence: (row) => row.recurrence },
    sorters: { startsOn: (row) => row.startsOn, amountMinor: (row) => row.amountMinor },
    factory: (input, id) => ({
      id,
      description: (input.description ?? "").trim(),
      category: input.category ?? "other",
      amountMinor: input.amountMinor ?? 0,
      currency: input.currency ?? "EGP",
      recurrence: input.recurrence ?? "monthly",
      startsOn: input.startsOn ?? nowIso().slice(0, 10),
      endsOn: input.endsOn ?? null,
      fixed: input.fixed ?? true,
      allocation: input.allocation ?? "single",
      branchIds: input.branchIds ?? [],
      manualPercent: input.manualPercent ?? {},
      createdAt: nowIso(),
      createdBy: input.createdBy ?? null,
    }),
  },
  () => getActiveTenantId(),
);

export type OperatingExpenseInput = Omit<OperatingExpense, "id" | "createdAt">;

export interface OperatingExpenseService {
  all(): Promise<OperatingExpense[]>;
  create(input: OperatingExpenseInput): Promise<OperatingExpense>;
  update(id: Id, input: OperatingExpenseInput): Promise<OperatingExpense>;
  remove(id: Id): Promise<void>;
}

function check(input: Partial<OperatingExpense>) {
  const problem = validateExpense(input);
  if (problem) throw new ServiceError("VALIDATION", problem, 400);
}

export const operatingExpenseService: OperatingExpenseService = {
  all: () => store.all(),
  async create(input) {
    check(input);
    return store.create(input);
  },
  async update(id, input) {
    check(input);
    return store.update(id, input);
  },
  remove: (id) => store.remove(id),
};
