"use client";

/**
 * Inventory control configuration and records the backend has no home for —
 * SRS ch.11. Browser-local under both data modes, behind one interface a
 * server can take over:
 *
 *   - storage layouts and count-sheet walk order (FR-INV-049)
 *   - the cycle-count policy, class pins and started cycle counts (FR-INV-048)
 *   - reorder parameters, known future demand and the seasonal calendar
 *     (FR-INV-067 … FR-INV-070)
 *   - the day-close expiry write-off policy and its run log (FR-INV-026)
 *   - the waste anomaly policy (FR-INV-061)
 *   - waste record photographs (FR-INV-056)
 *   - reconciliation check runs (FR-INV-051)
 *
 * Nothing here moves stock. Every stock effect these screens have goes
 * through the real inventory service.
 */

import type { Id, IsoDate, IsoDateTime, Localised } from "../types";
import { localCollection, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";
import { DEFAULT_CYCLE_POLICY, type CycleClass, type CyclePolicy } from "../inventory-cycle";
import { DEFAULT_REORDER_PARAMETERS, type DemandEvent, type ReorderParameters } from "../inventory-reorder";
import { DEFAULT_MULTIPLIERS, type SeasonKind, type SeasonalEvent } from "../inventory-seasonality";
import { DEFAULT_WASTE_ANOMALY_POLICY, type WasteAnomalyPolicy } from "../inventory-waste";
import { DEFAULT_TRANSFER_SUGGESTION_POLICY, type TransferSuggestionPolicy } from "../inventory-transfers";

const tenant = () => getActiveTenantId();

/** Documents are stored as single-row collections keyed by a fixed id. */
function documentStore<T extends { key: string }>(name: string, initial: () => T) {
  const store = localCollection<T>({ name, idOf: (row) => row.key, factory: (input) => input as T }, tenant);
  return {
    async read(): Promise<T> {
      return (await store.get(initial().key)) ?? initial();
    },
    async write(next: T): Promise<T> {
      const existing = await store.get(next.key);
      return existing ? store.update(next.key, next) : store.create(next);
    },
  };
}

// ---------------------------------------------------------------------------
// FR-INV-049 — storage layout and walk order
// ---------------------------------------------------------------------------

export interface StorageArea {
  id: Id;
  name: Localised;
  /** Short code printed on the sheet and the shelf label, e.g. "WIC". */
  code: string;
  /** Position on the walk — lower is visited first. */
  walkOrder: number;
}

export interface StorageSlot {
  areaId: Id;
  /** Shelf or bin label inside the area, free text: "S2", "Rack 3 / top". */
  shelf: string;
  /** Order within the area. */
  position: number;
}

export interface StorageLayout {
  locationId: Id;
  areas: StorageArea[];
  /** Item id → where it lives. Items without a slot go at the end of the sheet. */
  slots: Record<Id, StorageSlot>;
  updatedAt: IsoDateTime;
  updatedBy: string | null;
}

const layouts = localCollection<StorageLayout>(
  { name: "storage-layouts", idOf: (row) => row.locationId, factory: (input) => input as StorageLayout },
  tenant,
);

export function emptyLayout(locationId: Id): StorageLayout {
  return { locationId, areas: [], slots: {}, updatedAt: nowIso(), updatedBy: null };
}

export function newStorageArea(walkOrder: number): StorageArea {
  return { id: localId("area"), name: { en: "", ar: "" }, code: "", walkOrder };
}

/**
 * The walk: area by walk order, then shelf, then position, then name. Lines
 * for items with no slot go last, alphabetically, under "Unassigned".
 */
export function orderForSheet<T extends { itemId: Id; itemName: Localised }>(
  layout: StorageLayout | null,
  lines: T[],
  locale: "en" | "ar" = "en",
): { line: T; area: StorageArea | null; slot: StorageSlot | null }[] {
  const areaById = new Map((layout?.areas ?? []).map((area) => [area.id, area]));
  return lines
    .map((line) => {
      const slot = layout?.slots[line.itemId] ?? null;
      const area = slot ? (areaById.get(slot.areaId) ?? null) : null;
      return { line, area, slot: area ? slot : null };
    })
    .sort((a, b) => {
      if (!a.area !== !b.area) return a.area ? -1 : 1;
      if (a.area && b.area) {
        const byArea = a.area.walkOrder - b.area.walkOrder || a.area.code.localeCompare(b.area.code);
        if (byArea !== 0) return byArea;
        const byShelf = (a.slot?.shelf ?? "").localeCompare(b.slot?.shelf ?? "", undefined, { numeric: true });
        if (byShelf !== 0) return byShelf;
        const byPosition = (a.slot?.position ?? 0) - (b.slot?.position ?? 0);
        if (byPosition !== 0) return byPosition;
      }
      return (a.line.itemName[locale] || a.line.itemName.en).localeCompare(b.line.itemName[locale] || b.line.itemName.en);
    });
}

// ---------------------------------------------------------------------------
// FR-INV-048 — cycle counting
// ---------------------------------------------------------------------------

export interface CycleSettings {
  key: "cycle";
  policy: CyclePolicy;
  /** Location id → item id → pinned class. */
  pins: Record<Id, Record<Id, CycleClass>>;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

export interface CycleCountStart {
  id: Id;
  sessionId: Id;
  reference: string;
  locationId: Id;
  itemIds: Id[];
  startedAt: IsoDateTime;
  startedBy: string | null;
}

const cycleSettings = documentStore<CycleSettings>("cycle-settings", () => ({
  key: "cycle",
  policy: DEFAULT_CYCLE_POLICY,
  pins: {},
  updatedAt: null,
  updatedBy: null,
}));

const cycleStarts = localCollection<CycleCountStart>(
  { name: "cycle-starts", idOf: (row) => row.id, factory: (input, id) => ({ ...(input as CycleCountStart), id }) },
  tenant,
);

// ---------------------------------------------------------------------------
// FR-INV-067 … FR-INV-070 — forecasting inputs
// ---------------------------------------------------------------------------

export interface ForecastSettings {
  key: "forecast";
  defaults: ReorderParameters;
  /** Item id → overrides (lead time from the supplier, a pack size, …). */
  items: Record<Id, Partial<ReorderParameters>>;
  /** Tenant multipliers per seasonal kind, replacing the defaults. */
  multipliers: Partial<Record<SeasonKind, number>>;
  /** Tenant-defined seasonal periods: local festivals, a mall's sale week. */
  customSeasons: SeasonalEvent[];
  /** Whether to use the supplier's lead time when an item has a default supplier. */
  useSupplierLeadTime: boolean;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

const forecastSettings = documentStore<ForecastSettings>("forecast-settings", () => ({
  key: "forecast",
  defaults: DEFAULT_REORDER_PARAMETERS,
  items: {},
  multipliers: { ...DEFAULT_MULTIPLIERS },
  customSeasons: [],
  useSupplierLeadTime: true,
  updatedAt: null,
  updatedBy: null,
}));

const demandEvents = localCollection<DemandEvent>(
  {
    name: "demand-events",
    idOf: (row) => row.id,
    search: (row) => [row.name],
    sorters: { from: (row) => row.from },
    factory: (input, id) => ({ ...(input as DemandEvent), id }),
  },
  tenant,
);

// ---------------------------------------------------------------------------
// FR-INV-026 — expiry write-off at day close
// ---------------------------------------------------------------------------

export interface ExpiryWriteOffPolicy {
  key: "expiry-writeoff";
  /** Category (as the item master names it, English key) → enabled. */
  categories: Record<string, boolean>;
  /** Categories not listed follow this. */
  defaultEnabled: boolean;
  /** Reason code the waste records carry — "expired" per the SRS. */
  reasonCode: string;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

export interface ExpiryWriteOffRunLine {
  batchId: Id;
  batchNumber: string;
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  quantity: string;
  unit: string;
  valueMinor: number;
  outcome: "posted" | "failed" | "skipped";
  message: string | null;
}

export interface ExpiryWriteOffRun {
  id: Id;
  businessDay: IsoDate;
  ranAt: IsoDateTime;
  ranBy: string | null;
  lines: ExpiryWriteOffRunLine[];
}

const expiryPolicy = documentStore<ExpiryWriteOffPolicy>("expiry-writeoff-policy", () => ({
  key: "expiry-writeoff",
  categories: {},
  defaultEnabled: false,
  reasonCode: "expired",
  updatedAt: null,
  updatedBy: null,
}));

const expiryRuns = localCollection<ExpiryWriteOffRun>(
  {
    name: "expiry-writeoff-runs",
    idOf: (row) => row.id,
    sorters: { ranAt: (row) => row.ranAt },
    factory: (input, id) => ({ ...(input as ExpiryWriteOffRun), id }),
  },
  tenant,
);

export function writeOffEnabledFor(policy: ExpiryWriteOffPolicy, category: string): boolean {
  return policy.categories[category] ?? policy.defaultEnabled;
}

// ---------------------------------------------------------------------------
// FR-INV-061 / FR-BRN-017 — detection policies
// ---------------------------------------------------------------------------

export interface DetectionSettings {
  key: "detection";
  waste: WasteAnomalyPolicy;
  transfers: TransferSuggestionPolicy;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

const detection = documentStore<DetectionSettings>("inventory-detection", () => ({
  key: "detection",
  waste: DEFAULT_WASTE_ANOMALY_POLICY,
  transfers: DEFAULT_TRANSFER_SUGGESTION_POLICY,
  updatedAt: null,
  updatedBy: null,
}));

// ---------------------------------------------------------------------------
// FR-INV-056 — waste photographs
// ---------------------------------------------------------------------------

export interface WastePhoto {
  recordId: Id;
  /** A downscaled JPEG data URL — photographs are evidence, not archives. */
  dataUrl: string;
  fileName: string;
  capturedAt: IsoDateTime;
  capturedBy: string | null;
}

const wastePhotos = localCollection<WastePhoto>(
  { name: "waste-photos", idOf: (row) => row.recordId, factory: (input) => input as WastePhoto },
  tenant,
);

/** Largest data URL kept, so a few photos cannot exhaust local storage. */
export const MAX_PHOTO_BYTES = 350_000;

// ---------------------------------------------------------------------------
// FR-INV-051 — reconciliation runs
// ---------------------------------------------------------------------------

export interface ReconciliationRun {
  id: Id;
  source: "server" | "browser";
  ranAt: IsoDateTime;
  ranBy: string | null;
  reconciled: boolean;
  pairsChecked: number;
  divergences: number;
  itemsRead: number;
  failures: number;
}

const reconciliationRuns = localCollection<ReconciliationRun>(
  {
    name: "reconciliation-runs",
    idOf: (row) => row.id,
    sorters: { ranAt: (row) => row.ranAt },
    factory: (input, id) => ({ ...(input as ReconciliationRun), id }),
  },
  tenant,
);

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface InventoryControlService {
  storage: {
    get(locationId: Id): Promise<StorageLayout>;
    all(): Promise<StorageLayout[]>;
    save(layout: StorageLayout): Promise<StorageLayout>;
  };
  cycle: {
    settings(): Promise<CycleSettings>;
    saveSettings(next: CycleSettings): Promise<CycleSettings>;
    starts(): Promise<CycleCountStart[]>;
    recordStart(input: Omit<CycleCountStart, "id">): Promise<CycleCountStart>;
  };
  forecast: {
    settings(): Promise<ForecastSettings>;
    saveSettings(next: ForecastSettings): Promise<ForecastSettings>;
    events(): Promise<DemandEvent[]>;
    saveEvent(event: DemandEvent): Promise<DemandEvent>;
    removeEvent(id: Id): Promise<void>;
  };
  expiry: {
    policy(): Promise<ExpiryWriteOffPolicy>;
    savePolicy(next: ExpiryWriteOffPolicy): Promise<ExpiryWriteOffPolicy>;
    runs(): Promise<ExpiryWriteOffRun[]>;
    recordRun(run: Omit<ExpiryWriteOffRun, "id">): Promise<ExpiryWriteOffRun>;
  };
  detection: {
    settings(): Promise<DetectionSettings>;
    saveSettings(next: DetectionSettings): Promise<DetectionSettings>;
  };
  photos: {
    get(recordId: Id): Promise<WastePhoto | null>;
    save(photo: WastePhoto): Promise<WastePhoto>;
    remove(recordId: Id): Promise<void>;
  };
  reconciliation: {
    runs(): Promise<ReconciliationRun[]>;
    record(run: Omit<ReconciliationRun, "id">): Promise<ReconciliationRun>;
  };
}

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ServiceError("VALIDATION", `${label} must be more than zero.`, 400);
  }
}

function validateReorder(parameters: Partial<ReorderParameters>, label: string) {
  if (parameters.lookbackDays !== undefined) positive(parameters.lookbackDays, `${label}: lookback`);
  if (parameters.leadTimeDays !== undefined && (!Number.isFinite(parameters.leadTimeDays) || parameters.leadTimeDays < 0)) {
    throw new ServiceError("VALIDATION", `${label}: lead time cannot be negative.`, 400);
  }
  if (parameters.reviewPeriodDays !== undefined) positive(parameters.reviewPeriodDays, `${label}: review period`);
  if (parameters.serviceLevel !== undefined && !(parameters.serviceLevel >= 0.5 && parameters.serviceLevel < 1)) {
    throw new ServiceError("VALIDATION", `${label}: service level must be between 50% and 99.9%.`, 400);
  }
  if (parameters.packSize !== undefined && parameters.packSize !== null) positive(parameters.packSize, `${label}: pack size`);
}

export const inventoryControlService: InventoryControlService = {
  storage: {
    async get(locationId) {
      return (await layouts.get(locationId)) ?? emptyLayout(locationId);
    },
    async all() {
      return layouts.all();
    },
    async save(layout) {
      const codes = new Set<string>();
      for (const area of layout.areas) {
        if (!area.name.en.trim() && !area.name.ar.trim()) {
          throw new ServiceError("VALIDATION", "Every storage area needs a name.", 400);
        }
        const code = area.code.trim().toUpperCase();
        if (!code) throw new ServiceError("VALIDATION", "Every storage area needs a short code.", 400);
        if (codes.has(code)) throw new ServiceError("VALIDATION", `The code ${code} is used twice.`, 400);
        codes.add(code);
      }
      const areaIds = new Set(layout.areas.map((area) => area.id));
      // A slot in an area that was deleted would silently drop off the walk.
      const slots = Object.fromEntries(Object.entries(layout.slots).filter(([, slot]) => areaIds.has(slot.areaId)));
      const next: StorageLayout = {
        ...layout,
        areas: layout.areas.map((area) => ({ ...area, code: area.code.trim().toUpperCase() })),
        slots,
        updatedAt: nowIso(),
      };
      const existing = await layouts.get(layout.locationId);
      return existing ? layouts.update(layout.locationId, next) : layouts.create(next);
    },
  },

  cycle: {
    settings: () => cycleSettings.read(),
    async saveSettings(next) {
      const { frequencyDays, aValueShare, bValueShare, maxLinesPerCount, highVariancePercent } = next.policy;
      for (const value of Object.values(frequencyDays)) positive(value, "Count frequency");
      if (!(aValueShare > 0 && aValueShare < bValueShare && bValueShare < 100)) {
        throw new ServiceError("VALIDATION", "Class A's value share must be below class B's, and both below 100%.", 400);
      }
      if (!(frequencyDays.A <= frequencyDays.B && frequencyDays.B <= frequencyDays.C)) {
        throw new ServiceError("VALIDATION", "Class A must be counted at least as often as B, and B as often as C.", 400);
      }
      positive(maxLinesPerCount, "Lines per count");
      if (!(highVariancePercent >= 0)) throw new ServiceError("VALIDATION", "The variance threshold cannot be negative.", 400);
      return cycleSettings.write({ ...next, updatedAt: nowIso() });
    },
    starts: () => cycleStarts.all(),
    recordStart: (input) => cycleStarts.create(input),
  },

  forecast: {
    settings: () => forecastSettings.read(),
    async saveSettings(next) {
      validateReorder(next.defaults, "Defaults");
      for (const [itemId, overrides] of Object.entries(next.items)) validateReorder(overrides, `Item ${itemId}`);
      for (const [kind, value] of Object.entries(next.multipliers)) {
        if (typeof value === "number" && !(value > 0 && value <= 10)) {
          throw new ServiceError("VALIDATION", `The ${kind} multiplier must be between 0 and 10.`, 400);
        }
      }
      for (const season of next.customSeasons) {
        if (!season.from || !season.to || season.to < season.from) {
          throw new ServiceError("VALIDATION", "A seasonal period must end on or after it starts.", 400);
        }
        if (!(season.multiplier > 0 && season.multiplier <= 10)) {
          throw new ServiceError("VALIDATION", "A seasonal multiplier must be between 0 and 10.", 400);
        }
      }
      return forecastSettings.write({ ...next, updatedAt: nowIso() });
    },
    events: () => demandEvents.all(),
    async saveEvent(event) {
      if (!event.name.trim()) throw new ServiceError("VALIDATION", "Name the event.", 400);
      if (!event.from || !event.to || event.to < event.from) {
        throw new ServiceError("VALIDATION", "The event must end on or after it starts.", 400);
      }
      const hasLines = event.lines.some((line) => Number(line.quantity) > 0);
      const hasUplift = event.upliftPercent !== null && event.upliftPercent !== 0;
      if (!hasLines && !hasUplift) {
        throw new ServiceError("VALIDATION", "Add item quantities or an uplift — otherwise the event changes nothing.", 400);
      }
      if (event.upliftPercent !== null && !(event.upliftPercent > -100 && event.upliftPercent <= 1000)) {
        throw new ServiceError("VALIDATION", "The uplift must be above −100% and at most 1000%.", 400);
      }
      const clean = { ...event, name: event.name.trim(), lines: event.lines.filter((line) => Number(line.quantity) > 0) };
      const existing = event.id ? await demandEvents.get(event.id) : null;
      return existing ? demandEvents.update(event.id, clean) : demandEvents.create(clean);
    },
    removeEvent: (id) => demandEvents.remove(id),
  },

  expiry: {
    policy: () => expiryPolicy.read(),
    async savePolicy(next) {
      if (!next.reasonCode.trim()) throw new ServiceError("VALIDATION", "Choose the reason code write-offs carry.", 400);
      return expiryPolicy.write({ ...next, updatedAt: nowIso() });
    },
    runs: () => expiryRuns.all(),
    recordRun: (run) => expiryRuns.create(run),
  },

  detection: {
    settings: () => detection.read(),
    async saveSettings(next) {
      positive(next.waste.sigma, "Sigma");
      positive(next.waste.minRecords, "Minimum records");
      positive(next.waste.minPeers, "Minimum peers");
      if (!(next.waste.shiftConcentration > 0 && next.waste.shiftConcentration <= 1)) {
        throw new ServiceError("VALIDATION", "Shift concentration must be between 1% and 100%.", 400);
      }
      positive(next.transfers.horizonDays, "Horizon");
      if (next.transfers.transitDays < 0) throw new ServiceError("VALIDATION", "Transit days cannot be negative.", 400);
      return detection.write({ ...next, updatedAt: nowIso() });
    },
  },

  photos: {
    get: (recordId) => wastePhotos.get(recordId),
    async save(photo) {
      if (photo.dataUrl.length > MAX_PHOTO_BYTES) {
        throw new ServiceError("VALIDATION", "That photograph is too large to keep on this device.", 400);
      }
      const existing = await wastePhotos.get(photo.recordId);
      return existing ? wastePhotos.update(photo.recordId, photo) : wastePhotos.create(photo);
    },
    remove: (recordId) => wastePhotos.remove(recordId),
  },

  reconciliation: {
    runs: () => reconciliationRuns.all(),
    record: (run) => reconciliationRuns.create(run),
  },
};
