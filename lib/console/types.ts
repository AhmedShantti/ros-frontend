/**
 * TRENDOW domain model — front-end projection.
 *
 * These types mirror the aggregate catalogue in SRS §7.3 and the entity
 * specifications in §7.4. They are the contract between the UI and the
 * service layer: when the real API arrives, the mock services in
 * `lib/console/services/mock` are replaced but these types do not move.
 *
 * Two conventions carried over from the specification:
 *   - Money is minor units plus a currency (§7.2). Never a float.
 *   - Quantity is a decimal string plus a unit, to preserve the 6 decimal
 *     places BR-CORE-003 requires. Never a float.
 */

// Imported for use below and re-exported at the end of the file, so that
// consumers can take domain types and permission keys from one module.
import type { PermissionKey, RoleKey } from "./permissions";

// ---------------------------------------------------------------------------
// Shared kernel
// ---------------------------------------------------------------------------

export type Id = string;
export type IsoDateTime = string;
export type IsoDate = string;

export type Currency = "EGP" | "SAR" | "AED";

/** SRS §7.2 — minor units plus ISO 4217 code. 12500 EGP = 125.00. */
export interface Money {
  amount: number;
  currency: Currency;
}

/** SRS §7.2 — arbitrary-precision quantity carried as a string. */
export interface Quantity {
  value: string;
  unit: UnitCode;
}

export type UnitCode =
  | "g"
  | "kg"
  | "ml"
  | "l"
  | "pc"
  | "dozen"
  | "case"
  | "pack"
  | "tray"
  | "hour";

export type Dimension = "mass" | "volume" | "count" | "length" | "time";

/**
 * SRS FR-LOC-006 — every user-authored string is storable in each enabled
 * language, with a designated fallback.
 */
export interface Localised {
  en: string;
  ar: string;
}

export type Locale = "en" | "ar";
export type Direction = "ltr" | "rtl";

/** A generic paged envelope; cursor pagination per SRS §26.1. */
export interface Page<T> {
  rows: T[];
  total: number;
  cursor?: string | null;
}

export interface ListQuery {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  filters?: Record<string, string | number | boolean | undefined>;
}

// ---------------------------------------------------------------------------
// Organisation — SRS ch.6, ch.17
// ---------------------------------------------------------------------------

export type TenantState =
  | "provisioning"
  | "trial"
  | "active"
  | "past_due"
  | "restricted"
  | "suspended"
  | "terminating";

export type PlanTier = "starter" | "professional" | "enterprise";

export interface Tenant {
  id: Id;
  name: Localised;
  slug: string;
  state: TenantState;
  plan: PlanTier;
  countryCode: CountryCode;
  baseCurrency: Currency;
  region: string;
  brandCount: number;
  branchCount: number;
  createdAt: IsoDateTime;
}

export interface Brand {
  id: Id;
  tenantId: Id;
  name: Localised;
  code: string;
  colour: string;
  branchCount: number;
  active: boolean;
}

export type LocationKind = "branch" | "warehouse" | "central_kitchen";

export interface Branch {
  id: Id;
  tenantId: Id;
  brandId: Id;
  name: Localised;
  code: string;
  countryCode: CountryCode;
  currency: Currency;
  timezone: string;
  /** SRS FR-FIN-024 — business day boundary, e.g. "04:00". */
  businessDayBoundary: string;
  seats: number;
  areaSqm: number;
  openedAt: IsoDate;
  active: boolean;
  isFranchise: boolean;
  address: string;
  /** FR-POS-xxx — drive-through is a per-branch capability, not every site has a lane. */
  driveThroughEnabled: boolean;
}

export interface Warehouse {
  id: Id;
  tenantId: Id;
  name: Localised;
  code: string;
  /**
   * What kind of store this is. The API models it explicitly; deriving it
   * from whether a branch is attached loses `virtual`, which is a real
   * option and not the same thing as "central".
   */
  warehouseType: "branch" | "central" | "virtual";
  attachedBranchId: Id | null;
  countryCode: CountryCode;
  active: boolean;
}

export interface CentralKitchen {
  id: Id;
  tenantId: Id;
  name: Localised;
  code: string;
  countryCode: CountryCode;
  servesBranchIds: Id[];
  active: boolean;
}

/** Any location that can hold stock — SRS BR-PLT-001. */
export interface StockLocation {
  id: Id;
  kind: LocationKind;
  name: Localised;
  code: string;
}

export type TerminalKind = "pos" | "kds" | "kiosk";
export type TerminalStatus = "online" | "offline" | "degraded" | "revoked";

export interface Terminal {
  id: Id;
  tenantId: Id;
  branchId: Id;
  name: string;
  code: string;
  kind: TerminalKind;
  status: TerminalStatus;
  appVersion: string;
  lastSeenAt: IsoDateTime;
  /** SRS ch.21 — operations waiting in the device outbox. */
  queuedOperations: number;
  batteryPercent: number | null;
  ipAddress: string;
}

export type StationType =
  | "grill"
  | "fryer"
  | "cold"
  | "hot_line"
  | "beverage"
  | "barista"
  | "dessert"
  | "bakery"
  | "shawarma"
  | "packaging"
  | "pass";

export interface Station {
  id: Id;
  branchId: Id;
  name: Localised;
  type: StationType;
  colour: string;
  capacityPerHour: number;
  active: boolean;
}

export type TableState =
  | "available"
  | "seated"
  | "ordered"
  | "food_served"
  | "bill_requested"
  | "payment_in_progress"
  | "needs_cleaning";

export interface RestaurantTable {
  id: Id;
  branchId: Id;
  area: Localised;
  label: string;
  capacity: number;
  state: TableState;
  seatedAt: IsoDateTime | null;
  orderId: Id | null;
  serverId: Id | null;
}

// ---------------------------------------------------------------------------
// Identity, roles and access — SRS ch.15
// ---------------------------------------------------------------------------

export type ScopeLevel = "tenant" | "brand" | "branch_set" | "branch";

export interface RoleAssignment {
  roleId: Id;
  scopeLevel: ScopeLevel;
  /** Empty means the whole level (all brands / all branches). */
  scopeIds: Id[];
  validFrom: IsoDate | null;
  validTo: IsoDate | null;
}

export interface Role {
  id: Id;
  key: RoleKey;
  name: Localised;
  description: Localised;
  /** Predefined roles may be cloned but not deleted — FR-SEC-010. */
  system: boolean;
  permissions: PermissionKey[];
  defaultScope: ScopeLevel;
  userCount: number;
}

export type UserStatus = "active" | "invited" | "suspended";

export interface User {
  id: Id;
  tenantId: Id;
  name: Localised;
  email: string;
  phone: string;
  status: UserStatus;
  /** FR-SEC-023/024 — MFA is mandatory for privileged roles. */
  mfaEnrolled: boolean;
  lastLoginAt: IsoDateTime | null;
  assignments: RoleAssignment[];
  employeeId: Id | null;
  locale: Locale;
}

/** The signed-in identity the console renders for. */
export interface Session {
  user: User;
  roleKey: RoleKey;
  permissions: Set<PermissionKey>;
  tenantId: Id;
  brandId: Id | null;
  branchId: Id | null;
  mfaSatisfied: boolean;
}

// ---------------------------------------------------------------------------
// Catalogue — SRS ch.10
// ---------------------------------------------------------------------------

export interface MenuCategory {
  id: Id;
  tenantId: Id;
  name: Localised;
  parentId: Id | null;
  sortOrder: number;
  colour: string;
  itemCount: number;
  active: boolean;
}

export type TaxClassCode = "standard" | "reduced" | "zero" | "exempt";

/**
 * A menu — FR-MNU-001/002/003.
 *
 * A branch may have several assigned (breakfast, all-day, delivery) and the
 * one in force is resolved by `priority`, highest first. Two menus sharing a
 * priority make that resolution non-deterministic, which the API reports as
 * an ambiguity warning rather than silently picking one.
 */
export interface Menu {
  id: Id;
  tenantId: Id;
  name: Localised;
  /** Highest wins when several menus are assigned to the same branch. */
  priority: number;
  /** FR-MNU-002 — dine-in, takeaway, delivery… vocabulary owned by Sales. */
  orderTypes: string[];
  /** Branch ids this menu is assigned to (C-01). */
  branchIds: Id[];
  active: boolean;
  createdAt: IsoDateTime;
}

/** FR-MNU-003 — which menus a branch resolves to, and whether that is safe. */
export interface MenuResolution {
  menus: Menu[];
  ambiguous: boolean;
  warning: string | null;
}

/** SRS §7.3 #7 — what stops the catalogue being sellable. */
export interface CatalogueCompleteness {
  sellable: boolean;
  /** Active variants with no price entry in any list. */
  unpricedVariants: { menuItemId: Id; variantId: Id }[];
  /** Active menu items with zero active variants. */
  itemsWithoutActiveVariant: Id[];
  /** (active list × active variant) pairs lacking a price. */
  activeListGaps: { priceListId: Id; priceListName: string; menuItemVariantId: Id }[];
}

export interface MenuItemVariant {
  id: Id;
  name: Localised;
  basePrice: Money;
  barcode: string | null;
  recipeId: Id | null;
  available: boolean;
}

export interface MenuItem {
  id: Id;
  tenantId: Id;
  categoryId: Id;
  /** FR-MNU-005 — a distinct name per surface. */
  name: Localised;
  kitchenName: Localised;
  receiptName: Localised;
  description: Localised;
  taxClass: TaxClassCode;
  stationType: StationType;
  prepTimeSeconds: number;
  variants: MenuItemVariant[];
  allergens: string[];
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
  available: boolean;
  /** FR-MNU-030 — an "86" carries a reason and an optional re-enable time. */
  unavailableReason: string | null;
  /** FR-MNU-033 — min over ingredients of (stock ÷ per-portion need). */
  remainingSellable: number | null;
  sortOrder: number;
  colour: string;
  imageEmoji: string;
}

export type ModifierKind = "addition" | "removal" | "substitution";

export interface Modifier {
  id: Id;
  name: Localised;
  kind: ModifierKind;
  priceDelta: Money;
  /** FR-MNU-013 — how this modifier changes the parent recipe. */
  recipeDelta: RecipeDelta[];
  isDefault: boolean;
}

export interface RecipeDelta {
  componentId: Id;
  componentName: Localised;
  operation: "add" | "remove_all" | "scale";
  quantity?: Quantity;
}

export interface ModifierGroup {
  id: Id;
  tenantId: Id;
  name: Localised;
  minSelections: number;
  maxSelections: number;
  required: boolean;
  allowRepeat: boolean;
  freeQuantityThreshold: number | null;
  modifiers: Modifier[];
  attachedItemCount: number;
}

export interface ComboSlot {
  id: Id;
  name: Localised;
  optionItemIds: Id[];
  optionNames: Localised[];
  priceDelta: Money;
}

export type ComboPricingStrategy =
  | "fixed"
  | "sum_minus_discount"
  | "component_override";

export interface Combo {
  id: Id;
  tenantId: Id;
  name: Localised;
  price: Money;
  pricingStrategy: ComboPricingStrategy;
  slots: ComboSlot[];
  active: boolean;
}

export type PriceListScope = "tenant" | "brand" | "branch";

export interface PriceListEntry {
  menuItemId: Id;
  variantId: Id;
  itemName: Localised;
  price: Money;
  previousPrice: Money | null;
}

export interface PriceList {
  id: Id;
  tenantId: Id;
  name: Localised;
  scope: PriceListScope;
  scopeId: Id | null;
  orderTypes: OrderType[];
  priority: number;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  /** FR-MNU-022 — recurring windows such as weekdays 15:00–18:00. */
  recurrence: string | null;
  entryCount: number;
  entries: PriceListEntry[];
  active: boolean;
}

// ---------------------------------------------------------------------------
// Recipes — SRS §7.4.4, ch.10.6
// ---------------------------------------------------------------------------

export type RecipeType = "menu_item" | "sub_recipe" | "production_item";
export type RecipeStatus = "draft" | "published" | "superseded" | "archived";

export interface RecipeLine {
  id: Id;
  sequence: number;
  componentType: "stock_item" | "sub_recipe";
  componentId: Id;
  componentName: Localised;
  quantity: Quantity;
  /** FR-MNU-044 — trim loss for this component, e.g. 18% peeling potatoes. */
  wastagePercentage: number;
  isOptional: boolean;
  unitCost: Money;
  lineCost: Money;
}

export interface Recipe {
  id: Id;
  tenantId: Id;
  name: Localised;
  recipeType: RecipeType;
  targetId: Id | null;
  targetName: Localised | null;
  version: number;
  status: RecipeStatus;
  yieldQuantity: Quantity;
  /** FR-MNU-043 — preparation loss across the whole recipe. */
  yieldPercentage: number;
  prepTimeSeconds: number;
  lines: RecipeLine[];
  computedCost: Money;
  costPerPortion: Money;
  /** Selling price of the linked variant, for the margin readout. */
  sellingPrice: Money | null;
  costComputedAt: IsoDateTime;
  effectiveFrom: IsoDate;
  /** BR-MNU-012 — an item may be sold before its recipe is complete. */
  complete: boolean;
  instructions: Localised;
}

// ---------------------------------------------------------------------------
// Inventory — SRS ch.11
// ---------------------------------------------------------------------------

export type CostingMethod = "weighted_average" | "fifo" | "standard";
export type StorageRequirement = "ambient" | "chilled" | "frozen";

export interface StockItem {
  id: Id;
  tenantId: Id;
  sku: string;
  name: Localised;
  category: Localised;
  baseUnit: UnitCode;
  /**
   * The unit's own id, when it came from the backend.
   *
   * `baseUnit` is a display code resolved through the unit registry, and a
   * code cannot be sent back — every write that carries a unit wants the
   * UUID. Undefined in demo mode, where units are codes all the way down.
   */
  baseUnitId?: Id;
  purchaseUnit: UnitCode;
  purchaseConversion: number;
  costingMethod: CostingMethod;
  batchTracked: boolean;
  expiryTracked: boolean;
  storage: StorageRequirement;
  shelfLifeDays: number | null;
  defaultSupplierId: Id | null;
  allergens: string[];
  unitCost: Money;
  active: boolean;
}

export interface StockLevel {
  itemId: Id;
  itemName: Localised;
  sku: string;
  locationId: Id;
  locationName: Localised;
  onHand: Quantity;
  allocated: Quantity;
  onOrder: Quantity;
  reorderPoint: number;
  reorderQuantity: number;
  parLevel: number;
  unitCost: Money;
  value: Money;
  /** Derived: how many days of cover at the trailing usage rate. */
  daysOfCover: number | null;
  lastCountedAt: IsoDateTime | null;
  status: "ok" | "low" | "critical" | "negative" | "overstocked";
}

export interface Batch {
  id: Id;
  itemId: Id;
  itemName: Localised;
  locationId: Id;
  locationName: Localised;
  batchNumber: string;
  productionDate: IsoDate | null;
  expiryDate: IsoDate;
  quantity: Quantity;
  unitCost: Money;
  value: Money;
  supplierId: Id | null;
  supplierName: Localised | null;
  daysToExpiry: number;
  status: "fresh" | "expiring" | "critical" | "expired";
}

/** SRS §7.4.3 — the immutable ledger every quantity derives from. */
export type MovementType =
  | "purchase_receipt"
  | "purchase_return"
  | "sale_depletion"
  | "sale_reversal"
  | "transfer_out"
  | "transfer_in"
  | "production_input"
  | "production_output"
  | "waste"
  | "count_adjustment"
  | "manual_adjustment"
  | "opening_balance"
  | "expiry_writeoff";

export interface StockMovement {
  id: Id;
  tenantId: Id;
  locationId: Id;
  locationName: Localised;
  itemId: Id;
  itemName: Localised;
  batchId: Id | null;
  movementType: MovementType;
  /** Signed: negative is out. */
  quantity: Quantity;
  unitCost: Money;
  totalCost: Money;
  balanceAfter: Quantity;
  referenceType: string;
  referenceId: Id;
  counterpartMovementId: Id | null;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  performedBy: Id;
  performedByName: Localised;
  reasonCode: string | null;
  notes: string | null;
}

export type CountMode = "blind" | "open";
export type CountStatus = "draft" | "counting" | "submitted" | "posted" | "cancelled";

export interface CountLine {
  id: Id;
  itemId: Id;
  itemName: Localised;
  sku: string;
  /** Hidden in the UI while a blind count is in progress — FR-INV-042. */
  expected: Quantity;
  counted: Quantity | null;
  varianceQty: number;
  varianceValue: Money;
  variancePercent: number;
  flagged: boolean;
  recount: boolean;
}

export interface CountSession {
  id: Id;
  tenantId: Id;
  locationId: Id;
  locationName: Localised;
  reference: string;
  scope: Localised;
  mode: CountMode;
  status: CountStatus;
  openedAt: IsoDateTime;
  submittedAt: IsoDateTime | null;
  postedAt: IsoDateTime | null;
  countedBy: Id;
  countedByName: Localised;
  postedBy: Id | null;
  lineCount: number;
  flaggedCount: number;
  netVarianceValue: Money;
  lines: CountLine[];
}

export type TransferStatus =
  | "draft"
  | "requested"
  | "dispatched"
  | "in_transit"
  | "received"
  | "discrepancy"
  | "cancelled";

export interface TransferLine {
  id: Id;
  itemId: Id;
  itemName: Localised;
  dispatched: Quantity;
  received: Quantity | null;
  discrepancy: number;
  unitCost: Money;
}

export interface Transfer {
  id: Id;
  tenantId: Id;
  reference: string;
  fromLocationId: Id;
  fromLocationName: Localised;
  toLocationId: Id;
  toLocationName: Localised;
  status: TransferStatus;
  dispatchedAt: IsoDateTime | null;
  receivedAt: IsoDateTime | null;
  requestedBy: Localised;
  lines: TransferLine[];
  totalValue: Money;
}

export type WasteCategory =
  | "storage"
  | "supplier"
  | "kitchen"
  | "service"
  | "policy"
  | "facility"
  | "control";

export interface WasteReason {
  code: string;
  name: Localised;
  category: WasteCategory;
  /** FR-INV-059 — staff meals and tastings are not true waste. */
  isTrueWaste: boolean;
}

export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";

export interface WasteRecord {
  id: Id;
  tenantId: Id;
  locationId: Id;
  locationName: Localised;
  itemId: Id;
  itemName: Localised;
  quantity: Quantity;
  reasonCode: string;
  reasonName: Localised;
  category: WasteCategory;
  isTrueWaste: boolean;
  value: Money;
  recordedAt: IsoDateTime;
  recordedBy: Id;
  recordedByName: Localised;
  stationId: Id | null;
  approval: ApprovalState;
  notes: string | null;
}

export interface StockAdjustment {
  id: Id;
  tenantId: Id;
  locationId: Id;
  locationName: Localised;
  itemId: Id;
  itemName: Localised;
  quantity: Quantity;
  reasonCode: string;
  reasonName: Localised;
  value: Money;
  createdAt: IsoDateTime;
  createdBy: Localised;
  approval: ApprovalState;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Purchasing — SRS ch.12
// ---------------------------------------------------------------------------

export interface Supplier {
  id: Id;
  tenantId: Id;
  code: string;
  legalName: Localised;
  tradingName: Localised;
  taxRegistration: string;
  contactName: string;
  phone: string;
  email: string;
  paymentTermsDays: number;
  currency: Currency;
  leadTimeDays: number;
  minimumOrderValue: Money;
  deliveryDays: string[];
  active: boolean;
  /** FR-PRC-009 — supplier scorecard. */
  scorecard: SupplierScorecard;
  outstandingBalance: Money;
}

export interface SupplierScorecard {
  onTimeDeliveryRate: number;
  fillRate: number;
  priceStability: number;
  qualityRejectionRate: number;
  invoiceAccuracy: number;
  averageLeadTimeDays: number;
}

export type RequisitionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "consolidated"
  | "rejected"
  | "cancelled";

export interface RequisitionLine {
  id: Id;
  itemId: Id;
  itemName: Localised;
  quantity: Quantity;
  estimatedCost: Money;
}

export interface Requisition {
  id: Id;
  tenantId: Id;
  reference: string;
  branchId: Id;
  branchName: Localised;
  status: RequisitionStatus;
  requestedBy: Localised;
  requestedAt: IsoDateTime;
  neededBy: IsoDate;
  lines: RequisitionLine[];
  estimatedTotal: Money;
  notes: string | null;
}

export type PurchaseOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

export interface PurchaseOrderLine {
  id: Id;
  itemId: Id;
  itemName: Localised;
  quantity: Quantity;
  receivedQuantity: Quantity;
  unitPrice: Money;
  taxRate: number;
  lineTotal: Money;
}

export interface PurchaseOrder {
  id: Id;
  tenantId: Id;
  reference: string;
  supplierId: Id;
  supplierName: Localised;
  deliveryLocationId: Id;
  deliveryLocationName: Localised;
  status: PurchaseOrderStatus;
  /** FR-PRC-018 — the value band that decides who must approve. */
  approvalTier: 0 | 1 | 2 | 3;
  createdBy: Localised;
  createdAt: IsoDateTime;
  expectedDelivery: IsoDate;
  approvedBy: Localised | null;
  approvedAt: IsoDateTime | null;
  lines: PurchaseOrderLine[];
  subtotal: Money;
  taxTotal: Money;
  total: Money;
}

export type ReceiptStatus = "draft" | "posted" | "disputed";

export interface GoodsReceiptLine {
  id: Id;
  itemId: Id;
  itemName: Localised;
  ordered: Quantity;
  received: Quantity;
  rejected: Quantity;
  rejectionReason: string | null;
  batchNumber: string | null;
  expiryDate: IsoDate | null;
  unitPrice: Money;
  /** FR-PRC-008 — percentage drift from the agreed price. */
  priceVariancePercent: number;
}

export interface GoodsReceipt {
  id: Id;
  tenantId: Id;
  reference: string;
  purchaseOrderId: Id | null;
  purchaseOrderRef: string | null;
  supplierId: Id;
  supplierName: Localised;
  locationId: Id;
  locationName: Localised;
  status: ReceiptStatus;
  receivedAt: IsoDateTime;
  receivedBy: Localised;
  /** FR-PRC-035 — chilled and frozen goods carry a reading. */
  temperatureC: number | null;
  temperatureOk: boolean;
  lines: GoodsReceiptLine[];
  total: Money;
}

export type MatchResult = "matched" | "within_tolerance" | "disputed" | "unmatched";
export type InvoiceStatus =
  | "recorded"
  | "matched"
  | "disputed"
  | "approved_for_payment"
  | "paid";

export interface SupplierInvoice {
  id: Id;
  tenantId: Id;
  reference: string;
  supplierInvoiceNumber: string;
  supplierId: Id;
  supplierName: Localised;
  goodsReceiptId: Id | null;
  goodsReceiptRef: string | null;
  purchaseOrderRef: string | null;
  status: InvoiceStatus;
  /** FR-PRC-041 — the three-way match across PO, receipt and invoice. */
  matchResult: MatchResult;
  matchNotes: Localised | null;
  invoiceDate: IsoDate;
  dueDate: IsoDate;
  subtotal: Money;
  taxTotal: Money;
  total: Money;
  ageingBucket: "current" | "30" | "60" | "90+";
}

// ---------------------------------------------------------------------------
// Sales and kitchen — SRS §7.4.1, ch.8, ch.9
// ---------------------------------------------------------------------------

export type OrderType =
  | "dine_in"
  | "takeaway"
  | "delivery"
  | "drive_thru"
  | "pickup"
  | "aggregator";

export type OrderChannel = "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";

export type OrderState =
  | "draft"
  | "open"
  | "held"
  | "parked"
  | "partially_paid"
  | "completed"
  | "cancelled"
  | "partially_refunded"
  | "refunded";

export type OrderLineState =
  | "pending"
  | "fired"
  | "preparing"
  | "ready"
  | "served"
  | "voided"
  | "comped";

export interface OrderLineModifier {
  id: Id;
  name: Localised;
  kind: ModifierKind;
  priceDelta: Money;
}

export interface OrderLine {
  id: Id;
  sequence: number;
  menuItemId: Id;
  variantId: Id;
  /** BR-POS-004 — captured at sale time, never re-derived. */
  itemNameSnapshot: Localised;
  quantity: number;
  unitPrice: Money;
  modifiers: OrderLineModifier[];
  modifierTotal: Money;
  lineDiscount: Money;
  lineSubtotal: Money;
  taxAmount: Money;
  lineTotal: Money;
  unitCostSnapshot: Money;
  recipeVersionId: Id | null;
  course: number;
  seatNumber: number | null;
  state: OrderLineState;
  stationId: Id | null;
  firedAt: IsoDateTime | null;
  readyAt: IsoDateTime | null;
  voidReason: string | null;
  isComp: boolean;
  notes: string | null;
}

export type TenderType =
  | "cash"
  | "card"
  | "wallet"
  | "gift_card"
  | "loyalty_points"
  | "store_credit"
  | "voucher"
  | "bank_transfer"
  | "on_account"
  | "aggregator_settled";

export interface OrderPayment {
  id: Id;
  tender: TenderType;
  /** Applied to the order balance — capped at what was owed, never more. */
  amount: Money;
  /** What the customer actually handed over. Equals `amount` for every
   *  non-cash tender, since only cash produces physical change. */
  tenderedAmount: Money;
  /** `tenderedAmount - amount`. Zero for every non-cash tender. */
  changeAmount: Money;
  tip: Money;
  /** IR-INT-013 — the last four digits only; never a PAN. */
  cardLast4: string | null;
  cardScheme: string | null;
  authorisationCode: string | null;
  capturedAt: IsoDateTime;
}

export interface OrderDiscount {
  id: Id;
  reason: Localised;
  percentage: number | null;
  amount: Money;
  appliedBy: Localised;
  approvedBy: Localised | null;
  appliedAt: IsoDateTime;
}

export type SyncState = "local" | "pending" | "synced" | "conflicted";

export interface Order {
  id: Id;
  tenantId: Id;
  branchId: Id;
  branchName: Localised;
  terminalId: Id;
  terminalName: string;
  orderNumber: string;
  businessDay: IsoDate;
  orderType: OrderType;
  channel: OrderChannel;
  state: OrderState;
  tableId: Id | null;
  tableLabel: string | null;
  guestCount: number | null;
  customerId: Id | null;
  customerName: Localised | null;
  openedBy: Id;
  openedByName: Localised;
  servedByName: Localised | null;
  currency: Currency;
  subtotal: Money;
  discountTotal: Money;
  serviceChargeTotal: Money;
  taxTotal: Money;
  roundingAdjustment: Money;
  grandTotal: Money;
  paidTotal: Money;
  tipTotal: Money;
  cogsTotal: Money;
  lines: OrderLine[];
  payments: OrderPayment[];
  discounts: OrderDiscount[];
  openedAt: IsoDateTime;
  firstFiredAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  /** Set together, only when `state` becomes `"cancelled"`. */
  cancelledAt: IsoDateTime | null;
  cancelledBy: Localised | null;
  cancelReason: string | null;
  syncState: SyncState;
  /** When a `"pending"` order synced to the server — distinct from `openedAt`,
   *  which is when it was actually rung up, possibly while offline. */
  syncedAt: IsoDateTime | null;
  aggregatorRef: string | null;
  notes: string | null;
  /**
   * Optimistic-concurrency token, and the ETag validator (SRS §24.6.4).
   *
   * Sent back as `if-match` on every mutation, so a second terminal editing
   * the same order is refused with 412 rather than silently overwriting.
   * Null in demo mode, where there is no server to disagree with.
   */
  version: number | null;
}

/**
 * `cancelled` is deliberately not `bumped`.
 *
 * Bumping means the food was made and went out. A cancelled order's ticket
 * has to stay on the station display, loudly, until a cook acknowledges it —
 * otherwise the card vanishes from under someone who is mid-cook and the pan
 * keeps going.
 */
export type TicketState = "queued" | "started" | "ready" | "bumped" | "recalled" | "cancelled";
export type TicketUrgency = "on_target" | "approaching" | "exceeded" | "critical";

export interface TicketLine {
  id: Id;
  name: Localised;
  quantity: number;
  modifiers: { name: Localised; kind: ModifierKind }[];
  state: OrderLineState;
  notes: string | null;
}

export interface KitchenTicket {
  id: Id;
  branchId: Id;
  orderId: Id;
  orderNumber: string;
  orderType: OrderType;
  tableLabel: string | null;
  stationId: Id;
  stationName: Localised;
  state: TicketState;
  urgency: TicketUrgency;
  course: number;
  priority: "normal" | "rush" | "vip" | "remake";
  firedAt: IsoDateTime;
  /**
   * When a cook pressed Start and took the ticket on, or null while it is
   * still queued.
   *
   * `firedAt` measures what the guest experiences; this measures what the
   * line does. The gap between the two is pick-up time — a queued ticket
   * nobody has touched is invisible in the elapsed clock alone, because that
   * clock runs identically whether or not anyone is cooking.
   */
  startedAt: IsoDateTime | null;
  /** When the ticket was bumped as done, or null while it is still open. */
  bumpedAt: IsoDateTime | null;
  /**
   * Why the order was cancelled, shown to the cook on the station display.
   * The reason is mandatory at the till, so a cancelled ticket always has one.
   */
  cancelReason: string | null;
  targetSeconds: number;
  elapsedSeconds: number;
  lines: TicketLine[];
}

// ---------------------------------------------------------------------------
// Workforce — SRS ch.14
// ---------------------------------------------------------------------------

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "casual"
  | "contractor"
  | "trainee";

export type EmployeeStatus = "active" | "on_leave" | "suspended" | "terminated";

export interface EmployeeDocument {
  id: Id;
  type: Localised;
  reference: string;
  expiresOn: IsoDate;
  daysToExpiry: number;
  status: "valid" | "expiring" | "expired";
}

export interface Employee {
  id: Id;
  tenantId: Id;
  code: string;
  name: Localised;
  position: Localised;
  department: Localised;
  homeBranchId: Id;
  homeBranchName: Localised;
  permittedBranchIds: Id[];
  employmentType: EmploymentType;
  status: EmployeeStatus;
  hiredOn: IsoDate;
  phone: string;
  email: string;
  /** FR-HRM-003 — visible only with hr.compensation.view. */
  hourlyRate: Money;
  userId: Id | null;
  documents: EmployeeDocument[];
}

export type ShiftStatus = "draft" | "published" | "acknowledged" | "completed";

export interface ScheduledShift {
  id: Id;
  employeeId: Id;
  employeeName: Localised;
  position: Localised;
  branchId: Id;
  date: IsoDate;
  startTime: string;
  endTime: string;
  hours: number;
  status: ShiftStatus;
  projectedCost: Money;
  /** FR-HRM-012 — scheduling rule violations. */
  violations: string[];
}

export type AttendanceFlag =
  | "late_arrival"
  | "early_departure"
  | "missing_clock_out"
  | "outside_geofence"
  | "no_scheduled_shift"
  | "auto_closed";

export interface AttendanceRecord {
  id: Id;
  employeeId: Id;
  employeeName: Localised;
  branchId: Id;
  branchName: Localised;
  date: IsoDate;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clockIn: IsoDateTime | null;
  clockOut: IsoDateTime | null;
  method: "pin" | "mobile" | "biometric" | "manual";
  regularHours: number;
  overtimeHours: number;
  breakMinutes: number;
  flags: AttendanceFlag[];
  corrected: boolean;
  cost: Money;
}

export interface OvertimeRecord {
  id: Id;
  employeeId: Id;
  employeeName: Localised;
  branchName: Localised;
  weekStarting: IsoDate;
  regularHours: number;
  overtimeHours: number;
  multiplier: number;
  cost: Money;
  approval: ApprovalState;
  approvedBy: Localised | null;
}

export interface EmployeePerformance {
  employeeId: Id;
  employeeName: Localised;
  position: Localised;
  branchName: Localised;
  netSales: Money;
  orderCount: number;
  averageOrderValue: Money;
  itemsPerOrder: number;
  upsellRate: number;
  averageServiceSeconds: number;
  voidCount: number;
  voidValue: Money;
  discountValue: Money;
  cashVariance: Money;
  hoursWorked: number;
  salesPerLabourHour: Money;
}

// ---------------------------------------------------------------------------
// Finance — SRS ch.16
// ---------------------------------------------------------------------------

export type CashSessionStatus = "open" | "closing" | "closed" | "force_closed";

export interface DenominationCount {
  value: number;
  count: number;
}

export interface CashSession {
  id: Id;
  tenantId: Id;
  branchId: Id;
  branchName: Localised;
  drawerId: Id;
  drawerName: string;
  terminalName: string;
  employeeId: Id;
  employeeName: Localised;
  status: CashSessionStatus;
  openedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
  businessDay: IsoDate;
  openingFloat: Money;
  cashSales: Money;
  cashRefunds: Money;
  payIns: Money;
  payOuts: Money;
  safeDrops: Money;
  expectedCash: Money;
  countedCash: Money | null;
  /** FR-FIN-005 — counted minus expected. */
  variance: Money;
  varianceApproval: ApprovalState;
  denominations: DenominationCount[];
  orderCount: number;
  /** Sum of `subtotal` across this session's completed orders, before any deduction. */
  grossSales: Money;
  discountTotal: Money;
  taxTotal: Money;
  serviceChargeTotal: Money;
  /** `grossSales - discountTotal + serviceChargeTotal` — tax excluded, since tax is
   *  collected on the government's behalf rather than earned as revenue. */
  netSales: Money;
  cardSales: Money;
  /** Wallet, gift card, loyalty points, store credit, voucher, bank transfer, etc. */
  otherSales: Money;
  /** Refunds across every tender, not only cash — see `cashRefunds` for the cash-only figure. */
  refundTotal: Money;
  cancelledOrderCount: number;
}

export type ExpenseStatus = "draft" | "pending_approval" | "approved" | "rejected" | "posted";

export interface Expense {
  id: Id;
  tenantId: Id;
  branchId: Id;
  branchName: Localised;
  reference: string;
  category: Localised;
  description: Localised;
  amount: Money;
  paymentMethod: "petty_cash" | "bank_transfer" | "card" | "on_account";
  supplierName: Localised | null;
  incurredOn: IsoDate;
  status: ExpenseStatus;
  recurring: boolean;
  hasAttachment: boolean;
  createdBy: Localised;
}

export interface TenderSummaryRow {
  tender: TenderType;
  count: number;
  amount: Money;
}

export interface TaxSummaryRow {
  taxClass: TaxClassCode;
  rate: number;
  netAmount: Money;
  taxAmount: Money;
  grossAmount: Money;
}

export type DayCloseStatus = "open" | "blocked" | "closed";

export interface DayClose {
  id: Id;
  tenantId: Id;
  branchId: Id;
  branchName: Localised;
  businessDay: IsoDate;
  status: DayCloseStatus;
  /** FR-FIN-023 — sequentially numbered per branch, immutable. */
  zReportNumber: number | null;
  closedAt: IsoDateTime | null;
  closedBy: Localised | null;
  /** FR-FIN-021 — day close is blocked while these remain open. */
  blockingSessions: string[];
  grossSales: Money;
  discounts: Money;
  refunds: Money;
  netSales: Money;
  taxTotal: Money;
  transactionCount: number;
  averageOrderValue: Money;
  voidCount: number;
  compValue: Money;
  cashVariance: Money;
  tenders: TenderSummaryRow[];
  taxRows: TaxSummaryRow[];
}

// ---------------------------------------------------------------------------
// Costing and profitability — SRS ch.13
// ---------------------------------------------------------------------------

export interface FoodCostRow {
  key: string;
  label: Localised;
  netSales: Money;
  cogs: Money;
  foodCostPercent: number;
  targetPercent: number;
  variancePoints: number;
}

/** FR-CST-010..014 — the variance report. */
export interface VarianceRow {
  itemId: Id;
  itemName: Localised;
  sku: string;
  category: Localised;
  unit: UnitCode;
  theoreticalUsage: number;
  actualUsage: number;
  varianceQty: number;
  recordedWasteQty: number;
  unexplainedQty: number;
  varianceValue: Money;
  variancePercent: number;
  /** FR-CST-015 — a hypothesis, never a conclusion. */
  hypothesis: Localised | null;
}

export interface WasteAnalysisRow {
  key: string;
  label: Localised;
  quantity: number;
  value: Money;
  percentOfCogs: number;
  recordCount: number;
  isTrueWaste: boolean;
}

/** FR-MNU-055 — Boston-matrix menu engineering. */
export type MenuClassification = "star" | "plough_horse" | "puzzle" | "dog";

export interface ContributionMarginRow {
  itemId: Id;
  itemName: Localised;
  category: Localised;
  unitsSold: number;
  sellingPrice: Money;
  directCost: Money;
  contributionMargin: Money;
  contributionMarginPercent: number;
  totalContribution: Money;
  classification: MenuClassification;
}

export interface ChannelProfitabilityRow {
  channel: OrderChannel;
  revenue: Money;
  cogs: Money;
  commission: Money;
  packaging: Money;
  netContribution: Money;
  marginPercent: number;
}

// ---------------------------------------------------------------------------
// Governance — SRS ch.15.6, ch.20
// ---------------------------------------------------------------------------

export type ApprovalKind =
  | "discount"
  | "refund"
  | "purchase_order"
  | "waste"
  | "count_adjustment"
  | "expense"
  | "price_change"
  | "overtime"
  | "stock_adjustment";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "escalated";

export interface ApprovalRequest {
  id: Id;
  tenantId: Id;
  reference: string;
  kind: ApprovalKind;
  entityType: string;
  entityId: Id;
  entityLabel: Localised;
  branchId: Id;
  branchName: Localised;
  value: Money;
  requestedBy: Id;
  requestedByName: Localised;
  requestedAt: IsoDateTime;
  requiredPermission: PermissionKey;
  status: ApprovalStatus;
  decidedBy: Localised | null;
  decidedAt: IsoDateTime | null;
  comment: string | null;
  expiresAt: IsoDateTime;
  reason: Localised;
}

export type ActorType = "user" | "system" | "device" | "integration";

export interface AuditEntry {
  id: Id;
  tenantId: Id;
  branchId: Id | null;
  branchName: Localised | null;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  actorId: Id;
  actorName: Localised;
  actorType: ActorType;
  impersonatedBy: Localised | null;
  /** Canonical verb, e.g. order.discount.applied. */
  action: string;
  entityType: string;
  entityId: Id;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reasonCode: string | null;
  reasonText: string | null;
  approverName: Localised | null;
  ipAddress: string;
  terminalId: Id | null;
  correlationId: string;
  /** FR-AUD-004 — SHA-256 over the entry plus the previous hash. */
  hash: string;
  previousHash: string;
}

export type AnomalyKind =
  | "excessive_voids"
  | "post_payment_void"
  | "refund_concentration"
  | "discount_concentration"
  | "no_sale_drawer_opens"
  | "cash_variance_pattern"
  | "waste_concentration"
  | "count_adjustment_pattern"
  | "price_override_frequency"
  | "outside_trading_hours";

export interface AnomalyFlag {
  id: Id;
  kind: AnomalyKind;
  title: Localised;
  /** FR-CST-042 — the evidence, so a manager can evaluate rather than accept. */
  evidence: Localised;
  branchId: Id;
  branchName: Localised;
  subjectName: Localised;
  observedValue: number;
  baselineValue: number;
  sigma: number;
  detectedAt: IsoDateTime;
  severity: Severity;
  status: "open" | "reviewing" | "dismissed" | "confirmed";
}

/** FR-SEC-015 — incompatible permission pairs. */
export interface SodConflict {
  userId: Id;
  userName: Localised;
  roleName: Localised;
  permissionA: PermissionKey;
  permissionB: PermissionKey;
  risk: Localised;
  blocking: boolean;
}

// ---------------------------------------------------------------------------
// Platform — country packs, integrations, alerts
// ---------------------------------------------------------------------------

export type CountryCode = "EG" | "SA" | "AE" | "JO" | "KW" | "QA";

export interface TaxClassDefinition {
  code: TaxClassCode;
  rate: number | null;
  label: Localised;
}

export interface CountryPack {
  code: CountryCode;
  name: Localised;
  version: string;
  effectiveFrom: IsoDate;
  status: "active" | "scheduled" | "draft" | "superseded";
  signed: boolean;
  currency: Currency;
  currencyExponent: number;
  taxEngine: string;
  pricingMode: "tax_inclusive" | "tax_exclusive";
  roundingMode: "HALF_UP" | "HALF_EVEN" | "DOWN";
  computationLevel: "line" | "order";
  taxClasses: TaxClassDefinition[];
  fiscalProvider: string | null;
  fiscalMode: string | null;
  weekStart: string;
  weekend: string[];
  standardWeeklyHours: number;
  overtimeMultiplier: number;
  dataRetentionYears: number;
  branchCount: number;
  conformancePassed: boolean;
}

export type IntegrationCategory =
  | "payment"
  | "aggregator"
  | "accounting"
  | "notification"
  | "identity"
  | "hardware";

export type ConnectorStatus = "healthy" | "degraded" | "failing" | "disabled" | "not_configured";

export interface Integration {
  id: Id;
  name: string;
  category: IntegrationCategory;
  vendor: string;
  status: ConnectorStatus;
  enabled: boolean;
  /** FR-INT-004 — connector health is visible, not inferred. */
  lastSuccessAt: IsoDateTime | null;
  errorRate: number;
  queueDepth: number;
  /** FR-INT-006 — circuit breaker state. */
  circuitOpen: boolean;
  branchCount: number;
  description: Localised;
}

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type AlertKind =
  | "cash_variance"
  | "discount_threshold"
  | "void_after_payment"
  | "stock_zero"
  | "low_stock"
  | "expiry"
  | "order_delayed"
  | "sales_below_forecast"
  | "terminal_offline"
  | "sync_backlog"
  | "fiscal_submission_failed"
  | "document_expiring"
  | "negative_stock";

export interface OperationalAlert {
  id: Id;
  kind: AlertKind;
  severity: Severity;
  title: Localised;
  detail: Localised;
  branchId: Id | null;
  branchName: Localised | null;
  raisedAt: IsoDateTime;
  acknowledged: boolean;
  /** Where clicking the alert should take the user. */
  href: string | null;
  specRef: string;
}

// ---------------------------------------------------------------------------
// Dashboard aggregates — SRS ch.19.4
// ---------------------------------------------------------------------------

export interface TrendPoint {
  label: string;
  value: number;
  comparison?: number;
}

export interface MetricSummary {
  value: number;
  previous: number;
  target: number | null;
  deltaPercent: number;
  direction: "up" | "down" | "flat";
  /** Whether "up" is good for this metric — food cost rising is bad. */
  higherIsBetter: boolean;
}

export interface HourlySalesPoint {
  hour: string;
  sales: number;
  /** Null when no payroll source exists — the backend has no workforce API. */
  labourCost: number | null;
  orders: number;
  /** Null when nothing forecasts; the backend has no forecasting endpoint. */
  forecast: number | null;
}

/**
 * One branch's line in the ranking.
 *
 * The percentages are nullable because they are not all derivable from the
 * same source: sales and cost of goods come off the orders themselves, while
 * labour needs a payroll feed the backend does not expose. A null means "no
 * source for this", and the table shows a dash — never a zero, which would
 * read as a branch with no labour cost at all.
 */
export interface BranchRankingRow {
  branchId: Id;
  branchName: Localised;
  brandName: Localised;
  netSales: Money;
  transactionCount: number;
  averageOrderValue: Money;
  foodCostPercent: number | null;
  labourCostPercent: number | null;
  primeCostPercent: number | null;
  wastePercent: number | null;
  varianceValue: Money | null;
  rank: number;
  /** Null when there is no prior period to compare against. */
  previousRank: number | null;
  /** FR-BRN-013 — deviation from the group mean, in standard deviations. */
  outlierSigma: number;
}

/**
 * The now, as far as the server can describe it.
 *
 * Orders, tables and terminals are read straight off the API. The kitchen
 * figures and the staff count are null because there is no KDS or workforce
 * endpoint to read them from — and a queue depth of zero would be read as a
 * clear pass, which is the opposite of "nobody is watching".
 */
export interface LiveOperationsSnapshot {
  openOrders: number;
  tablesOccupied: number;
  tablesTotal: number;
  kitchenQueueDepth: number | null;
  averageWaitSeconds: number | null;
  activeTerminals: number;
  totalTerminals: number;
  offlineTerminals: number;
  staffOnShift: number | null;
  delayedTickets: number | null;
  syncBacklog: number;
}

export interface DashboardData {
  businessDay: IsoDate;
  generatedAt: IsoDateTime;
  currency: Currency;
  netSales: MetricSummary;
  transactions: MetricSummary;
  averageOrderValue: MetricSummary;
  /** Null unless the orders carry cost snapshots to divide by. */
  foodCostPercent: MetricSummary | null;
  /** Null — no payroll endpoint exists to cost a shift against. */
  labourCostPercent: MetricSummary | null;
  /** Null whenever either half of prime cost is. */
  primeCostPercent: MetricSummary | null;
  wastePercent: MetricSummary | null;
  grossProfit: MetricSummary | null;
  salesTrend: TrendPoint[];
  hourly: HourlySalesPoint[];
  categoryMix: TrendPoint[];
  branchRanking: BranchRankingRow[];
  wasteByReason: TrendPoint[];
  /**
   * The P&L ladder, as far down it as the data reaches.
   *
   * Everything above gross profit comes from the orders. Below it needs
   * payroll and an expense ledger, neither of which the backend serves, so
   * those rungs are null and the panel stops rather than inventing a number.
   */
  profitability: {
    grossSales: Money;
    discounts: Money;
    refunds: Money | null;
    netSales: Money;
    cogs: Money | null;
    grossProfit: Money | null;
    labourCost: Money | null;
    contributionAfterLabour: Money | null;
    operatingExpenses: Money | null;
    operatingProfit: Money | null;
  };
  alerts: OperationalAlert[];
  live: LiveOperationsSnapshot;
}

// ---------------------------------------------------------------------------
// Reports catalogue — SRS §19.3
// ---------------------------------------------------------------------------

export type ReportCategory =
  | "sales"
  | "inventory"
  | "kitchen"
  | "financial"
  | "workforce"
  | "governance";

export interface ReportDefinition {
  id: string;
  category: ReportCategory;
  name: Localised;
  description: Localised;
  requiredPermission: PermissionKey;
  /** Whether the report is heavy enough to run asynchronously. */
  async: boolean;
  specRef: string;
}

export type { PermissionKey, RoleKey };
