"use client";

/**
 * Price writes with their history — FR-MNU-024.
 *
 * Every screen that sets a price comes through `changePrice`, so the real
 * upsert (`services.catalogue.setPrice`) and the history row cannot drift
 * apart: the row is written only after the server accepted the price, and
 * records the price that was there before.
 */

import { useMemo } from "react";
import type { Id, Localised, Money, Recipe } from "./types";
import { services } from "./services";
import type { PriceChangeSource, ScheduledPriceChange } from "./services/menu-pricing";
import { useAsync } from "./hooks";
import { useSession } from "./providers";

export interface PriceTarget {
  priceListId: Id;
  priceListName: Localised;
  menuItemId: Id;
  variantId: Id;
  itemName: Localised;
  current: Money | null;
}

export async function changePrice(
  target: PriceTarget,
  to: Money,
  meta: { actor: string; source: PriceChangeSource; effectiveAt?: string; note?: string | null },
) {
  const entry = await services.catalogue.setPrice(target.priceListId, target.variantId, to);
  const now = new Date().toISOString();
  // FR-MNU-024: who, what, from, to, when, effective when.
  await services.menuPricing.record({
    priceListId: target.priceListId,
    priceListName: target.priceListName,
    menuItemId: target.menuItemId || entry.menuItemId,
    variantId: target.variantId,
    itemName: target.itemName,
    from: target.current,
    to,
    changedBy: meta.actor,
    changedAt: now,
    effectiveAt: meta.effectiveAt ?? now,
    source: meta.source,
    note: meta.note ?? null,
  });
  return entry;
}

export interface ScheduleOutcome {
  applied: number;
  failed: number;
}

/**
 * Apply every pending scheduled price whose moment has passed.
 *
 * There is no server scheduler for prices, so this runs when a person with
 * price permission opens pricing. The history row keeps the scheduled
 * moment as "effective", and the row's own timestamp shows when it really
 * reached the server — the gap is visible, not hidden.
 */
let inFlight: Promise<ScheduleOutcome> | null = null;

export function applyDueSchedules(actor: string, now = new Date()): Promise<ScheduleOutcome> {
  // Two mounts (or two tabs of one page) must not apply the same schedule twice.
  if (!inFlight) inFlight = runDueSchedules(actor, now).finally(() => (inFlight = null));
  return inFlight;
}

async function runDueSchedules(actor: string, now: Date): Promise<ScheduleOutcome> {
  const due = (await services.menuPricing.schedules.all()).filter(
    (row) => row.status === "pending" && new Date(row.effectiveAt).getTime() <= now.getTime(),
  );
  const outcome: ScheduleOutcome = { applied: 0, failed: 0 };

  // Oldest first, so two schedules for one variant land in order.
  due.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  for (const row of due) {
    try {
      const entries = await services.catalogue.priceEntries(row.priceListId);
      const current = entries.find((entry) => entry.variantId === row.variantId)?.price ?? null;
      await changePrice(
        { ...row, current },
        row.price,
        { actor, source: "scheduled", effectiveAt: row.effectiveAt, note: `scheduled by ${row.createdBy}` },
      );
      await services.menuPricing.schedules.update(row.id, {
        status: "applied",
        resolvedAt: new Date().toISOString(),
        resolvedBy: actor,
        error: null,
      } satisfies Partial<ScheduledPriceChange>);
      outcome.applied += 1;
    } catch (caught) {
      await services.menuPricing.schedules.update(row.id, {
        status: "failed",
        resolvedAt: new Date().toISOString(),
        resolvedBy: actor,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      outcome.failed += 1;
    }
  }
  return outcome;
}

export function useActor(): string {
  const { session } = useSession();
  return session?.user.email || session?.user.name.en || "unknown";
}

/**
 * FR-MNU-026 — portion cost per variant, from the recipes.
 *
 * A menu-item recipe targets a variant (live: `menuItemVariantId`; demo: the
 * variant id too), and a variant may also name its recipe. Only complete
 * recipes count: an incomplete one books zero cost, and a zero cost would
 * make every price look like pure margin.
 */
export function useVariantCosts() {
  const recipes = useAsync(
    () => services.catalogue.recipes.list({ limit: 1000 }).then((page) => page.rows),
    [],
  );

  return useMemo(() => {
    const byTarget = new Map<Id, Recipe>();
    const byId = new Map<Id, Recipe>();
    for (const recipe of recipes.data ?? []) {
      byId.set(recipe.id, recipe);
      // Branch variants must not stand in for the standard cost.
      if (recipe.recipeType === "menu_item" && recipe.targetId && (recipe.scope ?? "tenant") !== "branch") {
        byTarget.set(recipe.targetId, recipe);
      }
    }
    function costOf(variantId: Id, menuItemId?: Id | null, recipeId?: Id | null): number | null {
      const recipe =
        (recipeId ? byId.get(recipeId) : undefined) ??
        byTarget.get(variantId) ??
        (menuItemId ? byTarget.get(menuItemId) : undefined);
      if (!recipe || !recipe.complete || recipe.costPerPortion.amount <= 0) return null;
      return recipe.costPerPortion.amount;
    }
    return { loading: recipes.loading, costOf };
  }, [recipes.data, recipes.loading]);
}
