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
import type * as S from "@/lib/api/schema";

import type {
  Batch,
  Branch,
  Brand,
  CentralKitchen,
  CountSession,
  Id,
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

/** Which registry members reach the API, and which are still demo data. */
export const API_COVERAGE = {
  live: [
    "organisation.tenants",
    "organisation.brands",
    "organisation.branches",
    "organisation.warehouses",
    "organisation.centralKitchens",
    "organisation.locations",
    "catalogue.categories",
    "catalogue.items",
    "catalogue.modifierGroups",
    "catalogue.priceLists",
    "catalogue.recipes",
    "catalogue.toggleAvailability",
    "inventory.items",
    "inventory.levels",
    "inventory.batches",
    "inventory.movements",
    "inventory.waste",
    "inventory.counts",
    "inventory.transfers",
    "sales.orders",
    "operations.openOrders",
    "operations.terminals",
    "operations.stations",
    "operations.tables",
    "security.roles",
  ],
  /** No endpoint exists yet — these still serve demo data. */
  demo: [
    "dashboard",
    "costing",
    "purchasing",
    "workforce",
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
      warehouseType: input.attachedBranchId ? "branch" : "central",
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

const catalogue: CatalogueService = {
  categories,
  items,
  modifierGroups,
  combos: mockServices.catalogue.combos,
  priceLists,
  recipes,

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

const inventory: InventoryService = {
  items: stockItems,
  levels,
  batches,
  movements,
  counts,
  transfers,
  waste,
  adjustments,
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

const sales: SalesService = { orders };

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
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const httpServices: ServiceRegistry = {
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
