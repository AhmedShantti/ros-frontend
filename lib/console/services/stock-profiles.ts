"use client";

/**
 * The rest of the stock item master — FR-INV-001, FR-INV-003 … FR-INV-005.
 *
 * `POST /inventory/items` takes the core of an item (SKU, names, base unit,
 * costing, tracking flags, shelf life, standard cost) and the backend has no
 * PATCH for it afterwards. Everything else the SRS lists for the master —
 * purchase units with their own conversions, supplier codes, barcodes,
 * allergens, density, account code, min/max per location — has no field on
 * the server at all.
 *
 * So those attributes live here, keyed by stock item id, behind an interface
 * a server implementation can take over. The reorder point and quantity are
 * the exception: `POST /inventory/items/{id}/reorder-config` is real, and the
 * editor writes those through `services.inventory.setReorderConfig`.
 */

import type { Id, IsoDateTime, UnitCode } from "../types";
import type { BarcodeKind } from "../stock-units";
import { localCollection, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export interface PurchaseUnit {
  id: Id;
  /** The word on the delivery note: case, pack, kg. */
  unit: UnitCode;
  /** How many base units one of these holds, as a decimal string. */
  conversion: string;
  supplierId: Id | null;
  /** FR-INV-005 — the supplier's own code for this item. */
  supplierCode: string;
  isDefault: boolean;
}

export interface ItemBarcode {
  id: Id;
  code: string;
  kind: BarcodeKind;
  /** Whose barcode it is — null for the item's own. */
  supplierId: Id | null;
  /** Which purchase unit it identifies, when it is a case barcode. */
  purchaseUnitId: Id | null;
}

export interface LocationPolicy {
  locationId: Id;
  minimum: string;
  maximum: string;
  /**
   * The last reorder point and quantity written through the real
   * reorder-config endpoint, mirrored so the form can show them back — the
   * levels projection does not always carry them.
   */
  reorderPoint: string;
  reorderQuantity: string;
}

export interface StockItemProfile {
  itemId: Id;
  /** FR-INV-001 — hierarchical, e.g. ["Food", "Protein", "Poultry"]. */
  categoryPath: string[];
  recipeUnit: UnitCode | null;
  purchaseUnits: PurchaseUnit[];
  barcodes: ItemBarcode[];
  allergens: string[];
  /** FR-INV-004 — grams per millilitre; null means mass↔volume is refused. */
  densityGPerMl: string | null;
  accountCode: string;
  sellableDirectly: boolean;
  produced: boolean;
  shelfLifeBasis: "receipt" | "production";
  batchStrategy: "fifo" | "fefo";
  locationPolicies: LocationPolicy[];
  updatedAt: IsoDateTime;
  updatedBy: string | null;
}

export function emptyProfile(itemId: Id): StockItemProfile {
  return {
    itemId,
    categoryPath: [],
    recipeUnit: null,
    purchaseUnits: [],
    barcodes: [],
    allergens: [],
    densityGPerMl: null,
    accountCode: "",
    sellableDirectly: false,
    produced: false,
    shelfLifeBasis: "receipt",
    batchStrategy: "fefo",
    locationPolicies: [],
    updatedAt: nowIso(),
    updatedBy: null,
  };
}

export function newPurchaseUnit(): PurchaseUnit {
  return { id: localId("pu"), unit: "case", conversion: "", supplierId: null, supplierCode: "", isDefault: false };
}

export function newBarcode(code = ""): ItemBarcode {
  return { id: localId("bc"), code, kind: "ean13", supplierId: null, purchaseUnitId: null };
}

const store = localCollection<StockItemProfile>(
  {
    name: "stock-item-profiles",
    idOf: (row) => row.itemId,
    factory: (input) => ({ ...emptyProfile(input.itemId ?? ""), ...input }) as StockItemProfile,
  },
  () => getActiveTenantId(),
);

export interface StockProfileService {
  get(itemId: Id): Promise<StockItemProfile>;
  all(): Promise<StockItemProfile[]>;
  save(profile: StockItemProfile): Promise<StockItemProfile>;
  /** Which item, if any, already carries this barcode — FR-INV-005 matching. */
  findByBarcode(code: string): Promise<{ itemId: Id; barcode: ItemBarcode } | null>;
}

export const stockProfileService: StockProfileService = {
  async get(itemId) {
    return (await store.get(itemId)) ?? emptyProfile(itemId);
  },

  async all() {
    return store.all();
  },

  async save(profile) {
    // A barcode identifies exactly one item in the tenant; a scanner that
    // could resolve to two is a scanner that will one day pick the wrong one.
    const others = (await store.all()).filter((row) => row.itemId !== profile.itemId);
    for (const barcode of profile.barcodes) {
      const clash = others.find((row) => row.barcodes.some((entry) => entry.code === barcode.code.trim()));
      if (clash) {
        throw new ServiceError(
          "CONFLICT",
          `Barcode ${barcode.code} already belongs to another item.`,
          409,
          clash.itemId,
        );
      }
    }
    const defaults = profile.purchaseUnits.filter((row) => row.isDefault).length;
    if (defaults > 1) {
      throw new ServiceError("VALIDATION", "Only one purchase unit can be the default.", 400);
    }

    const next: StockItemProfile = {
      ...profile,
      barcodes: profile.barcodes.map((row) => ({ ...row, code: row.code.trim() })),
      updatedAt: nowIso(),
    };
    const existing = await store.get(profile.itemId);
    return existing ? store.update(profile.itemId, next) : store.create(next);
  },

  async findByBarcode(code) {
    const needle = code.trim();
    for (const row of await store.all()) {
      const barcode = row.barcodes.find((entry) => entry.code === needle);
      if (barcode) return { itemId: row.itemId, barcode };
    }
    return null;
  },
};
