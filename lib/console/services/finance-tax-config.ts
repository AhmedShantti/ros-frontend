"use client";

/**
 * Tax-inclusive / tax-exclusive pricing per price list — FR-FIN-031.
 *
 * Per branch the mode is the versioned `fin.pricingMode` setting in the
 * cascade. A price list can override it (a tax-exclusive corporate catering
 * list at a tax-inclusive branch), but the price-list resource in the API
 * has no field for it, so the override is kept in the browser-local store.
 * Changes are appended as versions with an effective date, like every other
 * financial setting (FR-PLT-028): a price list's past sales must keep being
 * read with the mode they were charged under.
 */

import type { Id, IsoDate, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { todayIso } from "../settings";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export type PriceListTaxMode = "inherit" | "tax_inclusive" | "tax_exclusive";

export interface PriceListTaxVersion {
  id: Id;
  priceListId: Id;
  mode: PriceListTaxMode;
  effectiveFrom: IsoDate;
  createdAt: IsoDateTime;
  createdBy: string | null;
}

const store = localCollection<PriceListTaxVersion>(
  {
    name: "finance-price-list-tax-mode",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id,
      priceListId: input.priceListId ?? "",
      mode: input.mode ?? "inherit",
      effectiveFrom: input.effectiveFrom ?? todayIso(),
      createdAt: nowIso(),
      createdBy: input.createdBy ?? null,
    }),
  },
  () => getActiveTenantId(),
);

/** The version in force for a price list as at a date. */
export function priceListModeAt(
  versions: PriceListTaxVersion[],
  priceListId: Id,
  asAt: IsoDate = todayIso(),
): PriceListTaxVersion | null {
  return (
    versions
      .filter((row) => row.priceListId === priceListId && row.effectiveFrom <= asAt)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt))[0] ??
    null
  );
}

export interface PriceListTaxService {
  all(): Promise<PriceListTaxVersion[]>;
  set(input: { priceListId: Id; mode: PriceListTaxMode; effectiveFrom: IsoDate; createdBy: string | null }): Promise<PriceListTaxVersion>;
}

export const priceListTaxService: PriceListTaxService = {
  all: () => store.all(),
  async set(input) {
    if (input.effectiveFrom < todayIso()) {
      throw new ServiceError(
        "VALIDATION",
        "A pricing-mode change cannot take effect in the past — sales already made keep the mode they were charged under.",
        400,
      );
    }
    return store.create(input);
  },
};
