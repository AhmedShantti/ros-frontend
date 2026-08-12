/**
 * Service interfaces.
 *
 * This file is the contract between the UI and whatever supplies its data.
 * Today that is `./mock`; tomorrow it is an HTTP client. Nothing in
 * `app/` or `components/` imports a mock module directly — everything goes
 * through the registry in `./index`, so the substitution is one file.
 *
 * The shapes deliberately echo SRS ch.26: cursor-friendly list envelopes,
 * a machine-readable error code alongside the human-readable message, and
 * scope carried explicitly on every read.
 */

import type {
  AnomalyFlag,
  ApprovalRequest,
  AttendanceRecord,
  AuditEntry,
  Batch,
  Branch,
  Brand,
  CashSession,
  CentralKitchen,
  ChannelProfitabilityRow,
  Combo,
  ContributionMarginRow,
  CountSession,
  CountryPack,
  DashboardData,
  DayClose,
  Employee,
  EmployeePerformance,
  Expense,
  FoodCostRow,
  GoodsReceipt,
  Id,
  Integration,
  KitchenTicket,
  ListQuery,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  Order,
  OvertimeRecord,
  Page,
  PriceList,
  PurchaseOrder,
  Recipe,
  ReportDefinition,
  Requisition,
  RestaurantTable,
  Role,
  ScheduledShift,
  SodConflict,
  Station,
  StockAdjustment,
  StockItem,
  StockLevel,
  StockLocation,
  StockMovement,
  Supplier,
  SupplierInvoice,
  TaxSummaryRow,
  TenderSummaryRow,
  Tenant,
  Terminal,
  Transfer,
  User,
  VarianceRow,
  Warehouse,
  WasteAnalysisRow,
  WasteRecord,
} from "../types";

/** The tenant/brand/branch the caller is looking through. */
export interface Scope {
  tenantId: Id;
  brandId: Id | null;
  branchId: Id | null;
}

export interface ScopedQuery extends ListQuery {
  scope?: Scope;
}

/**
 * A failure the UI can render. `code` is stable and machine-readable per
 * FR-API-001; `message` is what a person reads.
 */
export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string;

  constructor(code: string, message: string, status = 500, detail?: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Read + mock-write over a collection. */
export interface CollectionService<T> {
  list(query?: ScopedQuery): Promise<Page<T>>;
  get(id: Id): Promise<T | null>;
  create(input: Partial<T>): Promise<T>;
  update(id: Id, patch: Partial<T>): Promise<T>;
  remove(id: Id): Promise<void>;
}

/** Read-only collections — reports, ledgers, anything append-only. */
export type ReadonlyCollectionService<T> = Pick<CollectionService<T>, "list" | "get">;

export interface DashboardService {
  get(scope: Scope): Promise<DashboardData>;
}

export interface OperationsService {
  openOrders(query?: ScopedQuery): Promise<Page<Order>>;
  tables(query?: ScopedQuery): Promise<Page<RestaurantTable>>;
  kitchenQueue(query?: ScopedQuery): Promise<Page<KitchenTicket>>;
  terminals(query?: ScopedQuery): Promise<Page<Terminal>>;
  stations(query?: ScopedQuery): Promise<Page<Station>>;
}

export interface CostingService {
  foodCostByBranch(scope: Scope): Promise<FoodCostRow[]>;
  foodCostByCategory(scope: Scope): Promise<FoodCostRow[]>;
  foodCostByBrand(scope: Scope): Promise<FoodCostRow[]>;
  variance(query?: ScopedQuery): Promise<Page<VarianceRow>>;
  wasteAnalysis(
    groupBy: "reason" | "item" | "location" | "employee",
    scope: Scope,
  ): Promise<WasteAnalysisRow[]>;
  wasteTotals(scope: Scope): Promise<{
    trueWaste: import("../types").Money;
    controlledConsumption: import("../types").Money;
    percentOfCogs: number;
    percentOfNetSales: number;
    revenueRequiredToOffset: import("../types").Money;
  }>;
  contributionMargin(query?: ScopedQuery): Promise<Page<ContributionMarginRow>>;
  channelProfitability(scope: Scope): Promise<ChannelProfitabilityRow[]>;
  branchProfitability(scope: Scope): Promise<
    {
      branchId: Id;
      branchName: import("../types").Localised;
      grossSales: import("../types").Money;
      discounts: import("../types").Money;
      refunds: import("../types").Money;
      netSales: import("../types").Money;
      cogs: import("../types").Money;
      grossProfit: import("../types").Money;
      labourCost: import("../types").Money;
      contributionAfterLabour: import("../types").Money;
      operatingExpenses: import("../types").Money;
      operatingProfit: import("../types").Money;
      seats: number;
      areaSqm: number;
    }[]
  >;
}

export interface FinanceService {
  cashSessions: ReadonlyCollectionService<CashSession>;
  expenses: CollectionService<Expense>;
  dayCloses: ReadonlyCollectionService<DayClose>;
  paymentSummary(scope: Scope): Promise<TenderSummaryRow[]>;
  taxSummary(scope: Scope): Promise<TaxSummaryRow[]>;
  /** Mock action — the real endpoint is POST /v1/branches/{id}/day-close. */
  closeDay(branchId: Id, businessDay: string): Promise<DayClose>;
}

export interface GovernanceService {
  approvals: ReadonlyCollectionService<ApprovalRequest>;
  audit: ReadonlyCollectionService<AuditEntry>;
  anomalies: ReadonlyCollectionService<AnomalyFlag>;
  sodConflicts(scope: Scope): Promise<SodConflict[]>;
  decide(id: Id, decision: "approved" | "rejected", comment?: string): Promise<ApprovalRequest>;
}

export interface OrganisationService {
  tenants: ReadonlyCollectionService<Tenant>;
  brands: CollectionService<Brand>;
  branches: CollectionService<Branch>;
  warehouses: CollectionService<Warehouse>;
  centralKitchens: CollectionService<CentralKitchen>;
  locations(): Promise<StockLocation[]>;
}

export interface CatalogueService {
  categories: CollectionService<MenuCategory>;
  items: CollectionService<MenuItem>;
  modifierGroups: CollectionService<ModifierGroup>;
  combos: CollectionService<Combo>;
  priceLists: CollectionService<PriceList>;
  recipes: CollectionService<Recipe>;
  /** FR-MNU-030 — "86" an item, or bring it back. */
  toggleAvailability(itemId: Id, available: boolean, reason?: string): Promise<MenuItem>;
}

export interface InventoryService {
  items: CollectionService<StockItem>;
  levels: ReadonlyCollectionService<StockLevel>;
  batches: ReadonlyCollectionService<Batch>;
  movements: ReadonlyCollectionService<StockMovement>;
  counts: CollectionService<CountSession>;
  transfers: CollectionService<Transfer>;
  waste: CollectionService<WasteRecord>;
  adjustments: CollectionService<StockAdjustment>;
}

export interface PurchasingService {
  suppliers: CollectionService<Supplier>;
  requisitions: CollectionService<Requisition>;
  orders: CollectionService<PurchaseOrder>;
  receipts: CollectionService<GoodsReceipt>;
  invoices: CollectionService<SupplierInvoice>;
  /** Mock action — POST /v1/purchase-orders/{id}/approve. */
  approveOrder(id: Id): Promise<PurchaseOrder>;
}

export interface WorkforceService {
  employees: CollectionService<Employee>;
  shifts: CollectionService<ScheduledShift>;
  attendance: CollectionService<AttendanceRecord>;
  overtime: CollectionService<OvertimeRecord>;
  performance: ReadonlyCollectionService<EmployeePerformance>;
}

export interface SecurityService {
  users: CollectionService<User>;
  roles: CollectionService<Role>;
}

export interface PlatformService {
  countryPacks: ReadonlyCollectionService<CountryPack>;
  integrations: CollectionService<Integration>;
  reports(): Promise<ReportDefinition[]>;
}

export interface SalesService {
  orders: ReadonlyCollectionService<Order>;
}

/** Everything the console can talk to. */
export interface ServiceRegistry {
  dashboard: DashboardService;
  sales: SalesService;
  operations: OperationsService;
  catalogue: CatalogueService;
  inventory: InventoryService;
  purchasing: PurchasingService;
  costing: CostingService;
  workforce: WorkforceService;
  finance: FinanceService;
  organisation: OrganisationService;
  governance: GovernanceService;
  security: SecurityService;
  platform: PlatformService;
}
