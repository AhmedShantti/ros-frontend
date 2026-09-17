"use client";

/**
 * The pricing records the catalogue API does not keep — FR-MNU-020, FR-MNU-024,
 * FR-MNU-025, FR-MNU-026.
 *
 * `POST /catalogue/price-lists/{id}/entries` is an upsert that returns the new
 * entry and nothing else: no history endpoint, no scheduled-price endpoint, no
 * branch-group scope (C-06 removed `branch_group` from the enum on purpose).
 * So four things live here, behind an interface a server can take over:
 *
 *  - **History** — one row per price the console set, with who, from what,
 *    to what, when, and effective when. It records changes made *through this
 *    console*; the server's audit trail remains the authority for everything.
 *  - **Schedules** — a price set for a future moment. The server cannot hold
 *    one, so the console applies it through the real endpoint the first time
 *    somebody with price permission opens pricing after it falls due, and
 *    says so on screen.
 *  - **Branch groups** — a named set of branches. A group-scoped list is
 *    materialised as one real branch-scoped list per member, linked here.
 *  - **Settings** — the margin warning threshold and the default price point.
 */

import type { Id, IsoDateTime, Localised, Money } from "../types";
import { localCollection, localDocument, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";

export type PriceChangeSource = "manual" | "bulk" | "import" | "scheduled";

/** FR-MNU-024 — who changed what, from what to what, when, and effective when. */
export interface PriceChangeRecord {
  id: Id;
  priceListId: Id;
  priceListName: Localised;
  menuItemId: Id;
  variantId: Id;
  itemName: Localised;
  from: Money | null;
  to: Money;
  changedBy: string;
  changedAt: IsoDateTime;
  effectiveAt: IsoDateTime;
  source: PriceChangeSource;
  note: string | null;
}

export type ScheduledPriceStatus = "pending" | "applied" | "cancelled" | "failed";

/** A price that takes effect later. */
export interface ScheduledPriceChange {
  id: Id;
  priceListId: Id;
  priceListName: Localised;
  menuItemId: Id;
  variantId: Id;
  itemName: Localised;
  /** The price when the change was scheduled, for the review. */
  priceAtScheduling: Money | null;
  price: Money;
  effectiveAt: IsoDateTime;
  createdBy: string;
  createdAt: IsoDateTime;
  status: ScheduledPriceStatus;
  resolvedAt: IsoDateTime | null;
  resolvedBy: string | null;
  error: string | null;
}

/** FR-MNU-020 — a branch group, and the branch-scoped lists standing in for it. */
export interface BranchGroup {
  id: Id;
  name: Localised;
  branchIds: Id[];
  /** Real price lists created for this group, one per member branch. */
  priceListIds: Id[];
  updatedAt: IsoDateTime;
}

/** FR-MNU-025 — "always end in .95". */
export type PricePointRule =
  | { kind: "none" }
  /** `ending` is the minor-unit remainder within one major unit, e.g. 95. */
  | { kind: "ending"; ending: number; direction: "up" | "down" | "nearest" }
  /** Round to a multiple of `step` minor units, e.g. 50 or 500. */
  | { kind: "multiple"; step: number; direction: "up" | "down" | "nearest" };

export interface PricingSettings {
  /** FR-MNU-026 — warn when a new price leaves less margin than this. */
  marginThresholdPercent: number;
  pricePoint: PricePointRule;
}

const DEFAULT_SETTINGS: PricingSettings = {
  marginThresholdPercent: 60,
  pricePoint: { kind: "none" },
};

const history = localCollection<PriceChangeRecord>(
  {
    name: "menu-price-history",
    idOf: (row) => row.id,
    search: (row) => [row.itemName, row.priceListName, row.changedBy],
    filters: {
      priceListId: (row) => row.priceListId,
      variantId: (row) => row.variantId,
      menuItemId: (row) => row.menuItemId,
      source: (row) => row.source,
    },
    sorters: { changedAt: (row) => row.changedAt, effectiveAt: (row) => row.effectiveAt },
    factory: (input, id) => ({
      id,
      priceListId: input.priceListId ?? "",
      priceListName: input.priceListName ?? { en: "", ar: "" },
      menuItemId: input.menuItemId ?? "",
      variantId: input.variantId ?? "",
      itemName: input.itemName ?? { en: "", ar: "" },
      from: input.from ?? null,
      to: input.to ?? { amount: 0, currency: "EGP" },
      changedBy: input.changedBy ?? "",
      changedAt: input.changedAt ?? nowIso(),
      effectiveAt: input.effectiveAt ?? input.changedAt ?? nowIso(),
      source: input.source ?? "manual",
      note: input.note ?? null,
    }),
  },
  () => getActiveTenantId(),
);

const schedules = localCollection<ScheduledPriceChange>(
  {
    name: "menu-price-schedule",
    idOf: (row) => row.id,
    search: (row) => [row.itemName, row.priceListName],
    filters: { status: (row) => row.status, priceListId: (row) => row.priceListId },
    sorters: { effectiveAt: (row) => row.effectiveAt },
    factory: (input, id) => ({
      id,
      priceListId: input.priceListId ?? "",
      priceListName: input.priceListName ?? { en: "", ar: "" },
      menuItemId: input.menuItemId ?? "",
      variantId: input.variantId ?? "",
      itemName: input.itemName ?? { en: "", ar: "" },
      priceAtScheduling: input.priceAtScheduling ?? null,
      price: input.price ?? { amount: 0, currency: "EGP" },
      effectiveAt: input.effectiveAt ?? nowIso(),
      createdBy: input.createdBy ?? "",
      createdAt: nowIso(),
      status: "pending",
      resolvedAt: null,
      resolvedBy: null,
      error: null,
    }),
  },
  () => getActiveTenantId(),
);

const groups = localCollection<BranchGroup>(
  {
    name: "menu-branch-groups",
    idOf: (row) => row.id,
    search: (row) => [row.name],
    factory: (input) => ({
      id: input.id ?? localId("bgr"),
      name: input.name ?? { en: "", ar: "" },
      branchIds: input.branchIds ?? [],
      priceListIds: input.priceListIds ?? [],
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  () => getActiveTenantId(),
);

const settings = localDocument<PricingSettings>(
  "menu-pricing-settings",
  () => ({ ...DEFAULT_SETTINGS }),
  () => getActiveTenantId(),
);

export interface MenuPricingService {
  history: typeof history;
  schedules: typeof schedules;
  branchGroups: typeof groups;
  record(change: Omit<PriceChangeRecord, "id">): Promise<PriceChangeRecord>;
  settings(): PricingSettings;
  saveSettings(next: PricingSettings): PricingSettings;
}

export const menuPricingService: MenuPricingService = {
  history,
  schedules,
  branchGroups: groups,
  async record(change) {
    return history.create(change);
  },
  settings() {
    return { ...DEFAULT_SETTINGS, ...settings.read() };
  },
  saveSettings(next) {
    settings.write(next);
    return next;
  },
};
