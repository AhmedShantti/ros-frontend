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
  BranchKdsConfig,
  BranchTaxClass,
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
  DayCloseResult,
  Drawer,
  Employee,
  EmployeePerformance,
  EmployeeRoleAssignment,
  Expense,
  FoodCostRow,
  GoodsReceipt,
  Id,
  Integration,
  IsoDate,
  IsoDateTime,
  KitchenQueueSnapshot,
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

/** One station's queue, plus the two branch KDS settings that govern it. */
export interface StationQueue {
  tickets: KitchenTicket[];
  /** FR-KDS-025 — how long after a bump a ticket can still be recalled. */
  recallWindowSeconds: number;
  /**
   * How long a cancelled line stays on the display before it may be hidden,
   * or null when the branch keeps them up until acknowledged.
   */
  cancelledLineVisibilitySeconds: number | null;
}

/**
 * The kitchen display — SRS ch.9.
 *
 * Every one of these is addressed by station or by ticket, never by scope:
 * the backend binds a KDS terminal to exactly one station and refuses (403)
 * a read or a write aimed at any other. So the caller names the station, and
 * a refusal is reported rather than routed around.
 */
export interface KitchenService {
  /**
   * KDS-STATION-DISCOVERY-AUTH-FIX-P0 — the stations at the CALLER'S OWN KDS
   * session branch, for the station picker. Branch-scoped server-side to the
   * session itself, never a client-supplied branch/tenant; deliberately not
   * `OperationsService.stations()` (`GET /org/branches/:branchId/stations`),
   * which is BRANCH_READ-gated console/admin surface a KDS session cannot
   * and should not call.
   */
  stations(): Promise<Pick<Station, "id" | "name" | "colour">[]>;
  /** FR-KDS-020 — the FIFO queue for one station. */
  queue(stationId: Id): Promise<StationQueue>;
  /**
   * KITCHEN-QUEUE-MANAGER-REAL-BACKEND-P0 — `GET /kitchen/branches/{branchId}
   * /queue`, the manager-facing Dashboard read: every active ticket in the
   * named branch, grouped by station. Requires `kitchen.queue.view`, never a
   * KDS session — a SEPARATE, Dashboard-only route from `queue(stationId)`
   * above, which stays terminal-bound and unchanged.
   */
  branchQueue(branchId: Id): Promise<KitchenQueueSnapshot>;
  /**
   * FR-KDS-021 — record that these tickets have been seen on this station.
   * Write-once per ticket; returns how many were newly acknowledged.
   */
  acknowledgeViewed(stationId: Id, ticketIds: Id[]): Promise<number>;
  /**
   * A cook has taken the line on.
   *
   * FRONTEND-POS-KDS-TERMINAL-DECOUPLING-P0 — `stationId` is required on the
   * wire now, as a `?stationId=` QUERY PARAMETER (not a JSON body field):
   * operational context (which station this mutation is being performed
   * from), not a device identity. Always the station this ticket's own
   * queue was read from, never a Terminal/device fact.
   */
  startLine(ticketId: Id, lineId: Id, stationId: Id): Promise<KitchenTicket>;
  /** FR-KDS-026 — one line is made and ready. Same `stationId` requirement as `startLine`. */
  bumpLine(ticketId: Id, lineId: Id, stationId: Id): Promise<KitchenTicket>;
  /** Every eligible line on the ticket at once. Same `stationId` requirement as `startLine`. */
  bumpAll(ticketId: Id, stationId: Id): Promise<{ ticket: KitchenTicket; bumpedLineIds: Id[] }>;
  /** FR-KDS-025 — pull a bumped ticket back, inside the recall window. Same `stationId` requirement as `startLine`. */
  recall(ticketId: Id, stationId: Id): Promise<KitchenTicket>;
}

export interface OperationsService {
  openOrders(query?: ScopedQuery): Promise<Page<Order>>;
  tables(query?: ScopedQuery): Promise<Page<RestaurantTable>>;
  /**
   * The manager's view of the same tickets the cooks see.
   *
   * `filters.stationId` names one station. Without it this fans out over the
   * stations of the branches in scope, which against a station-bound
   * terminal yields only the one it is allowed to read.
   */
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
  /**
   * KDS-BRANCH-FALLBACK-STATION-P0 — the branch's kitchen-routing tier-5
   * fallback: which station an otherwise-unrouted fired item goes to. `null`
   * means none is configured (routing then fails closed for that item).
   */
  getBranchKdsConfig(branchId: Id): Promise<BranchKdsConfig>;
  /** `fallbackStationId: null` explicitly clears the fallback. */
  setBranchKdsConfig(
    branchId: Id,
    fallbackStationId: Id | null,
  ): Promise<BranchKdsConfig>;
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
  /**
   * `GET /branches/{branchId}/day-closes/{businessDay}`.
   *
   * A day close is addressed by branch and business day, not by its own id —
   * there is no index and no lookup by uuid — so `get` takes the composite
   * key `"<branchId>:<businessDay>"`, which is what `list` puts in `id` for
   * a day that has no persisted Z yet.
   */
  dayCloses: ReadonlyCollectionService<DayClose>;
  paymentSummary(scope: Scope): Promise<TenderSummaryRow[]>;
  taxSummary(scope: Scope): Promise<TaxSummaryRow[]>;
  /**
   * `POST /branches/{branchId}/day-closes/{businessDay}` — FR-FIN-021/023.
   *
   * Returns what the request actually did. A branch's first ever call
   * activates its DayClose epoch and seals nothing, so the caller must read
   * `outcome` rather than assume a 200 produced a Z.
   */
  closeDay(branchId: Id, businessDay: string): Promise<DayCloseResult>;
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

/**
 * KITCHEN-DISPLAY-SETUP-FRONTEND-P0 — a station exactly as `GET
 * .../kitchen-setup` describes it: `id`, `branchId`, `name`, `displayColour`
 * (nullable), and a `capacityPerHour` read out of the opaque
 * `capacityConfig` blob when present. Deliberately NOT `Station` — that
 * type's `type` field is a client-side guess against the station's name
 * (`map.toStation`'s `stationType()`) and its `active` is a hardcoded `true`
 * with no backing column (`// gap: stations have no status on the API`).
 * This manager-setup surface must show only what the backend truthfully
 * supplies, never a fabricated type or an invented Active/Inactive state.
 */
export interface KitchenSetupStation {
  id: Id;
  branchId: Id;
  name: Localised;
  displayColour: string | null;
  capacityPerHour: number | null;
}

/**
 * KITCHEN-DISPLAY-SETUP-FRONTEND-P0 — which FR-KDS-010/011 routing tiers
 * this backend actually implements, restated verbatim from
 * `GET .../kitchen-setup`'s own `capabilities` block. Never inferred or
 * assumed client-side.
 */
export interface KitchenSetupCapabilities {
  itemRouting: boolean;
  categoryRouting: boolean;
  modifierRouting: boolean;
  lineOverride: boolean;
  multiStation: boolean;
  fallback: boolean;
}

/**
 * KITCHEN-DISPLAY-SETUP-FRONTEND-P0 — the manager Console's read of
 * `GET /org/branches/{branchId}/kitchen-setup`: stations, routing rules,
 * the branch fallback station, and the two canonical KDS settings, composed
 * server-side from the same canonical Organisation data the existing
 * station/routing-rule/kds-config endpoints already serve. `branchId` is
 * carried on the shape itself so a caller can tell a stale response (from a
 * branch that has since been switched away from) apart from a fresh one.
 */
export interface KitchenSetup {
  branchId: Id;
  stations: KitchenSetupStation[];
  routingRules: StationRoutingRule[];
  fallbackStationId: Id | null;
  recallWindowSeconds: number;
  cancelledLineVisibilitySeconds: number | null;
  capabilities: KitchenSetupCapabilities;
}

/** Partial update — a field left `undefined` is unchanged (true PATCH). */
export interface KitchenConfigPatch {
  fallbackStationId?: Id | null;
  recallWindowSeconds?: number;
  cancelledLineVisibilitySeconds?: number | null;
}

export interface KitchenConfig {
  fallbackStationId: Id | null;
  recallWindowSeconds: number;
  cancelledLineVisibilitySeconds: number | null;
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

  // -- Kitchen Display Setup (manager Console) --------------------------------
  /** The manager-safe, N+1-free Kitchen Display Setup read for one branch. */
  getKitchenSetup(branchId: Id): Promise<KitchenSetup>;
  /**
   * True partial update of the branch's KDS fallback station, recall
   * window, and cancelled-line visibility window — a field omitted from
   * `patch` is left unchanged.
   */
  updateKitchenConfig(branchId: Id, patch: KitchenConfigPatch): Promise<KitchenConfig>;
  /**
   * Reassigns an EXISTING routing rule to a different destination station.
   * The rule's selector (menuItemId/categoryId/modifierId) is immutable —
   * routing a different selector is a new rule via `addStationRoutingRule`.
   */
  updateStationRoutingRule(branchId: Id, ruleId: Id, stationId: Id): Promise<StationRoutingRule>;
  /**
   * Removes a routing rule. Future Fire resolutions fall through to
   * whichever lower-precedence tier still applies; already-fired tickets
   * are never affected.
   */
  removeStationRoutingRule(branchId: Id, ruleId: Id): Promise<void>;
}

/** A variant's create-time shape — every variant is directly sellable from creation. */
export interface CreateVariantInput {
  name: Localised;
  price: Money;
  barcode?: string;
}

/**
 * Creates the item AND its sellable variant(s) atomically, in one call — never
 * "create item, then separately add a variant" just to make it sellable. The
 * common single-variant case sends a one-element `variants` array.
 */
export interface CreateMenuItemInput extends Partial<Omit<MenuItem, "variants">> {
  name: Localised;
  variants: CreateVariantInput[];
}

export interface CatalogueService {
  categories: CollectionService<MenuCategory>;
  items: Omit<CollectionService<MenuItem>, "create"> & {
    create(input: CreateMenuItemInput): Promise<MenuItem>;
  };
  modifierGroups: CollectionService<ModifierGroup>;
  combos: CollectionService<Combo>;
  recipes: CollectionService<Recipe>;
  /** FR-MNU-001 — the menus a branch can serve. */
  menus: CollectionService<Menu>;
  /**
   * FR-MNU-030 — "86" an item, or bring it back. `reason` is an action-time
   * note for audit accountability only — the API never returns it, so it is
   * never persisted item state. `autoReenableAt` (ISO datetime) is genuinely
   * accepted and stored by the API when 86ing (`Toggle86Dto.autoReenableAt`);
   * it is ignored when restoring.
   */
  toggleAvailability(
    itemId: Id,
    available: boolean,
    reason?: string,
    autoReenableAt?: string,
  ): Promise<MenuItem>;

  // -- Menu assignment (C-01) ------------------------------------------------
  /** Assign a menu to a branch. */
  assignMenuToBranch(menuId: Id, branchId: Id): Promise<void>;
  unassignMenuFromBranch(menuId: Id, branchId: Id): Promise<void>;
  /** FR-MNU-003 — which menus this branch resolves to, and in what order. */
  resolveBranchMenus(branchId: Id): Promise<MenuResolution>;
  /** C-09 — activate/deactivate a menu, audited. */
  setMenuActive(menuId: Id, active: boolean): Promise<Menu>;

  // -- Item composition ------------------------------------------------------
  /**
   * DEMO-TAX-CLASS-BACKEND-P0 — every ACTIVE tax class identity sellable at
   * this branch's currently-effective country pack. The one legitimate
   * source of options for `MenuItem.taxClassId` — never a Country Pack's own
   * `taxClasses[]` (`CountryPack` describes rate configuration, not the
   * tenant's provisioned identities).
   */
  listTaxClassesForBranch(branchId: Id): Promise<BranchTaxClass[]>;
  /** C-02 — place an item into a category. An item may sit in several. */
  placeItem(itemId: Id, categoryId: Id): Promise<void>;
  unplaceItem(itemId: Id, categoryId: Id): Promise<void>;
  /**
   * FR-MNU-006 — a FURTHER sellable size/portion on an item that already
   * exists (and is therefore already sellable). Initial variant creation
   * happens atomically inside `items.create()` instead.
   */
  addVariant(itemId: Id, input: CreateVariantInput): Promise<MenuItemVariant>;
  /** C-09 — activate/deactivate a variant, audited. */
  setVariantActive(variantId: Id, active: boolean): Promise<void>;
  /** Direct price edit — no Price List concept, no separate pricing workspace. */
  updateVariantPrice(variantId: Id, price: Money): Promise<MenuItemVariant>;
  /** FR-MNU-010 — attach a reusable modifier group to an item. */
  linkModifierGroup(
    itemId: Id,
    groupId: Id,
    options?: { sortOrder?: number },
  ): Promise<void>;
  /** Add a modifier to a group. */
  addModifier(groupId: Id, input: Partial<Modifier>): Promise<Modifier>;

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
  /**
   * LIVE-DEMO-HOTFIX-1 — set/rotate a POS employee's PIN. Not part of
   * `CollectionService<Employee>`: a PIN is a credential, not a field on the
   * employee record itself, and `PinService.setPin` is a dedicated write.
   */
  setEmployeePin(employeeId: Id, pin: string): Promise<void>;
  /**
   * DEMO-EMPLOYEE-RBAC-1 — this employee's scoped role assignments, and
   * assigning/removing one. Available system roles for the picker come from
   * `services.security.roles` (already real and tenant-wide) — these three
   * exist only because the API has no "membership id for this employee"
   * lookup, so an employee-scoped facade resolves it server-side instead of
   * handing a raw membership id to the browser.
   */
  roleAssignments(employeeId: Id): Promise<EmployeeRoleAssignment[]>;
  assignEmployeeRole(
    employeeId: Id,
    roleId: Id,
    scope: { type: "tenant" } | { type: "branch"; branchId: Id },
  ): Promise<EmployeeRoleAssignment>;
  removeEmployeeRoleAssignment(employeeId: Id, assignmentId: Id): Promise<void>;
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

/** FR-POS-045/046/047 — a discount is a reason, a size, and (above the
 *  backend's own threshold) a manager. The manager fields are always
 *  optional here: only the server knows the threshold, and passing none
 *  when none is needed is the honest default. */
export interface DiscountInput {
  type: "percentage" | "fixed";
  /** `percentage`: exact decimal string, `0 < value <= 100`. `fixed`: a
   *  whole number of minor units expressed as a string (ADR-008). */
  value: string;
  reasonCodeId: Id;
  managerEmployeeCode?: string;
  managerPin?: string;
}

export interface OrderMutationService {
  /** FR-POS-001 — open an order. The id is minted here (FR-OFF-015). */
  open(input: {
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    channel?: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    tableId?: Id;
    notes?: string;
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
   * Void a line that has not been fired.
   *
   * PREFIRE-VOID-NO-REASON-P0 — no reason is required, accepted, or looked
   * up for this operation (see the governance register's "Pre-Fire Void
   * Reason Removed" entry). Nothing has reached the kitchen or inventory
   * yet, so there is nothing for a reason to classify.
   */
  voidLine(
    businessDay: IsoDate,
    orderId: Id,
    lineId: Id,
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

  /** FR-POS-045/046/047 — discount the whole order. */
  discountOrder(
    businessDay: IsoDate,
    orderId: Id,
    input: DiscountInput,
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /** FR-POS-045/046/047 — discount one line. */
  discountLine(
    businessDay: IsoDate,
    orderId: Id,
    lineId: Id,
    input: DiscountInput,
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /** FR-POS-050 — comp a line: it still costs, it is never charged. */
  comp(
    businessDay: IsoDate,
    orderId: Id,
    lineId: Id,
    input: { reasonCodeId: Id },
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /**
   * FR-POS-070/071 — void a line the kitchen already has.
   *
   * Unlike a pre-fire void this asks for a disposition, because the stock
   * movement Fire created still stands (PROGRESS.md — stock depletes at
   * Fire, not at payment) and this is what says where the food went.
   */
  voidLinePostFire(
    businessDay: IsoDate,
    orderId: Id,
    lineId: Id,
    input: {
      disposition: "returned_to_stock" | "wasted" | "given_to_staff";
      reasonCodeId: Id;
    },
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /**
   * FR-POS-072/073/074 — refund against one specific, already-settled
   * payment. There is no "refund the order"; the payment being reversed is
   * named explicitly.
   */
  refund(
    businessDay: IsoDate,
    orderId: Id,
    input: {
      originalPaymentId: Id;
      /** Minor units, exact integer string (ADR-008). Never more than the payment. */
      amountMinor: string;
      tender: "cash" | "manual_external_card";
      reasonCodeId: Id;
      /** Required for a cash refund; refused for card. */
      cashSessionId?: Id;
      managerEmployeeCode?: string;
      managerPin?: string;
    },
    options?: { ifMatch?: number },
  ): Promise<Order>;

  /**
   * FR-POS-070/075, BR-POS-003 — cancel an entire order before payment.
   * Only surfaced today for pre-fire orders (an abandoned Draft never sent
   * to the kitchen); a produced/bumped line's elevated
   * `pos.order.cancel_after_production` approval path is not wired here.
   */
  cancel(
    businessDay: IsoDate,
    orderId: Id,
    input: { reasonCodeId: Id },
    options?: { ifMatch?: number },
  ): Promise<Order>;
}

/** One settled payment, as the receipt reports it — enough to refund against. */
export interface OrderPaymentSummary {
  id: Id;
  tender: "cash" | "manual_external_card";
  amount: Money;
  processedAt: IsoDateTime;
  cardLast4: string | null;
  changeGiven: Money | null;
  tenderedAmount: Money | null;
}

export interface ReceiptLineModifier {
  modifierId: Id;
  name: Localised;
  priceDelta: Money;
  quantity: number;
}

/** One captured line as the receipt reports it — a frozen sale-time snapshot, never re-resolved from Catalogue. */
export interface ReceiptLine {
  menuItemId: Id;
  name: Localised;
  quantity: number;
  unitPrice: Money;
  modifiers: ReceiptLineModifier[];
  modifierTotal: Money;
  lineDiscount: Money;
  lineSubtotal: Money;
  taxAmount: Money;
  lineTotal: Money;
}

/** FR-FIN-020 — the itemized, non-fiscal receipt of a completed order (POS-FIN-1). */
export interface Receipt {
  /**
   * ORDERS-MODULE-COMPREHENSIVE-P0 — the permanent Order Reference
   * (`orders.id`), unlike `orderNumber` (e.g. "MAIN-7"), which is unique
   * only within a branch and business day. This is the exact, tenant-wide
   * value a customer support lookup or `GET /orders/by-reference` needs.
   */
  id: Id;
  orderNumber: string;
  orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
  currency: Currency;
  completedAt: IsoDateTime;
  /** POS-DINEIN-PREBILL-PRINT-P0 — present only for a dine_in order. */
  tableId: Id | null;
  guestCount: number | null;
  /**
   * The table's CURRENT display label, resolved live at read time — NOT a
   * frozen sale-time snapshot (the order carries no such column). Null for
   * a non-dine-in order, or a dine-in order whose table no longer resolves.
   */
  tableLabel: string | null;
  lines: ReceiptLine[];
  payments: OrderPaymentSummary[];
  totals: {
    subtotal: Money;
    discountTotal: Money;
    taxTotal: Money;
    serviceChargeTotal: Money;
    tipTotal: Money;
    cashRoundingAdjustment: Money;
    grandTotal: Money;
    paidTotal: Money;
  };
  taxPresentation: "INCLUSIVE" | "EXCLUSIVE" | "NOT_APPLICABLE" | "UNDETERMINED";
}

/**
 * POS-DINEIN-PREBILL-PRINT-P0 — SRS UC-POS-01: "Customer requests bill.
 * Waiter prints the pre-bill (non-fiscal)." Payment begins only afterward.
 *
 * Deliberately the same field family as `Receipt` above (this is the one
 * non-fiscal document architecture, reused, not a second one) — the real
 * differences are that `state` is never a finalised value, `openedAt`
 * stands in for `completedAt` (the order has not been completed), and
 * `payments` reports whatever has genuinely already been captured (e.g. a
 * prior partial payment), never one this read creates.
 */
export interface PreBill {
  /** ORDERS-MODULE-COMPREHENSIVE-P0 — see `Receipt.id`; same permanent value. */
  id: Id;
  orderNumber: string;
  orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
  currency: Currency;
  state: "draft" | "open" | "held" | "parked" | "partially_paid";
  openedAt: IsoDateTime;
  tableId: Id | null;
  guestCount: number | null;
  tableLabel: string | null;
  lines: ReceiptLine[];
  payments: OrderPaymentSummary[];
  totals: {
    subtotal: Money;
    discountTotal: Money;
    taxTotal: Money;
    serviceChargeTotal: Money;
    tipTotal: Money;
    cashRoundingAdjustment: Money;
    grandTotal: Money;
    paidTotal: Money;
  };
  taxPresentation: "INCLUSIVE" | "EXCLUSIVE" | "NOT_APPLICABLE" | "UNDETERMINED";
}

/**
 * LIVE-01-PREFIRE-LINE-VOID-P0 — the six actions `GET /orders/reason-codes`
 * scopes a read to, one required `purpose` per call.
 */
export type PosReasonPurpose =
  | "void_prefire"
  | "discount"
  | "comp"
  | "void_postfire"
  | "refund"
  | "order_cancel";

/** A reason code valid for one specific POS action — see `PosReasonPurpose`. */
export interface PosReasonCode {
  id: Id;
  code: string;
  label: Localised;
}

/**
 * POS-SAFE-TABLES-DINEIN-P0 — a dine-in table, as the POS table picker needs
 * it. Deliberately not the Organisation admin `RestaurantTable` shape (no
 * `branchId` — always the caller's own branch; no management fields).
 * `org.tables` carries no active/usable column, so none is faked here.
 */
export interface PosTable {
  id: Id;
  label: string;
  section: string | null;
  seatCapacity: number | null;
  /**
   * DINE-IN-TABLE-SELECTOR-RESUME-P0 — the backend's own DERIVED occupancy
   * (`GET /orders/tables`). Never computed, cached or persisted client-side.
   * `ambiguous` = dirty data left two or more active orders on the table.
   */
  occupancy: PosTableOccupancy;
  /** Present only when `occupancy` is `occupied`. */
  activeOrder: PosTableOrderRef | null;
  /** Non-empty only when `occupancy` is `ambiguous`. */
  conflictingOrders: PosTableOrderRef[];
}

export type PosTableOccupancy = "available" | "occupied" | "ambiguous";

/** The identifiers-only view of an active order that a table row carries. */
export interface PosTableOrderRef {
  /** The permanent Order Reference (`orders.id`). */
  id: Id;
  businessDay: IsoDate;
  orderNumber: string;
  state: string;
  version: number;
}

/**
 * DASHBOARD-TABLE-STATUS-LIVE-P0 — one table of a branch's live Table Status
 * (`GET /orders/tables/status`, `pos.order.view_history`). The backend's own
 * derived occupancy, passed through untouched — the same single algorithm
 * behind the POS table list. Deliberately NOT `RestaurantTable` (the
 * Organisation table-setup record, whose `state` the API never populates)
 * and not `PosTable` (the POS terminal's read): a Dashboard screen must not
 * depend on either.
 */
export interface TableStatusRow {
  id: Id;
  label: string;
  section: string | null;
  seatCapacity: number | null;
  occupancy: PosTableOccupancy;
  /** Present only when `occupancy` is `occupied`. */
  activeOrder: PosTableOrderRef | null;
  /** Non-empty only when `occupancy` is `ambiguous`; no entry is "the" order. */
  conflictingOrders: PosTableOrderRef[];
}

/**
 * The outcome of the atomic select-table operation
 * (`POST /orders/tables/{tableId}/select`): the backend — not the client —
 * decided whether `order` was just opened or already existed.
 */
export interface SelectedTable {
  outcome: "created" | "resumed";
  order: Order;
}

export interface SalesService {
  orders: ReadonlyCollectionService<Order>;
  /** The write half of the order lifecycle. */
  mutations: OrderMutationService;
  /**
   * FR-FIN-020 — the non-fiscal receipt of a completed order (also available,
   * per POS-FIN-1, once it has gone partially_refunded or refunded).
   *
   * There is no `GET /payments` and `Order.payments` is deliberately left
   * empty (see `map.toOrder`) because no endpoint fills it — the receipt is
   * the only place a completed order's payment ids are readable, so it is
   * also what a refund's payment picker reads from.
   */
  receipt(businessDay: IsoDate, orderId: Id): Promise<Receipt>;
  /**
   * POS-DINEIN-PREBILL-PRINT-P0 — SRS UC-POS-01: the pre-payment PRE-BILL
   * for an order still in progress. Available for any non-finalised order
   * state; refused (the service throws) once the order is completed,
   * cancelled, partially_refunded or refunded — print the receipt instead.
   * Always reads the order fresh from the server at call time; never built
   * from a cached/local order.
   */
  preBill(businessDay: IsoDate, orderId: Id): Promise<PreBill>;
  /**
   * LIVE-01-PREFIRE-LINE-VOID-P0 — reason codes valid for one POS action,
   * scoped server-side to whichever ONE of the five reason-requiring action
   * permissions matches `purpose`. This is the POS-reachable reason-code
   * read (`GET /orders/reason-codes`, class-level `@AllowPosSession()` on
   * `OrdersController`) — NEVER `InventoryService.reasonCodes()`
   * (`GET /inventory/reason-codes`), a back-office-only route with no
   * `@AllowPosSession()` at all: a PIN(POS)/PIN(KDS) session is refused
   * outright by `JwtAuthGuard` before permissions are even checked
   * ("PIN (POS) sessions cannot access dashboard or back-office
   * endpoints."), and its codes are for Inventory waste/adjustment
   * workflows, unrelated to order-line actions.
   */
  reasonCodes(purpose: PosReasonPurpose): Promise<PosReasonCode[]>;
  /**
   * POS-SAFE-TABLES-DINEIN-P0 — the caller's own branch's dine-in tables
   * (`GET /orders/tables`, class-level `@AllowPosSession()` on
   * `OrdersController`, same as `reasonCodes` above). NEVER
   * `OrganisationService.tables` (`GET /org/branches/{id}/tables`) — that
   * needs `settings.branch.read`, which Cashier deliberately does not hold,
   * and a PIN(POS) session is refused outright before permissions are even
   * checked, exactly like `reasonCodes`' own back-office counterpart.
   */
  tables(): Promise<PosTable[]>;
  /**
   * DINE-IN-TABLE-SELECTOR-RESUME-P0 — atomic create-or-resume for one
   * Dine-In table (`POST /orders/tables/{tableId}/select`, `Idempotency-Key`
   * minted per call by the API client). Resolves with the canonical Order
   * INCLUDING its lines — the same shape `orders.get` returns — so a resumed
   * order is hydrated from the server, never rebuilt from menu data.
   *
   * Throws `ServiceError` — `status 409` / `DINE_IN_TABLE_AMBIGUOUS` when the
   * table has two or more active orders, `403` for a branch-scope denial,
   * `404` for an unknown/foreign table. Callers must NOT retry it as a direct
   * `POST /orders`: the backend refuses a duplicate Dine-In order there too.
   */
  selectTable(tableId: Id): Promise<SelectedTable>;
  /**
   * DASHBOARD-TABLE-STATUS-LIVE-P0 — a branch's tables with their derived
   * dine-in occupancy (`GET /orders/tables/status?branchId=`,
   * `pos.order.view_history`, a Console-session read). One request, no
   * per-table order fetch. Throws `ServiceError` — `403` for a branch outside
   * the caller's scope, `404` for an unknown/foreign branch. NEVER the
   * `settings.branch.read`-gated `/org/branches/{id}/tables`, and NEVER the
   * POS-session `tables()` above.
   */
  tableStatus(branchId: Id): Promise<TableStatusRow[]>;
  /**
   * ORDERS-MODULE-COMPREHENSIVE-P0 / ACCEPTANCE-CORRECTION-P0 — exact
   * Order Reference (permanent `orders.id`) lookup, without a business
   * day: the whole point of a support/history lookup is that the caller
   * does not already know one. Requires `pos.order.view_history` — NEVER
   * `pos.order.create` (Cashier's ordinary POS grant; BLOCKER A). Null
   * when the order does not exist, exists in another tenant, OR is a real
   * order outside the caller's authorized branch/brand scope — the server
   * folds all three into the SAME 404 (BLOCKER B: the branch-scope case
   * used to be a distinguishable 403, which made this an existence
   * oracle). A caller holding no `pos.order.view_history` grant at all
   * gets a genuine 403, thrown, not returned as null.
   */
  findOrderByReference(orderId: Id): Promise<Order | null>;
  /**
   * ORDERS-MODULE-COMPREHENSIVE-P0 / ACCEPTANCE-CORRECTION-P0 — Order
   * Number search (FR-POS-002, e.g. "MAIN-7"). NOT globally unique — only
   * within (branch, business day) — so every match visible to the caller
   * is returned (bounded server-side) for the caller to disambiguate by
   * business day and branch; this layer never assumes one match is THE
   * order. Requires `pos.order.view_history`, never `pos.order.create`
   * (BLOCKER A).
   */
  searchOrdersByNumber(orderNumber: string, branchId?: Id): Promise<Order[]>;
  /**
   * ORDERS-MODULE-COMPREHENSIVE-P0 / ACCEPTANCE-CORRECTION-P0 — one real
   * page of order history, exposing the backend's actual keyset cursor.
   * Calls `GET /orders/history` (`pos.order.view_history`) — NEVER
   * `orders.list` (`GET /orders`, `pos.order.create` — the POS terminal's
   * own Resume/Open-Orders picker's contract; BLOCKER A). Unlike
   * `orders.list` (which also walks that cursor internally, hidden, to
   * fill a fixed offset window), this is for a genuine "Load more" control
   * over full history — never an unbounded fetch of the whole tenant's
   * orders into the browser.
   */
  listOrderHistoryPage(options?: {
    branchId?: Id;
    cursor?: { businessDay: IsoDate; id: Id } | null;
    limit?: number;
    /**
     * ORDERS-HISTORY-LIMIT-CONTRACT-FIX-P0 — restricts the (still
     * cursor-paginated) page to FR-POS-001's "still on the floor" states,
     * server-side. `GET /orders/history`'s default ordering is pure
     * recency with no state filter, so a manager-safe caller needing a
     * complete, truthful "what is open right now" answer cannot get one
     * from a client-side filter over a bounded recent-history page once
     * total order volume exceeds one page — this makes that a real
     * server-side answer instead.
     */
    state?: "open";
  }): Promise<{ orders: Order[]; nextCursor: { businessDay: IsoDate; id: Id } | null }>;
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
  /**
   * The session's CURRENT close attempt (after a recount, the recount). Null
   * until a count has been declared. Sent back on a finalize/recount so a
   * stale screen can never decide or replace a count it did not show.
   */
  closeAttemptId: Id | null;
  /** 1 for the first count, +1 per recount. Null until a count is declared. */
  attemptNumber: number | null;
  /**
   * CASH-CLOSE-RECOUNT-AFTER-REJECTION-P0 — server truth, never inferred here:
   * true only while the session is frozen AND a manager explicitly REJECTED
   * the variance of the current count. The one state in which a recount is
   * allowed; false while a decision is still awaited, and once closed.
   */
  recountAvailable: boolean;
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
  /** Set only on a recount: the rejected attempt this count supersedes. */
  supersedesCloseAttemptId?: Id | null;
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

/**
 * DEMO-MANAGER-CASH-SESSIONS-FRONTEND-P0 — a stranded (or in-progress-close)
 * session, discovered by branch rather than by whoever's own PIN identity
 * opened it. Everything an Owner/Shift Supervisor needs to identify one and
 * hand it to the existing close_other workflow (close-context / close /
 * close/finalize) — not a grant of authority itself, which the server
 * re-checks from scratch at the terminal.
 */
export interface OpenCashSession {
  sessionId: Id;
  branchId: Id;
  drawerId: Id;
  drawerName: string;
  employeeId: Id;
  employeeName: string;
  status: "open" | "closing";
  openedAt: IsoDateTime;
  openingFloat: Money;
}

/** R-1(a)/R-4(a)/R-5 — the branch rule that decides what "over tolerance" means. */
export interface CashClosePolicy {
  id: Id;
  branchId: Id;
  effectiveFrom: IsoDateTime;
  countMode: "blind" | "open";
  tolerance: Money;
  varianceApprovalExpirySeconds: number;
  /** Who published this version. `null` on a read — the resolved-policy view does not echo it back, only the write response that created it does. */
  createdBy: Id | null;
  createdAt: IsoDateTime;
}

/** FR-POS-090/091/094, FR-FIN-001/002/006 — the cash drawer, end to end. */
export interface TreasuryService {
  /**
   * PROD-CASH-SESSION-RECOVERY-P0 — the authenticated PIN employee's own
   * already-open cash session, if the server still has one, so POS bootstrap
   * can resume it after a reload, a deploy, or a fresh PIN sign-on on a
   * device that lost its local state, instead of asking to open a second
   * drawer over one that never closed. `null` means genuinely no open
   * session — server truth, not a guess from local storage.
   *
   * CASH-SESSION-RESUME-AND-CLOSE-P0 — `status` is carried through (the wire
   * response already has it — see `TreasuryController_getCurrentSessionResponse`)
   * so a resumed session that is `"closing"` (declared, over tolerance,
   * awaiting a manager's finalize decision) can be routed straight back to
   * the close flow instead of the ordinary order-taking screen. In practice
   * this is only ever `"open"` or `"closing"`: the backend's own contract is
   * that a genuinely `"closed"` session is never returned as "current".
   */
  getCurrentSession(): Promise<{
    cashSessionId: Id;
    shiftId: Id;
    drawerId: Id;
    status: "open" | "closing" | "closed";
  } | null>;

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
      /**
       * The attempt the manager was shown. If a recount has since superseded
       * it the server refuses (409) rather than deciding a count never seen.
       */
      closeAttemptId?: Id;
    },
  ): Promise<{ status: "closing" | "closed"; outcome: "closed" | "rejected" }>;

  /**
   * CASH-CLOSE-RECOUNT-AFTER-REJECTION-P0 — a NEW physical count, recorded
   * after a manager explicitly rejected the variance of the current one.
   *
   * The rejected count, its approval request and the rejection stay in
   * history untouched; this appends a fresh count that supersedes it. The
   * counted amount is always supplied afresh — nothing about the previous
   * count is reused. Within tolerance the session closes in this request;
   * beyond it the session stays frozen for a NEW manager decision.
   */
  recountClose(
    cashSessionId: Id,
    input: {
      /** The rejected attempt being replaced (from `closeContext().closeAttemptId`). */
      supersedesCloseAttemptId: Id;
      /** Non-negative minor units as an exact string. Omit when counting by denomination. */
      countedTotalMinorUnits?: string;
      denominations?: DenominationCountInput[];
    },
  ): Promise<CashCloseDeclaration>;

  /**
   * GOLDEN-PATH-FINAL-INTEGRATION — the currently-effective policy for a
   * branch, or `null` if none has ever been published. The one read that
   * lets an Owner/authorized-manager admin page tell "nothing configured
   * yet" apart from "configured, here it is" before deciding whether to
   * publish a version.
   */
  getCashClosePolicy(branchId: Id): Promise<CashClosePolicy | null>;

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

  /** DEMO-OPS-HOTFIX-3 — all drawers in a branch, for the Owner's Operations -> Drawers admin page. */
  listDrawers(branchId: Id): Promise<Drawer[]>;

  /** DEMO-OPS-HOTFIX-3 — provision a new drawer. Owner/authorized-manager only. */
  createDrawer(branchId: Id, input: { name: string; terminalId?: Id }): Promise<Drawer>;

  /**
   * DEMO-OPS-HOTFIX-3 — the REAL drawers a Cashier's own terminal-bound
   * branch has, for the POS Open-Shift drawer selector. The branch is
   * resolved server-side from the caller's own terminal; there is no
   * branchId to pass.
   */
  listSessionDrawers(): Promise<Drawer[]>;

  /**
   * DEMO-MANAGER-CASH-SESSIONS-FRONTEND-P0 — every OPEN or CLOSING cash
   * session at a branch, oldest first, for an Owner/Shift Supervisor
   * discovering a drawer another employee left open. Requires
   * `cash.session.close_other`, enforced server-side (FR-SEC-045) — this is
   * a discovery read only; it grants no authority of its own, and closing
   * what it finds still goes through the terminal PIN workflow above.
   */
  listOpenSessions(branchId: Id): Promise<OpenCashSession[]>;
}

/** Everything the console can talk to. */
export interface ServiceRegistry {
  dashboard: DashboardService;
  /**
   * Customers, loyalty and promotions — SRS ch.18.
   *
   * Declared here like every other domain so screens depend on the interface
   * rather than on which implementation is wired in. See
   * `lib/console/services/crm.ts`.
   */
  crm: import("./crm").CrmService;
  sales: SalesService;
  production: ProductionService;
  treasury: TreasuryService;
  operations: OperationsService;
  kitchen: KitchenService;
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
