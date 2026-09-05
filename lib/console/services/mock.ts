/**
 * Mock service implementations.
 *
 * Every function here is a stand-in for one HTTP call. They are async, they
 * take a beat before resolving, and they can be made to fail on demand — so
 * the loading, empty, and error states in the UI are exercised rather than
 * assumed. See BACKEND_INTEGRATION.md for the replacement recipe.
 */

import type {
  Branch,
  Brand,
  CentralKitchen,
  Id,
  KitchenTicket,
  Localised,
  Menu,
  MenuItem,
  Order,
  Page,
  PurchaseOrder,
  RestaurantTable,
  Station,
  Terminal,
  Warehouse,
} from "../types";
import type {
  CatalogueService,
  CollectionService,
  CostingService,
  DashboardService,
  FinanceService,
  GovernanceService,
  InventoryService,
  KitchenService,
  LowStockRow,
  ModifierRecipeEffect,
  OperatingHours,
  OperationsService,
  PrintRoutingRule,
  ProductionService,
  OrderMutationService,
  OrganisationService,
  PlatformService,
  PurchasingService,
  ReadonlyCollectionService,
  ReasonCode,
  RecipeVersion,
  SalesService,
  Scope,
  ScopedQuery,
  SecurityService,
  StationRoutingRule,
  TreasuryService,
  SubstituteGroup,
  ServiceRegistry,
  WorkforceService,
} from "./types";
import { ServiceError } from "./types";

import { branchById, branches, brands, centralKitchens, stations, stockLocations, tables, tenants, terminals, warehouses } from "../mock/org";
import { combos, menuCategories, menuItems, modifierGroups, priceLists, recipes } from "../mock/catalogue";
import { stockItems } from "../mock/stock-items";
import { batches, countSessions, stockAdjustments, stockLevels, stockMovements, transfers, wasteRecords } from "../mock/inventory";
import { goodsReceipts, purchaseOrders, requisitions, supplierInvoices, suppliers } from "../mock/purchasing";
import { kitchenTickets, openOrders, orders } from "../mock/sales";
import { attendanceRecords, employees, employeePerformance, overtimeRecords, scheduledShifts } from "../mock/workforce";
import { cashSessions, dayCloses, expenses, paymentSummary, taxSummary } from "../mock/finance";
import { anomalyFlags, approvalRequests, auditEntries, roles, sodConflicts, users } from "../mock/governance";
import { countryPacks, integrations, reportCatalogue } from "../mock/platform";
import {
  branchProfitability,
  branchRanking,
  channelProfitability,
  contributionMargin,
  dashboard,
  foodCostByBranch,
  foodCostByBrand,
  foodCostByCategory,
  varianceRows,
  wasteByEmployeeRows,
  wasteByItemRows,
  wasteByLocationRows,
  wasteByReasonRows,
  wasteTotals,
} from "../mock/analytics";

// ---------------------------------------------------------------------------
// Transport simulation
// ---------------------------------------------------------------------------

export type FailureMode = "none" | "error" | "empty" | "slow";

let failureMode: FailureMode = "none";

/** Drives the demo of the loading, empty and error states. */
export function setFailureMode(mode: FailureMode): void {
  failureMode = mode;
}

export function getFailureMode(): FailureMode {
  return failureMode;
}

function latency(): number {
  if (failureMode === "slow") return 2600;
  // Enough to see a skeleton, not enough to be annoying.
  return 140 + Math.floor(Math.random() * 180);
}

async function transport<T>(produce: () => T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, latency()));
  if (failureMode === "error") {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      "The reporting service did not respond.",
      503,
      "Simulated failure. Switch the data mode back to Normal in Settings → Demo controls.",
    );
  }
  return produce();
}

function emptyPage<T>(): Page<T> {
  return { rows: [], total: 0, cursor: null };
}

// ---------------------------------------------------------------------------
// Generic in-memory collection
// ---------------------------------------------------------------------------

type Accessor<T> = (row: T) => unknown;

interface CollectionConfig<T> {
  rows: T[];
  idOf: (row: T) => Id;
  /** Fields the free-text search box looks at. */
  search?: (row: T) => (string | Localised | null | undefined)[];
  branchOf?: (row: T) => Id | null;
  brandOf?: (row: T) => Id | null;
  /** Named filters exposed to the UI toolbar. */
  filters?: Record<string, Accessor<T>>;
  /** Named sort keys. */
  sorters?: Record<string, Accessor<T>>;
  /** Builds a new row for `create`. Omit to make the collection read-only. */
  factory?: (input: Partial<T>, id: Id) => T;
}

function textOf(value: string | Localised | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return `${value.en} ${value.ar}`;
}

/** Strip Arabic diacritics and normalise alef/ya/ta-marbuta — FR-POS-012. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function makeCollection<T>(config: CollectionConfig<T>): CollectionService<T> {
  const store = config.rows;

  function applyScope(rows: T[], scope?: Scope): T[] {
    if (!scope) return rows;
    let out = rows;
    if (scope.branchId && config.branchOf) {
      out = out.filter((row) => {
        const branchId = config.branchOf!(row);
        return branchId === null || branchId === scope.branchId;
      });
    } else if (scope.brandId) {
      out = out.filter((row) => {
        if (config.brandOf) {
          const brandId = config.brandOf(row);
          return brandId === null || brandId === scope.brandId;
        }
        if (config.branchOf) {
          const branchId = config.branchOf(row);
          if (branchId === null) return true;
          return branchById.get(branchId)?.brandId === scope.brandId;
        }
        return true;
      });
    }
    return out;
  }

  return {
    async list(query: ScopedQuery = {}) {
      return transport(() => {
        if (failureMode === "empty") return emptyPage<T>();

        let rows = applyScope(store, query.scope);

        if (query.search && query.search.trim() && config.search) {
          const needle = normalise(query.search.trim());
          rows = rows.filter((row) =>
            config
              .search!(row)
              .some((field) => normalise(textOf(field)).includes(needle)),
          );
        }

        if (query.filters) {
          for (const [key, expected] of Object.entries(query.filters)) {
            if (expected === undefined || expected === "" || expected === "all") continue;
            const accessor = config.filters?.[key];
            if (!accessor) continue;
            rows = rows.filter((row) => String(accessor(row)) === String(expected));
          }
        }

        if (query.sort) {
          const desc = query.sort.startsWith("-");
          const key = desc ? query.sort.slice(1) : query.sort;
          const accessor = config.sorters?.[key];
          if (accessor) {
            rows = [...rows].sort((a, b) => {
              const result = compare(accessor(a), accessor(b));
              return desc ? -result : result;
            });
          }
        }

        const total = rows.length;
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 25;
        return { rows: rows.slice(offset, offset + limit), total, cursor: null };
      });
    },

    async get(id: Id) {
      return transport(() => store.find((row) => config.idOf(row) === id) ?? null);
    },

    async create(input: Partial<T>) {
      if (!config.factory) {
        throw new ServiceError("READ_ONLY", "This collection cannot be written to.", 405);
      }
      return transport(() => {
        const id = `new_${Math.random().toString(36).slice(2, 10)}`;
        const row = config.factory!(input, id);
        store.unshift(row);
        return row;
      });
    },

    async update(id: Id, patch: Partial<T>) {
      return transport(() => {
        const index = store.findIndex((row) => config.idOf(row) === id);
        if (index === -1) {
          throw new ServiceError("NOT_FOUND", "That record no longer exists.", 404);
        }
        const updated = { ...store[index]!, ...patch };
        store[index] = updated;
        return updated;
      });
    },

    async remove(id: Id) {
      return transport(() => {
        const index = store.findIndex((row) => config.idOf(row) === id);
        if (index === -1) {
          throw new ServiceError("NOT_FOUND", "That record no longer exists.", 404);
        }
        store.splice(index, 1);
      });
    },
  };
}

function readonlyOf<T>(service: CollectionService<T>): ReadonlyCollectionService<T> {
  return { list: service.list, get: service.get };
}

/** Wrap a plain array as a read-only, scope-aware collection. */
function staticCollection<T>(config: CollectionConfig<T>): ReadonlyCollectionService<T> {
  return readonlyOf(makeCollection(config));
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

const brandsCollection: CollectionService<Brand> = makeCollection<Brand>({
  rows: brands,
  idOf: (b) => b.id,
  search: (b) => [b.name, b.code],
  brandOf: (b) => b.id,
  filters: { active: (b) => b.active },
  sorters: { name: (b) => b.name.en, branchCount: (b) => b.branchCount },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    name: (input.name as Localised) ?? { en: "New brand", ar: "علامة جديدة" },
    code: input.code ?? "NEW",
    colour: input.colour ?? "#0f6f7a",
    branchCount: 0,
    active: true,
  }),
});

const branchesCollection: CollectionService<Branch> = makeCollection<Branch>({
  rows: branches,
  idOf: (b) => b.id,
  search: (b) => [b.name, b.code, b.address],
  branchOf: (b) => b.id,
  brandOf: (b) => b.brandId,
  filters: {
    brandId: (b) => b.brandId,
    active: (b) => b.active,
    isFranchise: (b) => b.isFranchise,
    countryCode: (b) => b.countryCode,
  },
  sorters: {
    name: (b) => b.name.en,
    seats: (b) => b.seats,
    openedAt: (b) => b.openedAt,
  },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    brandId: input.brandId ?? brands[0]!.id,
    name: (input.name as Localised) ?? { en: "New branch", ar: "فرع جديد" },
    code: input.code ?? "NEW-000",
    countryCode: input.countryCode ?? "EG",
    currency: input.currency ?? "EGP",
    timezone: input.timezone ?? "Africa/Cairo",
    businessDayBoundary: input.businessDayBoundary ?? "04:00",
    seats: input.seats ?? 40,
    areaSqm: input.areaSqm ?? 120,
    openedAt: input.openedAt ?? new Date().toISOString().slice(0, 10),
    active: true,
    isFranchise: input.isFranchise ?? false,
    address: input.address ?? "",
    driveThroughEnabled: input.driveThroughEnabled ?? false,
  }),
});

const warehousesCollection: CollectionService<Warehouse> = makeCollection<Warehouse>({
  rows: warehouses,
  idOf: (w) => w.id,
  search: (w) => [w.name, w.code],
  filters: { active: (w) => w.active },
  sorters: { name: (w) => w.name.en },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    name: (input.name as Localised) ?? { en: "New warehouse", ar: "مستودع جديد" },
    code: input.code ?? "WH-NEW",
    warehouseType: input.warehouseType ?? (input.attachedBranchId ? "branch" : "central"),
    attachedBranchId: input.attachedBranchId ?? null,
    countryCode: input.countryCode ?? "EG",
    active: true,
  }),
});

const centralKitchensCollection: CollectionService<CentralKitchen> = makeCollection<CentralKitchen>({
  rows: centralKitchens,
  idOf: (c) => c.id,
  search: (c) => [c.name, c.code],
  filters: { active: (c) => c.active },
  sorters: { name: (c) => c.name.en },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    name: (input.name as Localised) ?? { en: "New central kitchen", ar: "مطبخ مركزي جديد" },
    code: input.code ?? "CK-NEW",
    countryCode: input.countryCode ?? "EG",
    servesBranchIds: input.servesBranchIds ?? [],
    active: true,
  }),
});

/**
 * Branch configuration fixtures.
 *
 * Every branch opens 10:00–23:00 seven days a week with a 04:00 business-day
 * cutover, which is the shape FR-FIN-024 cares about: a sale at 01:30 belongs
 * to the previous trading day, not to the calendar one.
 */
const demoOperatingHours: OperatingHours[] = branches.flatMap((branch) =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    id: `oh_${branch.id}_${dayOfWeek}`,
    branchId: branch.id,
    dayOfWeek,
    opensAt: "10:00",
    closesAt: "23:00",
    businessDayCutover: branch.businessDayBoundary || "04:00",
    overnight: false,
  })),
);

const demoPrintRouting: PrintRoutingRule[] = branches.flatMap((branch) => [
  {
    id: `pr_${branch.id}_receipt`,
    branchId: branch.id,
    documentType: "receipt",
    printerTarget: "front-counter",
    stationId: null,
  },
  {
    id: `pr_${branch.id}_kitchen`,
    branchId: branch.id,
    documentType: "kitchen_ticket",
    printerTarget: "kitchen-1",
    stationId: stations.find((station) => station.branchId === branch.id)?.id ?? null,
  },
]);

const demoStationRouting: StationRoutingRule[] = stations.map((station, index) => ({
  id: `srr_${station.id}`,
  branchId: station.branchId,
  stationId: station.id,
  categoryId: menuCategories[index % menuCategories.length]?.id ?? null,
  menuItemId: null,
  modifierId: null,
  priority: 10 + index,
}));

const organisation: OrganisationService = {
  tenants: staticCollection({
    rows: tenants,
    idOf: (t) => t.id,
    search: (t) => [t.name, t.slug],
    filters: { state: (t) => t.state, plan: (t) => t.plan, countryCode: (t) => t.countryCode },
    sorters: { name: (t) => t.name.en, branchCount: (t) => t.branchCount, createdAt: (t) => t.createdAt },
  }),
  brands: brandsCollection,
  branches: branchesCollection,
  warehouses: warehousesCollection,
  centralKitchens: centralKitchensCollection,
  async locations() {
    return transport(() => stockLocations);
  },

  async reassignBranchBrand(branchId, brandId) {
    return transport(() => {
      const index = branches.findIndex((row) => row.id === branchId);
      if (index === -1) throw new ServiceError("NOT_FOUND", "That branch no longer exists.", 404);
      branches[index] = { ...branches[index]!, brandId };
    });
  },

  // -- Branch configuration --------------------------------------------------

  async operatingHours(branchId) {
    return transport(() => demoOperatingHours.filter((row) => row.branchId === branchId));
  },

  async addOperatingHours(branchId, input) {
    return transport(() => {
      const created: OperatingHours = {
        id: `oh_${branchId}_${demoOperatingHours.length + 1}`,
        branchId,
        dayOfWeek: input.dayOfWeek,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        businessDayCutover: input.businessDayCutover ?? "04:00",
        // An interval that closes before it opens has crossed midnight.
        overnight: input.closesAt <= input.opensAt,
      };
      demoOperatingHours.push(created);
      return created;
    });
  },

  async printRouting(branchId) {
    return transport(() => demoPrintRouting.filter((row) => row.branchId === branchId));
  },

  async addPrintRouting(branchId, input) {
    return transport(() => {
      const created: PrintRoutingRule = {
        id: `pr_${branchId}_${demoPrintRouting.length + 1}`,
        branchId,
        documentType: input.documentType,
        printerTarget: input.printerTarget,
        stationId: input.stationId ?? null,
      };
      demoPrintRouting.push(created);
      return created;
    });
  },

  async stationRoutingRules(branchId) {
    return transport(() =>
      demoStationRouting
        .filter((row) => row.branchId === branchId)
        .sort((a, b) => b.priority - a.priority),
    );
  },

  async addStationRoutingRule(branchId, input) {
    return transport(() => {
      const created: StationRoutingRule = {
        id: `srr_${branchId}_${demoStationRouting.length + 1}`,
        branchId,
        stationId: input.stationId,
        categoryId: input.categoryId ?? null,
        menuItemId: input.menuItemId ?? null,
        modifierId: input.modifierId ?? null,
        priority: input.priority ?? 10,
      };
      demoStationRouting.push(created);
      return created;
    });
  },

  async station(stationId) {
    return transport(() => stations.find((row) => row.id === stationId) ?? null);
  },
};

// ---------------------------------------------------------------------------
// Sales and operations
// ---------------------------------------------------------------------------

const ordersCollection: CollectionService<Order> = makeCollection<Order>({
  rows: orders,
  idOf: (o) => o.id,
  search: (o) => [o.orderNumber, o.branchName, o.customerName, o.tableLabel, o.aggregatorRef],
  branchOf: (o) => o.branchId,
  filters: {
    state: (o) => o.state,
    orderType: (o) => o.orderType,
    channel: (o) => o.channel,
    businessDay: (o) => o.businessDay,
    syncState: (o) => o.syncState,
  },
  sorters: {
    openedAt: (o) => o.openedAt,
    grandTotal: (o) => o.grandTotal.amount,
    orderNumber: (o) => o.orderNumber,
  },
});

/**
 * The demo has no order engine behind `services` — the POS drives the live
 * reducer in `lib/console/live/` instead, which is a far richer simulation
 * than these five endpoints. So rather than build a second, worse one here,
 * each mutation says plainly that this path needs a backend.
 */
function noBackend(action: string): never {
  throw new ServiceError(
    "NO_BACKEND",
    "Demo mode cannot do that — the POS runs on its own local engine here.",
    501,
    `${action} needs NEXT_PUBLIC_API_URL pointed at the backend.`,
  );
}

const orderMutations: OrderMutationService = {
  async open() {
    noBackend("Opening an order through the service layer");
  },
  async get(_businessDay, orderId) {
    const found = await ordersCollection.get(orderId);
    if (!found) throw new ServiceError("NOT_FOUND", "That order no longer exists.", 404);
    return found;
  },
  async addLine() {
    noBackend("Capturing an order line");
  },
  async voidLine() {
    noBackend("Voiding an order line");
  },
  async fire() {
    noBackend("Firing an order");
  },
  async capturePayment() {
    noBackend("Capturing a payment");
  },
  async discountOrder() {
    noBackend("Discounting an order");
  },
  async discountLine() {
    noBackend("Discounting a line");
  },
  async comp() {
    noBackend("Comping a line");
  },
  async voidLinePostFire() {
    noBackend("Voiding a fired line");
  },
  async refund() {
    noBackend("Issuing a refund");
  },
};

const sales: SalesService = {
  orders: readonlyOf(ordersCollection),
  mutations: orderMutations,
  async receipt() {
    noBackend("Reading an order receipt");
  },
};

/**
 * The drawer is not simulated here.
 *
 * Demo mode already has a till — the in-memory engine in
 * `lib/console/live/`, which the POS and the cash-sessions screen both read.
 * A second, divergent drawer behind the service layer would give two
 * different answers to "what is in the till", so every treasury call refuses
 * and names the environment variable that makes it work.
 */
const treasury: TreasuryService = {
  async openCashSession() {
    noBackend("Opening a cash session");
  },
  async recordMovement() {
    noBackend("Recording a cash movement");
  },
  async closeContext() {
    noBackend("Reading a cash session's close context");
  },
  async declareClose() {
    noBackend("Declaring a cash count");
  },
  async finalizeClose() {
    noBackend("Finalising an above-tolerance close");
  },
  async setCashClosePolicy() {
    noBackend("Publishing a cash-close policy");
  },
};

const openOrdersCollection: CollectionService<Order> = makeCollection<Order>({
  rows: openOrders,
  idOf: (o) => o.id,
  search: (o) => [o.orderNumber, o.branchName, o.tableLabel],
  branchOf: (o) => o.branchId,
  filters: { state: (o) => o.state, orderType: (o) => o.orderType },
  sorters: { openedAt: (o) => o.openedAt, grandTotal: (o) => o.grandTotal.amount },
});

const tablesCollection: CollectionService<RestaurantTable> = makeCollection<RestaurantTable>({
  rows: tables,
  idOf: (t) => t.id,
  search: (t) => [t.label, t.area],
  branchOf: (t) => t.branchId,
  filters: { state: (t) => t.state, area: (t) => t.area.en },
  sorters: { label: (t) => t.label, capacity: (t) => t.capacity, seatedAt: (t) => t.seatedAt ?? "" },
});

const ticketsCollection: CollectionService<KitchenTicket> = makeCollection<KitchenTicket>({
  rows: kitchenTickets,
  idOf: (t) => t.id,
  search: (t) => [t.orderNumber, t.stationName, t.tableLabel],
  branchOf: (t) => t.branchId,
  filters: { state: (t) => t.state, urgency: (t) => t.urgency, stationId: (t) => t.stationId, priority: (t) => t.priority },
  sorters: { elapsedSeconds: (t) => t.elapsedSeconds, firedAt: (t) => t.firedAt },
});

const terminalsCollection: CollectionService<Terminal> = makeCollection<Terminal>({
  rows: terminals,
  idOf: (t) => t.id,
  search: (t) => [t.name, t.code, t.ipAddress],
  branchOf: (t) => t.branchId,
  filters: { status: (t) => t.status, kind: (t) => t.kind, appVersion: (t) => t.appVersion },
  sorters: {
    name: (t) => t.name,
    lastSeenAt: (t) => t.lastSeenAt,
    queuedOperations: (t) => t.queuedOperations,
  },
});

const stationsCollection: CollectionService<Station> = makeCollection<Station>({
  rows: stations,
  idOf: (s) => s.id,
  search: (s) => [s.name],
  branchOf: (s) => s.branchId,
  filters: { type: (s) => s.type, active: (s) => s.active },
  sorters: { name: (s) => s.name.en, capacityPerHour: (s) => s.capacityPerHour },
});

const operations: OperationsService = {
  openOrders: (q) => openOrdersCollection.list(q),
  tables: (q) => tablesCollection.list(q),
  kitchenQueue: (q) => ticketsCollection.list(q),
  terminals: (q) => terminalsCollection.list(q),
  stations: (q) => stationsCollection.list(q),

  setTerminalStatus: (terminalId, status) =>
    terminalsCollection.update(terminalId, {
      // The demo dataset speaks the console's vocabulary, not the API's.
      status: status === "revoked" ? "revoked" : status === "disabled" ? "offline" : "online",
    }),

  createTable: (branchId, input) => tablesCollection.create({ ...input, branchId }),
  updateTable: (tableId, patch) => tablesCollection.update(tableId, patch),
  createStation: (branchId, input) => stationsCollection.create({ ...input, branchId }),
  updateStation: (stationId, patch) => stationsCollection.update(stationId, patch),
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const itemsCollection: CollectionService<MenuItem> = makeCollection<MenuItem>({
  rows: menuItems,
  idOf: (m) => m.id,
  search: (m) => [m.name, m.kitchenName, m.description],
  filters: {
    categoryId: (m) => m.categoryId,
    available: (m) => m.available,
    taxClass: (m) => m.taxClass,
    stationType: (m) => m.stationType,
  },
  sorters: {
    name: (m) => m.name.en,
    price: (m) => m.variants[0]?.basePrice.amount ?? 0,
    prepTimeSeconds: (m) => m.prepTimeSeconds,
    sortOrder: (m) => m.sortOrder,
  },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    categoryId: input.categoryId ?? menuCategories[0]!.id,
    name: (input.name as Localised) ?? { en: "New item", ar: "صنف جديد" },
    kitchenName: (input.kitchenName as Localised) ?? { en: "NEW", ar: "جديد" },
    receiptName: (input.receiptName as Localised) ?? { en: "New item", ar: "صنف جديد" },
    description: (input.description as Localised) ?? { en: "", ar: "" },
    taxClass: input.taxClass ?? "standard",
    stationType: input.stationType ?? "hot_line",
    prepTimeSeconds: input.prepTimeSeconds ?? 300,
    variants: input.variants ?? [
      {
        id: `${id}_v1`,
        name: { en: "Standard", ar: "عادي" },
        basePrice: { amount: 0, currency: "EGP" },
        barcode: null,
        recipeId: null,
        available: true,
      },
    ],
    allergens: input.allergens ?? [],
    isCombo: false,
    isOpenPrice: input.isOpenPrice ?? false,
    isWeighed: input.isWeighed ?? false,
    available: true,
    unavailableReason: null,
    remainingSellable: null,
    sortOrder: menuItems.length + 1,
    colour: input.colour ?? "#0f6f7a",
    imageEmoji: input.imageEmoji ?? "",
  }),
});

/**
 * Demo menus — FR-MNU-001/002.
 *
 * The fixture set has categories and items but never had the menus above
 * them, because nothing rendered menus until the backend's seven menu
 * endpoints were wired. Three is enough to exercise the screen: a default
 * all-day menu on every branch, a breakfast menu that outranks it in the
 * morning, and a delivery menu assigned to one branch only.
 */
const demoMenus: Menu[] = [
  {
    id: "menu_all_day",
    tenantId: tenants[0]!.id,
    name: { en: "All-day menu", ar: "قائمة اليوم الكامل" },
    priority: 10,
    orderTypes: ["dine_in", "takeaway"],
    branchIds: branches.map((branch) => branch.id),
    active: true,
    createdAt: new Date("2025-01-06T08:00:00Z").toISOString(),
  },
  {
    id: "menu_breakfast",
    tenantId: tenants[0]!.id,
    name: { en: "Breakfast", ar: "الإفطار" },
    priority: 50,
    orderTypes: ["dine_in"],
    branchIds: branches.slice(0, 2).map((branch) => branch.id),
    active: true,
    createdAt: new Date("2025-02-11T06:00:00Z").toISOString(),
  },
  {
    id: "menu_delivery",
    tenantId: tenants[0]!.id,
    name: { en: "Delivery", ar: "التوصيل" },
    priority: 30,
    orderTypes: ["delivery"],
    branchIds: branches.slice(0, 1).map((branch) => branch.id),
    active: false,
    createdAt: new Date("2025-03-02T10:00:00Z").toISOString(),
  },
];

const menusCollection: CollectionService<Menu> = makeCollection<Menu>({
  rows: demoMenus,
  idOf: (m) => m.id,
  search: (m) => [m.name],
  branchOf: (m) => (m.branchIds.length === 0 ? null : (m.branchIds[0] ?? null)),
  filters: { active: (m) => m.active },
  sorters: { name: (m) => m.name.en, priority: (m) => m.priority },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    name: (input.name as Localised) ?? { en: "New menu", ar: "قائمة جديدة" },
    priority: input.priority ?? 10,
    orderTypes: input.orderTypes ?? ["dine_in"],
    branchIds: input.branchIds ?? [],
    active: true,
    createdAt: new Date().toISOString(),
  }),
});

const catalogue: CatalogueService = {
  categories: makeCollection({
    rows: menuCategories,
    idOf: (c) => c.id,
    search: (c) => [c.name],
    filters: { active: (c) => c.active },
    sorters: { name: (c) => c.name.en, sortOrder: (c) => c.sortOrder, itemCount: (c) => c.itemCount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      name: (input.name as Localised) ?? { en: "New category", ar: "فئة جديدة" },
      parentId: null,
      sortOrder: menuCategories.length + 1,
      colour: input.colour ?? "#0f6f7a",
      itemCount: 0,
      active: true,
    }),
  }),
  items: itemsCollection,
  modifierGroups: makeCollection({
    rows: modifierGroups,
    idOf: (g) => g.id,
    search: (g) => [g.name, ...g.modifiers.map((m) => m.name)],
    filters: { required: (g) => g.required },
    sorters: { name: (g) => g.name.en, attachedItemCount: (g) => g.attachedItemCount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      name: (input.name as Localised) ?? { en: "New group", ar: "مجموعة جديدة" },
      minSelections: input.minSelections ?? 0,
      maxSelections: input.maxSelections ?? 1,
      required: input.required ?? false,
      allowRepeat: input.allowRepeat ?? false,
      freeQuantityThreshold: null,
      modifiers: input.modifiers ?? [],
      attachedItemCount: 0,
    }),
  }),
  combos: makeCollection({
    rows: combos,
    idOf: (c) => c.id,
    search: (c) => [c.name],
    filters: { active: (c) => c.active, pricingStrategy: (c) => c.pricingStrategy },
    sorters: { name: (c) => c.name.en, price: (c) => c.price.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      name: (input.name as Localised) ?? { en: "New combo", ar: "كومبو جديد" },
      price: input.price ?? { amount: 0, currency: "EGP" },
      pricingStrategy: input.pricingStrategy ?? "fixed",
      slots: input.slots ?? [],
      active: true,
    }),
  }),
  priceLists: makeCollection({
    rows: priceLists,
    idOf: (p) => p.id,
    search: (p) => [p.name],
    filters: { scope: (p) => p.scope, active: (p) => p.active },
    sorters: { name: (p) => p.name.en, priority: (p) => p.priority, validFrom: (p) => p.validFrom },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      name: (input.name as Localised) ?? { en: "New price list", ar: "قائمة أسعار جديدة" },
      scope: input.scope ?? "tenant",
      scopeId: input.scopeId ?? null,
      orderTypes: input.orderTypes ?? ["dine_in"],
      priority: input.priority ?? 10,
      validFrom: input.validFrom ?? new Date().toISOString().slice(0, 10),
      validTo: null,
      recurrence: null,
      entryCount: 0,
      entries: [],
      active: true,
    }),
  }),
  recipes: makeCollection({
    rows: recipes,
    idOf: (r) => r.id,
    search: (r) => [r.name, r.targetName],
    filters: {
      status: (r) => r.status,
      recipeType: (r) => r.recipeType,
      complete: (r) => r.complete,
    },
    sorters: {
      name: (r) => r.name.en,
      cost: (r) => r.computedCost.amount,
      version: (r) => r.version,
      margin: (r) =>
        r.sellingPrice ? r.sellingPrice.amount - r.computedCost.amount : -Infinity,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      name: (input.name as Localised) ?? { en: "New recipe", ar: "وصفة جديدة" },
      recipeType: input.recipeType ?? "menu_item",
      targetId: null,
      targetName: null,
      version: 1,
      status: "draft",
      yieldQuantity: input.yieldQuantity ?? { value: "1.000000", unit: "pc" },
      yieldPercentage: input.yieldPercentage ?? 100,
      prepTimeSeconds: input.prepTimeSeconds ?? 300,
      lines: input.lines ?? [],
      computedCost: { amount: 0, currency: "EGP" },
      costPerPortion: { amount: 0, currency: "EGP" },
      sellingPrice: null,
      costComputedAt: new Date().toISOString(),
      effectiveFrom: new Date().toISOString().slice(0, 10),
      complete: false,
      instructions: { en: "", ar: "" },
    }),
  }),
  menus: menusCollection,

  async toggleAvailability(itemId, available, reason) {
    return transport(() => {
      const index = menuItems.findIndex((m) => m.id === itemId);
      if (index === -1) {
        throw new ServiceError("NOT_FOUND", "That menu item no longer exists.", 404);
      }
      const updated = {
        ...menuItems[index]!,
        available,
        unavailableReason: available ? null : (reason ?? "Manually 86'd"),
      };
      menuItems[index] = updated;
      return updated;
    });
  },

  // -- Menu assignment -------------------------------------------------------

  async assignMenuToBranch(menuId, branchId) {
    return transport(() => {
      const menu = demoMenus.find((row) => row.id === menuId);
      if (!menu) throw new ServiceError("NOT_FOUND", "That menu no longer exists.", 404);
      if (!menu.branchIds.includes(branchId)) menu.branchIds = [...menu.branchIds, branchId];
    });
  },

  async unassignMenuFromBranch(menuId, branchId) {
    return transport(() => {
      const menu = demoMenus.find((row) => row.id === menuId);
      if (!menu) throw new ServiceError("NOT_FOUND", "That menu no longer exists.", 404);
      menu.branchIds = menu.branchIds.filter((id) => id !== branchId);
    });
  },

  async resolveBranchMenus(branchId) {
    return transport(() => {
      const assigned = demoMenus
        .filter((menu) => menu.active && menu.branchIds.includes(branchId))
        .sort((a, b) => b.priority - a.priority);

      // FR-MNU-003 — equal priorities make the winner non-deterministic.
      const priorities = assigned.map((menu) => menu.priority);
      const ambiguous = new Set(priorities).size !== priorities.length;

      return {
        menus: assigned,
        ambiguous,
        warning: ambiguous
          ? "Two or more menus share a priority; resolution order is not deterministic."
          : null,
      };
    });
  },

  async setMenuActive(menuId, active) {
    return menusCollection.update(menuId, { active });
  },

  // -- Item composition ------------------------------------------------------

  async placeItem(itemId, categoryId) {
    return transport(() => {
      const index = menuItems.findIndex((m) => m.id === itemId);
      if (index === -1) throw new ServiceError("NOT_FOUND", "That item no longer exists.", 404);
      menuItems[index] = { ...menuItems[index]!, categoryId };
    });
  },

  async unplaceItem(itemId) {
    return transport(() => {
      const index = menuItems.findIndex((m) => m.id === itemId);
      if (index === -1) throw new ServiceError("NOT_FOUND", "That item no longer exists.", 404);
      menuItems[index] = { ...menuItems[index]!, categoryId: "" };
    });
  },

  async addVariant(itemId, input) {
    return transport(() => {
      const index = menuItems.findIndex((m) => m.id === itemId);
      if (index === -1) throw new ServiceError("NOT_FOUND", "That item no longer exists.", 404);

      const variant = {
        id: `var_${itemId}_${menuItems[index]!.variants.length + 1}`,
        name: input.name ?? { en: "New variant", ar: "خيار جديد" },
        basePrice: input.basePrice ?? { amount: 0, currency: "EGP" as const },
        barcode: input.barcode ?? null,
        recipeId: null,
        available: true,
      };

      menuItems[index] = {
        ...menuItems[index]!,
        variants: [...menuItems[index]!.variants, variant],
      };
      return variant;
    });
  },

  async setVariantActive(variantId, active) {
    return transport(() => {
      for (let index = 0; index < menuItems.length; index += 1) {
        const item = menuItems[index]!;
        if (!item.variants.some((variant) => variant.id === variantId)) continue;
        menuItems[index] = {
          ...item,
          variants: item.variants.map((variant) =>
            variant.id === variantId ? { ...variant, available: active } : variant,
          ),
        };
        return;
      }
      throw new ServiceError("NOT_FOUND", "That variant no longer exists.", 404);
    });
  },

  async linkModifierGroup(itemId, groupId) {
    return transport(() => {
      if (!menuItems.some((m) => m.id === itemId)) {
        throw new ServiceError("NOT_FOUND", "That item no longer exists.", 404);
      }
      const group = modifierGroups.find((row) => row.id === groupId);
      if (!group) throw new ServiceError("NOT_FOUND", "That group no longer exists.", 404);

      // `MenuItem` carries no list of attached groups, and the API has no
      // endpoint to read one back either — the attachment is only observable
      // as the group's own count, so that is what moves.
      group.attachedItemCount += 1;
    });
  },

  async addModifier(groupId, input) {
    return transport(() => {
      const group = modifierGroups.find((row) => row.id === groupId);
      if (!group) throw new ServiceError("NOT_FOUND", "That group no longer exists.", 404);

      const modifier = {
        id: `mod_${groupId}_${group.modifiers.length + 1}`,
        name: input.name ?? { en: "New modifier", ar: "إضافة جديدة" },
        kind: input.kind ?? ("addition" as const),
        priceDelta: input.priceDelta ?? { amount: 0, currency: "EGP" as const },
        recipeDelta: input.recipeDelta ?? [],
        isDefault: input.isDefault ?? false,
      };

      group.modifiers = [...group.modifiers, modifier];
      return modifier;
    });
  },

  // -- Pricing ---------------------------------------------------------------

  async setPrice(priceListId, variantId, price) {
    return transport(() => {
      const list = priceLists.find((row) => row.id === priceListId);
      if (!list) throw new ServiceError("NOT_FOUND", "That price list no longer exists.", 404);

      const owner = menuItems.find((item) =>
        item.variants.some((variant) => variant.id === variantId),
      );

      const existing = list.entries.find((entry) => entry.variantId === variantId);
      const entry = {
        menuItemId: owner?.id ?? "",
        variantId,
        itemName: owner?.name ?? { en: "", ar: "" },
        price,
        previousPrice: existing?.price ?? null,
      };

      list.entries = existing
        ? list.entries.map((row) => (row.variantId === variantId ? entry : row))
        : [...list.entries, entry];
      list.entryCount = list.entries.length;

      return entry;
    });
  },

  async priceEntries(priceListId) {
    return transport(() => priceLists.find((row) => row.id === priceListId)?.entries ?? []);
  },

  // -- Readiness -------------------------------------------------------------

  async completeness() {
    return transport(() => {
      const unpricedVariants = menuItems.flatMap((item) =>
        item.variants
          .filter((variant) => variant.available && variant.basePrice.amount === 0)
          .map((variant) => ({ menuItemId: item.id, variantId: variant.id })),
      );

      const itemsWithoutActiveVariant = menuItems
        .filter((item) => item.available && item.variants.every((v) => !v.available))
        .map((item) => item.id);

      return {
        sellable: unpricedVariants.length === 0 && itemsWithoutActiveVariant.length === 0,
        unpricedVariants,
        itemsWithoutActiveVariant,
        activeListGaps: [],
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const locationBranch = (locationId: Id): Id | null =>
  branchById.has(locationId) ? locationId : null;

/** Demo reason codes — FR-INV-013. The fixtures reference these by id. */
const demoReasonCodes: ReasonCode[] = [
  { id: "rsn_spoilage", code: "SPOIL", category: "waste", label: { en: "Spoilage", ar: "تلف" } },
  { id: "rsn_breakage", code: "BREAK", category: "waste", label: { en: "Breakage", ar: "كسر" } },
  { id: "rsn_staff_meal", code: "STAFF", category: "waste", label: { en: "Staff meal", ar: "وجبة موظفين" } },
  { id: "rsn_count", code: "COUNT", category: "adjustment", label: { en: "Count adjustment", ar: "تسوية جرد" } },
  { id: "rsn_transfer", code: "XFER", category: "discrepancy", label: { en: "Transfer discrepancy", ar: "فرق تحويل" } },
];

/** Per-item, per-location reorder configuration — FR-INV-065. */
const demoReorderConfig = new Map<string, { reorderPoint: string; reorderQuantity: string }>();

const nameOfLocation = (locationId: Id): Localised =>
  stockLocations.find((row) => row.id === locationId)?.name ?? { en: locationId, ar: locationId };

const inventory: InventoryService = {
  items: makeCollection({
    rows: stockItems,
    idOf: (s) => s.id,
    search: (s) => [s.name, s.sku, s.category],
    filters: {
      category: (s) => s.category.en,
      storage: (s) => s.storage,
      costingMethod: (s) => s.costingMethod,
      batchTracked: (s) => s.batchTracked,
      active: (s) => s.active,
    },
    sorters: { name: (s) => s.name.en, sku: (s) => s.sku, unitCost: (s) => s.unitCost.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      sku: input.sku ?? `NEW-${id.slice(-4)}`,
      name: (input.name as Localised) ?? { en: "New item", ar: "صنف جديد" },
      category: (input.category as Localised) ?? { en: "Uncategorised", ar: "غير مصنّف" },
      baseUnit: input.baseUnit ?? "g",
      purchaseUnit: input.purchaseUnit ?? "kg",
      purchaseConversion: input.purchaseConversion ?? 1000,
      costingMethod: input.costingMethod ?? "weighted_average",
      batchTracked: input.batchTracked ?? false,
      expiryTracked: input.expiryTracked ?? false,
      storage: input.storage ?? "ambient",
      shelfLifeDays: input.shelfLifeDays ?? null,
      defaultSupplierId: input.defaultSupplierId ?? null,
      allergens: input.allergens ?? [],
      unitCost: input.unitCost ?? { amount: 0, currency: "EGP" },
      active: true,
    }),
  }),
  levels: staticCollection({
    rows: stockLevels,
    idOf: (l) => `${l.locationId}:${l.itemId}`,
    search: (l) => [l.itemName, l.sku, l.locationName],
    branchOf: (l) => locationBranch(l.locationId),
    filters: { status: (l) => l.status, locationId: (l) => l.locationId },
    sorters: {
      itemName: (l) => l.itemName.en,
      onHand: (l) => Number(l.onHand.value),
      value: (l) => l.value.amount,
      daysOfCover: (l) => l.daysOfCover ?? 0,
    },
  }),
  batches: staticCollection({
    rows: batches,
    idOf: (b) => b.id,
    search: (b) => [b.itemName, b.batchNumber, b.locationName],
    branchOf: (b) => locationBranch(b.locationId),
    filters: { status: (b) => b.status, locationId: (b) => b.locationId },
    sorters: {
      expiryDate: (b) => b.expiryDate,
      daysToExpiry: (b) => b.daysToExpiry,
      value: (b) => b.value.amount,
      itemName: (b) => b.itemName.en,
    },
  }),
  movements: staticCollection({
    rows: stockMovements,
    idOf: (m) => m.id,
    search: (m) => [m.itemName, m.locationName, m.referenceId, m.performedByName],
    branchOf: (m) => locationBranch(m.locationId),
    filters: {
      movementType: (m) => m.movementType,
      locationId: (m) => m.locationId,
      referenceType: (m) => m.referenceType,
    },
    sorters: {
      occurredAt: (m) => m.occurredAt,
      totalCost: (m) => m.totalCost.amount,
      quantity: (m) => Number(m.quantity.value),
    },
  }),
  counts: makeCollection({
    rows: countSessions,
    idOf: (c) => c.id,
    search: (c) => [c.reference, c.locationName, c.scope, c.countedByName],
    branchOf: (c) => locationBranch(c.locationId),
    filters: { status: (c) => c.status, mode: (c) => c.mode, locationId: (c) => c.locationId },
    sorters: {
      openedAt: (c) => c.openedAt,
      netVarianceValue: (c) => Math.abs(c.netVarianceValue.amount),
      flaggedCount: (c) => c.flaggedCount,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      locationId: input.locationId ?? branches[0]!.id,
      locationName: (input.locationName as Localised) ?? branches[0]!.name,
      reference: `CNT-${Math.floor(Math.random() * 9000) + 1000}`,
      scope: (input.scope as Localised) ?? { en: "Ad-hoc list", ar: "قائمة مخصصة" },
      mode: input.mode ?? "blind",
      status: "draft",
      openedAt: new Date().toISOString(),
      submittedAt: null,
      postedAt: null,
      countedBy: employees[0]!.id,
      countedByName: employees[0]!.name,
      postedBy: null,
      lineCount: 0,
      flaggedCount: 0,
      netVarianceValue: { amount: 0, currency: "EGP" },
      lines: [],
    }),
  }),
  transfers: makeCollection({
    rows: transfers,
    idOf: (t) => t.id,
    search: (t) => [t.reference, t.fromLocationName, t.toLocationName],
    filters: { status: (t) => t.status, fromLocationId: (t) => t.fromLocationId, toLocationId: (t) => t.toLocationId },
    sorters: { dispatchedAt: (t) => t.dispatchedAt ?? "", totalValue: (t) => t.totalValue.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      reference: `TRF-${Math.floor(Math.random() * 9000) + 1000}`,
      fromLocationId: input.fromLocationId ?? branches[0]!.id,
      fromLocationName: (input.fromLocationName as Localised) ?? branches[0]!.name,
      toLocationId: input.toLocationId ?? branches[1]!.id,
      toLocationName: (input.toLocationName as Localised) ?? branches[1]!.name,
      status: "draft",
      dispatchedAt: null,
      receivedAt: null,
      requestedBy: employees[0]!.name,
      lines: input.lines ?? [],
      totalValue: { amount: 0, currency: "EGP" },
    }),
  }),
  waste: makeCollection({
    rows: wasteRecords,
    idOf: (w) => w.id,
    search: (w) => [w.itemName, w.locationName, w.reasonName, w.recordedByName],
    branchOf: (w) => locationBranch(w.locationId),
    filters: {
      reasonCode: (w) => w.reasonCode,
      category: (w) => w.category,
      isTrueWaste: (w) => w.isTrueWaste,
      approval: (w) => w.approval,
      locationId: (w) => w.locationId,
    },
    sorters: { recordedAt: (w) => w.recordedAt, value: (w) => w.value.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      locationId: input.locationId ?? branches[0]!.id,
      locationName: (input.locationName as Localised) ?? branches[0]!.name,
      itemId: input.itemId ?? stockItems[0]!.id,
      itemName: (input.itemName as Localised) ?? stockItems[0]!.name,
      quantity: input.quantity ?? { value: "0.000", unit: "g" },
      reasonCode: input.reasonCode ?? "spoiled",
      reasonName: (input.reasonName as Localised) ?? { en: "Spoiled", ar: "تالف" },
      category: input.category ?? "storage",
      isTrueWaste: input.isTrueWaste ?? true,
      value: input.value ?? { amount: 0, currency: "EGP" },
      recordedAt: new Date().toISOString(),
      recordedBy: employees[0]!.id,
      recordedByName: employees[0]!.name,
      stationId: null,
      approval: "not_required",
      notes: input.notes ?? null,
    }),
  }),
  adjustments: makeCollection({
    rows: stockAdjustments,
    idOf: (a) => a.id,
    search: (a) => [a.itemName, a.locationName, a.reasonName],
    branchOf: (a) => locationBranch(a.locationId),
    filters: { reasonCode: (a) => a.reasonCode, approval: (a) => a.approval, locationId: (a) => a.locationId },
    sorters: { createdAt: (a) => a.createdAt, value: (a) => a.value.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      locationId: input.locationId ?? branches[0]!.id,
      locationName: (input.locationName as Localised) ?? branches[0]!.name,
      itemId: input.itemId ?? stockItems[0]!.id,
      itemName: (input.itemName as Localised) ?? stockItems[0]!.name,
      quantity: input.quantity ?? { value: "0.000", unit: "g" },
      reasonCode: input.reasonCode ?? "correction",
      reasonName: (input.reasonName as Localised) ?? { en: "Correction", ar: "تصحيح" },
      value: input.value ?? { amount: 0, currency: "EGP" },
      createdAt: new Date().toISOString(),
      createdBy: employees[0]!.name,
      approval: "not_required",
      notes: input.notes ?? null,
    }),
  }),

  // -- Counting --------------------------------------------------------------

  async recordCount(lineId, countedQuantity) {
    return transport(() => {
      for (const session of countSessions) {
        const line = session.lines.find((row) => row.id === lineId);
        if (!line) continue;

        line.counted = { value: countedQuantity, unit: line.expected.unit };
        const expected = Number(line.expected.value);
        const counted = Number(countedQuantity);
        line.varianceQty = counted - expected;
        line.variancePercent = expected === 0 ? 0 : (line.varianceQty / expected) * 100;
        // FR-INV-042 — a variance past the tolerance is flagged for recount.
        line.flagged = Math.abs(line.variancePercent) > 5;
        return;
      }
      throw new ServiceError("NOT_FOUND", "That count line no longer exists.", 404);
    });
  },

  // -- Transfers -------------------------------------------------------------

  async receiveTransfer(input) {
    return transport(() => {
      const transfer = transfers.find((row) => row.id === input.transferReferenceId);
      if (!transfer) {
        throw new ServiceError("NOT_FOUND", "That transfer no longer exists.", 404);
      }
      transfer.status = "received";
      transfer.receivedAt = new Date().toISOString();
    });
  },

  // -- Reorder configuration -------------------------------------------------

  async setReorderConfig(itemId, input) {
    return transport(() => {
      demoReorderConfig.set(`${itemId}:${input.locationId}`, {
        reorderPoint: input.reorderPoint,
        reorderQuantity: input.reorderQuantity,
      });
    });
  },

  // -- Reason codes ----------------------------------------------------------

  async reasonCodes() {
    return transport(() => [...demoReasonCodes]);
  },

  async createReasonCode(input) {
    return transport(() => {
      if (demoReasonCodes.some((row) => row.code === input.code)) {
        throw new ServiceError("CONFLICT", "That reason code already exists.", 409);
      }
      const created: ReasonCode = {
        id: `rsn_${input.code.toLowerCase()}`,
        code: input.code,
        category: input.category,
        label: input.label,
      };
      demoReasonCodes.push(created);
      return created;
    });
  },

  // -- Computed reports ------------------------------------------------------

  async lowStock(query = {}) {
    return transport(() => {
      const rows = stockLevels
        .map((level): LowStockRow | null => {
          // A per-location override set through `setReorderConfig` wins over
          // the fixture's own figure, so the demo reflects what was just set.
          const config = demoReorderConfig.get(`${level.itemId}:${level.locationId}`);
          const point = config ? config.reorderPoint : String(level.reorderPoint);
          if (point === "" || Number(level.onHand.value) > Number(point)) return null;

          const quantity = config ? config.reorderQuantity : String(level.reorderQuantity);

          return {
            stockItemId: level.itemId,
            itemName: level.itemName,
            locationId: level.locationId,
            locationName: nameOfLocation(level.locationId),
            onHand: level.onHand,
            reorderPoint: { value: point, unit: level.onHand.unit },
            reorderQuantity: { value: quantity, unit: level.onHand.unit },
          };
        })
        .filter((row): row is LowStockRow => row !== null);

      const branchId = query.scope?.branchId;
      return branchId ? rows.filter((row) => row.locationId === branchId) : rows;
    });
  },

  async negativeStock(query = {}) {
    return transport(() => {
      const rows = stockLevels
        .filter((level) => Number(level.onHand.value) < 0)
        .map((level) => ({
          stockItemId: level.itemId,
          itemName: level.itemName,
          locationId: level.locationId,
          locationName: nameOfLocation(level.locationId),
          onHand: level.onHand,
        }));

      const branchId = query.scope?.branchId;
      return branchId ? rows.filter((row) => row.locationId === branchId) : rows;
    });
  },

  async reconciliation() {
    return transport(() => ({
      // The demo ledger and its projection are generated from one source,
      // so they agree by construction — which is the honest answer here.
      reconciled: true,
      note: "Demo data: the ledger and the projection are generated together, so they cannot diverge.",
      divergences: [],
    }));
  },
};

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------

const purchaseOrdersCollection: CollectionService<PurchaseOrder> = makeCollection<PurchaseOrder>({
  rows: purchaseOrders,
  idOf: (p) => p.id,
  search: (p) => [p.reference, p.supplierName, p.deliveryLocationName],
  branchOf: (p) => locationBranch(p.deliveryLocationId),
  filters: {
    status: (p) => p.status,
    supplierId: (p) => p.supplierId,
    approvalTier: (p) => p.approvalTier,
  },
  sorters: {
    createdAt: (p) => p.createdAt,
    total: (p) => p.total.amount,
    expectedDelivery: (p) => p.expectedDelivery,
  },
  factory: (input, id) => ({
    id,
    tenantId: tenants[0]!.id,
    reference: `PO-${Math.floor(Math.random() * 9000) + 1000}`,
    supplierId: input.supplierId ?? suppliers[0]!.id,
    supplierName: (input.supplierName as Localised) ?? suppliers[0]!.tradingName,
    deliveryLocationId: input.deliveryLocationId ?? branches[0]!.id,
    deliveryLocationName: (input.deliveryLocationName as Localised) ?? branches[0]!.name,
    status: "draft",
    approvalTier: 0,
    createdBy: employees[0]!.name,
    createdAt: new Date().toISOString(),
    expectedDelivery: new Date().toISOString().slice(0, 10),
    approvedBy: null,
    approvedAt: null,
    lines: input.lines ?? [],
    subtotal: { amount: 0, currency: "EGP" },
    taxTotal: { amount: 0, currency: "EGP" },
    total: { amount: 0, currency: "EGP" },
  }),
});

const purchasing: PurchasingService = {
  suppliers: makeCollection({
    rows: suppliers,
    idOf: (s) => s.id,
    search: (s) => [s.legalName, s.tradingName, s.code, s.contactName, s.email],
    filters: { active: (s) => s.active, currency: (s) => s.currency },
    sorters: {
      name: (s) => s.tradingName.en,
      leadTimeDays: (s) => s.leadTimeDays,
      onTime: (s) => s.scorecard.onTimeDeliveryRate,
      outstanding: (s) => s.outstandingBalance.amount,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      code: input.code ?? `SUP-${id.slice(-3)}`,
      legalName: (input.legalName as Localised) ?? { en: "New supplier", ar: "مورد جديد" },
      tradingName: (input.tradingName as Localised) ?? { en: "New supplier", ar: "مورد جديد" },
      taxRegistration: input.taxRegistration ?? "",
      contactName: input.contactName ?? "",
      phone: input.phone ?? "",
      email: input.email ?? "",
      paymentTermsDays: input.paymentTermsDays ?? 30,
      currency: input.currency ?? "EGP",
      leadTimeDays: input.leadTimeDays ?? 2,
      minimumOrderValue: input.minimumOrderValue ?? { amount: 0, currency: "EGP" },
      deliveryDays: input.deliveryDays ?? [],
      active: true,
      scorecard: input.scorecard ?? {
        onTimeDeliveryRate: 0,
        fillRate: 0,
        priceStability: 0,
        qualityRejectionRate: 0,
        invoiceAccuracy: 0,
        averageLeadTimeDays: 0,
      },
      outstandingBalance: { amount: 0, currency: "EGP" },
    }),
  }),
  requisitions: makeCollection({
    rows: requisitions,
    idOf: (r) => r.id,
    search: (r) => [r.reference, r.branchName, r.requestedBy],
    branchOf: (r) => r.branchId,
    filters: { status: (r) => r.status, branchId: (r) => r.branchId },
    sorters: {
      requestedAt: (r) => r.requestedAt,
      estimatedTotal: (r) => r.estimatedTotal.amount,
      neededBy: (r) => r.neededBy,
    },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      reference: `REQ-${Math.floor(Math.random() * 9000) + 1000}`,
      branchId: input.branchId ?? branches[0]!.id,
      branchName: (input.branchName as Localised) ?? branches[0]!.name,
      status: "draft",
      requestedBy: employees[0]!.name,
      requestedAt: new Date().toISOString(),
      neededBy: new Date().toISOString().slice(0, 10),
      lines: input.lines ?? [],
      estimatedTotal: { amount: 0, currency: "EGP" },
      notes: input.notes ?? null,
    }),
  }),
  orders: purchaseOrdersCollection,
  receipts: makeCollection({
    rows: goodsReceipts,
    idOf: (g) => g.id,
    search: (g) => [g.reference, g.supplierName, g.locationName, g.purchaseOrderRef],
    branchOf: (g) => locationBranch(g.locationId),
    filters: { status: (g) => g.status, supplierId: (g) => g.supplierId, temperatureOk: (g) => g.temperatureOk },
    sorters: { receivedAt: (g) => g.receivedAt, total: (g) => g.total.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      reference: `GRN-${Math.floor(Math.random() * 9000) + 1000}`,
      purchaseOrderId: input.purchaseOrderId ?? null,
      purchaseOrderRef: input.purchaseOrderRef ?? null,
      supplierId: input.supplierId ?? suppliers[0]!.id,
      supplierName: (input.supplierName as Localised) ?? suppliers[0]!.tradingName,
      locationId: input.locationId ?? branches[0]!.id,
      locationName: (input.locationName as Localised) ?? branches[0]!.name,
      status: "draft",
      receivedAt: new Date().toISOString(),
      receivedBy: employees[0]!.name,
      temperatureC: null,
      temperatureOk: true,
      lines: input.lines ?? [],
      total: { amount: 0, currency: "EGP" },
    }),
  }),
  invoices: makeCollection({
    rows: supplierInvoices,
    idOf: (i) => i.id,
    search: (i) => [i.reference, i.supplierInvoiceNumber, i.supplierName, i.purchaseOrderRef],
    filters: {
      status: (i) => i.status,
      matchResult: (i) => i.matchResult,
      supplierId: (i) => i.supplierId,
      ageingBucket: (i) => i.ageingBucket,
    },
    sorters: { invoiceDate: (i) => i.invoiceDate, dueDate: (i) => i.dueDate, total: (i) => i.total.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      reference: `SI-${Math.floor(Math.random() * 9000) + 1000}`,
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? "",
      supplierId: input.supplierId ?? suppliers[0]!.id,
      supplierName: (input.supplierName as Localised) ?? suppliers[0]!.tradingName,
      goodsReceiptId: null,
      goodsReceiptRef: null,
      purchaseOrderRef: null,
      status: "recorded",
      matchResult: "unmatched",
      matchNotes: null,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      subtotal: { amount: 0, currency: "EGP" },
      taxTotal: { amount: 0, currency: "EGP" },
      total: { amount: 0, currency: "EGP" },
      ageingBucket: "current",
    }),
  }),
  async approveOrder(id) {
    return transport(() => {
      const index = purchaseOrders.findIndex((p) => p.id === id);
      if (index === -1) {
        throw new ServiceError("NOT_FOUND", "That purchase order no longer exists.", 404);
      }
      const current = purchaseOrders[index]!;
      if (current.status !== "pending_approval" && current.status !== "draft") {
        throw new ServiceError(
          "INVALID_STATE",
          "Only a draft or pending order can be approved.",
          422,
          `The order is currently ${current.status.replace(/_/g, " ")}.`,
        );
      }
      const updated: typeof current = {
        ...current,
        status: "approved",
        approvedBy: { en: "You (demo session)", ar: "أنت (جلسة تجريبية)" },
        approvedAt: new Date().toISOString(),
      };
      purchaseOrders[index] = updated;
      return updated;
    });
  },
};

// ---------------------------------------------------------------------------
// Workforce
// ---------------------------------------------------------------------------

const workforce: WorkforceService = {
  employees: makeCollection({
    rows: employees,
    idOf: (e) => e.id,
    search: (e) => [e.name, e.code, e.position, e.email, e.phone],
    branchOf: (e) => e.homeBranchId,
    filters: {
      status: (e) => e.status,
      employmentType: (e) => e.employmentType,
      homeBranchId: (e) => e.homeBranchId,
      department: (e) => e.department.en,
    },
    sorters: { name: (e) => e.name.en, hiredOn: (e) => e.hiredOn, position: (e) => e.position.en },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      code: input.code ?? `E${Math.floor(Math.random() * 9000) + 1000}`,
      name: (input.name as Localised) ?? { en: "New employee", ar: "موظف جديد" },
      position: (input.position as Localised) ?? { en: "Unassigned", ar: "غير محدد" },
      department: (input.department as Localised) ?? { en: "Front of house", ar: "الصالة" },
      homeBranchId: input.homeBranchId ?? branches[0]!.id,
      homeBranchName: (input.homeBranchName as Localised) ?? branches[0]!.name,
      permittedBranchIds: input.permittedBranchIds ?? [branches[0]!.id],
      employmentType: input.employmentType ?? "full_time",
      status: "active",
      hiredOn: input.hiredOn ?? new Date().toISOString().slice(0, 10),
      phone: input.phone ?? "",
      email: input.email ?? "",
      hourlyRate: input.hourlyRate ?? { amount: 0, currency: "EGP" },
      userId: null,
      documents: [],
    }),
  }),
  shifts: makeCollection({
    rows: scheduledShifts,
    idOf: (s) => s.id,
    search: (s) => [s.employeeName, s.position],
    branchOf: (s) => s.branchId,
    filters: { status: (s) => s.status, date: (s) => s.date, branchId: (s) => s.branchId },
    sorters: { date: (s) => s.date, employeeName: (s) => s.employeeName.en, hours: (s) => s.hours },
    factory: (input, id) => ({
      id,
      employeeId: input.employeeId ?? employees[0]!.id,
      employeeName: (input.employeeName as Localised) ?? employees[0]!.name,
      position: (input.position as Localised) ?? employees[0]!.position,
      branchId: input.branchId ?? branches[0]!.id,
      date: input.date ?? new Date().toISOString().slice(0, 10),
      startTime: input.startTime ?? "09:00",
      endTime: input.endTime ?? "17:00",
      hours: input.hours ?? 8,
      status: "draft",
      projectedCost: { amount: 0, currency: "EGP" },
      violations: [],
    }),
  }),
  attendance: makeCollection({
    rows: attendanceRecords,
    idOf: (a) => a.id,
    search: (a) => [a.employeeName, a.branchName],
    branchOf: (a) => a.branchId,
    filters: { date: (a) => a.date, method: (a) => a.method, corrected: (a) => a.corrected, branchId: (a) => a.branchId },
    sorters: {
      date: (a) => a.date,
      employeeName: (a) => a.employeeName.en,
      overtimeHours: (a) => a.overtimeHours,
      cost: (a) => a.cost.amount,
    },
  }),
  overtime: makeCollection({
    rows: overtimeRecords,
    idOf: (o) => o.id,
    search: (o) => [o.employeeName, o.branchName],
    filters: { approval: (o) => o.approval, weekStarting: (o) => o.weekStarting },
    sorters: { overtimeHours: (o) => o.overtimeHours, cost: (o) => o.cost.amount },
  }),
  performance: staticCollection({
    rows: employeePerformance,
    idOf: (p) => p.employeeId,
    search: (p) => [p.employeeName, p.position, p.branchName],
    filters: { position: (p) => p.position.en },
    sorters: {
      netSales: (p) => p.netSales.amount,
      orderCount: (p) => p.orderCount,
      upsellRate: (p) => p.upsellRate,
      salesPerLabourHour: (p) => p.salesPerLabourHour.amount,
      voidCount: (p) => p.voidCount,
    },
  }),
};

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

const finance: FinanceService = {
  cashSessions: staticCollection({
    rows: cashSessions,
    idOf: (c) => c.id,
    search: (c) => [c.employeeName, c.branchName, c.drawerName, c.terminalName],
    branchOf: (c) => c.branchId,
    filters: { status: (c) => c.status, varianceApproval: (c) => c.varianceApproval, businessDay: (c) => c.businessDay },
    sorters: {
      openedAt: (c) => c.openedAt,
      variance: (c) => Math.abs(c.variance.amount),
      expectedCash: (c) => c.expectedCash.amount,
    },
  }),
  expenses: makeCollection({
    rows: expenses,
    idOf: (e) => e.id,
    search: (e) => [e.reference, e.category, e.description, e.branchName],
    branchOf: (e) => e.branchId,
    filters: {
      status: (e) => e.status,
      category: (e) => e.category.en,
      paymentMethod: (e) => e.paymentMethod,
      recurring: (e) => e.recurring,
    },
    sorters: { incurredOn: (e) => e.incurredOn, amount: (e) => e.amount.amount },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      branchId: input.branchId ?? branches[0]!.id,
      branchName: (input.branchName as Localised) ?? branches[0]!.name,
      reference: `EXP-${Math.floor(Math.random() * 9000) + 1000}`,
      category: (input.category as Localised) ?? { en: "Uncategorised", ar: "غير مصنّف" },
      description: (input.description as Localised) ?? { en: "", ar: "" },
      amount: input.amount ?? { amount: 0, currency: "EGP" },
      paymentMethod: input.paymentMethod ?? "petty_cash",
      supplierName: null,
      incurredOn: input.incurredOn ?? new Date().toISOString().slice(0, 10),
      status: "draft",
      recurring: input.recurring ?? false,
      hasAttachment: false,
      createdBy: employees[0]!.name,
    }),
  }),
  dayCloses: staticCollection({
    rows: dayCloses,
    idOf: (d) => d.id,
    search: (d) => [d.branchName, d.businessDay],
    branchOf: (d) => d.branchId,
    filters: { status: (d) => d.status, businessDay: (d) => d.businessDay, branchId: (d) => d.branchId },
    sorters: { businessDay: (d) => d.businessDay, netSales: (d) => d.netSales.amount },
  }),
  async paymentSummary() {
    return transport(() => paymentSummary);
  },
  async taxSummary() {
    return transport(() => taxSummary);
  },
  async closeDay(branchId, businessDay) {
    return transport(() => {
      const index = dayCloses.findIndex(
        (d) => d.branchId === branchId && d.businessDay === businessDay,
      );
      if (index === -1) {
        throw new ServiceError("NOT_FOUND", "No day-close record for that branch and day.", 404);
      }
      const current = dayCloses[index]!;
      // FR-FIN-021 — blocked while any cash session remains open.
      if (current.blockingSessions.length > 0) {
        throw new ServiceError(
          "DAY_CLOSE_BLOCKED",
          "Close the open cash sessions first.",
          422,
          current.blockingSessions.join(", "),
        );
      }
      const updated: typeof current = {
        ...current,
        status: "closed",
        zReportNumber: (dayCloses.reduce((max, d) => Math.max(max, d.zReportNumber ?? 0), 0)) + 1,
        closedAt: new Date().toISOString(),
        closedBy: { en: "You (demo session)", ar: "أنت (جلسة تجريبية)" },
      };
      dayCloses[index] = updated;
      // The demo has no activation epoch to open, so every successful close
      // here is a real one. The shape still carries the outcome, because the
      // screen reads it either way.
      return {
        outcome: "CLOSED" as const,
        branchId,
        businessDay,
        activationBusinessDay: dayCloses[dayCloses.length - 1]?.businessDay ?? businessDay,
        firstEligibleBusinessDay: dayCloses[dayCloses.length - 1]?.businessDay ?? businessDay,
        dayClose: updated,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

/**
 * The demo kitchen display runs on the live reducer, not on this registry.
 *
 * `app/(terminal)/kds/page.tsx` drives `lib/console/live/` directly in demo
 * mode — a richer simulation than these six endpoints, with staggered
 * release, all-day counts and a recall window already in it. Reimplementing
 * a worse one here would give the KDS two sources of truth, so each mutation
 * says plainly that this path needs a backend.
 */
const kitchen: KitchenService = {
  async queue() {
    noBackend("Reading a station queue through the service layer");
  },
  async acknowledgeViewed() {
    noBackend("Acknowledging tickets as viewed");
  },
  async startLine() {
    noBackend("Starting a ticket line");
  },
  async bumpLine() {
    noBackend("Bumping a ticket line");
  },
  async bumpAll() {
    noBackend("Bumping a whole ticket");
  },
  async recall() {
    noBackend("Recalling a bumped ticket");
  },
};

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

const governance: GovernanceService = {
  approvals: staticCollection({
    rows: approvalRequests,
    idOf: (a) => a.id,
    search: (a) => [a.reference, a.entityLabel, a.requestedByName, a.branchName],
    branchOf: (a) => a.branchId,
    filters: { status: (a) => a.status, kind: (a) => a.kind, branchId: (a) => a.branchId },
    sorters: { requestedAt: (a) => a.requestedAt, value: (a) => a.value.amount },
  }),
  audit: staticCollection({
    rows: auditEntries,
    idOf: (a) => a.id,
    search: (a) => [a.action, a.actorName, a.entityId, a.correlationId, a.branchName],
    branchOf: (a) => a.branchId,
    filters: {
      action: (a) => a.action,
      actorType: (a) => a.actorType,
      entityType: (a) => a.entityType,
      branchId: (a) => a.branchId,
    },
    sorters: { occurredAt: (a) => a.occurredAt, action: (a) => a.action },
  }),
  anomalies: staticCollection({
    rows: anomalyFlags,
    idOf: (a) => a.id,
    search: (a) => [a.title, a.subjectName, a.branchName],
    branchOf: (a) => a.branchId,
    filters: { kind: (a) => a.kind, severity: (a) => a.severity, status: (a) => a.status },
    sorters: { detectedAt: (a) => a.detectedAt, sigma: (a) => a.sigma },
  }),
  async sodConflicts() {
    return transport(() => sodConflicts);
  },
  async decide(id, decision, comment) {
    return transport(() => {
      const index = approvalRequests.findIndex((a) => a.id === id);
      if (index === -1) {
        throw new ServiceError("NOT_FOUND", "That approval request no longer exists.", 404);
      }
      const current = approvalRequests[index]!;
      if (current.status !== "pending" && current.status !== "escalated") {
        throw new ServiceError(
          "ALREADY_DECIDED",
          "This request has already been decided.",
          409,
          `Current status: ${current.status}.`,
        );
      }
      const updated: typeof current = {
        ...current,
        status: decision,
        decidedBy: { en: "You (demo session)", ar: "أنت (جلسة تجريبية)" },
        decidedAt: new Date().toISOString(),
        comment: comment ?? null,
      };
      approvalRequests[index] = updated;
      return updated;
    });
  },
};

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const security: SecurityService = {
  async memberships() {
    return transport(() =>
      tenants.map((tenant) => ({
        membershipId: `mem_${tenant.id}`,
        tenantId: tenant.id,
        tenantName: tenant.name.en,
        status: "active",
      })),
    );
  },

  async assignRole(membershipId, roleId) {
    return transport(() => {
      const role = roles.find((row) => row.id === roleId);
      if (!role) throw new ServiceError("NOT_FOUND", "That role no longer exists.", 404);
      // The demo has no membership table; the visible effect is the count.
      role.userCount += 1;
    });
  },

  async removeRole(membershipId, roleId) {
    return transport(() => {
      const role = roles.find((row) => row.id === roleId);
      if (!role) throw new ServiceError("NOT_FOUND", "That role no longer exists.", 404);
      role.userCount = Math.max(0, role.userCount - 1);
    });
  },

  users: makeCollection({
    rows: users,
    idOf: (u) => u.id,
    search: (u) => [u.name, u.email, u.phone],
    filters: { status: (u) => u.status, mfaEnrolled: (u) => u.mfaEnrolled, locale: (u) => u.locale },
    sorters: { name: (u) => u.name.en, lastLoginAt: (u) => u.lastLoginAt ?? "", email: (u) => u.email },
    factory: (input, id) => ({
      id,
      tenantId: tenants[0]!.id,
      name: (input.name as Localised) ?? { en: "New user", ar: "مستخدم جديد" },
      email: input.email ?? "",
      phone: input.phone ?? "",
      status: "invited",
      mfaEnrolled: false,
      lastLoginAt: null,
      assignments: input.assignments ?? [],
      employeeId: null,
      locale: input.locale ?? "en",
    }),
  }),
  roles: makeCollection({
    rows: roles,
    idOf: (r) => r.id,
    search: (r) => [r.name, r.description],
    filters: { system: (r) => r.system, defaultScope: (r) => r.defaultScope },
    sorters: { name: (r) => r.name.en, userCount: (r) => r.userCount, permissions: (r) => r.permissions.length },
    factory: (input, id) => ({
      id,
      key: "branch_manager",
      name: (input.name as Localised) ?? { en: "New role", ar: "دور جديد" },
      description: (input.description as Localised) ?? { en: "", ar: "" },
      system: false,
      permissions: input.permissions ?? [],
      defaultScope: input.defaultScope ?? "branch",
      userCount: 0,
    }),
  }),
};

// ---------------------------------------------------------------------------
// Platform, costing, dashboard
// ---------------------------------------------------------------------------

const platform: PlatformService = {
  countryPacks: staticCollection({
    rows: countryPacks,
    idOf: (c) => c.code,
    search: (c) => [c.name, c.code, c.taxEngine],
    filters: { status: (c) => c.status, signed: (c) => c.signed },
    sorters: { name: (c) => c.name.en, effectiveFrom: (c) => c.effectiveFrom },
  }),
  integrations: makeCollection({
    rows: integrations,
    idOf: (i) => i.id,
    search: (i) => [i.name, i.vendor, i.description],
    filters: { category: (i) => i.category, status: (i) => i.status, enabled: (i) => i.enabled },
    sorters: { name: (i) => i.name, errorRate: (i) => i.errorRate, queueDepth: (i) => i.queueDepth },
  }),
  async reports() {
    return transport(() => reportCatalogue);
  },
};

const costing: CostingService = {
  async foodCostByBranch() {
    return transport(() => foodCostByBranch);
  },
  async foodCostByCategory() {
    return transport(() => foodCostByCategory);
  },
  async foodCostByBrand() {
    return transport(() => foodCostByBrand);
  },
  variance: (q) =>
    makeCollection({
      rows: varianceRows,
      idOf: (r) => r.itemId,
      search: (r) => [r.itemName, r.sku, r.category],
      filters: { category: (r) => r.category.en },
      sorters: {
        varianceValue: (r) => Math.abs(r.varianceValue.amount),
        variancePercent: (r) => Math.abs(r.variancePercent),
        unexplainedQty: (r) => Math.abs(r.unexplainedQty),
        itemName: (r) => r.itemName.en,
      },
    }).list(q),
  async wasteAnalysis(groupBy) {
    return transport(() => {
      switch (groupBy) {
        case "item": return wasteByItemRows;
        case "location": return wasteByLocationRows;
        case "employee": return wasteByEmployeeRows;
        default: return wasteByReasonRows;
      }
    });
  },
  async wasteTotals() {
    return transport(() => wasteTotals);
  },
  contributionMargin: (q) =>
    makeCollection({
      rows: contributionMargin,
      idOf: (r) => r.itemId,
      search: (r) => [r.itemName, r.category],
      filters: { classification: (r) => r.classification, category: (r) => r.category.en },
      sorters: {
        totalContribution: (r) => r.totalContribution.amount,
        contributionMarginPercent: (r) => r.contributionMarginPercent,
        unitsSold: (r) => r.unitsSold,
        itemName: (r) => r.itemName.en,
      },
    }).list(q),
  async channelProfitability() {
    return transport(() => channelProfitability);
  },
  async branchProfitability() {
    return transport(() => branchProfitability);
  },
};

const dashboardService: DashboardService = {
  async get(scope) {
    return transport(() => {
      if (!scope.branchId) return dashboard;
      // A branch-scoped dashboard shows that branch's row only.
      const row = branchRanking.find((r) => r.branchId === scope.branchId);
      if (!row) return dashboard;
      return { ...dashboard, branchRanking: [row] };
    });
  },
};

// ---------------------------------------------------------------------------
// Production — recipe versions and substitute groups
// ---------------------------------------------------------------------------

/**
 * Version history for the demo recipes.
 *
 * The fixtures carry one flat `Recipe` each with a `version` number, so a
 * plausible history is derived from it: every version below the current one
 * is superseded, and the current one takes the recipe's own status.
 */
const demoVersions = new Map<Id, RecipeVersion[]>();

function versionsOf(recipeId: Id): RecipeVersion[] {
  const existing = demoVersions.get(recipeId);
  if (existing) return existing;

  const recipe = recipes.find((row) => row.id === recipeId);
  if (!recipe) return [];

  const history: RecipeVersion[] = Array.from({ length: recipe.version }, (_unused, index) => {
    const version = index + 1;
    const current = version === recipe.version;
    return {
      id: `${recipe.id}_v${version}`,
      recipeId: recipe.id,
      version,
      status: current
        ? recipe.status === "published"
          ? ("published" as const)
          : ("draft" as const)
        : ("superseded" as const),
      yieldQuantity: recipe.yieldQuantity,
      yieldPercentage: recipe.yieldPercentage,
      prepTimeSeconds: recipe.prepTimeSeconds,
      lines: current ? recipe.lines : [],
      instructions: recipe.instructions,
      effectiveFrom: recipe.effectiveFrom,
      createdAt: recipe.costComputedAt,
      publishedBy: current && recipe.status === "published" ? employees[0]!.id : null,
    };
  }).reverse(); // newest first, as the API returns them

  demoVersions.set(recipeId, history);
  return history;
}

const demoSubstituteGroups: SubstituteGroup[] = [
  {
    id: "sub_oils",
    tenantId: tenants[0]!.id,
    name: "Cooking oils",
    memberIds: stockItems.slice(0, 2).map((item) => item.id),
  },
];

const production: ProductionService = {
  async versions(recipeId) {
    return transport(() => versionsOf(recipeId));
  },

  async createVersion(recipeId, input) {
    return transport(() => {
      const history = versionsOf(recipeId);
      if (history.length === 0) {
        // GAP-1: an unknown recipe is a 404 — nothing is auto-created.
        throw new ServiceError("NOT_FOUND", "That recipe no longer exists.", 404);
      }

      const next: RecipeVersion = {
        id: `${recipeId}_v${history[0]!.version + 1}`,
        recipeId,
        version: history[0]!.version + 1,
        status: "draft",
        yieldQuantity: { value: input.yieldQuantity, unit: history[0]!.yieldQuantity.unit },
        yieldPercentage: Number(input.yieldPercentage ?? "100"),
        prepTimeSeconds: input.prepTimeSeconds ?? 0,
        lines: [],
        instructions: input.instructions ?? { en: "", ar: "" },
        effectiveFrom: input.effectiveFrom ?? null,
        createdAt: new Date().toISOString(),
        publishedBy: null,
      };

      demoVersions.set(recipeId, [next, ...history]);
      return next;
    });
  },

  async replaceLines(recipeId, version, lines) {
    return transport(() => {
      const target = versionsOf(recipeId).find((row) => row.version === version);
      if (!target) throw new ServiceError("NOT_FOUND", "That version no longer exists.", 404);
      if (target.status === "published") {
        throw new ServiceError("CONFLICT", "A published version cannot be edited.", 409);
      }

      target.lines = lines.map((line, index) => ({
        id: `${target.id}_l${index + 1}`,
        sequence: line.sequence,
        componentType: line.componentType,
        componentId: line.stockItemId ?? line.subRecipeId ?? "",
        componentName:
          stockItems.find((item) => item.id === line.stockItemId)?.name ??
          { en: "Component", ar: "مكوّن" },
        quantity: { value: line.quantity, unit: "g" },
        wastagePercentage: Number(line.wastagePercentage ?? "0"),
        isOptional: line.isOptional ?? false,
        unitCost: { amount: 0, currency: "EGP" },
        lineCost: { amount: 0, currency: "EGP" },
      }));
    });
  },

  async publishVersion(recipeId, version) {
    return transport(() => {
      const history = versionsOf(recipeId);
      const target = history.find((row) => row.version === version);
      if (!target) throw new ServiceError("NOT_FOUND", "That version no longer exists.", 404);

      // SRS §26.3 — demote the incumbent, promote the target, one step.
      const incumbent = history.find((row) => row.status === "published");
      if (incumbent && incumbent.version !== version) incumbent.status = "superseded";

      target.status = "published";
      target.publishedBy = employees[0]!.id;

      return { supersededVersionId: incumbent?.id ?? null };
    });
  },

  async requiringCompletion(branchId) {
    return transport(() => {
      const incomplete = recipes.filter((recipe) => !recipe.complete);
      return {
        branchId: branchId ?? null,
        sellableVariantCount: menuItems.reduce((sum, item) => sum + item.variants.length, 0),
        absentCount: 0,
        incompleteCount: incomplete.length,
        entries: incomplete.map((recipe) => ({
          menuItemId: recipe.targetId ?? "",
          variantId: recipe.targetId ?? "",
          reason: "incomplete_recipe" as const,
          recipeVersionId: `${recipe.id}_v${recipe.version}`,
          detail: ["Recipe has no published complete version."],
        })),
      };
    });
  },

  async substituteGroups() {
    return transport(() => [...demoSubstituteGroups]);
  },

  async createSubstituteGroup(name, stockItemIds) {
    return transport(() => {
      const created: SubstituteGroup = {
        id: `sub_${demoSubstituteGroups.length + 1}`,
        tenantId: tenants[0]!.id,
        name,
        memberIds: stockItemIds ?? [],
      };
      demoSubstituteGroups.push(created);
      return created;
    });
  },

  async addSubstituteMember(groupId, stockItemId) {
    return transport(() => {
      const group = demoSubstituteGroups.find((row) => row.id === groupId);
      if (!group) throw new ServiceError("NOT_FOUND", "That group no longer exists.", 404);
      if (!group.memberIds.includes(stockItemId)) group.memberIds.push(stockItemId);
    });
  },

  async modifierRecipeEffects(modifierId) {
    return transport(() => [...(demoModifierEffects.get(modifierId) ?? [])]);
  },

  async replaceModifierRecipeEffects(modifierId, effects) {
    return transport(() => {
      const now = new Date().toISOString();
      const stored: ModifierRecipeEffect[] = effects
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((effect, index) => ({
          id: `mre_${modifierId}_${index + 1}`,
          modifierId,
          sequence: effect.sequence,
          operation: effect.operation,
          componentType: effect.componentType,
          stockItemId: effect.stockItemId ?? null,
          subRecipeId: effect.subRecipeId ?? null,
          // A `remove_all` takes out whatever is there; a quantity on one
          // would be meaningless, and the backend rejects it outright.
          quantity: effect.operation === "add" ? (effect.quantity ?? null) : null,
          unitId: effect.operation === "add" ? (effect.unitId ?? null) : null,
          createdAt: now,
        }));

      demoModifierEffects.set(modifierId, stored);
      return [...stored];
    });
  },
};

/** FR-MNU — modifier → recipe effects, per modifier. Empty until edited. */
const demoModifierEffects = new Map<Id, ModifierRecipeEffect[]>();

// ---------------------------------------------------------------------------

export const mockServices: ServiceRegistry = {
  dashboard: dashboardService,
  sales,
  production,
  treasury,
  operations,
  kitchen,
  catalogue,
  inventory,
  purchasing,
  costing,
  workforce,
  finance,
  organisation,
  governance,
  security,
  platform,
};
