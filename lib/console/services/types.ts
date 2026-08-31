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
  CatalogueCompleteness,
  Brand,
  CashSession,
  CentralKitchen,
  ChannelProfitabilityRow,
  Combo,
  ContributionMarginRow,
  CountSession,
  CountryPack,
  Currency,
  DashboardData,
  DayClose,
  Employee,
  EmployeePerformance,
  Expense,
  FoodCostRow,
  GoodsReceipt,
  Id,
  Integration,
  IsoDate,
  IsoDateTime,
  KitchenTicket,
  ListQuery,
  Localised,
  MenuCategory,
  Menu,
  MenuItem,
  ModifierGroup,
  MenuResolution,
  MenuItemVariant,
  Modifier,
  Money,
  Order,
  OvertimeRecord,
  Page,
  PriceList,
  PriceListEntry,
  Quantity,
  PurchaseOrder,
  Recipe,
  RecipeLine,
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
  /**
   * FR-SEC-030 — disable or revoke a registered device.
   *
   * `revoked` is terminal in both senses: the backend does not offer a way
   * back from it, which is the point of revoking a lost tablet.
   */
  setTerminalStatus(
    terminalId: Id,
    status: "active" | "disabled" | "revoked",
  ): Promise<Terminal>;
  /** Create a table on a branch, and rename/move an existing one. */
  createTable(branchId: Id, input: Partial<RestaurantTable>): Promise<RestaurantTable>;
  updateTable(tableId: Id, patch: Partial<RestaurantTable>): Promise<RestaurantTable>;
  /** Create a station on a branch, and edit an existing one. */
  createStation(branchId: Id, input: Partial<Station>): Promise<Station>;
  updateStation(stationId: Id, patch: Partial<Station>): Promise<Station>;
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

/** FR-ORG — one opening interval on one weekday. */
export interface OperatingHours {
  id: Id;
  branchId: Id;
  /** 0 (Sunday) through 6 (Saturday). */
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  /** FR-FIN-024 — the boundary that decides which business day a sale lands in. */
  businessDayCutover: string;
  /** True when the interval crosses midnight. */
  overnight: boolean;
}

/** FR-KDS — which printer a document type goes to, optionally per station. */
export interface PrintRoutingRule {
  id: Id;
  branchId: Id;
  documentType: string;
  printerTarget: string;
  stationId: Id | null;
}

/**
 * FR-KDS-002 — which station prepares what.
 *
 * A rule matches on a category, an item, or a modifier; the most specific
 * match at the highest priority wins.
 */
export interface StationRoutingRule {
  id: Id;
  branchId: Id;
  stationId: Id;
  categoryId: Id | null;
  menuItemId: Id | null;
  modifierId: Id | null;
  priority: number;
}

export interface OrganisationService {
  tenants: ReadonlyCollectionService<Tenant>;
  brands: CollectionService<Brand>;
  branches: CollectionService<Branch>;
  warehouses: CollectionService<Warehouse>;
  centralKitchens: CollectionService<CentralKitchen>;
  locations(): Promise<StockLocation[]>;

  /** Move a branch to another brand within the same tenant. */
  reassignBranchBrand(branchId: Id, brandId: Id): Promise<void>;

  // -- Branch configuration --------------------------------------------------
  operatingHours(branchId: Id): Promise<OperatingHours[]>;
  addOperatingHours(
    branchId: Id,
    input: {
      dayOfWeek: number;
      opensAt: string;
      closesAt: string;
      businessDayCutover?: string;
    },
  ): Promise<OperatingHours>;

  printRouting(branchId: Id): Promise<PrintRoutingRule[]>;
  addPrintRouting(
    branchId: Id,
    input: {
      documentType: "receipt" | "kitchen_ticket" | "bar_ticket";
      printerTarget: string;
      stationId?: Id;
    },
  ): Promise<PrintRoutingRule>;

  stationRoutingRules(branchId: Id): Promise<StationRoutingRule[]>;
  addStationRoutingRule(
    branchId: Id,
    input: {
      stationId: Id;
      categoryId?: Id;
      menuItemId?: Id;
      modifierId?: Id;
      priority?: number;
    },
  ): Promise<StationRoutingRule>;

  /** One station, by id — the detail behind a routing rule. */
  station(stationId: Id): Promise<Station | null>;
}

export interface CatalogueService {
  categories: CollectionService<MenuCategory>;
  items: CollectionService<MenuItem>;
  modifierGroups: CollectionService<ModifierGroup>;
  combos: CollectionService<Combo>;
  priceLists: CollectionService<PriceList>;
  recipes: CollectionService<Recipe>;
  /** FR-MNU-001 — the menus a branch can serve. */
  menus: CollectionService<Menu>;
  /** FR-MNU-030 — "86" an item, or bring it back. */
  toggleAvailability(itemId: Id, available: boolean, reason?: string): Promise<MenuItem>;

  // -- Menu assignment (C-01) ------------------------------------------------
  /** Assign a menu to a branch. */
  assignMenuToBranch(menuId: Id, branchId: Id): Promise<void>;
  unassignMenuFromBranch(menuId: Id, branchId: Id): Promise<void>;
  /** FR-MNU-003 — which menus this branch resolves to, and in what order. */
  resolveBranchMenus(branchId: Id): Promise<MenuResolution>;
  /** C-09 — activate/deactivate a menu, audited. */
  setMenuActive(menuId: Id, active: boolean): Promise<Menu>;

  // -- Item composition ------------------------------------------------------
  /** C-02 — place an item into a category. An item may sit in several. */
  placeItem(itemId: Id, categoryId: Id): Promise<void>;
  unplaceItem(itemId: Id, categoryId: Id): Promise<void>;
  /** FR-MNU-006 — a sellable size/portion of an item. */
  addVariant(itemId: Id, input: Partial<MenuItemVariant>): Promise<MenuItemVariant>;
  /** C-09 — activate/deactivate a variant, audited. */
  setVariantActive(variantId: Id, active: boolean): Promise<void>;
  /** FR-MNU-010 — attach a reusable modifier group to an item. */
  linkModifierGroup(
    itemId: Id,
    groupId: Id,
    options?: { sortOrder?: number },
  ): Promise<void>;
  /** Add a modifier to a group. */
  addModifier(groupId: Id, input: Partial<Modifier>): Promise<Modifier>;

  // -- Pricing ---------------------------------------------------------------
  /** FR-MNU-023/024 — set (create or overwrite) a variant's price in a list. */
  setPrice(priceListId: Id, variantId: Id, price: Money): Promise<PriceListEntry>;
  /** Entries on one price list. */
  priceEntries(priceListId: Id): Promise<PriceListEntry[]>;

  // -- Readiness -------------------------------------------------------------
  /** SRS §7.3 #7 — what is stopping the catalogue being sellable. */
  completeness(): Promise<CatalogueCompleteness>;
}

/** FR-INV-066 — an item at or under its reorder point, per location. */
export interface LowStockRow {
  stockItemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  onHand: Quantity;
  reorderPoint: Quantity | null;
  reorderQuantity: Quantity | null;
}

/** FR-INV-014 — stock that has gone below zero, which should be impossible. */
export interface NegativeStockRow {
  stockItemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  onHand: Quantity;
}

/** FR-INV-011/051 — the ledger against the projection it is supposed to equal. */
export interface ReconciliationReport {
  reconciled: boolean;
  note: string;
  divergences: {
    stockItemId: Id;
    itemName: Localised;
    locationId: Id;
    locationName: Localised;
    /** Sum of ledger movements. */
    ledger: Quantity;
    /** The `stock_levels` projection. */
    projected: Quantity;
  }[];
}

/** FR-INV-013 — the catalogue a waste, adjustment or discrepancy references. */
export interface ReasonCode {
  id: Id;
  code: string;
  category: string;
  label: Localised;
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

  // -- Counting --------------------------------------------------------------
  /** FR-INV-042 — record a counted quantity against one open count line. */
  recordCount(lineId: Id, countedQuantity: string): Promise<void>;

  // -- Transfers -------------------------------------------------------------
  /**
   * Receive a dispatched transfer. A short or over receipt writes a
   * discrepancy adjustment, which is why a reason code may be required.
   */
  receiveTransfer(input: {
    transferReferenceId: Id;
    toLocationId: Id;
    receivedQuantity: string;
    discrepancyReasonCodeId?: Id;
  }): Promise<void>;

  // -- Reorder configuration -------------------------------------------------
  /** FR-INV-065 — per-location reorder point and quantity for one item. */
  setReorderConfig(
    itemId: Id,
    input: { locationId: Id; reorderPoint: string; reorderQuantity: string },
  ): Promise<void>;

  // -- Reason codes ----------------------------------------------------------
  reasonCodes(): Promise<ReasonCode[]>;
  createReasonCode(input: {
    code: string;
    category: string;
    label: Localised;
  }): Promise<ReasonCode>;

  // -- Computed reports ------------------------------------------------------
  lowStock(query?: ScopedQuery): Promise<LowStockRow[]>;
  negativeStock(query?: ScopedQuery): Promise<NegativeStockRow[]>;
  reconciliation(): Promise<ReconciliationReport>;
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

/** A user's membership of a tenant — what a role is actually assigned to. */
export interface Membership {
  membershipId: Id;
  tenantId: Id;
  tenantName: string;
  status: string;
}

export interface SecurityService {
  users: CollectionService<User>;
  roles: CollectionService<Role>;
  /**
   * Memberships a role can be assigned to.
   *
   * The API exposes no tenant-wide membership index — `GET /auth/tenants`
   * returns only the *caller's* own memberships — so this is the caller's
   * list, not every user's. Assigning a role to someone else needs their
   * membership id, which no endpoint currently hands out.
   */
  memberships(): Promise<Membership[]>;
  assignRole(membershipId: Id, roleId: Id): Promise<void>;
  removeRole(membershipId: Id, roleId: Id): Promise<void>;
}

export interface PlatformService {
  countryPacks: ReadonlyCollectionService<CountryPack>;
  integrations: CollectionService<Integration>;
  reports(): Promise<ReportDefinition[]>;
}

/** One version of a recipe — SRS §26.3. Only one may be published at a time. */
export interface RecipeVersion {
  id: Id;
  recipeId: Id;
  version: number;
  status: "draft" | "published" | "superseded";
  yieldQuantity: Quantity;
  yieldPercentage: number;
  prepTimeSeconds: number;
  lines: RecipeLine[];
  instructions: Localised;
  effectiveFrom: IsoDate | null;
  createdAt: IsoDateTime;
  /** Who published it. The API carries no publication timestamp. */
  publishedBy: Id | null;
}

/**
 * BR-MNU-012 — variants that cannot be costed because their recipe is
 * missing or incomplete.
 */
export interface RecipeCompletenessReport {
  branchId: Id | null;
  /** Active variants examined — the denominator of the metric. */
  sellableVariantCount: number;
  absentCount: number;
  incompleteCount: number;
  entries: {
    menuItemId: Id;
    variantId: Id;
    reason: "absent_recipe" | "incomplete_recipe";
    recipeVersionId: Id | null;
    detail: string[];
  }[];
}

/** FR-MNU-014 — interchangeable ingredients, e.g. any of three cooking oils. */
export interface SubstituteGroup {
  id: Id;
  tenantId: Id;
  name: string;
  memberIds: Id[];
}

/**
 * Recipes and their versions — SRS ch.17.
 *
 * The list/create half lives on `catalogue.recipes` because that is where
 * the console has always read it; everything version-shaped is here.
 */
export interface ProductionService {
  /** Version history for one recipe, newest first. */
  versions(recipeId: Id): Promise<RecipeVersion[]>;
  /** Create a draft. An unknown recipe id is a 404 — nothing is auto-created. */
  createVersion(
    recipeId: Id,
    input: {
      yieldQuantity: string;
      yieldUnitId: Id;
      yieldPercentage?: string;
      prepTimeSeconds?: number;
      instructions?: Localised;
      effectiveFrom?: IsoDate;
      lines?: RecipeLineInput[];
    },
  ): Promise<RecipeVersion>;
  /** Replace a draft's lines wholesale. A published version is refused (409). */
  replaceLines(recipeId: Id, version: number, lines: RecipeLineInput[]): Promise<void>;
  /** Demote the incumbent and promote this version, in one transaction. */
  publishVersion(recipeId: Id, version: number): Promise<{ supersededVersionId: Id | null }>;
  /** BR-MNU-012 — what is not yet costable. */
  requiringCompletion(branchId?: Id): Promise<RecipeCompletenessReport>;

  // -- Substitute groups -----------------------------------------------------
  substituteGroups(): Promise<SubstituteGroup[]>;
  createSubstituteGroup(name: string, stockItemIds?: Id[]): Promise<SubstituteGroup>;
  addSubstituteMember(groupId: Id, stockItemId: Id): Promise<void>;

  // -- Modifier recipe effects -----------------------------------------------
  /**
   * FR-MNU — what a modifier does to the plate's recipe, in sequence order.
   *
   * "No onions" is a `remove_all` on a component; "extra cheese" is an `add`
   * with its own quantity. Without these, a modified sale deducts the base
   * recipe and the stock ledger drifts by exactly the modifier.
   */
  modifierRecipeEffects(modifierId: Id): Promise<ModifierRecipeEffect[]>;
  /** Full replace, shaped like `replaceLines` — there is no per-effect edit. */
  replaceModifierRecipeEffects(
    modifierId: Id,
    effects: ModifierRecipeEffectInput[],
  ): Promise<ModifierRecipeEffect[]>;
}

/** One stored effect. `quantity`/`unitId` are null for `remove_all`. */
export interface ModifierRecipeEffect {
  id: Id;
  modifierId: Id;
  sequence: number;
  operation: "add" | "remove_all";
  componentType: "stock_item" | "sub_recipe";
  stockItemId: Id | null;
  /** Logical recipe identity — resolved to its published version at capture time. */
  subRecipeId: Id | null;
  /** Exact decimal string, or null for `remove_all`. */
  quantity: string | null;
  unitId: Id | null;
  createdAt: IsoDateTime;
}

/** The shape an effect takes on the way *to* the API. */
export interface ModifierRecipeEffectInput {
  sequence: number;
  operation: "add" | "remove_all";
  componentType: "stock_item" | "sub_recipe";
  stockItemId?: Id;
  subRecipeId?: Id;
  /** Required for `add`, refused for `remove_all`. */
  quantity?: string;
  /** Required for `add`, refused for `remove_all`. */
  unitId?: Id;
}

/** The shape a recipe line takes on the way *to* the API. */
export interface RecipeLineInput {
  sequence: number;
  componentType: "stock_item" | "sub_recipe";
  /** One of these, matching `componentType`. */
  stockItemId?: Id;
  subRecipeId?: Id;
  substituteGroupId?: Id;
  quantity: string;
  unitId: Id;
  wastagePercentage?: string;
  isOptional?: boolean;
}

/**
 * The order lifecycle the backend actually implements.
 *
 * Open → capture lines → Fire → capture partial payments. There is no
 * Completion endpoint: `POST /payments` explicitly refuses a payment that
 * would settle the order in full, so an order cannot be closed through this
 * API yet. Anything the POS does beyond this — discounts, comps, splits,
 * refunds, price overrides — has no endpoint at all.
 *
 * Every mutation is optimistically concurrent: pass the `version` you last
 * saw as `ifMatch` and a stale write is refused with 412 rather than
 * silently overwriting a colleague's line.
 */
export interface OrderMutationService {
  /** FR-POS-001 — open an order. The id is minted here (FR-OFF-015). */
  open(input: {
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    channel?: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    tableId?: Id;
    guestCount?: number;
    notes?: string;
    terminalId?: Id;
    openedByEmployeeId?: Id;
  }): Promise<Order>;

  /** The order plus its persisted line snapshots. */
  get(businessDay: IsoDate, orderId: Id): Promise<Order>;

  /** FR-POS-010 — capture a line on an open order. */
  addLine(
    businessDay: IsoDate,
    orderId: Id,
    input: {
      menuItemId: Id;
      variantId: Id;
      quantity: string;
      modifiers?: { modifierId: Id; quantity?: number }[];
      notes?: string;
      course?: number;
      seatNumber?: number;
    },
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /**
   * FR-POS-013 — void a line that has not been fired.
   *
   * A reason code is required, not optional: the database refuses a voided
   * row without one, so omitting it would only turn a 400 into a 500.
   */
  voidLine(
    businessDay: IsoDate,
    orderId: Id,
    lineId: Id,
    reasonCodeId: Id,
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /** FR-POS-035 — send eligible pending lines to production. */
  fire(businessDay: IsoDate, orderId: Id, options?: { ifMatch?: number }): Promise<Order>;

  /**
   * FR-POS-060 — capture a partial payment.
   *
   * The backend refuses a payment that settles the order in full, because
   * Completion is not implemented. That rejection is passed through rather
   * than hidden: a cashier needs to know the drawer did not close.
   */
  capturePayment(
    businessDay: IsoDate,
    orderId: Id,
    input: {
      cashSessionId: Id;
      tender: "cash" | "manual_external_card";
      amountMinor: string;
      /** Required for cash, refused for card. */
      tenderedAmountMinor?: string;
      /** Required for card, refused for cash. */
      terminalReference?: string;
      cardScheme?: string;
      last4?: string;
      authorizationCode?: string;
    },
    options?: { ifMatch?: number },
  ): Promise<Order>;
}

export interface SalesService {
  orders: ReadonlyCollectionService<Order>;
  /** The write half of the order lifecycle. */
  mutations: OrderMutationService;
}

/** FR-POS-091 — the three ways cash moves without a sale. */
export type CashMovementKind = "pay_in" | "pay_out" | "safe_drop";

/** One recorded drawer movement. The route, not the amount, carries the sign. */
export interface CashMovement {
  id: Id;
  cashSessionId: Id;
  branchId: Id;
  employeeId: Id;
  kind: CashMovementKind;
  /** Always positive — read `kind` for the direction. */
  amount: Money;
  reason: string;
  occurredAt: IsoDateTime;
}

/**
 * FR-POS-094/095 — what a cashier is allowed to see *before* counting.
 *
 * The nulls here are load-bearing. Under a blind count the server omits
 * expected cash and tolerance entirely until a count is durably declared,
 * and a UI that renders `0` in their place has quietly defeated the control
 * the whole endpoint exists to enforce. `expectedCash` is a preview under an
 * open count and authoritative only once `status` has left `open`.
 */
export interface CashCloseContext {
  cashSessionId: Id;
  status: "open" | "closing" | "closed";
  countMode: "blind" | "open";
  currency: Currency;
  openingFloat: Money;
  /** Null when the branch has no cash-close policy configured at all. */
  tolerance: Money | null;
  /** Null while open + blind. A preview while open + open-mode. */
  expectedCash: Money | null;
  /** Null until a count has been declared. */
  countedCash: Money | null;
  /** Null until a count has been declared. */
  variance: Money | null;
  /** Null until a count has been declared. */
  approvalRequired: boolean | null;
  closedAt: IsoDateTime | null;
  /** True when this session still needs a manager decision to finish. */
  frozen: boolean;
}

/** The committed count — and the first legitimate disclosure of the variance. */
export interface CashCloseDeclaration {
  cashSessionId: Id;
  closeAttemptId: Id;
  status: "closing" | "closed";
  /** True when the variance exceeded tolerance and a manager must decide. */
  approvalRequired: boolean;
  /** False on an idempotent replay of an attempt already declared. */
  created: boolean;
  countMode: "blind" | "open";
  tolerance: Money;
  expectedCash: Money;
  countedCash: Money;
  variance: Money;
}

/** One line of a denomination count: how many of which note or coin. */
export interface DenominationCountInput {
  /** The note/coin's face value in minor units, as an exact integer string. */
  denominationMinorUnits: string;
  quantity: number;
}

/** R-1(a)/R-4(a)/R-5 — the branch rule that decides what "over tolerance" means. */
export interface CashClosePolicy {
  id: Id;
  branchId: Id;
  effectiveFrom: IsoDateTime;
  countMode: "blind" | "open";
  tolerance: Money;
  varianceApprovalExpirySeconds: number;
  createdBy: Id;
  createdAt: IsoDateTime;
}

/** FR-POS-090/091/094, FR-FIN-001/002/006 — the cash drawer, end to end. */
export interface TreasuryService {
  /**
   * Opens a cashier shift and its cash session in one transaction.
   *
   * Idempotent by construction: the device mints both ULIDs and the request
   * carries an idempotency key, so a retry over a flaky link cannot open a
   * second drawer. `created` is false on a replay of an already-open pair.
   */
  openCashSession(input: {
    drawerId: Id;
    /** Declared opening float in minor units, as an exact integer string. */
    openingFloat: string;
    notes?: string;
    /**
     * The device ULIDs for this open, when the caller is retrying one.
     *
     * Supplying the pair a previous attempt used is what makes a second
     * press a *replay* rather than a second drawer — that is the duplicate
     * protection the spec attaches to these fields. Omit them and fresh
     * ones are minted, which is correct only for a genuinely new open.
     */
    ids?: { cashSessionId: Id; shiftId: Id };
  }): Promise<{ cashSessionId: Id; shiftId: Id; created: boolean }>;

  /**
   * FR-POS-091 [M] — cash in, cash out, cash to the safe.
   *
   * `reason` is mandatory for all three; the backend refuses a blank one.
   * The amount is always positive and always minor units as an exact string.
   */
  recordMovement(
    cashSessionId: Id,
    kind: CashMovementKind,
    input: { amountMinor: string; reason: string; occurredAt?: IsoDateTime },
  ): Promise<CashMovement>;

  /** FR-POS-094/095 — read-only, and deliberately incomplete under a blind count. */
  closeContext(cashSessionId: Id): Promise<CashCloseContext>;

  /**
   * FR-POS-094/096/097 [M] — declare the physical count.
   *
   * Within tolerance this closes the session in the same request. Above it,
   * the session freezes at `closing` and only `finalizeClose` gets it out.
   */
  declareClose(
    cashSessionId: Id,
    input: {
      /** Non-negative minor units as an exact string. Omit when counting by denomination. */
      countedTotalMinorUnits?: string;
      denominations?: DenominationCountInput[];
    },
  ): Promise<CashCloseDeclaration>;

  /**
   * FR-FIN-006 [M] — the manager's decision on a frozen close.
   *
   * A rejection is a *success*: it commits and answers `rejected`, leaving
   * the session frozen for another attempt. The caller must treat that as an
   * outcome, not an error.
   */
  finalizeClose(
    cashSessionId: Id,
    input: {
      decision: "approved" | "rejected";
      reason: string;
      managerEmployeeCode: string;
      managerPin: string;
      comment?: string;
    },
  ): Promise<{ status: "closing" | "closed"; outcome: "closed" | "rejected" }>;

  /**
   * R-1(a)/R-4(a)/R-5 — publish a new immutable policy version for a branch.
   *
   * Versions are never edited; a change is a new row with its own
   * `effectiveFrom`, and a past instant is refused by the database.
   */
  setCashClosePolicy(
    branchId: Id,
    input: {
      /** Absolute non-negative tolerance in minor units, as an exact string. Zero is valid. */
      varianceToleranceMinorUnits: string;
      varianceApprovalExpirySeconds: number;
      countMode?: "blind" | "open";
      effectiveFrom?: IsoDateTime;
    },
  ): Promise<CashClosePolicy>;
}

/** Everything the console can talk to. */
export interface ServiceRegistry {
  dashboard: DashboardService;
  sales: SalesService;
  production: ProductionService;
  treasury: TreasuryService;
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
