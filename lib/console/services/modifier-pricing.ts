"use client";

/**
 * Modifier prices by context — FR-POS-022.
 *
 * "A modifier may be free for dine-in and charged for delivery." The
 * catalogue API carries one price delta per modifier and nothing else, so
 * the context rules are kept here, behind an interface a server can take
 * over, the same way nested modifier groups are (`modifier-nesting.ts`).
 *
 * Resolution — which rule wins when several match — is not done here. It
 * lives in `resolveModifierDelta` (`lib/console/live/engine.ts`), which the
 * till, the editor's preview and anything else that prices a modifier all
 * call, so they cannot disagree.
 */

import type { Id, ModifierPriceRule } from "../types";
import { localCollection, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

const store = localCollection<ModifierPriceRule>(
  {
    name: "modifier-pricing",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.id ?? id ?? localId("mpr"),
      modifierId: input.modifierId ?? "",
      orderType: input.orderType ?? null,
      branchId: input.branchId ?? null,
      priceListId: input.priceListId ?? null,
      priceDelta: input.priceDelta ?? { amount: 0, currency: "EGP" },
      updatedAt: nowIso(),
    }),
  },
  () => getActiveTenantId(),
);

export interface ModifierPricingService {
  all(): Promise<ModifierPriceRule[]>;
  /** Adds a rule, or replaces the one with the same modifier and the same three dimensions. */
  save(rule: Omit<ModifierPriceRule, "id" | "updatedAt">): Promise<ModifierPriceRule>;
  remove(id: Id): Promise<void>;
}

function sameContext(a: Omit<ModifierPriceRule, "id" | "updatedAt">, b: ModifierPriceRule): boolean {
  return (
    a.modifierId === b.modifierId &&
    a.orderType === b.orderType &&
    a.branchId === b.branchId &&
    a.priceListId === b.priceListId
  );
}

export const modifierPricingService: ModifierPricingService = {
  async all() {
    return store.all();
  },
  async save(rule) {
    // Two rules for the same context would make the answer depend on which
    // was saved last; editing a context replaces its rule instead.
    const existing = (await store.all()).find((row) => sameContext(rule, row));
    if (existing) return store.update(existing.id, { priceDelta: rule.priceDelta, updatedAt: nowIso() });
    return store.create(rule);
  },
  async remove(id) {
    await store.remove(id);
  },
};
