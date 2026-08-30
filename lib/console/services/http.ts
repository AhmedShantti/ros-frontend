/**
 * The `ServiceRegistry`, implemented against the ROS backend.
 *
 * This is the file `lib/console/services/index.ts` swaps in when
 * `NEXT_PUBLIC_API_URL` is set. Nothing above it changes: pages still call
 * `services.inventory.items.list(query)` and still get a `Page<StockItem>`.
 *
 * ## What is live and what is not
 *
 * The document at `api/openapi.json` is explicit that it describes only the
 * implemented surface — Fire, Payment, Completion, KDS bump/recall and the
 * whole of purchasing, workforce and finance are absent from the backend,
 * not merely undocumented. Those domains keep their demo data so the console
 * still runs end to end; `API_COVERAGE` below records exactly which, and
 * a one-time console warning names them at start-up. Nothing silently mixes
 * invented rows into a domain the backend does serve.
 *
 * ## Shape mismatches
 *
 * Most list endpoints answer with a plain array — no envelope, no search, no
 * sort. `project()` applies the toolbar's query client-side. `GET /orders`
 * is the exception: it is a real keyset cursor and is driven as one.
 *
 * ## Fan-out
 *
 * A few console screens want a shape the API spreads over several calls: a
 * menu item's variants, a category's menu, a branch's tables. Rather than
 * fetch every join for every row of a list, `list()` returns what one call
 * gives and `get()` fills the detail in. Lookup tables that every mapper
 * needs — branches, locations, stock items — are cached for a few seconds.
 */

import { api } from "@/lib/api/endpoints";
import { getTenantId } from "@/lib/api/session";
import { ulid } from "@/lib/api/ulid";
import type * as S from "@/lib/api/schema";

import type {
  Batch,
  Branch,
  Brand,
  CentralKitchen,
  CountSession,
  Id,
  Menu,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  Order,
  PriceList,
  Recipe,
  Role,
  StockAdjustment,
  StockItem,
  StockLevel,
  StockLocation,
  StockMovement,
  Tenant,
  Transfer,
  Warehouse,
  WasteRecord,
} from "../types";

import type {
  CatalogueService,
  CollectionService,
  InventoryService,
  OperationsService,
  OrganisationService,
  ReadonlyCollectionService,
  SalesService,
  Scope,
  ScopedQuery,
  SecurityService,
  ServiceRegistry,
} from "./types";
import { ServiceError } from "./types";
import { emptyPage, project } from "./paging";
import { mockServices } from "./mock";
import * as map from "./map";

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Which registry members reach the API, and which are still demo data.
 *
 * Every one of the document's 142 operations is reachable through this
 * registry. What remains under `demo` is not unfinished wiring — it is the
 * set of domains the backend does not implement at all, and inventing rows
 * for them here would be worse than saying so.
 */
export const API_COVERAGE = {
  live: [
    "organisation.tenants",
    "organisation.brands",
    "organisation.branches",
    "organisation.warehouses",
    "organisation.centralKitchens",
    "organisation.locations",
    "organisation.reassignBranchBrand",
    "organisation.operatingHours",
    "organisation.printRouting",
    "organisation.stationRoutingRules",
    "organisation.station",
    "catalogue.categories",
    "catalogue.items",
    "catalogue.menus",
    "catalogue.modifierGroups",
    "catalogue.priceLists",
    "catalogue.recipes",
    "catalogue.toggleAvailability",
    "catalogue.assignMenuToBranch",
    "catalogue.resolveBranchMenus",
    "catalogue.placeItem",
    "catalogue.addVariant",
    "catalogue.setVariantActive",
    "catalogue.linkModifierGroup",
    "catalogue.addModifier",
    "catalogue.setPrice",
    "catalogue.priceEntries",
    "catalogue.completeness",
    "inventory.items",
    "inventory.levels",
    "inventory.batches",
    "inventory.movements",
    "inventory.waste",
    "inventory.counts",
    "inventory.transfers",
    "inventory.recordCount",
    "inventory.receiveTransfer",
    "inventory.setReorderConfig",
    "inventory.reasonCodes",
    "inventory.lowStock",
    "inventory.negativeStock",
    "inventory.reconciliation",
    "production.versions",
    "production.publishVersion",
    "production.requiringCompletion",
    "production.substituteGroups",
    "production.modifierRecipeEffects",
    "sales.orders",
    "sales.mutations",
    "treasury.openCashSession",
    "treasury.recordMovement",
    "treasury.closeContext",
    "treasury.declareClose",
    "treasury.finalizeClose",
    "treasury.setCashClosePolicy",
    "operations.openOrders",
    "operations.terminals",
    "operations.stations",
    "operations.tables",
    "operations.setTerminalStatus",
    "operations.createTable",
    "operations.createStation",
    "security.roles",
    "security.memberships",
    "security.assignRole",
  ],
  /** No endpoint exists in the document — these still serve demo data. */
  demo: [
    "dashboard",
    "costing",
    "purchasing",
    "workforce",
    // Expenses, day-close and the tender/tax summaries have no endpoint.
    // The drawer itself does — see the `treasury.*` entries above.
    "finance",
    "governance",
    "platform",
    "catalogue.combos",
    "inventory.adjustments",
    "operations.kitchenQueue",
    "security.users",
  ],
} as const;

let warned = false;

function announceCoverage(): void {
  if (warned || typeof window === "undefined") return;
  warned = true;
  // eslint-disable-next-line no-console
  console.info(
    `[ROS] Live API for ${API_COVERAGE.live.length} services. Still demo data ` +
      `(no endpoint in api/openapi.json): ${API_COVERAGE.demo.join(", ")}.`,
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function tenantOf(query?: ScopedQuery | Scope): Id {
  const scope = query && "scope" in query ? query.scope : (query as Scope | undefined);
  return scope?.tenantId ?? getTenantId() ?? "";
}

function notImplemented(what: string): never {
  throw new ServiceError(
    "NOT_IMPLEMENTED",
    "The backend does not offer that yet.",
    501,
    `${what} has no endpoint in api/openapi.json.`,
  );
}

/** A short-lived memo for the lookup tables every mapper needs. */
function cached<T>(load: () => Promise<T>, ttlMs = 20_000) {
  let value: Promise<T> | null = null;
  let at = 0;

  const read = () => {
    if (!value || Date.now() - at > ttlMs) {
      at = Date.now();
      value = load().catch((error: unknown) => {
        // A failed lookup must not poison the cache for the next attempt.
        value = null;
        throw error;
      });
    }
    return value;
  };

  read.invalidate = () => {
    value = null;
  };

  return read;
}

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [key(row), row]));
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const branchesRaw = cached(() => api.organisation.listBranches());
const warehousesRaw = cached(() => api.organisation.listWarehouses());
const stockItemsRaw = cached(() => api.inventory.listItems());
const menusRaw = cached(() => api.catalogue.listMenus());
const menuItemsRaw = cached(() => api.catalogue.listItems());
const reasonCodesRaw = cached(() => api.inventory.listReasonCodes());
const availabilityRaw = cached(() => api.catalogue.listAvailabilityRules(), 5_000);

/** Every place stock can sit: warehouses, central kitchens, and branches. */
const locations = cached(async (): Promise<StockLocation[]> => {
  const tenantId = getTenantId() ?? "";
  const [branches, warehouses] = await Promise.all([branchesRaw(), warehousesRaw()]);
  return [
    ...warehouses.map(map.warehouseLocation),
    ...branches.map((row) => map.branchLocation(map.toBranch(row, tenantId))),
  ];
});

const locationIndex = async () => indexBy(await locations(), (row) => row.id);

const stockItemIndex = cached(async () => {
  const tenantId = getTenantId() ?? "";
  const rows = await stockItemsRaw();
  return indexBy(
    rows.map((row) => map.toStockItem(row, tenantId)),
    (row) => row.id,
  );
});

const branchIndex = cached(async () => {
  const tenantId = getTenantId() ?? "";
  return indexBy(
    (await branchesRaw()).map((row) => map.toBranch(row, tenantId)),
    (row) => row.id,
  );
});

/** Manual 86s, keyed by the item they take off the menu (FR-MNU-030). */
const eightySixIndex = cached(async () => {
  const rules = await availabilityRaw();
  const out = new Map<Id, string>();
  for (const rule of rules) {
    if (!rule.isManual86 || !rule.menuItemId) continue;
    out.set(rule.menuItemId, rule.autoReenableAt ? `Until ${rule.autoReenableAt}` : "Marked 86");
  }
  return out;
}, 5_000);

function invalidateCatalogue(): void {
  menuItemsRaw.invalidate();
  menusRaw.invalidate();
  availabilityRaw.invalidate();
  eightySixIndex.invalidate();
}

function invalidateOrg(): void {
  branchesRaw.invalidate();
  warehousesRaw.invalidate();
  branchIndex.invalidate();
  locations.invalidate();
}

function invalidateInventory(): void {
  stockItemsRaw.invalidate();
  stockItemIndex.invalidate();
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

const tenants: ReadonlyCollectionService<Tenant> = {
  async list(query = {}) {
    const [memberships, brands, branches] = await Promise.all([
      api.tenants.listTenants(),
      api.organisation.listBrands().catch(() => []),
      branchesRaw().catch(() => []),
    ]);

    const rows = memberships.map((membership) => {
      const tenant = map.toTenant(membership);
      // Counts only mean anything for the tenant whose token we hold.
      if (tenant.id === getTenantId()) {
        tenant.brandCount = brands.length;
        tenant.branchCount = branches.length;
      }
      return tenant;
    });

    return project(rows, query, {
      search: (row) => [row.name, row.slug],
      filters: { state: (row) => row.state },
      sorters: { name: (row) => row.name.en, branchCount: (row) => row.branchCount },
    });
  },

  async get(id) {
    const page = await tenants.list({ limit: 1000 });
    return page.rows.find((row) => row.id === id) ?? null;
  },
};

const brands: CollectionService<Brand> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const [rows, branches] = await Promise.all([
      api.organisation.listBrands(),
      branchesRaw().catch(() => []),
    ]);

    const perBrand = new Map<Id, number>();
    for (const branch of branches) {
      perBrand.set(branch.brandId, (perBrand.get(branch.brandId) ?? 0) + 1);
    }

    const mapped = rows.map((row) => map.toBrand(row, tenantId, perBrand.get(row.id) ?? 0));

    return project(mapped, query, {
      search: (row) => [row.name, row.code],
      brandOf: (row) => row.id,
      filters: { active: (row) => row.active },
      sorters: { name: (row) => row.name.en, branchCount: (row) => row.branchCount },
    });
  },

  async get(id) {
    const row = await api.organisation.getBrand(id);
    return map.toBrand(row, getTenantId() ?? "");
  },

  async create(input) {
    const row = await api.organisation.createBrand({
      name: map.toPlainName(input.name, "New brand"),
      theme: input.colour ? { colour: input.colour, code: input.code } : undefined,
    });
    return map.toBrand(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    const row = await api.organisation.updateBrand(id, {
      name: patch.name ? map.toPlainName(patch.name) : undefined,
      theme: patch.colour ? { colour: patch.colour, code: patch.code } : undefined,
    });
    return map.toBrand(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a brand");
  },
};

const branches: CollectionService<Branch> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = (await branchesRaw()).map((row) => map.toBranch(row, tenantId));

    return project(rows, query, {
      search: (row) => [row.name, row.code, row.address],
      branchOf: (row) => row.id,
      brandOf: (row) => row.brandId,
      filters: { active: (row) => row.active, brandId: (row) => row.brandId },
      sorters: { name: (row) => row.name.en, code: (row) => row.code, seats: (row) => row.seats },
    });
  },

  async get(id) {
    const row = await api.organisation.getBranch(id);
    return map.toBranch(row, getTenantId() ?? "");
  },

  async create(input) {
    if (!input.brandId) {
      throw new ServiceError("BAD_REQUEST", "Choose a brand for the branch.", 400);
    }
    const row = await api.organisation.createBranch({
      brandId: input.brandId,
      code: input.code ?? "NEW",
      name: map.toPlainName(input.name, "New branch"),
      timezone: input.timezone ?? "Africa/Cairo",
      baseCurrency: input.currency ?? map.getDefaultCurrency(),
      countryCode: input.countryCode ?? "EG",
    });
    invalidateOrg();
    return map.toBranch(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    const row = await api.organisation.updateBranch(id, {
      name: patch.name ? map.toPlainName(patch.name) : undefined,
      timezone: patch.timezone,
      baseCurrency: patch.currency,
      countryCode: patch.countryCode,
    });

    // `active` is its own endpoint, not a field on the update DTO.
    if (patch.active !== undefined) {
      await api.organisation.setBranchStatus(id, {
        status: patch.active ? "active" : "inactive",
      });
    }

    invalidateOrg();
    return map.toBranch(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a branch (deactivate it instead)");
  },
};

const warehouses: CollectionService<Warehouse> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = (await warehousesRaw()).map((row) => map.toWarehouse(row, tenantId));

    return project(rows, query, {
      search: (row) => [row.name, row.code],
      branchOf: (row) => row.attachedBranchId,
      filters: { active: (row) => row.active },
      sorters: { name: (row) => row.name.en },
    });
  },

  async get(id) {
    const row = await api.organisation.getWarehouse(id);
    return map.toWarehouse(row, getTenantId() ?? "");
  },

  async create(input) {
    const row = await api.organisation.createWarehouse({
      name: map.toPlainName(input.name, "New warehouse"),
      branchId: input.attachedBranchId ?? undefined,
      // Honour an explicit choice; fall back to inferring from the branch
      // only when the caller did not state one.
      warehouseType: input.warehouseType ?? (input.attachedBranchId ? "branch" : "central"),
    });
    invalidateOrg();
    return map.toWarehouse(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    const row = await api.organisation.updateWarehouse(id, {
      name: patch.name ? map.toPlainName(patch.name) : undefined,
    });
    invalidateOrg();
    return map.toWarehouse(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a warehouse");
  },
};

const centralKitchens: CollectionService<CentralKitchen> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = (await api.organisation.listCentralKitchens()).map((row) =>
      map.toCentralKitchen(row, tenantId),
    );
    return project(rows, query, {
      search: (row) => [row.name, row.code],
      sorters: { name: (row) => row.name.en },
    });
  },

  async get(id) {
    const row = await api.organisation.getCentralKitchen(id);
    return map.toCentralKitchen(row, getTenantId() ?? "");
  },

  async create(input) {
    const warehouseId = (input as { warehouseId?: Id }).warehouseId;
    if (!warehouseId) {
      throw new ServiceError(
        "BAD_REQUEST",
        "A central kitchen needs the warehouse that holds its stock.",
        400,
      );
    }
    const row = await api.organisation.createCentralKitchen({
      name: map.toPlainName(input.name, "New central kitchen"),
      warehouseId,
    });
    return map.toCentralKitchen(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    const row = await api.organisation.updateCentralKitchen(id, {
      name: patch.name ? map.toPlainName(patch.name) : undefined,
    });
    return map.toCentralKitchen(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a central kitchen");
  },
};

const organisation: OrganisationService = {
  tenants,
  brands,
  branches,
  warehouses,
  centralKitchens,
  locations: () => locations(),

  async reassignBranchBrand(branchId, brandId) {
    await api.organisation.reassignBranchBrand(branchId, { brandId });
    invalidateOrg();
  },

  // -- Branch configuration --------------------------------------------------

  async operatingHours(branchId) {
    const rows = await api.organisation.listOperatingHours(branchId);
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      businessDayCutover: row.businessDayCutover,
      overnight: row.overnight,
    }));
  },

  async addOperatingHours(branchId, input) {
    const row = await api.organisation.createOperatingHours(branchId, {
      dayOfWeek: input.dayOfWeek,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      businessDayCutover: input.businessDayCutover,
    });
    return {
      id: row.id,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      businessDayCutover: row.businessDayCutover,
      overnight: row.overnight,
    };
  },

  async printRouting(branchId) {
    const rows = await api.organisation.listPrintRouting(branchId);
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      documentType: row.documentType,
      printerTarget: row.printerTarget,
      stationId: row.stationId,
    }));
  },

  async addPrintRouting(branchId, input) {
    const row = await api.organisation.createPrintRouting(branchId, {
      documentType: input.documentType,
      printerTarget: input.printerTarget,
      stationId: input.stationId,
    });
    return {
      id: row.id,
      branchId: row.branchId,
      documentType: row.documentType,
      printerTarget: row.printerTarget,
      stationId: row.stationId,
    };
  },

  async stationRoutingRules(branchId) {
    const rows = await api.organisation.listStationRoutingRules(branchId);
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      stationId: row.stationId,
      categoryId: row.categoryId,
      menuItemId: row.menuItemId,
      modifierId: row.modifierId,
      priority: row.priority,
    }));
  },

  async addStationRoutingRule(branchId, input) {
    const row = await api.organisation.createStationRoutingRule(branchId, {
      stationId: input.stationId,
      categoryId: input.categoryId,
      menuItemId: input.menuItemId,
      modifierId: input.modifierId,
      priority: input.priority,
    });
    return {
      id: row.id,
      branchId: row.branchId,
      stationId: row.stationId,
      categoryId: row.categoryId,
      menuItemId: row.menuItemId,
      modifierId: row.modifierId,
      priority: row.priority,
    };
  },

  async station(stationId) {
    return map.toStation(await api.organisation.getStation(stationId));
  },
};

// ---------------------------------------------------------------------------
// Production — recipe versions and substitute groups (SRS ch.17, §26.3)
// ---------------------------------------------------------------------------

/** Wire recipe-version rows carry ids only; names are joined in from stock. */
async function toRecipeVersion(
  row: S.ProductionController_listVersionsResponse[number],
  recipeId: Id,
): Promise<import("./types").RecipeVersion> {
  const items = await stockItemIndex().catch(() => new Map<Id, StockItem>());

  return {
    id: row.id,
    recipeId,
    version: row.version,
    status: row.status,
    yieldQuantity: map.quantity(row.yieldQuantity, row.yieldUnitId),
    yieldPercentage: Number(row.yieldPercentage ?? "100"),
    prepTimeSeconds: row.prepTimeSeconds ?? 0,
    instructions: map.localised(row.instructions),
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt,
    publishedBy: row.publishedBy ?? null,
    lines: (row.lines ?? []).map((line) => {
      const item = line.stockItemId ? items.get(line.stockItemId) : undefined;
      return {
        id: line.id,
        sequence: line.sequence,
        componentType: line.componentType,
        componentId: line.stockItemId ?? line.subRecipeId ?? "",
        componentName: item?.name ?? {
          en: line.subRecipeId ? "Sub-recipe" : (line.stockItemId ?? "—"),
          ar: line.subRecipeId ? "وصفة فرعية" : (line.stockItemId ?? "—"),
        },
        quantity: map.quantity(line.quantity, line.unitId),
        wastagePercentage: Number(line.wastagePercentage ?? "0"),
        isOptional: line.isOptional,
        // gap: D-17-05 — the API never populates per-line cost in this phase.
        unitCost: map.money("0"),
        lineCost: map.money("0"),
      };
    }),
  };
}

const production: import("./types").ProductionService = {
  async versions(recipeId) {
    const rows = await api.production.listVersions(recipeId);
    return Promise.all(rows.map((row) => toRecipeVersion(row, recipeId)));
  },

  async createVersion(recipeId, input) {
    const row = await api.production.createVersion(recipeId, {
      yieldQuantity: input.yieldQuantity,
      yieldUnitId: input.yieldUnitId,
      yieldPercentage: input.yieldPercentage,
      prepTimeSeconds: input.prepTimeSeconds,
      instructions: input.instructions ? map.toNameMap(input.instructions) : undefined,
      effectiveFrom: input.effectiveFrom,
      lines: input.lines?.map((line) => ({
        sequence: line.sequence,
        componentType: line.componentType,
        stockItemId: line.stockItemId,
        subRecipeId: line.subRecipeId,
        substituteGroupId: line.substituteGroupId,
        quantity: line.quantity,
        unitId: line.unitId,
        wastagePercentage: line.wastagePercentage,
        isOptional: line.isOptional,
      })),
    });
    return toRecipeVersion(row, recipeId);
  },

  async replaceLines(recipeId, version, lines) {
    await api.production.replaceLines(recipeId, String(version), {
      lines: lines.map((line) => ({
        sequence: line.sequence,
        componentType: line.componentType,
        stockItemId: line.stockItemId,
        subRecipeId: line.subRecipeId,
        substituteGroupId: line.substituteGroupId,
        quantity: line.quantity,
        unitId: line.unitId,
        wastagePercentage: line.wastagePercentage,
        isOptional: line.isOptional,
      })),
    });
  },

  async publishVersion(recipeId, version) {
    const result = await api.production.publish(recipeId, String(version));
    return { supersededVersionId: result.supersededVersionId ?? null };
  },

  async requiringCompletion(branchId) {
    const report = await api.production.recipesRequiringCompletion({ branchId });
    return {
      branchId: report.branchId,
      sellableVariantCount: report.sellableVariantCount,
      absentCount: report.absentCount,
      incompleteCount: report.incompleteCount,
      entries: report.entries.map((entry) => ({
        menuItemId: entry.menuItemId,
        variantId: entry.variantId,
        reason: entry.reason,
        recipeVersionId: entry.recipeVersionId,
        detail: entry.detail ?? [],
      })),
    };
  },

  async substituteGroups() {
    const rows = await api.production.listGroups();
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      memberIds: (row.members ?? []).map((member) => member.stockItemId),
    }));
  },

  async createSubstituteGroup(name, stockItemIds) {
    const row = await api.production.createGroup({ name, stockItemIds });
    return {
      id: row.id,
      tenantId: getTenantId() ?? "",
      name: row.name,
      memberIds: stockItemIds ?? [],
    };
  },

  async addSubstituteMember(groupId, stockItemId) {
    await api.production.addGroupMember(groupId, { stockItemId });
  },

  async modifierRecipeEffects(modifierId) {
    const rows = await api.production.listModifierRecipeEffects(modifierId);
    return rows.map(map.toModifierRecipeEffect);
  },

  async replaceModifierRecipeEffects(modifierId, effects) {
    const response = await api.production.replaceModifierRecipeEffects(modifierId, {
      // A `remove_all` carries no quantity and no unit; sending either is a
      // 400, so they are dropped here rather than at every call site.
      effects: effects.map((effect) => ({
        sequence: effect.sequence,
        operation: effect.operation,
        componentType: effect.componentType,
        stockItemId: effect.componentType === "stock_item" ? effect.stockItemId : undefined,
        subRecipeId: effect.componentType === "sub_recipe" ? effect.subRecipeId : undefined,
        quantity: effect.operation === "add" ? effect.quantity : undefined,
        unitId: effect.operation === "add" ? effect.unitId : undefined,
      })),
    });
    return response.effects.map(map.toModifierRecipeEffect);
  },
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Categories hang off a menu on the API, and off the tenant in the console. */
const categories: CollectionService<MenuCategory> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const menus = await menusRaw();
    const perMenu = await Promise.all(
      menus.map((menu) => api.catalogue.listCategories(menu.id).catch(() => [])),
    );

    const rows = perMenu.flat().map((row) => map.toCategory(row, tenantId));

    return project(rows, query, {
      search: (row) => [row.name],
      filters: { active: (row) => row.active, parentId: (row) => row.parentId },
      sorters: { name: (row) => row.name.en, sortOrder: (row) => row.sortOrder },
    });
  },

  async get(id) {
    const page = await categories.list({ limit: 5000 });
    return page.rows.find((row) => row.id === id) ?? null;
  },

  async create(input) {
    const menus = await menusRaw();
    const menuId = (input as { menuId?: Id }).menuId ?? menus[0]?.id;
    if (!menuId) {
      throw new ServiceError("BAD_REQUEST", "Create a menu before adding categories.", 400);
    }
    const row = await api.catalogue.createCategory(menuId, {
      name: map.toNameMap(input.name),
      colour: input.colour,
      sortOrder: input.sortOrder,
      parentCategoryId: input.parentId ?? undefined,
    });
    invalidateCatalogue();
    return map.toCategory(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    const row = await api.catalogue.updateCategory(id, {
      name: patch.name ? map.toNameMap(patch.name) : undefined,
      colour: patch.colour,
      sortOrder: patch.sortOrder,
    });
    invalidateCatalogue();
    return map.toCategory(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a category");
  },
};

/** Prices live on a price list; the console shows one price per variant. */
async function variantPrices(): Promise<Map<Id, ReturnType<typeof map.money>>> {
  const lists = await api.catalogue.listPriceLists().catch(() => []);
  const active = lists.filter((list) => list.status === "active");
  const chosen = active.length > 0 ? active : lists.slice(0, 1);

  const entries = await Promise.all(
    chosen
      .sort((a, b) => a.priority - b.priority)
      .map((list) => api.catalogue.listPriceEntries(list.id).catch(() => [])),
  );

  const out = new Map<Id, ReturnType<typeof map.money>>();
  for (const list of entries) {
    for (const entry of list) {
      // Later (higher-priority) lists win.
      out.set(entry.menuItemVariantId, map.money(entry.price, entry.currency));
    }
  }
  return out;
}

const pricesByVariant = cached(variantPrices);

const items: CollectionService<MenuItem> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const [rows, eightySix] = await Promise.all([menuItemsRaw(), eightySixIndex()]);

    const mapped = rows.map((row) =>
      map.toMenuItem(row, { tenantId, unavailableReason: eightySix.get(row.id) ?? null }),
    );

    return project(mapped, query, {
      search: (row) => [row.name, row.kitchenName, row.description],
      filters: {
        available: (row) => row.available,
        isCombo: (row) => row.isCombo,
        categoryId: (row) => row.categoryId,
      },
      sorters: {
        name: (row) => row.name.en,
        sortOrder: (row) => row.sortOrder,
      },
    });
  },

  /** The detail view is worth the extra calls the list view is not. */
  async get(id) {
    const tenantId = getTenantId() ?? "";
    const [row, variants, placements, prices, eightySix] = await Promise.all([
      api.catalogue.getItem(id),
      api.catalogue.listVariants(id).catch(() => []),
      api.catalogue.listPlacements(id).catch(() => []),
      pricesByVariant().catch(() => new Map()),
      eightySixIndex().catch(() => new Map<Id, string>()),
    ]);

    const prepTime = variants.find((variant) => variant.prepTimeSeconds)?.prepTimeSeconds ?? 0;

    return map.toMenuItem(row, {
      tenantId,
      categoryId: placements[0]?.categoryId ?? null,
      variants: variants.map((variant) => map.toVariant(variant, prices.get(variant.id) ?? null)),
      unavailableReason: eightySix.get(id) ?? null,
      prepTimeSeconds: prepTime,
    });
  },

  async create(input) {
    const row = await api.catalogue.createItem({
      names: map.toNameMap(input.name),
      kitchenNames: input.kitchenName ? map.toNameMap(input.kitchenName) : undefined,
      description: input.description ? map.toNameMap(input.description) : undefined,
      allergens: input.allergens,
      isCombo: input.isCombo,
      isOpenPrice: input.isOpenPrice,
      isWeighed: input.isWeighed,
      sortOrder: input.sortOrder,
      colour: input.colour,
    });
    invalidateCatalogue();
    return map.toMenuItem(row, { tenantId: getTenantId() ?? "" });
  },

  async update(id, patch) {
    // PATCH /catalogue/items requires `names` even when the name is not what
    // is changing, so the current record is read first and carried through.
    const current = await api.catalogue.getItem(id);

    const row = await api.catalogue.updateItem(id, {
      names: patch.name ? map.toNameMap(patch.name) : current.names,
      kitchenNames: patch.kitchenName ? map.toNameMap(patch.kitchenName) : undefined,
      description: patch.description ? map.toNameMap(patch.description) : undefined,
      allergens: patch.allergens,
      sortOrder: patch.sortOrder,
      colour: patch.colour,
    });

    if (patch.available !== undefined) {
      await api.catalogue.setItemActive(id, { isActive: patch.available });
    }

    invalidateCatalogue();
    return map.toMenuItem(row, { tenantId: getTenantId() ?? "" });
  },

  async remove(id) {
    // FR-MNU: an item that has been sold is never deleted, only deactivated.
    await api.catalogue.setItemActive(id, { isActive: false });
    invalidateCatalogue();
  },
};

const modifierGroups: CollectionService<ModifierGroup> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = await api.catalogue.listModifierGroups();
    const mapped = rows.map((row) => map.toModifierGroup(row, tenantId));

    return project(mapped, query, {
      search: (row) => [row.name],
      filters: { required: (row) => row.required },
      sorters: { name: (row) => row.name.en, modifiers: (row) => row.modifiers.length },
    });
  },

  async get(id) {
    const [groups, modifiers] = await Promise.all([
      api.catalogue.listModifierGroups(),
      api.catalogue.listModifiers(id).catch(() => []),
    ]);
    const row = groups.find((group) => group.id === id);
    if (!row) return null;
    return map.toModifierGroup(row, getTenantId() ?? "", modifiers.map(map.toModifier));
  },

  async create(input) {
    const row = await api.catalogue.createModifierGroup({
      name: map.toNameMap(input.name),
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      isRequired: input.required,
      allowRepeat: input.allowRepeat,
      freeQuantityThreshold: input.freeQuantityThreshold ?? undefined,
    });
    return map.toModifierGroup(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    // `name` is required on the PATCH, so the current one is carried through.
    const groups = await api.catalogue.listModifierGroups();
    const current = groups.find((group) => group.id === id);

    const row = await api.catalogue.updateModifierGroup(id, {
      name: patch.name ? map.toNameMap(patch.name) : (current?.name ?? {}),
      minSelections: patch.minSelections,
      maxSelections: patch.maxSelections,
      isRequired: patch.required,
      allowRepeat: patch.allowRepeat,
      freeQuantityThreshold: patch.freeQuantityThreshold ?? undefined,
    });
    return map.toModifierGroup(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a modifier group");
  },
};

const priceLists: CollectionService<PriceList> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = (await api.catalogue.listPriceLists()).map((row) => map.toPriceList(row, tenantId));

    return project(rows, query, {
      search: (row) => [row.name],
      filters: { active: (row) => row.active, scope: (row) => row.scope },
      sorters: { name: (row) => row.name.en, priority: (row) => row.priority },
    });
  },

  async get(id) {
    const tenantId = getTenantId() ?? "";
    const [row, entries, menuItems] = await Promise.all([
      api.catalogue.getPriceList(id),
      api.catalogue.listPriceEntries(id).catch(() => []),
      menuItemsRaw().catch(() => [] as S.CatalogueController_listItemsResponse),
    ]);

    // Entries key on a variant; the console shows the item's name.
    const names = indexBy(menuItems, (item) => item.id);

    return map.toPriceList(
      row,
      tenantId,
      entries.map((entry) =>
        map.toPriceEntry(entry, map.localised(names.get(entry.menuItemVariantId)?.names)),
      ),
    );
  },

  async create(input) {
    const row = await api.catalogue.createPriceList({
      name: map.toPlainName(input.name, "New price list"),
      scopeType: input.scope ?? "tenant",
      scopeId: input.scopeId ?? undefined,
      priority: input.priority,
      validFrom: input.validFrom,
      validTo: input.validTo ?? undefined,
      orderType: input.orderTypes?.[0],
    });
    return map.toPriceList(row, getTenantId() ?? "");
  },

  async update() {
    notImplemented("Editing a price list header");
  },

  async remove() {
    notImplemented("Deleting a price list");
  },
};

const recipes: CollectionService<Recipe> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const [rows, stockItems, menuItems] = await Promise.all([
      api.production.listRecipes(),
      stockItemIndex().catch(() => new Map<Id, StockItem>()),
      menuItemsRaw().catch(() => [] as S.CatalogueController_listItemsResponse),
    ]);

    const itemNames = indexBy(menuItems, (item) => item.id);

    const mapped = rows.map((row) =>
      map.toRecipe(row, {
        tenantId,
        targetName: row.stockItemId
          ? (stockItems.get(row.stockItemId)?.name ?? null)
          : map.localised(itemNames.get(row.menuItemVariantId ?? "")?.names, { en: "", ar: "" }),
      }),
    );

    return project(mapped, query, {
      search: (row) => [row.name, row.targetName],
      branchOf: (row) => (row as Recipe & { branchId?: Id }).branchId ?? null,
      filters: { recipeType: (row) => row.recipeType, status: (row) => row.status },
      sorters: { name: (row) => row.name.en, version: (row) => row.version },
    });
  },

  async get(id) {
    const tenantId = getTenantId() ?? "";
    const [rows, versions, stockItems] = await Promise.all([
      api.production.listRecipes(),
      api.production.listVersions(id).catch(() => []),
      stockItemIndex().catch(() => new Map<Id, StockItem>()),
    ]);

    const row = rows.find((recipe) => recipe.id === id);
    if (!row) return null;

    // The published version is the one that costs a sale; fall back to the
    // newest draft so a half-built recipe is still inspectable.
    const published = versions.find((version) => version.status === "published");
    const version = published ?? versions[versions.length - 1] ?? null;

    const lines = (version?.lines ?? []).map((line) =>
      map.toRecipeLine(line, stockItems.get(line.stockItemId ?? "")?.name),
    );

    return map.toRecipe(row, {
      tenantId,
      version,
      lines,
      targetName: row.stockItemId ? (stockItems.get(row.stockItemId)?.name ?? null) : null,
    });
  },

  async create(input) {
    const row = await api.production.createRecipe({
      scope: "tenant",
      recipeType: input.recipeType ?? "menu_item",
      menuItemVariantId: input.recipeType === "menu_item" ? (input.targetId ?? undefined) : undefined,
      stockItemId: input.recipeType !== "menu_item" ? (input.targetId ?? undefined) : undefined,
    });
    return map.toRecipe(row, { tenantId: getTenantId() ?? "" });
  },

  async update() {
    notImplemented("Editing a recipe in place (publish a new version instead)");
  },

  async remove() {
    notImplemented("Deleting a recipe");
  },
};

/**
 * Menus — FR-MNU-001/002/003.
 *
 * Branch assignment is a separate list per menu, so `list()` fans out one
 * call per menu to fill `branchIds`. That is the same shape the assignment
 * editor needs, and a tenant has a handful of menus, not thousands.
 */
const menus: CollectionService<Menu> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = await menusRaw();

    const branchIds = await Promise.all(
      rows.map((row) => api.catalogue.listMenuBranches(row.id).catch(() => [] as string[])),
    );

    const mapped = rows.map((row, index) => map.toMenu(row, tenantId, branchIds[index] ?? []));

    return project(mapped, query, {
      search: (row) => [row.name],
      // A menu assigned to no branch belongs to every scope, so it stays
      // visible rather than vanishing the moment a branch is picked.
      branchOf: (row) => (row.branchIds.length === 0 ? null : (row.branchIds[0] ?? null)),
      filters: { active: (row) => row.active },
      sorters: { name: (row) => row.name.en, priority: (row) => row.priority },
    });
  },

  async get(id) {
    const tenantId = getTenantId() ?? "";
    const [row, branchIds] = await Promise.all([
      api.catalogue.getMenu(id),
      api.catalogue.listMenuBranches(id).catch(() => [] as string[]),
    ]);
    return map.toMenu(row, tenantId, branchIds);
  },

  async create(input) {
    const row = await api.catalogue.createMenu({
      name: map.toNameMap(input.name),
      priority: input.priority,
      orderTypes: input.orderTypes,
    });
    invalidateCatalogue();
    return map.toMenu(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    const row = await api.catalogue.updateMenu(id, {
      name: patch.name ? map.toNameMap(patch.name) : undefined,
      priority: patch.priority,
      orderTypes: patch.orderTypes,
    });

    // `isActive` is its own audited endpoint, not a field on the patch DTO.
    if (patch.active !== undefined) {
      await api.catalogue.setMenuActive(id, { isActive: patch.active });
    }

    invalidateCatalogue();
    return map.toMenu(row, getTenantId() ?? "", patch.branchIds ?? []);
  },

  async remove(id) {
    // C-09: a menu that has priced a sale is deactivated, never deleted.
    await api.catalogue.setMenuActive(id, { isActive: false });
    invalidateCatalogue();
  },
};

const catalogue: CatalogueService = {
  categories,
  items,
  modifierGroups,
  combos: mockServices.catalogue.combos,
  priceLists,
  recipes,
  menus,

  // -- Menu assignment -------------------------------------------------------

  async assignMenuToBranch(menuId, branchId) {
    await api.catalogue.assignBranch(menuId, { branchId });
    invalidateCatalogue();
  },

  async unassignMenuFromBranch(menuId, branchId) {
    await api.catalogue.unassignBranch(menuId, branchId);
    invalidateCatalogue();
  },

  async resolveBranchMenus(branchId) {
    const response = await api.catalogue.resolveMenus(branchId);
    return map.toMenuResolution(response, getTenantId() ?? "");
  },

  async setMenuActive(menuId, active) {
    const row = await api.catalogue.setMenuActive(menuId, { isActive: active });
    invalidateCatalogue();
    return map.toMenu(row, getTenantId() ?? "");
  },

  // -- Item composition ------------------------------------------------------

  async placeItem(itemId, categoryId) {
    await api.catalogue.placeItem(itemId, { categoryId });
    invalidateCatalogue();
  },

  async unplaceItem(itemId, categoryId) {
    await api.catalogue.unplaceItem(itemId, categoryId);
    invalidateCatalogue();
  },

  async addVariant(itemId, input) {
    const row = await api.catalogue.addVariant(itemId, {
      name: map.toNameMap(input.name),
      barcode: input.barcode ?? undefined,
    });
    invalidateCatalogue();
    return map.toVariant(row, input.basePrice ?? null);
  },

  async setVariantActive(variantId, active) {
    await api.catalogue.setVariantActive(variantId, { isActive: active });
    invalidateCatalogue();
  },

  async linkModifierGroup(itemId, groupId, options = {}) {
    await api.catalogue.linkModifierGroup(itemId, {
      modifierGroupId: groupId,
      sortOrder: options.sortOrder,
    });
    invalidateCatalogue();
  },

  async addModifier(groupId, input) {
    const row = await api.catalogue.addModifier(groupId, {
      name: map.toNameMap(input.name),
      // The DTO requires a kind on every new modifier — there is no
      // heuristic default the server will accept.
      kind: input.kind ?? "addition",
      priceDelta:
        input.priceDelta === undefined ? undefined : String(input.priceDelta.amount),
      isDefault: input.isDefault,
    });
    invalidateCatalogue();
    return map.toModifier(row);
  },

  // -- Pricing ---------------------------------------------------------------

  async setPrice(priceListId, variantId, price) {
    const row = await api.catalogue.setPriceEntry(priceListId, {
      menuItemVariantId: variantId,
      price: map.toDecimal(price),
      currency: price.currency,
    });
    // A changed price invalidates the per-variant price cache the item list
    // reads, otherwise the table shows the old figure for another 20s.
    pricesByVariant.invalidate();
    invalidateCatalogue();
    return map.toPriceEntry(row);
  },

  async priceEntries(priceListId) {
    const [entries, itemRows] = await Promise.all([
      api.catalogue.listPriceEntries(priceListId),
      menuItemsRaw().catch(() => []),
    ]);

    // An entry references a variant; the console shows the item it belongs
    // to, so the variant → item mapping is resolved once for the whole list.
    const variantLists = await Promise.all(
      itemRows.map((item) =>
        api.catalogue
          .listVariants(item.id)
          .then((variants) => ({ item, variants }))
          .catch(() => ({ item, variants: [] })),
      ),
    );

    const owner = new Map<Id, { itemId: Id; name: ReturnType<typeof map.localised> }>();
    for (const { item, variants } of variantLists) {
      for (const variant of variants) {
        owner.set(variant.id, { itemId: item.id, name: map.localised(item.names) });
      }
    }

    return entries.map((entry) => {
      const match = owner.get(entry.menuItemVariantId);
      return map.toPriceEntry(entry, match?.name, match?.itemId ?? "");
    });
  },

  // -- Readiness -------------------------------------------------------------

  async completeness() {
    return map.toCompleteness(await api.catalogue.completenessReport());
  },

  /** FR-MNU-030 — an 86 is an availability rule, created or cleared. */
  async toggleAvailability(itemId, available, reason) {
    const rules = await availabilityRaw();
    const existing = rules.find((rule) => rule.menuItemId === itemId && rule.isManual86);

    const ruleId =
      existing?.id ??
      (await api.catalogue.createAvailabilityRule({ menuItemId: itemId })).id;

    await api.catalogue.toggle86(ruleId, {
      isManual86: !available,
      reasonText: reason,
    });

    invalidateCatalogue();

    const item = await items.get(itemId);
    if (!item) notImplemented(`Item ${itemId} disappeared while being toggled`);
    return item;
  },
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const stockItems: CollectionService<StockItem> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const rows = (await stockItemsRaw()).map((row) => map.toStockItem(row, tenantId));

    return project(rows, query, {
      search: (row) => [row.name, row.sku, row.category],
      filters: {
        active: (row) => row.active,
        costingMethod: (row) => row.costingMethod,
        batchTracked: (row) => row.batchTracked,
      },
      sorters: { name: (row) => row.name.en, sku: (row) => row.sku, unitCost: (row) => row.unitCost.amount },
    });
  },

  async get(id) {
    const row = await api.inventory.getItem(id);
    return map.toStockItem(row, getTenantId() ?? "");
  },

  async create(input) {
    if (!input.baseUnit) {
      throw new ServiceError("BAD_REQUEST", "Choose a base unit for the item.", 400);
    }
    const row = await api.inventory.createItem({
      sku: input.sku ?? "",
      names: map.toNameMap(input.name),
      // The API keys units by id; the console works in unit codes. Register
      // the tenant's units with `registerUnits()` for this to round-trip.
      baseUnitId: input.baseUnit,
      costingMethod: input.costingMethod,
      isBatchTracked: input.batchTracked,
      expiryTracked: input.expiryTracked,
      shelfLifeDays: input.shelfLifeDays ?? undefined,
      standardCost: input.unitCost ? map.toDecimal(input.unitCost) : undefined,
    });
    invalidateInventory();
    return map.toStockItem(row, getTenantId() ?? "");
  },

  async update(id, patch) {
    // The API exposes targeted mutations, not a general PATCH.
    if (patch.baseUnit) {
      await api.inventory.changeBaseUnit(id, { baseUnitId: patch.baseUnit });
    }
    invalidateInventory();
    const row = await api.inventory.getItem(id);
    return map.toStockItem(row, getTenantId() ?? "");
  },

  async remove() {
    notImplemented("Deleting a stock item");
  },
};

const levels: ReadonlyCollectionService<StockLevel> = {
  async list(query = {}) {
    const locationId = query.filters?.locationId as string | undefined;
    const [rows, itemsById, locationsById] = await Promise.all([
      api.inventory.levels({ locationId }),
      stockItemIndex(),
      locationIndex(),
    ]);

    const mapped = rows.map((row) =>
      map.toStockLevel(row, {
        item: itemsById.get(row.stockItemId),
        location: locationsById.get(row.locationId),
      }),
    );

    return project(mapped, query, {
      search: (row) => [row.itemName, row.sku, row.locationName],
      filters: { status: (row) => row.status, locationId: (row) => row.locationId },
      sorters: {
        itemName: (row) => row.itemName.en,
        onHand: (row) => Number(row.onHand.value),
        value: (row) => row.value.amount,
      },
    });
  },

  async get(id) {
    const page = await levels.list({ limit: 5000 });
    return page.rows.find((row) => `${row.itemId}:${row.locationId}` === id || row.itemId === id) ?? null;
  },
};

const batches: ReadonlyCollectionService<Batch> = {
  async list(query = {}) {
    const days = String(query.filters?.days ?? 90);
    const [rows, itemsById, locationsById] = await Promise.all([
      api.inventory.expiring({ days }),
      stockItemIndex(),
      locationIndex(),
    ]);

    const mapped = rows.map((row) =>
      map.toBatch(row, {
        item: itemsById.get(row.stockItemId),
        location: locationsById.get(row.locationId),
      }),
    );

    return project(mapped, query, {
      search: (row) => [row.itemName, row.batchNumber, row.locationName],
      filters: { status: (row) => row.status, locationId: (row) => row.locationId },
      sorters: { expiryDate: (row) => row.expiryDate, daysToExpiry: (row) => row.daysToExpiry },
    });
  },

  async get(id) {
    const page = await batches.list({ limit: 5000 });
    return page.rows.find((row) => row.id === id) ?? null;
  },
};

const movements: ReadonlyCollectionService<StockMovement> = {
  /** The ledger is addressable per item only — `filters.itemId` is required. */
  async list(query = {}) {
    const itemId = query.filters?.itemId as string | undefined;
    if (!itemId) {
      // Not an error: the movements screen opens before an item is chosen.
      return emptyPage<StockMovement>();
    }

    const tenantId = tenantOf(query);
    const locationId = query.filters?.locationId as string | undefined;

    const [rows, itemsById, locationsById] = await Promise.all([
      api.inventory.listMovements(itemId, { locationId }),
      stockItemIndex(),
      locationIndex(),
    ]);

    const item = itemsById.get(itemId);
    const mapped = rows.map((row) =>
      map.toMovement(row, { tenantId, item, location: locationsById.get(row.locationId) }),
    );

    return project(mapped, query, {
      search: (row) => [row.itemName, row.referenceType, row.locationName],
      filters: { movementType: (row) => row.movementType, locationId: (row) => row.locationId },
      sorters: { occurredAt: (row) => row.occurredAt, quantity: (row) => Number(row.quantity.value) },
    });
  },

  async get() {
    return null;
  },
};

const counts: CollectionService<CountSession> = {
  /** No index endpoint; a session is reachable by id once it has been opened. */
  async list() {
    return emptyPage<CountSession>();
  },

  async get(id) {
    const tenantId = getTenantId() ?? "";
    const [lines, itemsById] = await Promise.all([
      api.inventory.countLines(id),
      stockItemIndex(),
    ]);

    return map.toCountSession({ id } as S.InventoryController_openCountResponse, {
      tenantId,
      lines: lines.map((line) => map.toCountLine(line, { item: itemsById.get(line.stockItemId) })),
    });
  },

  async create(input) {
    if (!input.locationId) {
      throw new ServiceError("BAD_REQUEST", "Choose the location to count.", 400);
    }
    const row = await api.inventory.openCount({
      locationId: input.locationId,
      scopeType: "full_location",
      isBlindCount: input.mode === "blind",
    });
    return map.toCountSession(row, { tenantId: getTenantId() ?? "" });
  },

  async update(id, patch) {
    if (patch.status === "posted") {
      await api.inventory.postCount(id);
    }
    const session = await counts.get(id);
    if (!session) notImplemented(`Count ${id}`);
    return session;
  },

  async remove() {
    notImplemented("Cancelling a count session");
  },
};

const transfers: CollectionService<Transfer> = {
  /** Dispatch and receive exist; a transfer index does not. */
  async list() {
    return emptyPage<Transfer>();
  },

  async get() {
    return null;
  },

  async create(input) {
    const line = input.lines?.[0];
    if (!input.fromLocationId || !input.toLocationId || !line) {
      throw new ServiceError(
        "BAD_REQUEST",
        "A transfer needs a source, a destination and one line.",
        400,
      );
    }

    const row = await api.inventory.dispatch({
      stockItemId: line.itemId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      quantity: line.dispatched.value,
    });

    const record = row as unknown as Record<string, unknown>;
    return {
      ...(input as Transfer),
      id: String(record.id ?? record.transferId ?? ""),
      tenantId: getTenantId() ?? "",
      status: "dispatched",
      dispatchedAt: new Date().toISOString(),
    } satisfies Transfer;
  },

  async update(_id, patch) {
    if (patch.status !== "received") notImplemented("Editing a transfer");
    // POST /inventory/transfers/receive keys on the dispatch, which the list
    // endpoint does not exist to give back.
    notImplemented("Receiving a transfer without its dispatch line");
  },

  async remove() {
    notImplemented("Deleting a transfer");
  },
};

const waste: CollectionService<WasteRecord> = {
  async list(query = {}) {
    const tenantId = tenantOf(query);
    const [rows, locationsById, reasonRows] = await Promise.all([
      api.inventory.listWaste(),
      locationIndex(),
      reasonCodesRaw().catch(() => []),
    ]);

    const reasons = indexBy(reasonRows.map(map.toWasteReason), (reason) => reason.id);

    const mapped = rows.map((row) =>
      map.toWasteRecord(row, {
        tenantId,
        location: locationsById.get(row.locationId),
        reason: reasons.get(row.reasonCodeId),
      }),
    );

    return project(mapped, query, {
      search: (row) => [row.itemName, row.reasonName, row.locationName],
      filters: {
        category: (row) => row.category,
        approval: (row) => row.approval,
        locationId: (row) => row.locationId,
      },
      sorters: { recordedAt: (row) => row.recordedAt, value: (row) => row.value.amount },
    });
  },

  async get(id) {
    const page = await waste.list({ limit: 5000 });
    return page.rows.find((row) => row.id === id) ?? null;
  },

  async create(input) {
    if (!input.locationId || !input.itemId) {
      throw new ServiceError("BAD_REQUEST", "Choose a location and an item.", 400);
    }

    await api.inventory.recordWaste({
      locationId: input.locationId,
      reasonCodeId: input.reasonCode ?? "",
      notes: input.notes ?? undefined,
      lines: [{ stockItemId: input.itemId, quantity: input.quantity?.value ?? "0" }],
    });

    const page = await waste.list({ limit: 1, sort: "-recordedAt" });
    return page.rows[0] ?? (input as WasteRecord);
  },

  async update() {
    notImplemented("Editing a waste record");
  },

  async remove() {
    notImplemented("Deleting a waste record");
  },
};

/**
 * An adjustment is a manual movement on the API — there is no separate
 * document — so the list has nothing to read back. Writes go through.
 */
const adjustments: CollectionService<StockAdjustment> = {
  list: mockServices.inventory.adjustments.list,
  get: mockServices.inventory.adjustments.get,

  async create(input) {
    if (!input.locationId || !input.itemId) {
      throw new ServiceError("BAD_REQUEST", "Choose a location and an item.", 400);
    }
    await api.inventory.postMovement({
      locationId: input.locationId,
      stockItemId: input.itemId,
      movementType: "manual_adjustment",
      quantity: input.quantity?.value ?? "0",
      referenceType: "console_adjustment",
      referenceId: `adj_${Date.now()}`,
      reasonCodeId: input.reasonCode,
      notes: input.notes ?? undefined,
    });
    return input as StockAdjustment;
  },

  async update() {
    notImplemented("Editing an adjustment");
  },

  async remove() {
    notImplemented("Deleting an adjustment");
  },
};

/**
 * The computed inventory reports return ids only, so each one is joined
 * against the cached item and location tables before the UI sees it —
 * otherwise every row reads as a pair of UUIDs.
 */
async function namers() {
  const [items, locs] = await Promise.all([
    stockItemIndex().catch(() => new Map<Id, StockItem>()),
    locationIndex().catch(() => new Map<Id, StockLocation>()),
  ]);
  return {
    item: (id: Id) => items.get(id)?.name ?? { en: id, ar: id },
    location: (id: Id) => locs.get(id)?.name ?? { en: id, ar: id },
    /** The item's own base unit is the only sensible unit for its quantities. */
    unit: (id: Id) => items.get(id)?.baseUnit ?? "pc",
  };
}

const inventory: InventoryService = {
  items: stockItems,
  levels,
  batches,
  movements,
  counts,
  transfers,
  waste,
  adjustments,

  // -- Counting --------------------------------------------------------------

  async recordCount(lineId, countedQuantity) {
    await api.inventory.recordCount(lineId, { countedQuantity });
  },

  // -- Transfers -------------------------------------------------------------

  async receiveTransfer(input) {
    await api.inventory.receive({
      transferReferenceId: input.transferReferenceId,
      toLocationId: input.toLocationId,
      receivedQuantity: input.receivedQuantity,
      discrepancyReasonCodeId: input.discrepancyReasonCodeId,
    });
    invalidateInventory();
  },

  // -- Reorder configuration -------------------------------------------------

  async setReorderConfig(itemId, input) {
    await api.inventory.setReorderConfig(itemId, {
      locationId: input.locationId,
      reorderPoint: input.reorderPoint,
      reorderQuantity: input.reorderQuantity,
    });
    invalidateInventory();
  },

  // -- Reason codes ----------------------------------------------------------

  async reasonCodes() {
    const rows = await reasonCodesRaw();
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      category: row.category,
      label: map.localised(row.label, { en: row.code, ar: row.code }),
    }));
  },

  async createReasonCode(input) {
    const row = await api.inventory.createReasonCode({
      code: input.code,
      category: input.category,
      label: map.toNameMap(input.label),
    });
    reasonCodesRaw.invalidate();
    return {
      id: row.id,
      code: row.code,
      category: row.category,
      label: map.localised(row.label, { en: row.code, ar: row.code }),
    };
  },

  // -- Computed reports ------------------------------------------------------

  async lowStock(query = {}) {
    const [rows, name] = await Promise.all([api.inventory.lowStock(), namers()]);

    const mapped = rows.map((row) => ({
      stockItemId: row.stockItemId,
      itemName: name.item(row.stockItemId),
      locationId: row.locationId,
      locationName: name.location(row.locationId),
      onHand: map.quantityOf(row.quantityOnHand, name.unit(row.stockItemId)),
      reorderPoint:
        row.reorderPoint === null
          ? null
          : map.quantityOf(row.reorderPoint, name.unit(row.stockItemId)),
      reorderQuantity:
        row.reorderQuantity === null
          ? null
          : map.quantityOf(row.reorderQuantity, name.unit(row.stockItemId)),
    }));

    // The endpoint is tenant-wide; a branch-scoped console shows its own.
    const branchId = query.scope?.branchId;
    return branchId ? mapped.filter((row) => row.locationId === branchId) : mapped;
  },

  async negativeStock(query = {}) {
    const [rows, name] = await Promise.all([api.inventory.negativeStock(), namers()]);

    const mapped = rows.map((row) => ({
      stockItemId: row.stockItemId,
      itemName: name.item(row.stockItemId),
      locationId: row.locationId,
      locationName: name.location(row.locationId),
      onHand: map.quantityOf(row.quantityOnHand, name.unit(row.stockItemId)),
    }));

    const branchId = query.scope?.branchId;
    return branchId ? mapped.filter((row) => row.locationId === branchId) : mapped;
  },

  async reconciliation() {
    const [report, name] = await Promise.all([api.inventory.reconcile(), namers()]);

    return {
      reconciled: report.reconciled,
      note: report.note,
      divergences: report.divergences.map((row) => ({
        stockItemId: row.stockItemId,
        itemName: name.item(row.stockItemId),
        locationId: row.locationId,
        locationName: name.location(row.locationId),
        ledger: map.quantityOf(row.ledger, name.unit(row.stockItemId)),
        projected: map.quantityOf(row.projected, name.unit(row.stockItemId)),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

async function orderContext() {
  const [branchesById, tenantId] = await Promise.all([
    branchIndex().catch(() => new Map<Id, Branch>()),
    Promise.resolve(getTenantId() ?? ""),
  ]);
  return { branchesById, tenantId };
}

const orders: ReadonlyCollectionService<Order> = {
  /**
   * `GET /orders` is keyset-paginated on (businessDay, id). The console's
   * tables page by offset, so a page is walked forward from the start —
   * fine for the recent-orders view, which is what this screen is.
   */
  async list(query = {}) {
    const { branchesById, tenantId } = await orderContext();
    const branchId = (query.filters?.branchId as string | undefined) ?? query.scope?.branchId ?? undefined;

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 25;
    const wanted = offset + limit;

    const collected: S.OrdersController_listResponse["orders"] = [];
    let cursor: { id: string; businessDay: string } | null = null;

    // A handful of round-trips at most; the page size the API accepts is 100.
    for (let hop = 0; hop < 10 && collected.length < wanted + 1; hop += 1) {
      const response = await api.sales.list({
        branchId: branchId ?? undefined,
        limit: Math.min(100, wanted + 1 - collected.length),
        cursorId: cursor?.id,
        cursorBusinessDay: cursor?.businessDay,
      });

      collected.push(...response.orders);
      cursor = response.nextCursor ?? null;
      if (!cursor || response.orders.length === 0) break;
    }

    const mapped = collected.map((row) =>
      map.toOrder(row as S.OrdersController_findOneResponse, {
        tenantId,
        branchName: branchesById.get(row.branchId)?.name,
      }),
    );

    // The server has already ordered and filtered by branch; the projection
    // adds the toolbar's search, its state filter, and the offset window.
    return project(mapped, query, {
      search: (row) => [row.orderNumber, row.tableLabel, row.branchName],
      filters: {
        state: (row) => row.state,
        orderType: (row) => row.orderType,
        channel: (row) => row.channel,
      },
      sorters: { openedAt: (row) => row.openedAt, grandTotal: (row) => row.grandTotal.amount },
    });
  },

  async get(id) {
    // The key is (businessDay, id); a bare id is addressed as "day/id".
    const [businessDay, orderId] = id.includes("/") ? id.split("/") : [null, id];
    if (!businessDay) {
      throw new ServiceError(
        "BAD_REQUEST",
        "An order is addressed by its business day.",
        400,
        `Use "YYYY-MM-DD/${orderId}" — GET /orders/{businessDay}/{id}.`,
      );
    }

    const { branchesById, tenantId } = await orderContext();
    const row = await api.sales.findOne(businessDay, orderId!);
    return map.toOrder(row, { tenantId, branchName: branchesById.get(row.branchId)?.name });
  },
};

/**
 * The write half of the order lifecycle.
 *
 * Two things are non-obvious and both come from the document:
 *
 *  - Every mutation is keyed by `(businessDay, id)`, not by id alone. The
 *    business day is part of the primary key, because a trading day runs
 *    past midnight (FR-FIN-024) and the partition is by day.
 *  - Ids are minted here, not by the server (FR-OFF-015). A ULID rather
 *    than a UUID so `GET /orders`' keyset cursor pages chronologically.
 */
const orderMutations: import("./types").OrderMutationService = {
  async open(input) {
    const tenantId = getTenantId() ?? "";
    const branchesById = await branchIndex().catch(() => new Map<Id, Branch>());

    const row = await api.sales.create({
      id: ulid(),
      orderType: input.orderType,
      channel: input.channel ?? "pos",
      tableId: input.tableId,
      guestCount: input.guestCount,
      notes: input.notes,
      // Optional on a terminal-bound session, where the token carries it.
      terminalId: input.terminalId,
      openedByEmployeeId: input.openedByEmployeeId,
      // The device's own clock reading. It is recorded, never used to decide
      // which business day the sale lands in — the server does that.
      originDeviceTime: new Date().toISOString(),
    });

    return map.toOrder(row, {
      tenantId,
      branchName: branchesById.get(row.branchId)?.name,
    });
  },

  async get(businessDay, orderId) {
    const tenantId = getTenantId() ?? "";
    const [row, branchesById] = await Promise.all([
      api.sales.findOne(businessDay, orderId),
      branchIndex().catch(() => new Map<Id, Branch>()),
    ]);
    return map.toOrder(row, { tenantId, branchName: branchesById.get(row.branchId)?.name });
  },

  async addLine(businessDay, orderId, input, options = {}) {
    const response = await api.sales.addLine(
      businessDay,
      orderId,
      {
        id: ulid(),
        menuItemId: input.menuItemId,
        variantId: input.variantId,
        quantity: input.quantity,
        modifiers: input.modifiers?.map((modifier) => ({
          modifierId: modifier.modifierId,
          quantity: modifier.quantity,
        })),
        notes: input.notes,
        course: input.course,
        seatNumber: input.seatNumber,
      },
      { ifMatch: options.ifMatch },
    );

    return hydrateOrder(response.order);
  },

  async voidLine(businessDay, orderId, lineId, reasonCodeId, options = {}) {
    const response = await api.sales.voidLine(
      businessDay,
      orderId,
      lineId,
      { reasonCodeId },
      { ifMatch: options.ifMatch },
    );
    return hydrateOrder(response.order);
  },

  async fire(businessDay, orderId, options = {}) {
    const row = await api.sales.fire(businessDay, orderId, { ifMatch: options.ifMatch });
    return hydrateOrder(row);
  },

  async capturePayment(businessDay, orderId, input, options = {}) {
    const response = await api.sales.capturePayment(
      businessDay,
      orderId,
      {
        id: ulid(),
        cashSessionId: input.cashSessionId,
        tender: input.tender,
        amountMinor: input.amountMinor,
        // The document is strict about which of these two is allowed:
        // tendered is required for cash and refused for card, and the
        // terminal reference is the exact mirror of that.
        tenderedAmountMinor:
          input.tender === "cash" ? input.tenderedAmountMinor : undefined,
        terminalReference:
          input.tender === "manual_external_card" ? input.terminalReference : undefined,
        cardScheme: input.cardScheme,
        last4: input.last4,
        authorizationCode: input.authorizationCode,
      },
      { ifMatch: options.ifMatch },
    );
    return hydrateOrder(response.order);
  },
};

/** Every mutation answers with an order row; they all need the same joins. */
async function hydrateOrder(row: Parameters<typeof map.toOrder>[0]): Promise<Order> {
  const tenantId = getTenantId() ?? "";
  const branchesById = await branchIndex().catch(() => new Map<Id, Branch>());
  return map.toOrder(row, { tenantId, branchName: branchesById.get(row.branchId)?.name });
}

const sales: SalesService = { orders, mutations: orderMutations };

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

const treasury: import("./types").TreasuryService = {
  async openCashSession(input) {
    const response = await api.treasury.openCashSession({
      // Both ids are the device's (FR-OFF-015), and independent duplicate
      // protection beneath the mandatory idempotency key.
      cashSessionId: ulid(),
      shiftId: ulid(),
      drawerId: input.drawerId,
      openingFloat: input.openingFloat,
      notes: input.notes,
    });

    return {
      cashSessionId: response.cashSession.id,
      shiftId: response.shift.id,
      created: response.created,
    };
  },

  async recordMovement(cashSessionId, kind, input) {
    const body: S.CashMovementDto = {
      // FR-OFF-015 — the device's permanent id for this movement, beneath
      // the idempotency key the client layer adds for the retry itself.
      id: ulid(),
      amountMinor: input.amountMinor,
      reason: input.reason,
      occurredAt: input.occurredAt,
    };

    const call =
      kind === "pay_in"
        ? api.treasury.payIn
        : kind === "pay_out"
          ? api.treasury.payOut
          : api.treasury.safeDrop;

    const row = await call(cashSessionId, body);

    return {
      id: row.id,
      cashSessionId: row.cashSessionId,
      branchId: row.branchId,
      employeeId: row.employeeId,
      kind: row.movementType,
      amount: map.minorMoney(row.amountMinor, row.currency),
      reason: row.reason,
      occurredAt: row.occurredAt,
    };
  },

  async closeContext(cashSessionId) {
    // The generator marks every declared property as present, but this
    // response omits four of them outright under a blind count — that
    // omission *is* FR-POS-095, so it is read as a partial shape here.
    const row = (await api.treasury.getCloseContext(cashSessionId)) as Partial<
      S.TreasuryController_getCloseContextResponse
    >;

    const currency = map.currencyOf(row.currency);
    const declared = row.status === "closing" || row.status === "closed";
    const present = (value: string | undefined) => value !== undefined && value !== null;

    return {
      cashSessionId: row.cashSessionId ?? cashSessionId,
      status: row.status ?? "open",
      countMode: row.countMode ?? "blind",
      currency,
      openingFloat: map.minorMoney(row.openingFloatMinorUnits, currency),
      tolerance: present(row.toleranceMinorUnits)
        ? map.minorMoney(row.toleranceMinorUnits, currency)
        : null,
      expectedCash: present(row.expectedCashMinorUnits)
        ? map.minorMoney(row.expectedCashMinorUnits, currency)
        : null,
      countedCash:
        declared && present(row.countedCashMinorUnits)
          ? map.minorMoney(row.countedCashMinorUnits, currency)
          : null,
      variance:
        declared && present(row.varianceMinorUnits)
          ? map.minorMoney(row.varianceMinorUnits, currency)
          : null,
      approvalRequired: declared ? (row.approvalRequired ?? false) : null,
      closedAt: row.closedAt ?? null,
      frozen: row.status === "closing",
    };
  },

  async declareClose(cashSessionId, input) {
    const row = await api.treasury.declareClose(cashSessionId, {
      closeAttemptId: ulid(),
      countedTotalMinorUnits: input.countedTotalMinorUnits,
      denominations: input.denominations?.length ? input.denominations : undefined,
    });

    const currency = map.currencyOf(row.currency);

    return {
      cashSessionId: row.cashSessionId,
      closeAttemptId: row.closeAttemptId,
      status: row.status,
      approvalRequired: row.approvalRequired,
      created: row.created,
      countMode: row.countMode,
      tolerance: map.minorMoney(row.toleranceMinorUnits, currency),
      expectedCash: map.minorMoney(row.expectedCashMinorUnits, currency),
      countedCash: map.minorMoney(row.countedCashMinorUnits, currency),
      variance: map.minorMoney(row.varianceMinorUnits, currency),
    };
  },

  async finalizeClose(cashSessionId, input) {
    // R-6(a) — a rejection is a committed 200, not a refusal. Both ids are
    // fresh per attempt: reusing them after a rejection replays the
    // rejection instead of asking the manager again.
    const row = await api.treasury.finalizeClose(cashSessionId, {
      approvalRequestId: ulid(),
      approvalDecisionId: ulid(),
      decision: input.decision,
      reason: input.reason,
      managerEmployeeCode: input.managerEmployeeCode,
      managerPin: input.managerPin,
      comment: input.comment,
    });

    return { status: row.status, outcome: row.outcome };
  },

  async setCashClosePolicy(branchId, input) {
    const row = await api.treasury.createPolicy(branchId, {
      varianceToleranceMinorUnits: input.varianceToleranceMinorUnits,
      varianceApprovalExpirySeconds: input.varianceApprovalExpirySeconds,
      countMode: input.countMode,
      effectiveFrom: input.effectiveFrom,
    });

    return {
      id: row.id,
      branchId: row.branchId,
      effectiveFrom: row.effectiveFrom,
      countMode: row.countMode,
      tolerance: map.minorMoney(row.varianceToleranceMinorUnits, row.currency),
      varianceApprovalExpirySeconds: row.varianceApprovalExpirySeconds,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const OPEN_STATES = new Set(["draft", "open", "held", "parked", "partially_paid"]);

/** Fans a per-branch endpoint over the branches in scope. */
async function perBranch<T>(
  scope: Scope | undefined,
  fetch: (branchId: Id) => Promise<T[]>,
): Promise<T[]> {
  if (scope?.branchId) return fetch(scope.branchId);

  const branchRows = await branchesRaw();
  const wanted = scope?.brandId
    ? branchRows.filter((row) => row.brandId === scope.brandId)
    : branchRows;

  const results = await Promise.all(
    wanted.slice(0, 25).map((row) => fetch(row.id).catch(() => [] as T[])),
  );
  return results.flat();
}

const operations: OperationsService = {
  async openOrders(query = {}) {
    const page = await orders.list({ ...query, limit: Math.max(query.limit ?? 25, 100) });
    const open = page.rows.filter((row) => OPEN_STATES.has(row.state));
    return project(open, query, {
      search: (row) => [row.orderNumber, row.tableLabel],
      sorters: { openedAt: (row) => row.openedAt, grandTotal: (row) => row.grandTotal.amount },
    });
  },

  async tables(query = {}) {
    const rows = await perBranch(query.scope, (branchId) => api.organisation.listTables(branchId));
    const mapped = rows.map(map.toTable);

    return project(mapped, query, {
      search: (row) => [row.label, row.area],
      branchOf: (row) => row.branchId,
      filters: { state: (row) => row.state, area: (row) => row.area.en },
      sorters: { label: (row) => row.label, capacity: (row) => row.capacity },
    });
  },

  // No KDS endpoints exist — bump, recall and fire are all absent by design.
  kitchenQueue: mockServices.operations.kitchenQueue,

  async terminals(query = {}) {
    const rows = (await api.terminals.list()).map(map.toTerminal);
    return project(rows, query, {
      search: (row) => [row.name, row.code],
      branchOf: (row) => row.branchId,
      filters: { status: (row) => row.status, kind: (row) => row.kind },
      sorters: { name: (row) => row.name, lastSeenAt: (row) => row.lastSeenAt },
    });
  },

  async stations(query = {}) {
    const rows = await perBranch(query.scope, (branchId) => api.organisation.listStations(branchId));
    const mapped = rows.map(map.toStation);

    return project(mapped, query, {
      search: (row) => [row.name],
      branchOf: (row) => row.branchId,
      filters: { type: (row) => row.type, active: (row) => row.active },
      sorters: { name: (row) => row.name.en, capacityPerHour: (row) => row.capacityPerHour },
    });
  },

  async setTerminalStatus(terminalId, status) {
    return map.toTerminal(await api.terminals.setStatus(terminalId, { status }));
  },

  async createTable(branchId, input) {
    const row = await api.organisation.createTable(branchId, {
      label: input.label ?? "New table",
      seatCapacity: input.capacity,
      section: input.area ? map.toPlainName(input.area) : undefined,
    });
    return map.toTable(row);
  },

  async updateTable(tableId, patch) {
    const row = await api.organisation.updateTable(tableId, {
      label: patch.label,
      seatCapacity: patch.capacity,
      section: patch.area ? map.toPlainName(patch.area) : undefined,
    });
    return map.toTable(row);
  },

  async createStation(branchId, input) {
    const row = await api.organisation.createStation(branchId, {
      name: map.toPlainName(input.name, "New station"),
      displayColour: input.colour,
      // The API keeps station capacity in a free-form blob; the console
      // reads `perHour` back out of it in `map.toStation`.
      capacityConfig:
        input.capacityPerHour === undefined ? undefined : { perHour: input.capacityPerHour },
    });
    return map.toStation(row);
  },

  async updateStation(stationId, patch) {
    const row = await api.organisation.updateStation(stationId, {
      name: patch.name ? map.toPlainName(patch.name) : undefined,
      displayColour: patch.colour,
      capacityConfig:
        patch.capacityPerHour === undefined ? undefined : { perHour: patch.capacityPerHour },
    });
    return map.toStation(row);
  },
};

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const roles: CollectionService<Role> = {
  async list(query = {}) {
    const [rows, mine] = await Promise.all([
      api.rbac.listRoles(),
      api.rbac.myPermissions().catch(() => ({ permissions: [] as string[] })),
    ]);

    const mapped = rows.map((row) =>
      // The API answers with the caller's effective permissions, not with a
      // per-role grant list, so only the caller's own roles can be filled in.
      map.toRole(row, mine.permissions as Role["permissions"]),
    );

    return project(mapped, query, {
      search: (row) => [row.name, row.description],
      filters: { system: (row) => row.system },
      sorters: { name: (row) => row.name.en },
    });
  },

  async get(id) {
    const page = await roles.list({ limit: 500 });
    return page.rows.find((row) => row.id === id) ?? null;
  },

  async create(input) {
    const row = await api.rbac.createRole({
      name: map.toPlainName(input.name, "New role"),
      description: input.description ? map.toPlainName(input.description) : undefined,
    });
    return map.toRole(row);
  },

  async update(id, patch) {
    if (patch.permissions && patch.permissions.length > 0) {
      await api.rbac.addRolePermissions(id, { permissionCodes: patch.permissions });
    }
    const role = await roles.get(id);
    if (!role) notImplemented(`Role ${id}`);
    return role;
  },

  async remove() {
    notImplemented("Deleting a role");
  },
};

const security: SecurityService = {
  // No user index endpoint; memberships are reachable only by id.
  users: mockServices.security.users,
  roles,

  async memberships() {
    const rows = await api.tenants.listTenants();
    return rows.map((row) => ({
      membershipId: row.membershipId,
      tenantId: row.tenant.id,
      tenantName: row.tenant.legalName,
      status: row.status,
    }));
  },

  async assignRole(membershipId, roleId) {
    await api.rbac.assignRole(membershipId, { roleId });
  },

  async removeRole(membershipId, roleId) {
    await api.rbac.removeRole(membershipId, roleId);
  },
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const httpServices: ServiceRegistry = {
  production,
  treasury,
  // Live.
  organisation,
  catalogue,
  inventory,
  sales,
  operations,
  security,

  // Still demo data — no endpoints exist. See API_COVERAGE.
  dashboard: mockServices.dashboard,
  purchasing: mockServices.purchasing,
  costing: mockServices.costing,
  workforce: mockServices.workforce,
  finance: mockServices.finance,
  governance: mockServices.governance,
  platform: mockServices.platform,
};

announceCoverage();
