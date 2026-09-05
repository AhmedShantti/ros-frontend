/**
 * Wire types for ROS Backend API v0.0.1.
 *
 * GENERATED — do not edit. Run `npm run api:types` after replacing
 * `api/openapi.json`. 141 paths, 105 request DTOs.
 *
 * These are the shapes the backend actually sends and accepts. They are NOT
 * the console's domain model — see `lib/console/services/map.ts` for the
 * translation between the two.
 */

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface AcknowledgeViewedDto {
  ticketIds: string[];
}

export interface AddFingerprintDto {
  appVersion?: string;
  deviceFingerprint: string;
  os?: string;
}

export interface AddLineModifierDto {
  modifierId: string;
  quantity?: number;
}

export interface AddOrderLineDto {
  course?: number;
  /** FR-OFF-015 — the ULID the device assigned to this line. */
  id?: string;
  menuItemId: string;
  modifiers?: AddLineModifierDto[];
  notes?: string;
  /** DECIMAL(12,3) carried as an exact string end to end (BR-CORE-003). A JSON number could not represent 0.001 exactly and must never price a sale. */
  quantity: string;
  seatNumber?: number;
  variantId: string;
}

export interface AddPermissionsDto {
  permissionCodes: string[];
}

export interface AddPermittedBranchDto {
  branchId: string;
}

export interface AddSubstituteMemberDto {
  stockItemId: string;
}

export interface ApplyCompDto {
  id?: string;
  reasonCodeId: string;
}

export interface ApplyDiscountDto {
  approvalDecisionId?: string;
  approvalRequestId?: string;
  /** FR-OFF-015 — the ULID the device assigned to this Discount. */
  id?: string;
  managerEmployeeCode?: string;
  managerPin?: string;
  /** REQUIRED — FR-POS-046: selection from a configurable list, never free text. */
  reasonCodeId: string;
  type: "percentage" | "fixed";
  /** `type: percentage` — exact decimal string, at most 2 decimal places, `0 < value <= 100` (e.g. `"15.50"`). `type: fixed` — a whole number of minor units expressed as a string (ADR-008). */
  value: string;
}

export interface AssignBranchDto {
  branchId: string;
}

export interface AssignRoleDto {
  roleId: string;
  scope: AssignmentScopeDto;
  /** FR-SEC-005 — defaults to now when omitted. */
  validFrom?: string;
  /** FR-SEC-005 — omit or null for an open-ended assignment. */
  validTo?: string | null;
}

export interface AssignmentScopeDto {
  /** Required iff `type = branch`. */
  branchId?: string;
  /** Required iff `type = brand`. */
  brandId?: string;
  type: "tenant" | "brand" | "branch";
}

export interface BindTerminalDto {
  terminalId: string;
}

export interface CapturePaymentDto {
  /** The amount this Payment applies toward the order, in MINOR units, as an exact integer string (ADR-008 — never a JSON number). For CASH, the EXACT amount being settled — never the cash-rounded figure, which the server derives from `tenderedAmountMinor` and the order's pinned country pack. */
  amountMinor: string;
  /** Optional. */
  authorizationCode?: string;
  /** Optional, only when the cashier supplies it (FR-POS-066 permitted metadata). */
  cardScheme?: string;
  cashSessionId: string;
  /** FR-OFF-015 — the ULID the device assigned to this Payment. */
  id?: string;
  /** Optional. Exactly 4 digits when present — never more (FR-POS-066). */
  last4?: string;
  tender: "cash" | "manual_external_card";
  /** REQUIRED for CASH; refused for MANUAL_EXTERNAL_CARD. */
  tenderedAmountMinor?: string;
  /** REQUIRED for MANUAL_EXTERNAL_CARD; refused for CASH. The cashier's own record of the already-completed EXTERNAL terminal transaction — never a ROS-side integrated-terminal session id (FR-POS-064 is not implemented). */
  terminalReference?: string;
}

export interface CashMovementDto {
  /** Positive integer minor units, as an exact string (ADR-008: money is never a JSON number). The movement TYPE (the route) supplies the sign — a client can never submit a negative amount. */
  amountMinor: string;
  /** FR-OFF-015 — the device's permanent ULID for this movement. REQUIRED. */
  id: string;
  /** Device-declared instant. Defaults to server receipt time if omitted. */
  occurredAt?: string;
  /** FR-POS-091 [M] — mandatory for ALL THREE movement types. Non-blank. */
  reason: string;
}

export interface ChangeBaseUnitDto {
  baseUnitId: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface ClockInDto {
  gps?: GpsDto;
}

export interface ClockOutDto {
  gps?: GpsDto;
}

export interface CorrectAttendanceDto {
  correctedValue: string;
  field: "clock_in_at" | "clock_out_at";
  reason: string;
}

export interface CreateAvailabilityRuleDto {
  branchId?: string;
  channel?: string;
  dayOfWeek?: number;
  endsAt?: string;
  menuItemId?: string;
  startsAt?: string;
  variantId?: string;
}

export interface CreateBranchDto {
  address?: Record<string, unknown>;
  automaticAvailability?: boolean;
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  name: string;
  timezone: string;
}

export interface CreateBrandDto {
  defaultSettings?: Record<string, unknown>;
  name: string;
  theme?: Record<string, unknown>;
}

export interface CreateCashClosePolicyDto {
  /** FR-POS-094/095. Omitted = the source-stated default, `blind`. */
  countMode?: "open" | "blind";
  /** R-3(a)/C-2. Omitted = effective immediately (resolved to DATABASE time, never this process's clock). Supplied = an explicit future activation instant; a past instant is rejected (C-2 - enforced by the DB CHECK, not merely this validator). */
  effectiveFrom?: string;
  /** R-4(a): configured positive duration. No default exists anywhere. */
  varianceApprovalExpirySeconds: number;
  /** R-1(a): absolute non-negative minor units, as an exact integer string. A JSON number is IEEE-754 and money must never pass through one (ADR-008) - mirrors `OpenCashSessionDto.openingFloat` exactly, including zero being a VALID tolerance (unlike a positive-amount field). */
  varianceToleranceMinorUnits: string;
}

export interface CreateCategoryDto {
  colour?: string;
  name: Record<string, unknown>;
  parentCategoryId?: string;
  sortOrder?: number;
}

export interface CreateCentralKitchenDto {
  name: string;
  warehouseId: string;
}

export interface CreateEmployeeDto {
  code: string;
  contactDetails?: Record<string, unknown>;
  dateOfBirth?: string;
  department?: string;
  displayName: string;
  emergencyContact?: Record<string, unknown>;
  employmentType: "full_time" | "part_time" | "casual" | "contractor" | "trainee";
  hireDate?: string;
  homeBranchId: string;
  namesLocalized?: Record<string, unknown>;
  nationalId?: string;
  permittedBranchIds?: string[];
  position?: string;
  userId?: string;
}

export interface CreateMenuDto {
  activeWindow?: Record<string, unknown>;
  name: Record<string, unknown>;
  /** FR-MNU-002. Vocabulary owned by Sales; stored as text (no Sales dependency). */
  orderTypes?: string[];
  priority?: number;
}

export interface CreateMenuItemDto {
  aggregatorNames?: Record<string, unknown>;
  allergens?: string[];
  barcodePlu?: string;
  colour?: string;
  description?: Record<string, unknown>;
  dietaryTags?: string[];
  isCombo?: boolean;
  isOpenPrice?: boolean;
  isWeighed?: boolean;
  kitchenNames?: Record<string, unknown>;
  names: Record<string, unknown>;
  revenueAccountCode?: string;
  sortOrder?: number;
  /** C-04: recorded only. Fiscal is out of scope, so this is never resolved. */
  taxClassId?: string;
}

export interface CreateModifierDto {
  consumptionQuantity?: string;
  consumptionUnitId?: string;
  isDefault?: boolean;
  /** FR-POS-021 [M]. REQUIRED — P1E-5. Pre-existing rows may carry `kind: null` (no non-heuristic source data could classify them; see the catalogue-modifier-kind migration header), but every NEW modifier created through this API must state its semantic kind explicitly. */
  kind: "addition" | "removal" | "substitution";
  name: Record<string, unknown>;
  /** Minor units as an integer string, so BIGINT precision survives JSON. */
  priceDelta?: string;
  /** FR-MNU-013: opaque JSON — Production Spec is not implemented. */
  recipeDelta?: Record<string, unknown>;
  sortOrder?: number;
  /** FR-MNU-012: recorded only — Inventory is out of scope. */
  stockItemId?: string;
}

export interface CreateModifierGroupDto {
  allowRepeat?: boolean;
  freeQuantityThreshold?: number;
  isRequired?: boolean;
  maxSelections?: number;
  minSelections?: number;
  name: Record<string, unknown>;
}

export interface CreateOperatingHoursDto {
  businessDayCutover?: string;
  closesAt: string;
  dayOfWeek: number;
  opensAt: string;
}

export interface CreateOrderDto {
  channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
  guestCount?: number;
  /** FR-OFF-015 — the ULID the device already assigned. Preserved exactly, so an order created offline keeps one identity for its whole life. */
  id?: string;
  notes?: string;
  /** Optional for a PIN session, where the employee comes from the token. */
  openedByEmployeeId?: string;
  orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
  /** FR-OFF-015 — the device's own clock reading for the sale. Recorded as `origin_device_time`; it never decides the business day. */
  originDeviceTime: string;
  tableId?: string;
  /** The terminal the sale is on. Optional for a terminal-bound session, where it is taken from the token; when supplied it must MATCH the bound terminal. */
  terminalId?: string;
}

export interface CreatePriceListDto {
  name: string;
  orderType?: string;
  priority?: number;
  recurrenceRule?: Record<string, unknown>;
  scopeId?: string;
  /** C-06: `branch_group` is intentionally absent from the enum. */
  scopeType: "tenant" | "brand" | "branch";
  status?: "scheduled" | "active" | "expired";
  validFrom?: string;
  validTo?: string;
}

export interface CreatePrintRoutingDto {
  documentType: "receipt" | "kitchen_ticket" | "bar_ticket";
  printerTarget: string;
  stationId?: string;
}

export interface CreateReasonCodeDto {
  category: string;
  code: string;
  label: Record<string, unknown>;
}

export interface CreateRecipeDto {
  /** D-17-03: required for `branch` scope, forbidden otherwise. */
  branchId?: string;
  /** D-17-03: required for `brand` scope, forbidden otherwise. */
  brandId?: string;
  /** Required when `recipeType = menu_item`. */
  menuItemVariantId?: string;
  recipeType: "menu_item" | "sub_recipe" | "production_item";
  scope: "tenant" | "brand" | "branch";
  /** Required when `recipeType` is `sub_recipe` or `production_item`. */
  stockItemId?: string;
}

export interface CreateRecipeVersionDto {
  /** D-17-08 Q2 — INFORMATIONAL ONLY. Accepted, stored and returned. It is never read by publish, resolution or any selection predicate. */
  effectiveFrom?: string;
  instructions?: Record<string, unknown>;
  lines?: RecipeLineDto[];
  prepTimeSeconds?: number;
  referenceImages?: Record<string, unknown>;
  yieldPercentage?: string;
  yieldQuantity: string;
  yieldUnitId: string;
}

export interface CreateRoleDto {
  description?: string;
  name: string;
}

export interface CreateScheduleDto {
  branchId: string;
  weekStartDate: string;
}

export interface CreateScheduledShiftDto {
  employeeId: string;
  endsAt: string;
  position?: string;
  startsAt: string;
}

export interface CreateStationDto {
  capacityConfig?: Record<string, unknown>;
  displayColour?: string;
  displayTerminalId?: string;
  name: string;
}

export interface CreateStationRoutingRuleDto {
  categoryId?: string;
  menuItemId?: string;
  modifierId?: string;
  priority?: number;
  stationId: string;
}

export interface CreateStockItemDto {
  baseUnitId: string;
  batchStrategy?: "fifo" | "fefo";
  categoryId?: string;
  costingMethod?: "weighted_average" | "fifo" | "standard";
  expiryTracked?: boolean;
  isBatchTracked?: boolean;
  names: Record<string, unknown>;
  recipeUnitId?: string;
  shelfLifeDays?: number;
  sku: string;
  standardCost?: string;
  storageRequirements?: Record<string, unknown>;
}

export interface CreateSubstituteGroupDto {
  name: string;
  stockItemIds?: string[];
}

export interface CreateTableDto {
  label: string;
  seatCapacity?: number;
  section?: string;
}

export interface CreateVariantDto {
  barcode?: string;
  name: Record<string, unknown>;
  prepTimeSeconds?: number;
  sortOrder?: number;
}

export interface CreateWarehouseDto {
  branchId?: string;
  name: string;
  warehouseType?: "branch" | "central" | "virtual";
}

export interface DeactivateEmployeeDto {
  reason: string;
  status: "suspended" | "terminated";
  terminationDate?: string;
}

export interface DeclareCashSessionCloseDto {
  /** FR-OFF-015 — the device's permanent ULID for this close attempt. REQUIRED. */
  closeAttemptId: string;
  /** Non-negative integer minor units, as an exact string. Zero is valid. */
  countedTotalMinorUnits?: string;
  denominations?: DenominationCountDto[];
}

export interface DenominationCountDto {
  /** Positive integer minor units, as an exact string (never a JSON number). */
  denominationMinorUnits: string;
  quantity: number;
}

export interface DispatchTransferDto {
  fromLocationId: string;
  notes?: string;
  quantity: string;
  reasonCodeId?: string;
  stockItemId: string;
  toLocationId: string;
}

/** Nest's default HttpException envelope, also used verbatim by the single global SalesDomainExceptionFilter (statusCode/message differ, error is the class's HTTP reason phrase or domain error name). error is sometimes absent — a bare `new UnauthorizedException()` with no message omits it. */
export interface ErrorResponse {
  /** HTTP reason phrase or domain error class name. Not always present. */
  error?: string;
  /** A single message, or one entry per failed validation constraint (ValidationPipe). */
  message: string | string[];
  statusCode: number;
}

export interface FinalizeCashSessionCloseDto {
  /** FR-OFF-015 — client-generated permanent id for THIS approval decision. */
  approvalDecisionId: string;
  /** FR-OFF-015 — client-generated permanent id for THIS approval request. */
  approvalRequestId: string;
  comment?: string;
  decision: "approved" | "rejected";
  /** The deciding manager's employee code — mirrors `PinLoginDto`. */
  managerEmployeeCode: string;
  /** FR-SEC-020: 4-8 digits. Never logged, never echoed. */
  managerPin: string;
  /** FR-FIN-006 [M] — mandatory above tolerance. Non-blank. */
  reason: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface GpsDto {
  lat: number;
  lng: number;
}

export interface IssueRecoveryGrantDto {
  reason: string;
  terminalId: string;
  /** Default and cap enforced server-side in `SyncRecoveryService`. */
  ttlMinutes?: number;
}

export interface IssueRefundDto {
  /** Minor units, exact integer string (ADR-008). */
  amountMinor: string;
  approvalDecisionId?: string;
  approvalRequestId?: string;
  /** REQUIRED for a `cash` refund; refused for `manual_external_card`. */
  cashSessionId?: string;
  id?: string;
  managerEmployeeCode?: string;
  managerPin?: string;
  /** REQUIRED — the exact Payment this refund is issued against. */
  originalPaymentId: string;
  reasonCodeId: string;
  tender: "cash" | "manual_external_card";
}

export interface LinkModifierGroupDto {
  defaultSelectionOverride?: Record<string, unknown>;
  modifierGroupId: string;
  priceOverride?: Record<string, unknown>;
  sortOrder?: number;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface ModifierRecipeEffectDto {
  componentType: "stock_item" | "sub_recipe";
  operation: "add" | "remove_all";
  /** 6-dp decimal string. Required for `add`; forbidden for `remove_all`. */
  quantity?: string;
  sequence: number;
  stockItemId?: string;
  /** LOGICAL recipe identity — resolved to its published version at capture time. */
  subRecipeId?: string;
  /** Required for `add`; forbidden for `remove_all`. */
  unitId?: string;
}

export interface OpenCashSessionDto {
  /** FR-OFF-015 — the ULID the device assigned to the session. Preserved exactly. */
  cashSessionId: string;
  drawerId: string;
  /** Optional free-text note recorded with the opening. */
  notes?: string;
  /** Declared opening float in MINOR UNITS, as an exact integer string. A string, not a number: a JSON number is IEEE-754 and money must never pass through one (ADR-008). "50000" is 500.00 in a 2-decimal currency; the currency itself comes from the branch, never from here. */
  openingFloat: string;
  /** FR-OFF-015 — the ULID the device assigned to the shift. Preserved exactly. */
  shiftId: string;
}

export interface OpenCountDto {
  isBlindCount?: boolean;
  itemIds?: string[];
  locationId: string;
  /** B-2: caller-supplied approval gate; Inventory never evaluates a threshold. */
  requiresApproval?: boolean;
  scopeId?: string;
  scopeType: "full_location" | "category" | "item_list";
}

export interface PinLoginDto {
  /** Employee code, not an email — a POS operator identifies by staff code. */
  employeeCode: string;
  /** FR-SEC-020: 4–8 digits. Never logged, never echoed. */
  pin: string;
  tenantId: string;
  terminalId: string;
}

export interface PlaceMenuItemDto {
  categoryId: string;
}

export interface PostDayCloseDto {

}

export interface PostMovementDto {
  locationId: string;
  movementType: "purchase_receipt" | "purchase_return" | "sale_depletion" | "sale_reversal" | "transfer_out" | "transfer_in" | "production_input" | "production_output" | "waste" | "count_adjustment" | "manual_adjustment" | "opening_balance" | "expiry_writeoff";
  notes?: string;
  quantity: string;
  reasonCodeId?: string;
  referenceId: string;
  referenceType: string;
  stockItemId: string;
  unitCost?: string;
}

export interface ReassignBrandDto {
  brandId: string;
}

export interface ReceiveTransferDto {
  discrepancyReasonCodeId?: string;
  receivedQuantity: string;
  toLocationId: string;
  transferReferenceId: string;
}

export interface RecipeLineDto {
  componentType: "stock_item" | "sub_recipe";
  isOptional?: boolean;
  /** 6-dp decimal carried as a string end to end (BR-CORE-003). */
  quantity: string;
  sequence: number;
  stockItemId?: string;
  /** A sub-recipe component references LOGICAL RECIPE IDENTITY, not a version. */
  subRecipeId?: string;
  substituteGroupId?: string;
  /** MUST be a real `inventory.uom` id; Production Spec never creates UOMs. */
  unitId: string;
  wastagePercentage?: string;
}

export interface RecordCountDto {
  countedQuantity: string;
}

export interface RecordWasteDto {
  lines: WasteLineDto[];
  locationId: string;
  notes?: string;
  reasonCodeId: string;
  /** B-2: caller-supplied approval gate. */
  requiresApproval?: boolean;
}

export interface RefreshDto {
  refreshToken: string;
}

export interface RegisterTenantDto {
  email: string;
  /** POS/KDS sign-on. Accepted for frontend contract parity; unused for the owner path (owner is not a terminal role in this slice). */
  employeeCode?: string;
  fullName: string;
  /** New tenant's legal/business name. */
  organisation: string;
  /** FR-SEC-025 — signup requires a minimum of 10 characters. */
  password: string;
  phone?: string;
  pin?: string;
  roleKey: string;
  /** First branch name. Optional — defaults to "Main" when omitted. */
  scopeName?: string;
}

export interface RegisterTerminalDto {
  appVersion?: string;
  branchId: string;
  deviceFingerprint?: string;
  name: string;
  os?: string;
  terminalType: "pos" | "kds" | "kiosk" | "handheld";
}

export interface ReplaceModifierRecipeEffectsDto {
  effects: ModifierRecipeEffectDto[];
}

export interface ReplaceRecipeLinesDto {
  lines: RecipeLineDto[];
}

export interface ResetPasswordDto {
  newPassword: string;
  token: string;
}

export interface SelectTenantDto {
  tenantId: string;
}

export interface SetActiveDto {
  isActive: boolean;
}

export interface SetAttendanceSettingsDto {
  branchId: string;
  earlyClockInMinutes?: number;
  effectiveFrom?: string;
  geofenceCenterLat?: number;
  geofenceCenterLng?: number;
  geofenceRadiusMeters?: number;
  graceMinutes?: number;
}

export interface SetBranchStatusDto {
  status: "active" | "inactive";
}

export interface SetCompensationDto {
  /** Exact non-negative integer minor units, as a string (never a float). */
  amountMinorUnits: string;
  basis: "hourly" | "monthly_salary" | "per_shift";
  currency: string;
  effectiveFrom?: string;
}

export interface SetEmployeePinDto {
  /** FR-SEC-020 — 4 to 8 digits. Never logged. */
  pin: string;
}

export interface SetPriceEntryDto {
  currency: string;
  menuItemVariantId: string;
  price: string;
}

export interface SetReorderConfigDto {
  locationId: string;
  reorderPoint: string;
  reorderQuantity: string;
}

export interface SetTerminalStatusDto {
  status: "active" | "disabled" | "revoked";
}

export interface SyncBatchDto {
  /** SRS §21.5.1 — "idempotency key for the batch". */
  batchId: string;
  /** Must equal the authenticated terminal. A mismatch is 403, not a hint. */
  deviceId: string;
  /** Opaque to the client; `null` on a first sync. D4-2 gives it meaning. */
  lastServerCursor?: string | null;
  operations: SyncOperationDto[];
  protocolVersion: number;
}

export interface SyncOperationDto {
  /** Per-OPERATION, not per-batch: a 72-hour batch spans shift changes (`UC-OFF-01` step 8), and a batch-level actor would attribute a whole outage to one employee. */
  actorEmployeeId?: string | null;
  /** `FR-OFF-022` — the opId of the causal parent. A child whose parent has not been applied is DEFERRED, never rejected. */
  causedBy?: string | null;
  /** The aggregate this operation concerns. Never reassigned (`FR-OFF-015`). */
  entityId: string;
  /** `FR-OFF-041`. Stored verbatim; the server never rewrites it. */
  hlc: string;
  /** The DEVICE's wall clock, preserved alongside the server's receipt time (`FR-OFF-042`). Distinct from `hlc`: one is causal, one is what the receipt says. */
  occurredAt: string;
  /** `FR-OFF-021` / SRS §21.5.1 — "idempotency key for the operation". There is no separate idempotency field: `opId` IS it. */
  opId: string;
  /** Handler-specific. Validated by the registered handler, not here. */
  payload: Record<string, unknown>;
  /** Payload shape version for THIS operation type. */
  schemaVersion: number;
  type: string;
}

export interface Toggle86Dto {
  autoReenableAt?: string;
  isManual86: boolean;
  reasonText?: string;
}

export interface UpdateAssignmentDto {
  scope?: AssignmentScopeDto;
  validFrom?: string;
  validTo?: string | null;
}

export interface UpdateBranchDto {
  address?: Record<string, unknown>;
  automaticAvailability?: boolean;
  baseCurrency?: string;
  countryCode?: string;
  name?: string;
  timezone?: string;
}

export interface UpdateBrandDto {
  defaultSettings?: Record<string, unknown>;
  name?: string;
  theme?: Record<string, unknown>;
}

export interface UpdateCategoryDto {
  colour?: string;
  name?: Record<string, unknown>;
  parentCategoryId?: string;
  sortOrder?: number;
}

export interface UpdateCentralKitchenDto {
  name?: string;
  warehouseId?: string;
}

export interface UpdateEmployeeDto {
  contactDetails?: Record<string, unknown>;
  dateOfBirth?: string;
  department?: string;
  displayName?: string;
  emergencyContact?: Record<string, unknown>;
  employmentType?: "full_time" | "part_time" | "casual" | "contractor" | "trainee";
  hireDate?: string;
  namesLocalized?: Record<string, unknown>;
  nationalId?: string;
  position?: string;
}

export interface UpdateMenuDto {
  activeWindow?: Record<string, unknown>;
  name?: Record<string, unknown>;
  orderTypes?: string[];
  priority?: number;
}

export interface UpdateMenuItemDto {
  aggregatorNames?: Record<string, unknown>;
  allergens?: string[];
  barcodePlu?: string;
  colour?: string;
  description?: Record<string, unknown>;
  dietaryTags?: string[];
  isCombo?: boolean;
  isOpenPrice?: boolean;
  isWeighed?: boolean;
  kitchenNames?: Record<string, unknown>;
  names: Record<string, unknown>;
  revenueAccountCode?: string;
  sortOrder?: number;
  /** C-04: recorded only. Fiscal is out of scope, so this is never resolved. */
  taxClassId?: string;
}

export interface UpdateModifierGroupDto {
  allowRepeat?: boolean;
  freeQuantityThreshold?: number;
  isRequired?: boolean;
  maxSelections?: number;
  minSelections?: number;
  name: Record<string, unknown>;
}

export interface UpdateStationDto {
  capacityConfig?: Record<string, unknown>;
  displayColour?: string;
  displayTerminalId?: string;
  name?: string;
}

export interface UpdateTableDto {
  label?: string;
  seatCapacity?: number;
  section?: string;
}

export interface UpdateWarehouseDto {
  branchId?: string;
  name?: string;
  warehouseType?: "branch" | "central" | "virtual";
}

export interface VoidOrderLineDto {
  /** REQUIRED. FR-POS-013 demands a reason on a void, and the database agrees: `ck_order_line_void_reason` refuses a voided row without one. Making it optional here would only move the failure from a 400 to a 500. The reason catalogue is `inventory.reason_codes`; this references one by id and the service checks it is visible to the tenant. */
  reasonCodeId: string;
}

export interface VoidOrderLinePostFireDto {
  disposition: "returned_to_stock" | "wasted" | "given_to_staff";
  id?: string;
  reasonCodeId: string;
}

export interface WasteLineDto {
  quantity: string;
  stockItemId: string;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** `POST /auth/login` — Authenticate with email + password. — Access token, refresh token, and user. */
export type AuthController_loginResponse = {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  tokenType: "Bearer";
  user: {
    createdAt: string;
    displayName: string;
    email: string;
    id: string;
    lastLoginAt: string | null;
    phone: string | null;
    preferredLocale: string;
    status: "active" | "disabled" | "locked";
    updatedAt: string;
  };
};

export type AuthController_loginBody = LoginDto;

/** `POST /auth/logout` — Revoke the current session. — Current session revoked. */
export type AuthController_logoutResponse = void;

/** `GET /auth/me` — The authenticated user. — The authenticated user (no credentials), plus whether their password must be reset before further use. */
export type AuthController_meResponse = {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt: string | null;
  mustReset: boolean;
  phone: string | null;
  preferredLocale: string;
  status: "active" | "disabled" | "locked";
  updatedAt: string;
};

/** `GET /auth/memberships/{membershipId}/roles` — A membership's scoped role assignments, including expired ones. — Assignments, oldest first. */
export type RbacController_listAssignmentsResponse = ({
  createdAt: string;
  /** Stable assignment identity (FR-SEC-003). */
  id: string;
  membershipId: string;
  /** migration = inherited by the B1-2 backfill and not deliberately granted. */
  origin: "explicit" | "migration";
  /** When an inherited grant was explicitly reviewed. */
  reviewedAt: string | null;
  roleId: string;
  /** Set iff scopeType = branch. */
  scopeBranchId: string | null;
  /** Set iff scopeType = brand. */
  scopeBrandId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  validFrom: string;
  validTo: string | null;
})[];

/** `POST /auth/memberships/{membershipId}/roles` — Assign a role to a membership at an EXPLICIT scope (tenant, brand or branch). — The created assignment. */
export type RbacController_assignRoleResponse = {
  createdAt: string;
  /** Stable assignment identity (FR-SEC-003). */
  id: string;
  membershipId: string;
  /** migration = inherited by the B1-2 backfill and not deliberately granted. */
  origin: "explicit" | "migration";
  /** When an inherited grant was explicitly reviewed. */
  reviewedAt: string | null;
  roleId: string;
  /** Set iff scopeType = branch. */
  scopeBranchId: string | null;
  /** Set iff scopeType = brand. */
  scopeBrandId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  validFrom: string;
  validTo: string | null;
};

export type RbacController_assignRoleBody = AssignRoleDto;

/** `DELETE /auth/memberships/{membershipId}/roles/{roleId}` — DEPRECATED — remove a role from a membership by role id. — Role removed (or already absent). */
export type RbacController_removeRoleResponse = void;

/** `POST /auth/password/change` — Change password (proves the current password). — Password changed; other sessions revoked. */
export type PasswordController_changeResponse = void;

export type PasswordController_changeBody = ChangePasswordDto;

/** `POST /auth/password/forgot` — Request a password reset (no account enumeration). */
export type PasswordController_forgotResponse = void;

export type PasswordController_forgotBody = ForgotPasswordDto;

/** `POST /auth/password/reset` — Complete a password reset with a single-use token. — Password reset; all sessions revoked. */
export type PasswordController_resetResponse = void;

export type PasswordController_resetBody = ResetPasswordDto;

/** `GET /auth/permissions` — The caller's effective, scope-qualified authority (presentation only). — Tenant-scoped permission codes, every scoped grant, the symbolic permitted-branch set, the live authorization epoch, and whether inherited-scope review is still outstanding. */
export type RbacController_myPermissionsResponse = {
  /** Live authorization epoch. A client holding a token minted at an older epoch must refresh. */
  authorizationEpoch: number;
  /** TENANT-scoped permission codes only — what an unscoped, target-less endpoint authorises today. */
  permissions: string[];
  /** SYMBOLIC permitted-branch set. `all: true` means every branch in the tenant; `all: false` with empty lists means NO branches. Omission never means unrestricted. */
  permittedBranches: {
    all: boolean;
    branches: string[];
    brands: string[];
    v: number;
  };
  /** M-4+ — the tenant still holds unreviewed migration-originated TENANT grants. */
  scopeReviewRequired: boolean;
  /** Every effective assignment, scope-qualified. */
  scopes: ({
    assignmentId: string;
    branchId: string | null;
    brandId: string | null;
    permissions: string[];
    scopeType: "tenant" | "brand" | "branch";
  })[];
};

/** `POST /auth/pin` — Authenticate with a terminal-scoped employee PIN (POS). — Access token, refresh token, and user. The session is POS-only. */
export type AuthController_loginWithPinResponse = {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  tokenType: "Bearer";
  user: {
    createdAt: string;
    displayName: string;
    email: string;
    id: string;
    lastLoginAt: string | null;
    phone: string | null;
    preferredLocale: string;
    status: "active" | "disabled" | "locked";
    updatedAt: string;
  };
};

export type AuthController_loginWithPinBody = PinLoginDto;

/** `POST /auth/refresh` — Rotate a refresh token for a new access + refresh token pair. — A rotated access + refresh token pair. */
export type AuthController_refreshResponse = {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  tokenType: "Bearer";
  user: {
    createdAt: string;
    displayName: string;
    email: string;
    id: string;
    lastLoginAt: string | null;
    phone: string | null;
    preferredLocale: string;
    status: "active" | "disabled" | "locked";
    updatedAt: string;
  };
};

export type AuthController_refreshBody = RefreshDto;

/** `POST /auth/registrations` — Tenant self-service signup (FR-PLT-020). Creates a first user, a tenant, a working branch, and an Owner role with the full permission catalog, atomically. Returns a tenant-scoped auth result so the caller can enter the dashboard immediately. Supports roleKey "owner" only in this slice. — Tenant created; tenant-scoped access token issued. */
export type RegistrationsController_registerResponse = {
  auth: {
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    tokenType: "Bearer";
    user: {
      createdAt: string;
      displayName: string;
      email: string;
      id: string;
      lastLoginAt: string | null;
      phone: string | null;
      preferredLocale: string;
      status: "active" | "disabled" | "locked";
      updatedAt: string;
    };
  };
  email: string;
  membership: {
    membershipId: string;
    status: "active";
  };
  status: "created";
  tenant: {
    defaultCurrency: string;
    defaultLocale: string;
    id: string;
    legalName: string;
    slug: string;
    status: "active" | "suspended" | "closed";
  };
};

export type RegistrationsController_registerBody = RegisterTenantDto;

/** `PATCH /auth/role-assignments/{assignmentId}` — Re-scope an assignment and/or change its validity window. — The updated assignment. */
export type RbacController_updateAssignmentResponse = {
  createdAt: string;
  /** Stable assignment identity (FR-SEC-003). */
  id: string;
  membershipId: string;
  /** migration = inherited by the B1-2 backfill and not deliberately granted. */
  origin: "explicit" | "migration";
  /** When an inherited grant was explicitly reviewed. */
  reviewedAt: string | null;
  roleId: string;
  /** Set iff scopeType = branch. */
  scopeBranchId: string | null;
  /** Set iff scopeType = brand. */
  scopeBrandId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  validFrom: string;
  validTo: string | null;
};

export type RbacController_updateAssignmentBody = UpdateAssignmentDto;

/** `DELETE /auth/role-assignments/{assignmentId}` — Remove ONE scoped assignment by its stable id. — Assignment removed. */
export type RbacController_removeAssignmentResponse = void;

/** `POST /auth/role-assignments/{assignmentId}/review` — Explicitly review an INHERITED (migration-originated) tenant-wide assignment. — The reviewed assignment. */
export type RbacController_reviewAssignmentResponse = {
  createdAt: string;
  /** Stable assignment identity (FR-SEC-003). */
  id: string;
  membershipId: string;
  /** migration = inherited by the B1-2 backfill and not deliberately granted. */
  origin: "explicit" | "migration";
  /** When an inherited grant was explicitly reviewed. */
  reviewedAt: string | null;
  roleId: string;
  /** Set iff scopeType = branch. */
  scopeBranchId: string | null;
  /** Set iff scopeType = brand. */
  scopeBrandId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  validFrom: string;
  validTo: string | null;
};

/** `GET /auth/roles` — Roles visible to the tenant: its own roles plus shared system roles. — Roles, system roles first, then by name. */
export type RbacController_listRolesResponse = ({
  createdAt: string;
  description: string | null;
  id: string;
  isSystem: boolean;
  name: string;
  /** NULL for a platform/system role, shared across tenants. */
  tenantId: string | null;
  updatedAt: string;
})[];

/** `POST /auth/roles` — Create a tenant-owned role. — The newly created role. */
export type RbacController_createRoleResponse = {
  createdAt: string;
  description: string | null;
  id: string;
  isSystem: boolean;
  name: string;
  /** NULL for a platform/system role, shared across tenants. */
  tenantId: string | null;
  updatedAt: string;
};

export type RbacController_createRoleBody = CreateRoleDto;

/** `POST /auth/roles/{roleId}/permissions` — Grant permissions to a tenant-owned role. — Permissions granted. */
export type RbacController_addRolePermissionsResponse = void;

export type RbacController_addRolePermissionsBody = AddPermissionsDto;

/** `GET /auth/tenant` — Current tenant context on the request. — Current tenant context on the request. Both fields are null before a tenant is selected. */
export type TenantController_currentTenantResponse = {
  membershipId: string | null;
  tenantId: string | null;
};

/** `POST /auth/tenant` — Select a tenant, obtaining a tenant-scoped access token. — Tenant selected; tenant-scoped access token. */
export type TenantController_selectTenantResponse = {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  membership: {
    membershipId: string;
    status: "active" | "inactive" | "suspended";
  };
  tenant: {
    defaultCurrency: string;
    defaultLocale: string;
    id: string;
    legalName: string;
    slug: string;
    status: "active" | "suspended" | "closed";
  };
  tokenType: "Bearer";
};

export type TenantController_selectTenantBody = SelectTenantDto;

/** `GET /auth/tenants` — The caller's selectable tenants. — The caller's selectable tenants. */
export type TenantController_listTenantsResponse = ({
  membershipId: string;
  status: "active" | "inactive" | "suspended";
  tenant: {
    defaultCurrency: string;
    defaultLocale: string;
    id: string;
    legalName: string;
    slug: string;
    status: "active" | "suspended" | "closed";
  };
})[];

/** `GET /auth/terminal` — Current terminal binding on the request. — Current terminal binding. Null before a terminal is bound. */
export type TerminalController_currentTerminalResponse = {
  terminalId: string | null;
};

/** `POST /auth/terminal` — Bind the caller's current session to a terminal. — The session is now bound; a terminal-scoped access token. */
export type TerminalController_bindResponse = {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  terminal: {
    branchId: string;
    createdAt: string;
    id: string;
    lastSeenAt: string | null;
    name: string;
    status: "active" | "disabled" | "revoked";
    tenantId: string;
    terminalType: "pos" | "kds" | "kiosk" | "handheld";
  };
  tokenType: "Bearer";
};

export type TerminalController_bindBody = BindTerminalDto;

/** `GET /auth/terminals` — List terminals registered to the tenant. — Terminals, oldest first. */
export type TerminalController_listResponse = ({
  branchId: string;
  createdAt: string;
  id: string;
  lastSeenAt: string | null;
  name: string;
  status: "active" | "disabled" | "revoked";
  tenantId: string;
  terminalType: "pos" | "kds" | "kiosk" | "handheld";
})[];

/** `POST /auth/terminals` — Register a terminal. — The newly registered terminal. */
export type TerminalController_registerResponse = {
  branchId: string;
  createdAt: string;
  id: string;
  lastSeenAt: string | null;
  name: string;
  status: "active" | "disabled" | "revoked";
  tenantId: string;
  terminalType: "pos" | "kds" | "kiosk" | "handheld";
};

export type TerminalController_registerBody = RegisterTerminalDto;

/** `POST /auth/terminals/{terminalId}/fingerprints` — Register a device fingerprint on a terminal (idempotent: same fingerprint on the same terminal is a no-op). — Fingerprint registered (or already present). */
export type TerminalController_addFingerprintResponse = void;

export type TerminalController_addFingerprintBody = AddFingerprintDto;

/** `POST /auth/terminals/{terminalId}/status` — Set a terminal's status. — The updated terminal. */
export type TerminalController_setStatusResponse = {
  branchId: string;
  createdAt: string;
  id: string;
  lastSeenAt: string | null;
  name: string;
  status: "active" | "disabled" | "revoked";
  tenantId: string;
  terminalType: "pos" | "kds" | "kiosk" | "handheld";
};

export type TerminalController_setStatusBody = SetTerminalStatusDto;

/** `POST /branches/{branchId}/cash-close-policy` — Create a new immutable cash-close policy version for a branch — R-1(a), R-4(a), R-5. `Idempotency-Key` is MANDATORY (FR-API-020): a retry over a flaky link must not produce a second version. — The newly created cash-close policy version. */
export type CashClosePolicyController_createPolicyResponse = {
  branchId: string;
  countMode: "blind" | "open";
  createdAt: string;
  createdBy: string;
  /** ISO 4217 currency code — the branch's own base currency, never client-supplied. */
  currency: string;
  effectiveFrom: string;
  id: string;
  varianceApprovalExpirySeconds: number;
  /** Non-negative minor-unit tolerance as a decimal string. */
  varianceToleranceMinorUnits: string;
};

export type CashClosePolicyController_createPolicyBody = CreateCashClosePolicyDto;

/** `GET /branches/{branchId}/day-closes/{businessDay}` — Retrieve a historical DayClose / Z (persisted records only). — The persisted Z snapshot. */
export type DayCloseController_getResponse = {
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  cashReconciliation: {
    scope: "WHOLE_SESSION";
    sessionCount: number;
    sessions: ({
      businessDayCount: number;
      cashSessionId: string;
      dayScoped: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        cashRoundingAdjustments: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        cashSalesTotal: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        manualExternalCardTotal: string;
        paymentCount: number;
      };
      isVarianceOwner: boolean;
      wholeSession: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        countedCash: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        expectedCash: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        openingFloat: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        variance: string;
      };
    })[];
    varianceOwnerSessionCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    varianceTotal: string;
  };
  closedAt: string;
  closedBy: {
    employeeId: string | null;
    userId: string;
  };
  /** ISO 4217 currency code. */
  currency: string;
  dataAsOf: string;
  id: string;
  salesByOrderType: ({
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grossSales: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    netSales: string;
    orderCount: number;
    orderType: string;
  })[];
  salesSummary: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    averageOrderValue: string | null;
    completedOrderCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discounts: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grossSales: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    netSales: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    refunds: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
  };
  scope: {
    notImplemented: string[];
    notes: string[];
    partial: string[];
  };
  taxByClass: ({
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grossAmount: string;
    lineCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    netAmount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
  })[];
  tenderTotals: {
    cash: {
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      amountTotal: string;
      paymentCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      roundingAdjustmentTotal: string;
    };
    /** Captured payment value above a completed order’s grand total. Reconciliation-only. */
    completedExcessCapturedTotal: string;
    manualExternalCard: {
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      amountTotal: string;
      paymentCount: number;
    };
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unsettledCapturedTotal: string;
  };
  voidAndCompSummary: {
    compLineCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    compLineValue: string;
    voidedLineCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    voidedLineValue: string;
  };
  zNumber: string;
};

/** `POST /branches/{branchId}/day-closes/{businessDay}` — Close a business day, or — on the branch’s first ever DayClose request — activate the branch’s DayClose epoch. — ACTIVATED (no day sealed) or CLOSED (with the Z snapshot). Never 409 for a successful activation. */
export type DayCloseController_postResponse = {
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  activationBusinessDay: string;
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  firstEligibleBusinessDay: string;
  outcome: "ACTIVATED";
} | {
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  activationBusinessDay: string;
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  dayClose: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    cashReconciliation: {
      scope: "WHOLE_SESSION";
      sessionCount: number;
      sessions: ({
        businessDayCount: number;
        cashSessionId: string;
        dayScoped: {
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          cashRoundingAdjustments: string;
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          cashSalesTotal: string;
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          manualExternalCardTotal: string;
          paymentCount: number;
        };
        isVarianceOwner: boolean;
        wholeSession: {
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          countedCash: string;
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          expectedCash: string;
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          openingFloat: string;
          /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
          variance: string;
        };
      })[];
      varianceOwnerSessionCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      varianceTotal: string;
    };
    closedAt: string;
    closedBy: {
      employeeId: string | null;
      userId: string;
    };
    /** ISO 4217 currency code. */
    currency: string;
    dataAsOf: string;
    id: string;
    salesByOrderType: ({
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      grossSales: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      netSales: string;
      orderCount: number;
      orderType: string;
    })[];
    salesSummary: {
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      averageOrderValue: string | null;
      completedOrderCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      discounts: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      grossSales: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      netSales: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      refunds: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxTotal: string;
    };
    scope: {
      notImplemented: string[];
      notes: string[];
      partial: string[];
    };
    taxByClass: ({
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      grossAmount: string;
      lineCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      netAmount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
    })[];
    tenderTotals: {
      cash: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        amountTotal: string;
        paymentCount: number;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        roundingAdjustmentTotal: string;
      };
      /** Captured payment value above a completed order’s grand total. Reconciliation-only. */
      completedExcessCapturedTotal: string;
      manualExternalCard: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        amountTotal: string;
        paymentCount: number;
      };
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unsettledCapturedTotal: string;
    };
    voidAndCompSummary: {
      compLineCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      compLineValue: string;
      voidedLineCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      voidedLineValue: string;
    };
    zNumber: string;
  };
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  firstEligibleBusinessDay: string;
  outcome: "CLOSED";
};

export type DayCloseController_postBody = PostDayCloseDto;

/** `POST /cash-sessions` — Open a cashier shift and its cash session — FR-POS-090, FR-FIN-001/002. ONE command for the cashier, two records for the model. FR-POS-090 describes a single action ("open a shift, declaring an opening float"), and the cashier should not have to know that a shift is a Workforce concept and a session a Treasury one. They stay distinct in the schema (carried item P1D-A); only the command is unified, and both are written in one transaction. `Idempotency-Key` is MANDATORY (FR-API-020): opening a drawer is a financially significant act, and a retry over a flaky link must not produce a second shift or a second session. The two client ULIDs are independent duplicate protection beneath it. — The opened cash session and its shift, plus whether this call created them (false on an idempotent replay of an already-open pair). */
export type TreasuryController_openCashSessionResponse = {
  cashSession: {
    branchId: string;
    closedAt: string | null;
    /** ISO 4217 currency code. */
    currency: string;
    drawerId: string;
    employeeId: string;
    id: string;
    openedAt: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    openingFloat: string;
    shiftId: string;
    status: "open" | "closing" | "closed";
  };
  created: boolean;
  shift: {
    branchId: string;
    employeeId: string;
    id: string;
    openedAt: string;
    status: "open" | "closed";
  };
};

export type TreasuryController_openCashSessionBody = OpenCashSessionDto;

/** `POST /cash-sessions/{sessionId}/close` — Declare the physical cash count — FR-POS-094/096/097 [M]. Within tolerance, this closes the session in the SAME request. Above tolerance, it freezes the session (`open -> closing`) and the disclosed figures in THIS response are the first and only legitimate disclosure — FR-POS-095's blind-count control is that expected cash/variance are revealed strictly AFTER the count is durably committed, never before. `POST .../close/finalize` is the ONLY way out of `closing` — there is no above-tolerance one-request path (a manager PIN entered before this response exists could not be an informed decision). — The committed count declaration — closed immediately if within tolerance, otherwise frozen awaiting a manager decision. */
export type TreasuryController_declareCloseResponse = {
  approvalRequired: boolean;
  cashSessionId: string;
  closeAttemptId: string;
  countMode: "blind" | "open";
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  countedCashMinorUnits: string;
  /** False on an idempotent replay of an already-declared attempt. */
  created: boolean;
  /** ISO 4217 currency code. */
  currency: string;
  /** Disclosed only in this COMMITTED response — never before the count is durable (FR-POS-095). */
  expectedCashMinorUnits: string;
  status: "closing" | "closed";
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  toleranceMinorUnits: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  varianceMinorUnits: string;
};

export type TreasuryController_declareCloseBody = DeclareCashSessionCloseDto;

/** `GET /cash-sessions/{sessionId}/close-context` — The close context — FR-POS-094/095. Read-only. `cash.session.close` (own) / `cash.session.close_other` (another employee's) — the SAME own/other split `declareClose`/`finalizeClose` enforce, checked here too so a caller cannot probe another employee's session state without holding the right authority. While `open` in BLIND mode (FR-POS-095's default), `toleranceMinorUnits`/ `expectedCashMinorUnits` are structurally ABSENT from the response — never merely `null` — until a count is durably declared. While `open` in open-count mode, they are a PREVIEW only (not authoritative — the actual close re-resolves everything fresh, under the advisory lock). — The close context for this cash session. */
export type TreasuryController_getCloseContextResponse = {
  /** Present only once status is closing/closed. */
  approvalRequired: boolean;
  cashSessionId: string;
  closedAt: string | null;
  countMode: "blind" | "open";
  /** Present only once status is closing/closed. */
  countedCashMinorUnits: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** Absent while open + blind (FR-POS-095). A PREVIEW only while open + open-mode; authoritative once closing/closed. */
  expectedCashMinorUnits: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  openingFloatMinorUnits: string;
  status: "open" | "closing" | "closed";
  /** Present whenever a cash-close policy is configured for the branch — in BOTH blind and open mode. Absent only when no policy is configured at all. */
  toleranceMinorUnits: string;
  /** Present only once status is closing/closed. */
  varianceMinorUnits: string;
};

/** `POST /cash-sessions/{sessionId}/close/finalize` — The manager's decision on a frozen (above-tolerance) close — FR-FIN-006 [M], FR-SEC-016/030/032/033. The manager PIN is verified BEFORE the business transaction opens (`identity/contract`'s `TERMINAL_PIN_VERIFIER` — a failed-attempt/ lockout counter must survive a later rollback, and never runs at all on an idempotent replay). The verified manager's permission set — not the calling cashier's — is what `cash.variance.approve` is checked against, by the Approval Runtime itself, never by a route-level permission guard (the approver is a different actor than the caller). R-6(a): an explicit REJECTED decision COMMITS and returns 200 with `outcome: "rejected"` — never an error. The session stays `closing`; a retry supplies FRESH `approvalRequestId`/`approvalDecisionId` values. — The manager decision outcome — "closed" (approved) or "rejected" (R-6(a); the session remains closing). */
export type TreasuryController_finalizeCloseResponse = {
  cashSessionId: string;
  /** R-6(a): an explicit rejection COMMITS and returns 200 with outcome "rejected" — never an error. The session remains "closing"; a retry with fresh approvalRequestId/approvalDecisionId is expected. */
  outcome: "closed" | "rejected";
  status: "closing" | "closed";
};

export type TreasuryController_finalizeCloseBody = FinalizeCashSessionCloseDto;

/** `POST /cash-sessions/{sessionId}/pay-in` — Record cash added to the drawer — FR-POS-091 [M]. — The recorded pay-in movement. */
export type TreasuryController_payInResponse = {
  /** Positive minor-unit amount as a decimal string. The route (not this field) decides the sign. */
  amountMinor: string;
  branchId: string;
  cashSessionId: string;
  /** ISO 4217 currency code — the cash session’s own currency. */
  currency: string;
  employeeId: string;
  id: string;
  movementType: "pay_in" | "pay_out" | "safe_drop";
  occurredAt: string;
  reason: string;
};

export type TreasuryController_payInBody = CashMovementDto;

/** `POST /cash-sessions/{sessionId}/pay-out` — Record cash removed from the drawer for an expense — FR-POS-091 [M]. — The recorded pay-out movement. */
export type TreasuryController_payOutResponse = {
  /** Positive minor-unit amount as a decimal string. The route (not this field) decides the sign. */
  amountMinor: string;
  branchId: string;
  cashSessionId: string;
  /** ISO 4217 currency code — the cash session’s own currency. */
  currency: string;
  employeeId: string;
  id: string;
  movementType: "pay_in" | "pay_out" | "safe_drop";
  occurredAt: string;
  reason: string;
};

export type TreasuryController_payOutBody = CashMovementDto;

/** `POST /cash-sessions/{sessionId}/safe-drop` — Record excess cash removed to the safe — FR-POS-091 [M]. — The recorded safe-drop movement. */
export type TreasuryController_safeDropResponse = {
  /** Positive minor-unit amount as a decimal string. The route (not this field) decides the sign. */
  amountMinor: string;
  branchId: string;
  cashSessionId: string;
  /** ISO 4217 currency code — the cash session’s own currency. */
  currency: string;
  employeeId: string;
  id: string;
  movementType: "pay_in" | "pay_out" | "safe_drop";
  occurredAt: string;
  reason: string;
};

export type TreasuryController_safeDropBody = CashMovementDto;

/** `GET /catalogue/availability-rules` — Availability rules, optionally filtered to one menu item. */
export type CatalogueController_listAvailabilityRulesResponse = ({
  autoReenableAt: string | null;
  /** null applies to all branches. */
  branchId: string | null;
  channel: string | null;
  dayOfWeek: number | null;
  /** Time of day (no date component). */
  endsAt: string | null;
  id: string;
  isManual86: boolean;
  menuItemId: string | null;
  /** Time of day (no date component). */
  startsAt: string | null;
  variantId: string | null;
})[];

/** `POST /catalogue/availability-rules` — The newly created availability rule. */
export type CatalogueController_createAvailabilityRuleResponse = {
  autoReenableAt: string | null;
  /** null applies to all branches. */
  branchId: string | null;
  channel: string | null;
  dayOfWeek: number | null;
  /** Time of day (no date component). */
  endsAt: string | null;
  id: string;
  isManual86: boolean;
  menuItemId: string | null;
  /** Time of day (no date component). */
  startsAt: string | null;
  variantId: string | null;
};

export type CatalogueController_createAvailabilityRuleBody = CreateAvailabilityRuleDto;

/** `POST /catalogue/availability-rules/{ruleId}/86` — FR-MNU-030/032: manual 86 and authorised override, both audited. — The updated availability rule. */
export type CatalogueController_toggle86Response = {
  autoReenableAt: string | null;
  /** null applies to all branches. */
  branchId: string | null;
  channel: string | null;
  dayOfWeek: number | null;
  /** Time of day (no date component). */
  endsAt: string | null;
  id: string;
  isManual86: boolean;
  menuItemId: string | null;
  /** Time of day (no date component). */
  startsAt: string | null;
  variantId: string | null;
};

export type CatalogueController_toggle86Body = Toggle86Dto;

/** `GET /catalogue/branches/{branchId}/menus` — FR-MNU-003: priority-ordered resolution with an ambiguity warning. — Active menus assigned to this branch, priority order (highest first). */
export type CatalogueController_resolveMenusResponse = {
  /** True when two or more menus share the same priority — resolution order is then not deterministic. */
  ambiguous: boolean;
  menus: ({
    /** Opaque time-window configuration (FR-MNU-002); this phase does not evaluate it. */
    activeWindow: Record<string, unknown> | null;
    createdAt: string;
    id: string;
    isActive: boolean;
    /** Localised text, e.g. {"ar": "...", "en": "..."}. */
    name: Record<string, unknown>;
    orderTypes: string[];
    priority: number;
  })[];
  /** Present only when ambiguous is true. */
  warning: string;
};

/** `PATCH /catalogue/categories/{categoryId}` — The updated category. */
export type CatalogueController_updateCategoryResponse = {
  colour: string | null;
  id: string;
  menuId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  parentCategoryId: string | null;
  sortOrder: number;
};

export type CatalogueController_updateCategoryBody = UpdateCategoryDto;

/** `GET /catalogue/completeness` — C-11 (amended) completeness report: what would block sellability, without blocking anything itself. */
export type CatalogueController_completenessReportResponse = {
  /** (active price list x active variant) pairs lacking a price — the exact SRS §7.3 #7 invariant. */
  activeListGaps: ({
    menuItemVariantId: string;
    priceListId: string;
    priceListName: string;
  })[];
  /** Active menu item ids with zero active variants. */
  itemsWithoutActiveVariant: string[];
  sellable: boolean;
  /** Active variants with no price entry in any price list. */
  unpricedVariants: ({
    menuItemId: string;
    variantId: string;
  })[];
};

/** `GET /catalogue/items` — All menu items for this tenant. */
export type CatalogueController_listItemsResponse = ({
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  aggregatorNames: Record<string, unknown>;
  allergens: string[];
  barcodePlu: string | null;
  colour: string | null;
  createdAt: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  description: Record<string, unknown> | null;
  dietaryTags: string[];
  id: string;
  isActive: boolean;
  /** Retained per FR-MNU-004; no Combo tables exist (C-08) — always false in practice. */
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  kitchenNames: Record<string, unknown>;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  names: Record<string, unknown>;
  revenueAccountCode: string | null;
  sortOrder: number;
  taxClassId: string | null;
})[];

/** `POST /catalogue/items` — The newly created menu item. */
export type CatalogueController_createItemResponse = {
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  aggregatorNames: Record<string, unknown>;
  allergens: string[];
  barcodePlu: string | null;
  colour: string | null;
  createdAt: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  description: Record<string, unknown> | null;
  dietaryTags: string[];
  id: string;
  isActive: boolean;
  /** Retained per FR-MNU-004; no Combo tables exist (C-08) — always false in practice. */
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  kitchenNames: Record<string, unknown>;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  names: Record<string, unknown>;
  revenueAccountCode: string | null;
  sortOrder: number;
  taxClassId: string | null;
};

export type CatalogueController_createItemBody = CreateMenuItemDto;

/** `GET /catalogue/items/{itemId}` — The menu item. */
export type CatalogueController_getItemResponse = {
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  aggregatorNames: Record<string, unknown>;
  allergens: string[];
  barcodePlu: string | null;
  colour: string | null;
  createdAt: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  description: Record<string, unknown> | null;
  dietaryTags: string[];
  id: string;
  isActive: boolean;
  /** Retained per FR-MNU-004; no Combo tables exist (C-08) — always false in practice. */
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  kitchenNames: Record<string, unknown>;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  names: Record<string, unknown>;
  revenueAccountCode: string | null;
  sortOrder: number;
  taxClassId: string | null;
};

/** `PATCH /catalogue/items/{itemId}` — The updated menu item. */
export type CatalogueController_updateItemResponse = {
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  aggregatorNames: Record<string, unknown>;
  allergens: string[];
  barcodePlu: string | null;
  colour: string | null;
  createdAt: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  description: Record<string, unknown> | null;
  dietaryTags: string[];
  id: string;
  isActive: boolean;
  /** Retained per FR-MNU-004; no Combo tables exist (C-08) — always false in practice. */
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  kitchenNames: Record<string, unknown>;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  names: Record<string, unknown>;
  revenueAccountCode: string | null;
  sortOrder: number;
  taxClassId: string | null;
};

export type CatalogueController_updateItemBody = UpdateMenuItemDto;

/** `POST /catalogue/items/{itemId}/modifier-groups` — Attach a reusable modifier group to an item, with optional per-item overrides (FR-MNU-010). — Linked. */
export type CatalogueController_linkModifierGroupResponse = void;

export type CatalogueController_linkModifierGroupBody = LinkModifierGroupDto;

/** `GET /catalogue/items/{itemId}/placements` — Categories (and their menus) this item is placed in. */
export type CatalogueController_listPlacementsResponse = ({
  categoryId: string;
  menuId: string;
})[];

/** `POST /catalogue/items/{itemId}/placements` — Place an item into a category (C-02) — an item may be placed in many categories. — Placed. */
export type CatalogueController_placeItemResponse = void;

export type CatalogueController_placeItemBody = PlaceMenuItemDto;

/** `DELETE /catalogue/items/{itemId}/placements/{categoryId}` — Unplaced. */
export type CatalogueController_unplaceItemResponse = void;

/** `POST /catalogue/items/{itemId}/status` — Activate/deactivate a menu item (C-09 explicit, audited lifecycle). — The updated menu item. */
export type CatalogueController_setItemActiveResponse = {
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  aggregatorNames: Record<string, unknown>;
  allergens: string[];
  barcodePlu: string | null;
  colour: string | null;
  createdAt: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  description: Record<string, unknown> | null;
  dietaryTags: string[];
  id: string;
  isActive: boolean;
  /** Retained per FR-MNU-004; no Combo tables exist (C-08) — always false in practice. */
  isCombo: boolean;
  isOpenPrice: boolean;
  isWeighed: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  kitchenNames: Record<string, unknown>;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  names: Record<string, unknown>;
  revenueAccountCode: string | null;
  sortOrder: number;
  taxClassId: string | null;
};

export type CatalogueController_setItemActiveBody = SetActiveDto;

/** `GET /catalogue/items/{itemId}/variants` — Variants of this item, sort order. */
export type CatalogueController_listVariantsResponse = ({
  barcode: string | null;
  id: string;
  isActive: boolean;
  menuItemId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  prepTimeSeconds: number | null;
  sortOrder: number;
})[];

/** `POST /catalogue/items/{itemId}/variants` — The newly created variant. */
export type CatalogueController_addVariantResponse = {
  barcode: string | null;
  id: string;
  isActive: boolean;
  menuItemId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  prepTimeSeconds: number | null;
  sortOrder: number;
};

export type CatalogueController_addVariantBody = CreateVariantDto;

/** `GET /catalogue/menus` — All menus for this tenant. */
export type CatalogueController_listMenusResponse = ({
  /** Opaque time-window configuration (FR-MNU-002); this phase does not evaluate it. */
  activeWindow: Record<string, unknown> | null;
  createdAt: string;
  id: string;
  isActive: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  orderTypes: string[];
  priority: number;
})[];

/** `POST /catalogue/menus` — The newly created menu. */
export type CatalogueController_createMenuResponse = {
  /** Opaque time-window configuration (FR-MNU-002); this phase does not evaluate it. */
  activeWindow: Record<string, unknown> | null;
  createdAt: string;
  id: string;
  isActive: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  orderTypes: string[];
  priority: number;
};

export type CatalogueController_createMenuBody = CreateMenuDto;

/** `GET /catalogue/menus/{menuId}` — The menu. */
export type CatalogueController_getMenuResponse = {
  /** Opaque time-window configuration (FR-MNU-002); this phase does not evaluate it. */
  activeWindow: Record<string, unknown> | null;
  createdAt: string;
  id: string;
  isActive: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  orderTypes: string[];
  priority: number;
};

/** `PATCH /catalogue/menus/{menuId}` — The updated menu. */
export type CatalogueController_updateMenuResponse = {
  /** Opaque time-window configuration (FR-MNU-002); this phase does not evaluate it. */
  activeWindow: Record<string, unknown> | null;
  createdAt: string;
  id: string;
  isActive: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  orderTypes: string[];
  priority: number;
};

export type CatalogueController_updateMenuBody = UpdateMenuDto;

/** `GET /catalogue/menus/{menuId}/branches` — Branch ids this menu is assigned to. */
export type CatalogueController_listMenuBranchesResponse = string[];

/** `POST /catalogue/menus/{menuId}/branches` — Assign a menu to a branch (C-01). — Assigned. */
export type CatalogueController_assignBranchResponse = void;

export type CatalogueController_assignBranchBody = AssignBranchDto;

/** `DELETE /catalogue/menus/{menuId}/branches/{branchId}` — Unassigned. */
export type CatalogueController_unassignBranchResponse = void;

/** `GET /catalogue/menus/{menuId}/categories` — Categories on this menu, sort order. */
export type CatalogueController_listCategoriesResponse = ({
  colour: string | null;
  id: string;
  menuId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  parentCategoryId: string | null;
  sortOrder: number;
})[];

/** `POST /catalogue/menus/{menuId}/categories` — The newly created category. */
export type CatalogueController_createCategoryResponse = {
  colour: string | null;
  id: string;
  menuId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  parentCategoryId: string | null;
  sortOrder: number;
};

export type CatalogueController_createCategoryBody = CreateCategoryDto;

/** `POST /catalogue/menus/{menuId}/status` — Activate/deactivate a menu (C-09 explicit, audited lifecycle). — The updated menu. */
export type CatalogueController_setMenuActiveResponse = {
  /** Opaque time-window configuration (FR-MNU-002); this phase does not evaluate it. */
  activeWindow: Record<string, unknown> | null;
  createdAt: string;
  id: string;
  isActive: boolean;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  orderTypes: string[];
  priority: number;
};

export type CatalogueController_setMenuActiveBody = SetActiveDto;

/** `GET /catalogue/modifier-groups` — All modifier groups for this tenant. */
export type CatalogueController_listModifierGroupsResponse = ({
  allowRepeat: boolean;
  /** FR-MNU-011 "first N free, rest charged". */
  freeQuantityThreshold: number;
  id: string;
  isRequired: boolean;
  maxSelections: number;
  minSelections: number;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
})[];

/** `POST /catalogue/modifier-groups` — The newly created modifier group. */
export type CatalogueController_createModifierGroupResponse = {
  allowRepeat: boolean;
  /** FR-MNU-011 "first N free, rest charged". */
  freeQuantityThreshold: number;
  id: string;
  isRequired: boolean;
  maxSelections: number;
  minSelections: number;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
};

export type CatalogueController_createModifierGroupBody = CreateModifierGroupDto;

/** `PATCH /catalogue/modifier-groups/{groupId}` — The updated modifier group. */
export type CatalogueController_updateModifierGroupResponse = {
  allowRepeat: boolean;
  /** FR-MNU-011 "first N free, rest charged". */
  freeQuantityThreshold: number;
  id: string;
  isRequired: boolean;
  maxSelections: number;
  minSelections: number;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
};

export type CatalogueController_updateModifierGroupBody = UpdateModifierGroupDto;

/** `GET /catalogue/modifier-groups/{groupId}/modifiers` — Modifiers in this group, sort order. */
export type CatalogueController_listModifiersResponse = ({
  /** Decimal quantity as a string (preserves exact precision). */
  consumptionQuantity: string | null;
  consumptionUnitId: string | null;
  id: string;
  isDefault: boolean;
  /** FR-POS-021. null on a legacy modifier with no non-heuristic source for its kind. */
  kind: "addition" | "removal" | "substitution" | null | null;
  modifierGroupId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  /** Minor-unit money delta; may be negative (e.g. a substitution credit). */
  priceDelta: string;
  /** Opaque; not interpreted or executed by this phase (FR-MNU-013). */
  recipeDelta: Record<string, unknown> | null;
  sortOrder: number;
  stockItemId: string | null;
})[];

/** `POST /catalogue/modifier-groups/{groupId}/modifiers` — The newly created modifier. */
export type CatalogueController_addModifierResponse = {
  /** Decimal quantity as a string (preserves exact precision). */
  consumptionQuantity: string | null;
  consumptionUnitId: string | null;
  id: string;
  isDefault: boolean;
  /** FR-POS-021. null on a legacy modifier with no non-heuristic source for its kind. */
  kind: "addition" | "removal" | "substitution" | null | null;
  modifierGroupId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  /** Minor-unit money delta; may be negative (e.g. a substitution credit). */
  priceDelta: string;
  /** Opaque; not interpreted or executed by this phase (FR-MNU-013). */
  recipeDelta: Record<string, unknown> | null;
  sortOrder: number;
  stockItemId: string | null;
};

export type CatalogueController_addModifierBody = CreateModifierDto;

/** `GET /catalogue/price-lists` — All price lists for this tenant, priority descending. */
export type CatalogueController_listPriceListsResponse = ({
  id: string;
  name: string;
  orderType: string | null;
  priority: number;
  /** Opaque recurrence configuration (FR-MNU-022); not evaluated by this phase. */
  recurrenceRule: Record<string, unknown> | null;
  scopeId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  status: string;
  validFrom: string | null;
  validTo: string | null;
})[];

/** `POST /catalogue/price-lists` — The newly created price list. */
export type CatalogueController_createPriceListResponse = {
  id: string;
  name: string;
  orderType: string | null;
  priority: number;
  /** Opaque recurrence configuration (FR-MNU-022); not evaluated by this phase. */
  recurrenceRule: Record<string, unknown> | null;
  scopeId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  status: string;
  validFrom: string | null;
  validTo: string | null;
};

export type CatalogueController_createPriceListBody = CreatePriceListDto;

/** `GET /catalogue/price-lists/{priceListId}` — The price list. */
export type CatalogueController_getPriceListResponse = {
  id: string;
  name: string;
  orderType: string | null;
  priority: number;
  /** Opaque recurrence configuration (FR-MNU-022); not evaluated by this phase. */
  recurrenceRule: Record<string, unknown> | null;
  scopeId: string | null;
  scopeType: "tenant" | "brand" | "branch";
  status: string;
  validFrom: string | null;
  validTo: string | null;
};

/** `GET /catalogue/price-lists/{priceListId}/entries` — Price entries in this list. */
export type CatalogueController_listPriceEntriesResponse = ({
  /** ISO 4217 currency code. */
  currency: string;
  id: string;
  menuItemVariantId: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  price: string;
  priceListId: string;
})[];

/** `POST /catalogue/price-lists/{priceListId}/entries` — Set (create or overwrite) a variant's price within this list (FR-MNU-023/024). — The saved price entry. */
export type CatalogueController_setPriceEntryResponse = {
  /** ISO 4217 currency code. */
  currency: string;
  id: string;
  menuItemVariantId: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  price: string;
  priceListId: string;
};

export type CatalogueController_setPriceEntryBody = SetPriceEntryDto;

/** `POST /catalogue/variants/{variantId}/status` — Activate/deactivate a variant (C-09 explicit, audited lifecycle). — The updated variant. */
export type CatalogueController_setVariantActiveResponse = {
  barcode: string | null;
  id: string;
  isActive: boolean;
  menuItemId: string;
  /** Localised text, e.g. {"ar": "...", "en": "..."}. */
  name: Record<string, unknown>;
  prepTimeSeconds: number | null;
  sortOrder: number;
};

export type CatalogueController_setVariantActiveBody = SetActiveDto;

/** `GET /governance/audit/entries` — Search/filter the tenant audit log (FR-AUD-008). Requires audit.view. — A page of audit entries, most recent first. */
export type AuditQueryController_searchResponse = {
  entries: ({
    action: string;
    actorId: string | null;
    actorType: "user" | "anonymous" | "system" | "terminal";
    afterState: unknown | null;
    approvalId: string | null;
    approverId: string | null;
    beforeState: unknown | null;
    branchId: string | null;
    causationId: string | null;
    correlationId: string;
    entityId: string | null;
    entityType: string;
    /** Hex-encoded SHA-256 tamper-evidence hash (FR-AUD-004). */
    entryHash: string;
    id: string;
    impersonatedBy: string | null;
    ipAddress: string | null;
    occurredAt: string;
    /** Hex-encoded; null for a chain's first entry. */
    previousHash: string | null;
    reasonCode: string | null;
    reasonText: string | null;
    recordedAt: string;
    /** Per-tenant hash-chain position (BigInt on the wire). */
    sequenceNo: string;
    tenantId: string;
    terminalId: string | null;
    userAgent: string | null;
  })[];
  nextCursor: string | null;
};

/** `GET /governance/audit/entries/export` — Export the tenant audit log (FR-AUD-008). Requires audit.view AND report.export. — The complete, bounded set of matching audit entries. */
export type AuditQueryController_exportEntriesResponse = {
  count: number;
  entries: ({
    action: string;
    actorId: string | null;
    actorType: "user" | "anonymous" | "system" | "terminal";
    afterState: unknown | null;
    approvalId: string | null;
    approverId: string | null;
    beforeState: unknown | null;
    branchId: string | null;
    causationId: string | null;
    correlationId: string;
    entityId: string | null;
    entityType: string;
    /** Hex-encoded SHA-256 tamper-evidence hash (FR-AUD-004). */
    entryHash: string;
    id: string;
    impersonatedBy: string | null;
    ipAddress: string | null;
    occurredAt: string;
    /** Hex-encoded; null for a chain's first entry. */
    previousHash: string | null;
    reasonCode: string | null;
    reasonText: string | null;
    recordedAt: string;
    /** Per-tenant hash-chain position (BigInt on the wire). */
    sequenceNo: string;
    tenantId: string;
    terminalId: string | null;
    userAgent: string | null;
  })[];
};

/** `GET /health` — Service is up. */
export type HealthController_checkResponse = {
  service: string;
  status: "ok";
};

/** `POST /inventory/count-lines/{lineId}` — Record a counted quantity for one count line. — The updated count line. */
export type InventoryController_recordCountResponse = {
  /** Decimal quantity as a string (preserves exact precision). */
  countedQuantity: string | null;
  id: string;
  /** Decimal quantity as a string (preserves exact precision). */
  variance: string | null;
};

export type InventoryController_recordCountBody = RecordCountDto;

/** `POST /inventory/counts` — Open a count session and freeze expected quantities for its scope. — The opened count session. */
export type InventoryController_openCountResponse = {
  id: string;
  isBlindCount: boolean;
  lineCount: number;
  scopeType: "full_location" | "category" | "item_list";
  status: "in_progress" | "posted" | "cancelled";
};

export type InventoryController_openCountBody = OpenCountDto;

/** `GET /inventory/counts/{sessionId}/lines` — This session's count lines. expectedQuantity/countedQuantity/variance are null while a blind count is still in_progress and not yet recorded. */
export type InventoryController_countLinesResponse = ({
  /** Decimal quantity as a string (preserves exact precision). */
  countedQuantity: string | null;
  /** Hidden (returned null) while the session is a blind count still in progress. */
  expectedQuantity: string | null;
  id: string;
  stockItemId: string;
  /** Decimal quantity as a string (preserves exact precision). */
  variance: string | null;
})[];

/** `POST /inventory/counts/{sessionId}/post` — Post a count session: writes count_adjustment movements bringing recorded stock to counted stock. — The posted count session. */
export type InventoryController_postCountResponse = {
  adjustments: ({
    stockItemId: string;
    variance: number;
  })[];
  id: string;
  /** FR-INV-044: reported, not folded into the variance — the expected quantity was frozen at open. */
  movementsDuringCountWindow: number;
  status: "posted";
};

/** `GET /inventory/expiring` — FR-INV-024 computation. Alert delivery deferred. — Batches expiring within `days` (default 7) (FR-INV-024). */
export type InventoryController_expiringResponse = ({
  batchId: string;
  /** A DATE column returned as a full ISO instant (midnight UTC) — not truncated to YYYY-MM-DD in this response. */
  expiryDate: string | null;
  locationId: string;
  /** Decimal quantity as a string (preserves exact precision). */
  quantityRemaining: string;
  stockItemId: string;
})[];

/** `GET /inventory/items` — All stock items in the tenant. */
export type InventoryController_listItemsResponse = ({
  baseUnitId: string;
  batchStrategy: "fifo" | "fefo";
  categoryId: string | null;
  costingMethod: "weighted_average" | "fifo" | "standard";
  expiryTracked: boolean;
  id: string;
  isActive: boolean;
  isBatchTracked: boolean;
  /** Opaque localized-name object (locale -> name). */
  names: Record<string, unknown>;
  recipeUnitId: string | null;
  shelfLifeDays: number | null;
  sku: string;
  /** Cost per base unit as a decimal string of minor units. */
  standardCost: string | null;
})[];

/** `POST /inventory/items` — Create a stock item (FR-INV-001). — The created stock item. */
export type InventoryController_createItemResponse = {
  baseUnitId: string;
  batchStrategy: "fifo" | "fefo";
  categoryId: string | null;
  costingMethod: "weighted_average" | "fifo" | "standard";
  expiryTracked: boolean;
  id: string;
  isActive: boolean;
  isBatchTracked: boolean;
  /** Opaque localized-name object (locale -> name). */
  names: Record<string, unknown>;
  recipeUnitId: string | null;
  shelfLifeDays: number | null;
  sku: string;
  /** Cost per base unit as a decimal string of minor units. */
  standardCost: string | null;
};

export type InventoryController_createItemBody = CreateStockItemDto;

/** `GET /inventory/items/{itemId}` — The stock item. */
export type InventoryController_getItemResponse = {
  baseUnitId: string;
  batchStrategy: "fifo" | "fefo";
  categoryId: string | null;
  costingMethod: "weighted_average" | "fifo" | "standard";
  expiryTracked: boolean;
  id: string;
  isActive: boolean;
  isBatchTracked: boolean;
  /** Opaque localized-name object (locale -> name). */
  names: Record<string, unknown>;
  recipeUnitId: string | null;
  shelfLifeDays: number | null;
  sku: string;
  /** Cost per base unit as a decimal string of minor units. */
  standardCost: string | null;
};

/** `POST /inventory/items/{itemId}/base-unit` — FR-INV-002: rejected once any movement exists. — The updated stock item. */
export type InventoryController_changeBaseUnitResponse = {
  baseUnitId: string;
  batchStrategy: "fifo" | "fefo";
  categoryId: string | null;
  costingMethod: "weighted_average" | "fifo" | "standard";
  expiryTracked: boolean;
  id: string;
  isActive: boolean;
  isBatchTracked: boolean;
  /** Opaque localized-name object (locale -> name). */
  names: Record<string, unknown>;
  recipeUnitId: string | null;
  shelfLifeDays: number | null;
  sku: string;
  /** Cost per base unit as a decimal string of minor units. */
  standardCost: string | null;
};

export type InventoryController_changeBaseUnitBody = ChangeBaseUnitDto;

/** `GET /inventory/items/{itemId}/movements` — Cost-bearing read — gated by inventory.cost.view, not inventory.view. — The most recent 200 ledger movements for this item, newest first. */
export type InventoryController_listMovementsResponse = ({
  /** Decimal quantity as a string (preserves exact precision). */
  balanceAfter: string;
  batchId: string | null;
  counterpartMovementId: string | null;
  id: string;
  locationId: string;
  movementType: "purchase_receipt" | "purchase_return" | "sale_depletion" | "sale_reversal" | "transfer_out" | "transfer_in" | "production_input" | "production_output" | "waste" | "count_adjustment" | "manual_adjustment" | "opening_balance" | "expiry_writeoff";
  occurredAt: string;
  /** Signed: negative = out of stock. */
  quantity: string;
  referenceId: string;
  referenceType: string;
})[];

/** `POST /inventory/items/{itemId}/reorder-config` — FR-INV-065: per-location reorder configuration. — The upserted reorder configuration. */
export type InventoryController_setReorderConfigResponse = {
  id: string;
  locationId: string;
  /** Decimal quantity as a string (preserves exact precision). */
  reorderPoint: string | null;
  /** Decimal quantity as a string (preserves exact precision). */
  reorderQuantity: string | null;
  stockItemId: string;
};

export type InventoryController_setReorderConfigBody = SetReorderConfigDto;

/** `GET /inventory/levels` — Current stock levels (FR-INV-010/015). */
export type InventoryController_levelsResponse = ({
  lastReconciledAt: string | null;
  locationId: string;
  /** Decimal quantity as a string (preserves exact precision). */
  quantityOnHand: string;
  /** Decimal quantity as a string (preserves exact precision). */
  quantityReserved: string;
  stockItemId: string;
})[];

/** `GET /inventory/low-stock` — FR-INV-066 computation against per-location reorder points. — Levels below their per-location reorder point (FR-INV-066/065). */
export type InventoryController_lowStockResponse = ({
  locationId: string;
  /** Decimal quantity as a string (preserves exact precision). */
  quantityOnHand: string;
  /** Decimal quantity as a string (preserves exact precision). */
  reorderPoint: string | null;
  /** Decimal quantity as a string (preserves exact precision). */
  reorderQuantity: string | null;
  stockItemId: string;
})[];

/** `POST /inventory/movements` — Post a standalone movement (opening balance / manual adjustment) to the ledger. — The posted movement. */
export type InventoryController_postMovementResponse = {
  /** Stock balance after this movement. A JS number here, not a string — see the schema-level note. */
  balanceAfter: number;
  consumedBatches: ({
    batchId: string;
    quantity: number;
  })[];
  id: string;
  occurredAt: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  totalCost: string;
  /** Cost per base unit for this movement. */
  unitCost: string;
};

export type InventoryController_postMovementBody = PostMovementDto;

/** `GET /inventory/negative-stock` — FR-INV-014 computation. Alert delivery deferred. — Stock levels currently below zero (FR-INV-014; negative levels are permitted and recorded, this surfaces them). */
export type InventoryController_negativeStockResponse = ({
  locationId: string;
  /** Decimal quantity as a string (preserves exact precision). */
  quantityOnHand: string;
  stockItemId: string;
})[];

/** `GET /inventory/reason-codes` — All reason codes in the tenant. */
export type InventoryController_listReasonCodesResponse = ({
  category: string;
  code: string;
  id: string;
  /** Opaque localized-label object (locale -> label). */
  label: Record<string, unknown>;
})[];

/** `POST /inventory/reason-codes` — The created reason code. */
export type InventoryController_createReasonCodeResponse = {
  category: string;
  code: string;
  id: string;
  /** Opaque localized-label object (locale -> label). */
  label: Record<string, unknown>;
};

export type InventoryController_createReasonCodeBody = CreateReasonCodeDto;

/** `GET /inventory/reconciliation` — FR-INV-011/051 computation. Scheduling deferred (D-INV-08). — On-demand ledger-vs-projection reconciliation (FR-INV-011/051). Scheduling and alert delivery are deferred (D-INV-08). */
export type InventoryController_reconcileResponse = {
  divergences: ({
    /** The sum of ledger movements. */
    ledger: string;
    locationId: string;
    /** The stock_levels projection. */
    projected: string;
    stockItemId: string;
  })[];
  note: string;
  /** True when divergences is empty. */
  reconciled: boolean;
};

/** `POST /inventory/transfers` — Dispatch a transfer (writes the transfer_out leg). — The dispatched transfer. */
export type InventoryController_dispatchResponse = {
  dispatchMovementId: string;
  quantityDispatched: number;
  transferReferenceId: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  unitCost: string;
};

export type InventoryController_dispatchBody = DispatchTransferDto;

/** `POST /inventory/transfers/receive` — Receive a dispatched transfer (writes the transfer_in leg, plus a discrepancy adjustment if the received quantity differs). — The received transfer. */
export type InventoryController_receiveResponse = {
  /** The manual_adjustment movement written for the discrepancy, or null when none was needed. */
  adjustmentMovementId: string | null;
  discrepancy: number;
  quantityDispatched: number;
  quantityReceived: number;
  receiveMovementId: string;
  transferReferenceId: string;
};

export type InventoryController_receiveBody = ReceiveTransferDto;

/** `GET /inventory/waste` — The most recent 200 waste records, newest first. */
export type InventoryController_listWasteResponse = ({
  id: string;
  locationId: string;
  reasonCodeId: string;
  recordedAt: string;
  requiresApproval: boolean;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  totalValue: string;
})[];

/** `POST /inventory/waste` — Record waste (writes waste movements for each line; FR-INV-055…059). — The recorded waste. */
export type InventoryController_recordWasteResponse = {
  id: string;
  lines: ({
    movementId: string;
    stockItemId: string;
  })[];
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  totalValue: string;
};

export type InventoryController_recordWasteBody = RecordWasteDto;

/** `GET /kds/stations/{stationId}/queue` — Read a KDS station queue (FIFO, read-only). — The station queue and branch KDS config facts. */
export type KitchenController_getStationQueueResponse = {
  cancelledLineVisibilitySeconds: number | null;
  recallWindowSeconds: number;
  tickets: ({
    bumpedAt: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    /** Server-computed at response time — never a client value. */
    elapsedSeconds: number;
    firstViewedAt: string | null;
    id: string;
    lines: ({
      bumpedAt: string | null;
      cancelledAt: string | null;
      course: number | null;
      firstViewedAt: string | null;
      id: string;
      /** Opaque localized-name object, as stored at Fire time. */
      itemNameSnapshot: Record<string, unknown>;
      modifiers: ({
        id: string;
        kind: "addition" | "removal" | "substitution";
        /** Opaque localized-name object, as stored at Fire time. */
        nameSnapshot: Record<string, unknown>;
        quantity: number;
      })[];
      orderLineId: string;
      preparationNotes: string | null;
      /** DECIMAL(12,3) rendered as a string, never a JS number. */
      quantity: string;
      readyAt: string | null;
      recalledAt: string | null;
      sequence: number;
      startedAt: string | null;
      status: string;
    })[];
    orderId: string;
    orderNumber: string;
    orderType: string;
    readyAt: string | null;
    recallCount: number;
    recalledAt: string | null;
    routedAt: string;
    serviceReference: string | null;
    startedAt: string | null;
    stationId: string;
    status: string;
    targetReadyAt: string | null;
  })[];
};

/** `POST /kds/stations/{stationId}/tickets/view` — Acknowledge tickets as first-viewed on this station. — Count of newly-acknowledged tickets. */
export type KitchenController_acknowledgeViewedResponse = {
  /** Count of newly-acknowledged tickets on this station. */
  acknowledged: number;
};

export type KitchenController_acknowledgeViewedBody = AcknowledgeViewedDto;

/** `POST /kds/tickets/{ticketId}/bump-all` — Mark every eligible line on a ticket ready (bump all). — The updated ticket and the ids of lines this action bumped. */
export type KitchenController_bumpAllResponse = {
  bumpedLineIds: string[];
  ticket: {
    bumpedAt: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    /** Server-computed at response time — never a client value. */
    elapsedSeconds: number;
    firstViewedAt: string | null;
    id: string;
    lines: ({
      bumpedAt: string | null;
      cancelledAt: string | null;
      course: number | null;
      firstViewedAt: string | null;
      id: string;
      /** Opaque localized-name object, as stored at Fire time. */
      itemNameSnapshot: Record<string, unknown>;
      modifiers: ({
        id: string;
        kind: "addition" | "removal" | "substitution";
        /** Opaque localized-name object, as stored at Fire time. */
        nameSnapshot: Record<string, unknown>;
        quantity: number;
      })[];
      orderLineId: string;
      preparationNotes: string | null;
      /** DECIMAL(12,3) rendered as a string, never a JS number. */
      quantity: string;
      readyAt: string | null;
      recalledAt: string | null;
      sequence: number;
      startedAt: string | null;
      status: string;
    })[];
    orderId: string;
    orderNumber: string;
    orderType: string;
    readyAt: string | null;
    recallCount: number;
    recalledAt: string | null;
    routedAt: string;
    serviceReference: string | null;
    startedAt: string | null;
    stationId: string;
    status: string;
    targetReadyAt: string | null;
  };
};

/** `POST /kds/tickets/{ticketId}/lines/{lineId}/bump` — Mark a ticket line ready (bump item). — The updated ticket and line. */
export type KitchenController_bumpLineResponse = {
  line: {
    bumpedAt: string | null;
    cancelledAt: string | null;
    course: number | null;
    firstViewedAt: string | null;
    id: string;
    /** Opaque localized-name object, as stored at Fire time. */
    itemNameSnapshot: Record<string, unknown>;
    modifiers: ({
      id: string;
      kind: "addition" | "removal" | "substitution";
      /** Opaque localized-name object, as stored at Fire time. */
      nameSnapshot: Record<string, unknown>;
      quantity: number;
    })[];
    orderLineId: string;
    preparationNotes: string | null;
    /** DECIMAL(12,3) rendered as a string, never a JS number. */
    quantity: string;
    readyAt: string | null;
    recalledAt: string | null;
    sequence: number;
    startedAt: string | null;
    status: string;
  };
  ticket: {
    bumpedAt: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    /** Server-computed at response time — never a client value. */
    elapsedSeconds: number;
    firstViewedAt: string | null;
    id: string;
    lines: ({
      bumpedAt: string | null;
      cancelledAt: string | null;
      course: number | null;
      firstViewedAt: string | null;
      id: string;
      /** Opaque localized-name object, as stored at Fire time. */
      itemNameSnapshot: Record<string, unknown>;
      modifiers: ({
        id: string;
        kind: "addition" | "removal" | "substitution";
        /** Opaque localized-name object, as stored at Fire time. */
        nameSnapshot: Record<string, unknown>;
        quantity: number;
      })[];
      orderLineId: string;
      preparationNotes: string | null;
      /** DECIMAL(12,3) rendered as a string, never a JS number. */
      quantity: string;
      readyAt: string | null;
      recalledAt: string | null;
      sequence: number;
      startedAt: string | null;
      status: string;
    })[];
    orderId: string;
    orderNumber: string;
    orderType: string;
    readyAt: string | null;
    recallCount: number;
    recalledAt: string | null;
    routedAt: string;
    serviceReference: string | null;
    startedAt: string | null;
    stationId: string;
    status: string;
    targetReadyAt: string | null;
  };
};

/** `POST /kds/tickets/{ticketId}/lines/{lineId}/start` — Mark a ticket line started. — The updated ticket and line. */
export type KitchenController_startLineResponse = {
  line: {
    bumpedAt: string | null;
    cancelledAt: string | null;
    course: number | null;
    firstViewedAt: string | null;
    id: string;
    /** Opaque localized-name object, as stored at Fire time. */
    itemNameSnapshot: Record<string, unknown>;
    modifiers: ({
      id: string;
      kind: "addition" | "removal" | "substitution";
      /** Opaque localized-name object, as stored at Fire time. */
      nameSnapshot: Record<string, unknown>;
      quantity: number;
    })[];
    orderLineId: string;
    preparationNotes: string | null;
    /** DECIMAL(12,3) rendered as a string, never a JS number. */
    quantity: string;
    readyAt: string | null;
    recalledAt: string | null;
    sequence: number;
    startedAt: string | null;
    status: string;
  };
  ticket: {
    bumpedAt: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    /** Server-computed at response time — never a client value. */
    elapsedSeconds: number;
    firstViewedAt: string | null;
    id: string;
    lines: ({
      bumpedAt: string | null;
      cancelledAt: string | null;
      course: number | null;
      firstViewedAt: string | null;
      id: string;
      /** Opaque localized-name object, as stored at Fire time. */
      itemNameSnapshot: Record<string, unknown>;
      modifiers: ({
        id: string;
        kind: "addition" | "removal" | "substitution";
        /** Opaque localized-name object, as stored at Fire time. */
        nameSnapshot: Record<string, unknown>;
        quantity: number;
      })[];
      orderLineId: string;
      preparationNotes: string | null;
      /** DECIMAL(12,3) rendered as a string, never a JS number. */
      quantity: string;
      readyAt: string | null;
      recalledAt: string | null;
      sequence: number;
      startedAt: string | null;
      status: string;
    })[];
    orderId: string;
    orderNumber: string;
    orderType: string;
    readyAt: string | null;
    recallCount: number;
    recalledAt: string | null;
    routedAt: string;
    serviceReference: string | null;
    startedAt: string | null;
    stationId: string;
    status: string;
    targetReadyAt: string | null;
  };
};

/** `POST /kds/tickets/{ticketId}/recall` — Recall a bumped ticket back to active work. — The recalled ticket. */
export type KitchenController_recallResponse = {
  ticket: {
    bumpedAt: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    /** Server-computed at response time — never a client value. */
    elapsedSeconds: number;
    firstViewedAt: string | null;
    id: string;
    lines: ({
      bumpedAt: string | null;
      cancelledAt: string | null;
      course: number | null;
      firstViewedAt: string | null;
      id: string;
      /** Opaque localized-name object, as stored at Fire time. */
      itemNameSnapshot: Record<string, unknown>;
      modifiers: ({
        id: string;
        kind: "addition" | "removal" | "substitution";
        /** Opaque localized-name object, as stored at Fire time. */
        nameSnapshot: Record<string, unknown>;
        quantity: number;
      })[];
      orderLineId: string;
      preparationNotes: string | null;
      /** DECIMAL(12,3) rendered as a string, never a JS number. */
      quantity: string;
      readyAt: string | null;
      recalledAt: string | null;
      sequence: number;
      startedAt: string | null;
      status: string;
    })[];
    orderId: string;
    orderNumber: string;
    orderType: string;
    readyAt: string | null;
    recallCount: number;
    recalledAt: string | null;
    routedAt: string;
    serviceReference: string | null;
    startedAt: string | null;
    stationId: string;
    status: string;
    targetReadyAt: string | null;
  };
};

/** `GET /modifiers/{modifierId}/recipe-effects` — The modifier's recipe effects, in sequence order. */
export type ProductionController_listModifierRecipeEffectsResponse = ({
  componentType: "stock_item" | "sub_recipe";
  createdAt: string;
  id: string;
  modifierId: string;
  operation: "add" | "remove_all";
  /** Decimal quantity as a string (preserves exact precision). */
  quantity: string | null;
  sequence: number;
  stockItemId: string | null;
  /** LOGICAL recipe identity — resolved to its published version at capture time. */
  subRecipeId: string | null;
  unitId: string | null;
})[];

/** `PUT /modifiers/{modifierId}/recipe-effects` — Full replace, shaped like `PUT /recipes/:id/versions/:v/lines`. — The replaced set of recipe effects. */
export type ProductionController_replaceModifierRecipeEffectsResponse = {
  effects: ({
    componentType: "stock_item" | "sub_recipe";
    createdAt: string;
    id: string;
    modifierId: string;
    operation: "add" | "remove_all";
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string | null;
    sequence: number;
    stockItemId: string | null;
    /** LOGICAL recipe identity — resolved to its published version at capture time. */
    subRecipeId: string | null;
    unitId: string | null;
  })[];
  modifierId: string;
};

export type ProductionController_replaceModifierRecipeEffectsBody = ReplaceModifierRecipeEffectsDto;

/** `GET /orders` — List orders, cursor-paginated. — A page of orders (no line snapshots) plus an opaque cursor for the next page. */
export type OrdersController_listResponse = {
  /** Pass businessDay as cursorBusinessDay and id as cursorId to fetch the next page. Null on the last page. */
  nextCursor: {
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    id: string;
  } | null;
  orders: ({
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  })[];
};

/** `POST /orders` — Open an order. — The newly opened order. */
export type OrdersController_createResponse = {
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
  closedBy: string | null;
  completedAt: string | null;
  /** FR-LOC-021 — the pack version this order was priced under, pinned. */
  countryPackVersion: string;
  createdAt: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  discountTotal: string;
  firstFiredAt: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  grandTotal: string;
  guestCount: number | null;
  id: string;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  })[];
  notes: string | null;
  openedAt: string;
  openedBy: string;
  orderNumber: string;
  orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
  originDeviceTime: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  paidTotal: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  roundingAdjustment: string;
  servedBy: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  serviceChargeTotal: string;
  state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  subtotal: string;
  tableId: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  taxTotal: string;
  terminalId: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  tipTotal: string;
  updatedAt: string;
  /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
  version: number;
};

export type OrdersController_createBody = CreateOrderDto;

/** `GET /orders/{businessDay}/{id}` — One order, with its persisted line snapshots. — The order, including its lines. */
export type OrdersController_findOneResponse = {
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
  closedBy: string | null;
  completedAt: string | null;
  /** FR-LOC-021 — the pack version this order was priced under, pinned. */
  countryPackVersion: string;
  createdAt: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  discountTotal: string;
  firstFiredAt: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  grandTotal: string;
  guestCount: number | null;
  id: string;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  })[];
  notes: string | null;
  openedAt: string;
  openedBy: string;
  orderNumber: string;
  orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
  originDeviceTime: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  paidTotal: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  roundingAdjustment: string;
  servedBy: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  serviceChargeTotal: string;
  state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  subtotal: string;
  tableId: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  taxTotal: string;
  terminalId: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  tipTotal: string;
  updatedAt: string;
  /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
  version: number;
};

/** `POST /orders/{businessDay}/{id}/discount` — Apply an order-level discount. — The order with its new discount applied. */
export type OrdersController_applyOrderDiscountResponse = {
  discount: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    amountMinor: string;
    appliedByEmployeeId: string;
    appliedByUserId: string;
    approvalRequestId: string | null;
    approvalRequired: boolean;
    approvedByEmployeeId: string | null;
    approvedByUserId: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    createdAt: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    fixedValueMinor: string | null;
    id: string;
    kind: "discount" | "comp";
    orderId: string;
    orderLineId: string | null;
    orderVersionAfter: number;
    /** Basis points — 1bp = 0.01 percentage point (1500 = 15.00%). Exact integer string. */
    percentageValueBp: string | null;
    reasonCodeId: string;
    valueType: "percentage" | "fixed" | null | null;
  };
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
};

export type OrdersController_applyOrderDiscountBody = ApplyDiscountDto;

/** `POST /orders/{businessDay}/{id}/fire` — Fire eligible pending lines to production (explicit MVP Fire — no auto-Fire). — The order after Fire, including every line (previously-fired and newly-fired alike). */
export type OrdersController_fireResponse = {
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
  closedBy: string | null;
  completedAt: string | null;
  /** FR-LOC-021 — the pack version this order was priced under, pinned. */
  countryPackVersion: string;
  createdAt: string;
  /** ISO 4217 currency code. */
  currency: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  discountTotal: string;
  firstFiredAt: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  grandTotal: string;
  guestCount: number | null;
  id: string;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  })[];
  notes: string | null;
  openedAt: string;
  openedBy: string;
  orderNumber: string;
  orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
  originDeviceTime: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  paidTotal: string;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  roundingAdjustment: string;
  servedBy: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  serviceChargeTotal: string;
  state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  subtotal: string;
  tableId: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  taxTotal: string;
  terminalId: string | null;
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  tipTotal: string;
  updatedAt: string;
  /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
  version: number;
};

/** `POST /orders/{businessDay}/{id}/lines` — Capture a line on an open order. — The newly captured line and the order it now belongs to. */
export type OrdersController_addLineResponse = {
  line: {
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  };
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
};

export type OrdersController_addLineBody = AddOrderLineDto;

/** `DELETE /orders/{businessDay}/{id}/lines/{lineId}` — Void a pre-fire line (the ordinary cashier correction). — The voided line and the order it belongs to. */
export type OrdersController_voidLineResponse = {
  line: {
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  };
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
};

export type OrdersController_voidLineBody = VoidOrderLineDto;

/** `POST /orders/{businessDay}/{id}/lines/{lineId}/comp` — Give a complimentary item (comp). — The comped line and the order it belongs to. */
export type OrdersController_applyCompResponse = {
  discount: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    amountMinor: string;
    appliedByEmployeeId: string;
    appliedByUserId: string;
    approvalRequestId: string | null;
    approvalRequired: boolean;
    approvedByEmployeeId: string | null;
    approvedByUserId: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    createdAt: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    fixedValueMinor: string | null;
    id: string;
    kind: "discount" | "comp";
    orderId: string;
    orderLineId: string | null;
    orderVersionAfter: number;
    /** Basis points — 1bp = 0.01 percentage point (1500 = 15.00%). Exact integer string. */
    percentageValueBp: string | null;
    reasonCodeId: string;
    valueType: "percentage" | "fixed" | null | null;
  };
  line: {
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  };
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
};

export type OrdersController_applyCompBody = ApplyCompDto;

/** `POST /orders/{businessDay}/{id}/lines/{lineId}/discount` — Apply a line-level discount. — The discounted line and the order it belongs to. */
export type OrdersController_applyLineDiscountResponse = {
  discount: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    amountMinor: string;
    appliedByEmployeeId: string;
    appliedByUserId: string;
    approvalRequestId: string | null;
    approvalRequired: boolean;
    approvedByEmployeeId: string | null;
    approvedByUserId: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    createdAt: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    fixedValueMinor: string | null;
    id: string;
    kind: "discount" | "comp";
    orderId: string;
    orderLineId: string | null;
    orderVersionAfter: number;
    /** Basis points — 1bp = 0.01 percentage point (1500 = 15.00%). Exact integer string. */
    percentageValueBp: string | null;
    reasonCodeId: string;
    valueType: "percentage" | "fixed" | null | null;
  };
  line: {
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  };
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
};

export type OrdersController_applyLineDiscountBody = ApplyDiscountDto;

/** `POST /orders/{businessDay}/{id}/lines/{lineId}/void-postfire` — Void a post-fire line, with mandatory disposition. — The voided line, the order, and the disposition record. */
export type OrdersController_voidLinePostFireResponse = {
  line: {
    course: number | null;
    createdAt: string;
    firedAt: string | null;
    id: string;
    isComp: boolean;
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    notes: string | null;
    priceEntryId: string | null;
    priceListId: string | null;
    /** Opaque pricing-rule provenance snapshot. */
    priceRule: string | null;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    unitCostSnapshot: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  };
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
  postFireVoidRecord: {
    actorUserId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    createdAt: string;
    disposition: "returned_to_stock" | "wasted" | "given_to_staff";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    financialAmountRemoved: string;
    id: string;
    inventoryMovementIds: string[];
    orderId: string;
    orderLineId: string;
    reasonCodeId: string;
  };
};

export type OrdersController_voidLinePostFireBody = VoidOrderLinePostFireDto;

/** `POST /orders/{businessDay}/{id}/payments` — Capture a partial, or final settling, CASH or manual/external-card payment. A settling payment completes the order atomically. — The newly captured Payment and the order it now belongs to (paidTotal/roundingAdjustment/state/version updated). */
export type OrdersController_capturePaymentResponse = {
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
  payment: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    amount: string;
    authorizationCode: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    cardLast4: string | null;
    cardScheme: string | null;
    cashSessionId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    changeGiven: string | null;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    employeeId: string;
    id: string;
    orderId: string;
    paymentTerminalTxnRef: string | null;
    processedAt: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    tender: "cash" | "manual_external_card";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tenderedAmount: string | null;
    terminalId: string;
  };
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  remainingBalance: string;
};

export type OrdersController_capturePaymentBody = CapturePaymentDto;

/** `GET /orders/{businessDay}/{id}/receipt` — An itemized, INTERNAL, NON-FISCAL receipt for a completed order. — The non-fiscal receipt document. Available only once the order is completed. */
export type OrdersController_receiptResponse = {
  /** Localization key for the visible non-fiscal disclosure text. */
  disclosureKey: string;
  /** Primary machine-readable non-fiscal classification. */
  documentType: "INTERNAL_NON_FISCAL_RECEIPT";
  /** Always false. This is never a fiscal document. */
  fiscal: false;
  lines: ({
    /** Opaque localized-name snapshot (locale -> name), persisted at capture time. Never re-resolved from Catalogue. */
    itemNameSnapshot: Record<string, unknown>;
    /** Minor-unit money amount as a decimal string. Always "0" under the current runtime — discounts are not implemented — reported verbatim, never invented. */
    lineDiscount: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineSubtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    lineTotal: string;
    menuItemId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    modifierTotal: string;
    modifiers: ({
      modifierId: string;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. Never re-resolved from Catalogue. */
      nameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      priceDelta: string;
      quantity: number;
    })[];
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    sequence: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    /** The sale-time tax-class identity (never re-resolved). Non-null: a MenuItem with no TaxClass is not sellable. */
    taxClassId: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unitPrice: string;
    variantId: string;
  })[];
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    completedAt: string;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. Provenance only; never re-resolved. */
    countryPackVersion: string;
    /** ISO 4217 currency code. */
    currency: string;
    id: string;
    /** FR-POS-002 operational order number, e.g. <branch_code>-<business_day_seq>, drawn from a terminal block. This is NOT a fiscal invoice sequence: it is neither gapless nor globally ordered. */
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    /** Always completed — a receipt cannot be produced for any other order state. */
    state: "completed";
    terminalId: string | null;
  };
  payments: ({
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    amount: string;
    /** manual_external_card only, when supplied. Exactly 4 digits. */
    cardLast4: string | null;
    /** manual_external_card only, when supplied. */
    cardScheme: string | null;
    /** CASH only. Null for manual_external_card. */
    changeGiven: string | null;
    /** ISO 4217 currency code. */
    currency: string;
    id: string;
    /** Server clock at capture. */
    processedAt: string;
    /** CASH-only cash-drawer rounding adjustment for this payment. Zero for manual_external_card. Never part of the order grandTotal or paidTotal. */
    roundingAdjustment: string;
    tender: "cash" | "manual_external_card";
    /** CASH only. Null for manual_external_card. */
    tenderedAmount: string | null;
  })[];
  /** FR-FIN-031 — whether the pinned country pack priced this order tax-inclusive or tax-exclusive, derived from the frozen order totals only. NOT_APPLICABLE when taxTotal is zero. */
  taxPresentation: "INCLUSIVE" | "EXCLUSIVE" | "NOT_APPLICABLE" | "UNDETERMINED";
  totals: {
    /** A separate cash-drawer-reconciliation figure. Never part of grandTotal or paidTotal. */
    cashRoundingAdjustment: string;
    /** Always "0" under the current runtime — discounts are not implemented — reported verbatim, never invented. */
    discountTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Always "0" under the current runtime — service charge is not implemented. */
    serviceChargeTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    /** Always "0" under the current runtime — tips are not implemented. */
    tipTotal: string;
  };
};

/** `POST /orders/{businessDay}/{id}/refunds` — Issue a refund against a completed order. — The new Refund and the order it was issued against. */
export type OrdersController_issueRefundResponse = {
  order: {
    branchId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
    closedBy: string | null;
    completedAt: string | null;
    /** FR-LOC-021 — the pack version this order was priced under, pinned. */
    countryPackVersion: string;
    createdAt: string;
    /** ISO 4217 currency code. */
    currency: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discountTotal: string;
    firstFiredAt: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grandTotal: string;
    guestCount: number | null;
    id: string;
    /** Present only where the endpoint populates line snapshots. */
    lines: ({
      course: number | null;
      createdAt: string;
      firedAt: string | null;
      id: string;
      isComp: boolean;
      /** Opaque localized-name snapshot (locale -> name), persisted at capture time. */
      itemNameSnapshot: Record<string, unknown>;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineDiscount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineSubtotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      lineTotal: string;
      menuItemId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      modifierTotal: string;
      notes: string | null;
      priceEntryId: string | null;
      priceListId: string | null;
      /** Opaque pricing-rule provenance snapshot. */
      priceRule: string | null;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string;
      /** Decimal quantity as a string (preserves exact precision). */
      unitCostSnapshot: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unitPrice: string;
      variantId: string;
    })[];
    notes: string | null;
    openedAt: string;
    openedBy: string;
    orderNumber: string;
    orderType: "dine_in" | "takeaway" | "delivery" | "drive_thru" | "pickup" | "aggregator";
    originDeviceTime: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    paidTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    roundingAdjustment: string;
    servedBy: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    serviceChargeTotal: string;
    state: "draft" | "open" | "held" | "parked" | "partially_paid" | "completed" | "cancelled" | "partially_refunded" | "refunded";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    subtotal: string;
    tableId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    terminalId: string | null;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tipTotal: string;
    updatedAt: string;
    /** Optimistic-concurrency version; also the ETag validator (§24.6.4). */
    version: number;
  };
  refund: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    amountMinor: string;
    appliedByEmployeeId: string;
    appliedByUserId: string;
    approvalRequestId: string | null;
    approvalRequired: boolean;
    approvedByEmployeeId: string | null;
    approvedByUserId: string | null;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    businessDay: string;
    cashSessionId: string | null;
    createdAt: string;
    id: string;
    orderId: string;
    originalPaymentId: string;
    reasonCodeId: string;
    /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
    refundBusinessDay: string;
    tender: "cash" | "manual_external_card";
  };
};

export type OrdersController_issueRefundBody = IssueRefundDto;

/** `GET /org/access` — The caller's live, authorized brands and branches (frontend discovery). — Brands and branches visible under the current, live scoped authority. */
export type OrganisationController_getAccessibleScopeResponse = {
  /** Branches the caller's live scoped authority can see, both active and inactive (status is returned so the frontend can grey out an inactive branch rather than have it silently disappear). Resolved from LIVE scoped role assignments on every call — never from a JWT claim, a home branch, or `EmployeeBranch`, none of which grant visibility on their own. */
  branches: ({
    /** Opaque address JSON, as stored. */
    address: Record<string, unknown>;
    automaticAvailability: boolean;
    /** ISO 4217 currency code. */
    baseCurrency: string;
    brandId: string;
    code: string;
    countryCode: string;
    createdAt: string;
    id: string;
    name: string;
    status: "active" | "inactive";
    timezone: string;
  })[];
  /** Brands the caller's live scoped authority can see. A tenant-scoped grant sees every brand; a brand-scoped grant sees that brand; a branch-scoped grant sees that branch's own brand. Never every brand in the tenant merely because the tenant has one. */
  brands: ({
    createdAt: string;
    /** Opaque default-settings JSON, as stored. */
    defaultSettings: Record<string, unknown>;
    id: string;
    name: string;
    /** Opaque brand theme JSON, as stored. */
    theme: Record<string, unknown>;
  })[];
  tenantId: string;
};

/** `GET /org/branches` — All branches in the tenant. */
export type OrganisationController_listBranchesResponse = ({
  /** Opaque address JSON, as stored. */
  address: Record<string, unknown>;
  automaticAvailability: boolean;
  /** ISO 4217 currency code. */
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  createdAt: string;
  id: string;
  name: string;
  status: "active" | "inactive";
  timezone: string;
})[];

/** `POST /org/branches` — The newly created branch. */
export type OrganisationController_createBranchResponse = {
  /** Opaque address JSON, as stored. */
  address: Record<string, unknown>;
  automaticAvailability: boolean;
  /** ISO 4217 currency code. */
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  createdAt: string;
  id: string;
  name: string;
  status: "active" | "inactive";
  timezone: string;
};

export type OrganisationController_createBranchBody = CreateBranchDto;

/** `GET /org/branches/{branchId}` — The branch. */
export type OrganisationController_getBranchResponse = {
  /** Opaque address JSON, as stored. */
  address: Record<string, unknown>;
  automaticAvailability: boolean;
  /** ISO 4217 currency code. */
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  createdAt: string;
  id: string;
  name: string;
  status: "active" | "inactive";
  timezone: string;
};

/** `PATCH /org/branches/{branchId}` — The updated branch. */
export type OrganisationController_updateBranchResponse = {
  /** Opaque address JSON, as stored. */
  address: Record<string, unknown>;
  automaticAvailability: boolean;
  /** ISO 4217 currency code. */
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  createdAt: string;
  id: string;
  name: string;
  status: "active" | "inactive";
  timezone: string;
};

export type OrganisationController_updateBranchBody = UpdateBranchDto;

/** `POST /org/branches/{branchId}/brand` — Reassign a branch to another brand within the same tenant. — The updated branch. */
export type OrganisationController_reassignBranchBrandResponse = {
  /** Opaque address JSON, as stored. */
  address: Record<string, unknown>;
  automaticAvailability: boolean;
  /** ISO 4217 currency code. */
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  createdAt: string;
  id: string;
  name: string;
  status: "active" | "inactive";
  timezone: string;
};

export type OrganisationController_reassignBranchBrandBody = ReassignBrandDto;

/** `GET /org/branches/{branchId}/operating-hours` — All operating-hours intervals for the branch. */
export type OrganisationController_listOperatingHoursResponse = ({
  branchId: string;
  businessDayCutover: string;
  closesAt: string;
  /** 0 (Sunday) through 6 (Saturday). */
  dayOfWeek: number;
  id: string;
  opensAt: string;
  /** True when the interval crosses midnight. */
  overnight: boolean;
})[];

/** `POST /org/branches/{branchId}/operating-hours` — The newly created operating-hours interval. */
export type OrganisationController_createOperatingHoursResponse = {
  branchId: string;
  businessDayCutover: string;
  closesAt: string;
  /** 0 (Sunday) through 6 (Saturday). */
  dayOfWeek: number;
  id: string;
  opensAt: string;
  /** True when the interval crosses midnight. */
  overnight: boolean;
};

export type OrganisationController_createOperatingHoursBody = CreateOperatingHoursDto;

/** `GET /org/branches/{branchId}/print-routing` — All print-routing rules for the branch. */
export type OrganisationController_listPrintRoutingResponse = ({
  branchId: string;
  documentType: string;
  id: string;
  printerTarget: string;
  stationId: string | null;
})[];

/** `POST /org/branches/{branchId}/print-routing` — The newly created print-routing rule. */
export type OrganisationController_createPrintRoutingResponse = {
  branchId: string;
  documentType: string;
  id: string;
  printerTarget: string;
  stationId: string | null;
};

export type OrganisationController_createPrintRoutingBody = CreatePrintRoutingDto;

/** `GET /org/branches/{branchId}/station-routing-rules` — All station-routing rules for the branch. */
export type OrganisationController_listStationRoutingRulesResponse = ({
  branchId: string;
  categoryId: string | null;
  id: string;
  menuItemId: string | null;
  modifierId: string | null;
  priority: number;
  stationId: string;
})[];

/** `POST /org/branches/{branchId}/station-routing-rules` — The newly created station-routing rule. */
export type OrganisationController_createStationRoutingRuleResponse = {
  branchId: string;
  categoryId: string | null;
  id: string;
  menuItemId: string | null;
  modifierId: string | null;
  priority: number;
  stationId: string;
};

export type OrganisationController_createStationRoutingRuleBody = CreateStationRoutingRuleDto;

/** `GET /org/branches/{branchId}/stations` — All stations in the branch. */
export type OrganisationController_listStationsResponse = ({
  branchId: string;
  /** Opaque capacity-config JSON, as stored. */
  capacityConfig: Record<string, unknown>;
  createdAt: string;
  displayColour: string | null;
  displayTerminalId: string | null;
  id: string;
  name: string;
})[];

/** `POST /org/branches/{branchId}/stations` — The newly created station. */
export type OrganisationController_createStationResponse = {
  branchId: string;
  /** Opaque capacity-config JSON, as stored. */
  capacityConfig: Record<string, unknown>;
  createdAt: string;
  displayColour: string | null;
  displayTerminalId: string | null;
  id: string;
  name: string;
};

export type OrganisationController_createStationBody = CreateStationDto;

/** `POST /org/branches/{branchId}/status` — Set a branch active/inactive. — The updated branch. */
export type OrganisationController_setBranchStatusResponse = {
  /** Opaque address JSON, as stored. */
  address: Record<string, unknown>;
  automaticAvailability: boolean;
  /** ISO 4217 currency code. */
  baseCurrency: string;
  brandId: string;
  code: string;
  countryCode: string;
  createdAt: string;
  id: string;
  name: string;
  status: "active" | "inactive";
  timezone: string;
};

export type OrganisationController_setBranchStatusBody = SetBranchStatusDto;

/** `GET /org/branches/{branchId}/tables` — All tables in the branch. */
export type OrganisationController_listTablesResponse = ({
  branchId: string;
  id: string;
  label: string;
  seatCapacity: number | null;
  section: string | null;
})[];

/** `POST /org/branches/{branchId}/tables` — The newly created table. */
export type OrganisationController_createTableResponse = {
  branchId: string;
  id: string;
  label: string;
  seatCapacity: number | null;
  section: string | null;
};

export type OrganisationController_createTableBody = CreateTableDto;

/** `GET /org/brands` — All brands in the tenant. */
export type OrganisationController_listBrandsResponse = ({
  createdAt: string;
  /** Opaque default-settings JSON, as stored. */
  defaultSettings: Record<string, unknown>;
  id: string;
  name: string;
  /** Opaque brand theme JSON, as stored. */
  theme: Record<string, unknown>;
})[];

/** `POST /org/brands` — The newly created brand. */
export type OrganisationController_createBrandResponse = {
  createdAt: string;
  /** Opaque default-settings JSON, as stored. */
  defaultSettings: Record<string, unknown>;
  id: string;
  name: string;
  /** Opaque brand theme JSON, as stored. */
  theme: Record<string, unknown>;
};

export type OrganisationController_createBrandBody = CreateBrandDto;

/** `GET /org/brands/{brandId}` — The brand. */
export type OrganisationController_getBrandResponse = {
  createdAt: string;
  /** Opaque default-settings JSON, as stored. */
  defaultSettings: Record<string, unknown>;
  id: string;
  name: string;
  /** Opaque brand theme JSON, as stored. */
  theme: Record<string, unknown>;
};

/** `PATCH /org/brands/{brandId}` — The updated brand. */
export type OrganisationController_updateBrandResponse = {
  createdAt: string;
  /** Opaque default-settings JSON, as stored. */
  defaultSettings: Record<string, unknown>;
  id: string;
  name: string;
  /** Opaque brand theme JSON, as stored. */
  theme: Record<string, unknown>;
};

export type OrganisationController_updateBrandBody = UpdateBrandDto;

/** `GET /org/central-kitchens` — All central kitchens in the tenant. */
export type OrganisationController_listCentralKitchensResponse = ({
  id: string;
  name: string;
  warehouseId: string;
})[];

/** `POST /org/central-kitchens` — The newly created central kitchen. */
export type OrganisationController_createCentralKitchenResponse = {
  id: string;
  name: string;
  warehouseId: string;
};

export type OrganisationController_createCentralKitchenBody = CreateCentralKitchenDto;

/** `GET /org/central-kitchens/{centralKitchenId}` — The central kitchen. */
export type OrganisationController_getCentralKitchenResponse = {
  id: string;
  name: string;
  warehouseId: string;
};

/** `PATCH /org/central-kitchens/{centralKitchenId}` — The updated central kitchen. */
export type OrganisationController_updateCentralKitchenResponse = {
  id: string;
  name: string;
  warehouseId: string;
};

export type OrganisationController_updateCentralKitchenBody = UpdateCentralKitchenDto;

/** `GET /org/stations/{stationId}` — The station. */
export type OrganisationController_getStationResponse = {
  branchId: string;
  /** Opaque capacity-config JSON, as stored. */
  capacityConfig: Record<string, unknown>;
  createdAt: string;
  displayColour: string | null;
  displayTerminalId: string | null;
  id: string;
  name: string;
};

/** `PATCH /org/stations/{stationId}` — The updated station. */
export type OrganisationController_updateStationResponse = {
  branchId: string;
  /** Opaque capacity-config JSON, as stored. */
  capacityConfig: Record<string, unknown>;
  createdAt: string;
  displayColour: string | null;
  displayTerminalId: string | null;
  id: string;
  name: string;
};

export type OrganisationController_updateStationBody = UpdateStationDto;

/** `PATCH /org/tables/{tableId}` — The updated table. */
export type OrganisationController_updateTableResponse = {
  branchId: string;
  id: string;
  label: string;
  seatCapacity: number | null;
  section: string | null;
};

export type OrganisationController_updateTableBody = UpdateTableDto;

/** `GET /org/warehouses` — All warehouses in the tenant. */
export type OrganisationController_listWarehousesResponse = ({
  branchId: string | null;
  createdAt: string;
  id: string;
  name: string;
  warehouseType: "branch" | "central" | "virtual";
})[];

/** `POST /org/warehouses` — The newly created warehouse. */
export type OrganisationController_createWarehouseResponse = {
  branchId: string | null;
  createdAt: string;
  id: string;
  name: string;
  warehouseType: "branch" | "central" | "virtual";
};

export type OrganisationController_createWarehouseBody = CreateWarehouseDto;

/** `GET /org/warehouses/{warehouseId}` — The warehouse. */
export type OrganisationController_getWarehouseResponse = {
  branchId: string | null;
  createdAt: string;
  id: string;
  name: string;
  warehouseType: "branch" | "central" | "virtual";
};

/** `PATCH /org/warehouses/{warehouseId}` — The updated warehouse. */
export type OrganisationController_updateWarehouseResponse = {
  branchId: string | null;
  createdAt: string;
  id: string;
  name: string;
  warehouseType: "branch" | "central" | "virtual";
};

export type OrganisationController_updateWarehouseBody = UpdateWarehouseDto;

/** `GET /recipes` — List recipes, optionally filtered by type. — Recipes visible to this tenant. */
export type ProductionController_listRecipesResponse = ({
  branchId: string | null;
  brandId: string | null;
  createdAt: string;
  id: string;
  menuItemVariantId: string | null;
  recipeType: "menu_item" | "sub_recipe" | "production_item";
  scope: "tenant" | "brand" | "branch";
  stockItemId: string | null;
})[];

/** `POST /recipes` — The newly created recipe. */
export type ProductionController_createRecipeResponse = {
  branchId: string | null;
  brandId: string | null;
  createdAt: string;
  id: string;
  menuItemVariantId: string | null;
  recipeType: "menu_item" | "sub_recipe" | "production_item";
  scope: "tenant" | "brand" | "branch";
  stockItemId: string | null;
};

export type ProductionController_createRecipeBody = CreateRecipeDto;

/** `GET /recipes/requiring-completion` — The BR-MNU-012 completeness report. */
export type ProductionController_recipesRequiringCompletionResponse = {
  absentCount: number;
  /** The branch this report was resolved for; null for the tenant-wide view. */
  branchId: string | null;
  entries: ({
    /** Empty for absent_recipe. */
    detail: string[];
    menuItemId: string;
    reason: "absent_recipe" | "incomplete_recipe";
    /** The incomplete published version; null for absent_recipe. */
    recipeVersionId: string | null;
    variantId: string;
  })[];
  incompleteCount: number;
  /** Active variants examined — the denominator of the completeness metric. */
  sellableVariantCount: number;
};

/** `GET /recipes/{recipeId}/versions` — Version history, newest first, each with its lines. */
export type ProductionController_listVersionsResponse = ({
  /** D-17-05: never populated by this phase; always null today. */
  computedCost: string | null;
  costComputedAt: string | null;
  createdAt: string;
  /** Informational only (D-17-08 Q2) — never consulted in selection. */
  effectiveFrom: string | null;
  id: string;
  /** Opaque JSON instructions payload. */
  instructions: Record<string, unknown> | null;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    componentType: "stock_item" | "sub_recipe";
    id: string;
    isOptional: boolean;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    sequence: number;
    stockItemId: string | null;
    subRecipeId: string | null;
    substituteGroupId: string | null;
    unitId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    wastagePercentage: string;
  })[];
  prepTimeSeconds: number | null;
  publishedBy: string | null;
  recipeId: string;
  /** Opaque JSON reference-image payload. */
  referenceImages: Record<string, unknown> | null;
  status: "draft" | "published" | "superseded";
  version: number;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldPercentage: string;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldQuantity: string;
  yieldUnitId: string;
})[];

/** `POST /recipes/{recipeId}/versions` — SRS §26.3 — create a draft version. A recipe is NEVER auto-created here (GAP-1): an unknown id is a 404. — The newly created draft version. */
export type ProductionController_createVersionResponse = {
  /** D-17-05: never populated by this phase; always null today. */
  computedCost: string | null;
  costComputedAt: string | null;
  createdAt: string;
  /** Informational only (D-17-08 Q2) — never consulted in selection. */
  effectiveFrom: string | null;
  id: string;
  /** Opaque JSON instructions payload. */
  instructions: Record<string, unknown> | null;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    componentType: "stock_item" | "sub_recipe";
    id: string;
    isOptional: boolean;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    sequence: number;
    stockItemId: string | null;
    subRecipeId: string | null;
    substituteGroupId: string | null;
    unitId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    wastagePercentage: string;
  })[];
  prepTimeSeconds: number | null;
  publishedBy: string | null;
  recipeId: string;
  /** Opaque JSON reference-image payload. */
  referenceImages: Record<string, unknown> | null;
  status: "draft" | "published" | "superseded";
  version: number;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldPercentage: string;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldQuantity: string;
  yieldUnitId: string;
};

export type ProductionController_createVersionBody = CreateRecipeVersionDto;

/** `PUT /recipes/{recipeId}/versions/{version}/lines` — Replace a draft version's lines. Published versions are refused (409). — The version row (raw, not the view shape) plus the new line count. */
export type ProductionController_replaceLinesResponse = {
  /** D-17-05: never populated by this phase; always null today. */
  computedCost: string | null;
  costComputedAt: string | null;
  createdAt: string;
  /** Informational only (D-17-08 Q2) — never consulted in selection. */
  effectiveFrom: string | null;
  id: string;
  /** Opaque JSON instructions payload. */
  instructions: Record<string, unknown> | null;
  lineCount: number;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    componentType: "stock_item" | "sub_recipe";
    id: string;
    isOptional: boolean;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    sequence: number;
    stockItemId: string | null;
    subRecipeId: string | null;
    substituteGroupId: string | null;
    unitId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    wastagePercentage: string;
  })[];
  prepTimeSeconds: number | null;
  publishedBy: string | null;
  recipeId: string;
  /** Opaque JSON reference-image payload. */
  referenceImages: Record<string, unknown> | null;
  status: "draft" | "published" | "superseded";
  version: number;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldPercentage: string;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldQuantity: string;
  yieldUnitId: string;
};

export type ProductionController_replaceLinesBody = ReplaceRecipeLinesDto;

/** `POST /recipes/{recipeId}/versions/{version}/publish` — SRS §26.3 — publish. Demotes the incumbent, promotes the target, one txn. — The now-published version, plus the id of the version it superseded (if any). */
export type ProductionController_publishResponse = {
  /** D-17-05: never populated by this phase; always null today. */
  computedCost: string | null;
  costComputedAt: string | null;
  createdAt: string;
  /** Informational only (D-17-08 Q2) — never consulted in selection. */
  effectiveFrom: string | null;
  id: string;
  /** Opaque JSON instructions payload. */
  instructions: Record<string, unknown> | null;
  /** Present only where the endpoint populates line snapshots. */
  lines: ({
    componentType: "stock_item" | "sub_recipe";
    id: string;
    isOptional: boolean;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    sequence: number;
    stockItemId: string | null;
    subRecipeId: string | null;
    substituteGroupId: string | null;
    unitId: string;
    /** Decimal quantity as a string (preserves exact precision). */
    wastagePercentage: string;
  })[];
  prepTimeSeconds: number | null;
  publishedBy: string | null;
  recipeId: string;
  /** Opaque JSON reference-image payload. */
  referenceImages: Record<string, unknown> | null;
  status: "draft" | "published" | "superseded";
  supersededVersionId: string | null;
  version: number;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldPercentage: string;
  /** Decimal quantity as a string (preserves exact precision). */
  yieldQuantity: string;
  yieldUnitId: string;
};

/** `GET /reports/branches/{branchId}/daily-trading/{businessDay}` — Branch daily-trading report (dashboard-only; authorized against the branch it names). — The daily-trading report: salesSummary, tenderTotals (incl. completedExcessCapturedTotal), taxSummary, cashReconciliation (WHOLE_SESSION scope), dataAsOf, periodStatus (OPEN/UNSEALED/SETTLED — no SEALED, no FUTURE), currency/currencySource, and a scope block disclosing exactly what this Internal-MVP slice does and does not cover. */
export type ReportingController_getDailyTradingReportResponse = {
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  branchCurrentBusinessDay: string;
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  cashReconciliation: {
    closedSessionCount: number;
    contributingSessionCount: number;
    scope: "WHOLE_SESSION";
    sessions: ({
      businessDayCount: number;
      cashSessionId: string;
      closedAt: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      countedCash: string | null;
      /** ISO 4217 currency code. */
      currency: string;
      drawerId: string;
      employeeId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      expectedCash: string | null;
      isFinalised: boolean;
      openedAt: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      openingFloat: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      payInTotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      payOutTotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      safeDropTotal: string;
      spansMultipleBusinessDays: boolean;
      status: "open" | "closing" | "closed";
      tenderTotalsForThisBusinessDay: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        cashRoundingAdjustments: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        cashSalesTotal: string;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        manualExternalCardTotal: string;
        paymentCount: number;
      };
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      variance: string | null;
    })[];
    spanningSessionCount: number;
    unclosedSessionCount: number;
  };
  /** ISO 4217 currency code. */
  currency: string;
  currencySource: "TRANSACTION" | "BRANCH_FALLBACK";
  dataAsOf: string;
  openOrderCount: number;
  periodStatus: "OPEN" | "UNSEALED" | "SETTLED";
  salesSummary: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    averageOrderValue: string | null;
    completedOrderCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discounts: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grossSales: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    netSales: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    refunds: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    unsettledCapturedTotal: string;
  };
  scope: {
    cashReconciliationScope: string;
    lineExclusions: string[];
    notes: string[];
    salesPopulation: string;
    tenderPopulation: string;
  };
  taxSummary: {
    byClass: ({
      countryPackCode: string | null;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      grossAmount: string;
      lineCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      netAmount: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassCode: string | null;
      taxClassId: string;
    })[];
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
  };
  tenderTotals: {
    cash: {
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      amountTotal: string;
      paymentCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      roundingAdjustmentTotal: string;
    };
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    cashDrawerContribution: string;
    /** Captured payment value above a completed order’s grand total. Reconciliation-only — no revenue/tax/tip/discount/refund/rounding/variance disposition is inferred. */
    completedExcessCapturedTotal: string;
    manualExternalCard: {
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      amountTotal: string;
      paymentCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      roundingAdjustmentTotal: string;
    };
    paymentCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    tenderGrandTotal: string;
  };
  unclosedContributingSessionCount: number;
};

/** `GET /reports/branches/{branchId}/overview` — Branch operational overview — sales, cash, inventory, workforce, kds (dashboard-only; authorized against the branch it names). — The operational overview: sales, cash (WHOLE_SESSION scope, unchanged from daily-trading), inventory (branch-scoped low-stock count + calendar-day waste), workforce (branch-scoped calendar-day attendance summary), kds (business-day ticket counts + real prep duration where measurable), and a scope block disclosing exactly what this Demo/Operational slice does and does not cover. */
export type ReportingController_getOperationalOverviewResponse = {
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  branchCurrentBusinessDay: string;
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  cash: {
    closedSessionCount: number;
    contributingSessionCount: number;
    scope: "WHOLE_SESSION";
    sessions: ({
      cashSessionId: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      countedCash: string | null;
      currency: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      expectedCash: string | null;
      isFinalised: boolean;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      openingFloat: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      payInTotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      payOutTotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      safeDropTotal: string;
      status: "open" | "closing" | "closed";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      variance: string | null;
    })[];
    unclosedSessionCount: number;
  };
  /** ISO 4217 currency code. */
  currency: string;
  currencySource: "TRANSACTION" | "BRANCH_FALLBACK";
  dataAsOf: string;
  inventory: {
    lowStockItemCount: number;
    notes: string[];
    waste: {
      /** Decimal quantity as a string (preserves exact precision). */
      quantityTotal: string;
      recordCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      valueTotal: string;
      windowFrom: string;
      windowTo: string;
    };
  };
  kds: {
    averagePrepDurationSeconds: number | null;
    measuredPrepDurationCount: number;
    notes: string[];
    statusCounts: Record<string, unknown>;
    ticketCount: number;
  };
  periodStatus: "OPEN" | "UNSEALED" | "SETTLED";
  sales: {
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    averageOrderValue: string | null;
    completedOrderCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    discounts: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    grossSales: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    netSales: string;
    openOrderCount: number;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    refunds: string;
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxTotal: string;
    tenderTotals: {
      cash: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        amountTotal: string;
        paymentCount: number;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        roundingAdjustmentTotal: string;
      };
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      cashDrawerContribution: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      completedExcessCapturedTotal: string;
      manualExternalCard: {
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        amountTotal: string;
        paymentCount: number;
        /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
        roundingAdjustmentTotal: string;
      };
      paymentCount: number;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      tenderGrandTotal: string;
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      unsettledCapturedTotal: string;
    };
  };
  scope: {
    notes: string[];
  };
  workforce: {
    attendanceRecordCount: number;
    clockedInCount: number;
    earlyDepartureCount: number;
    lateArrivalCount: number;
    missingClockOutCount: number;
    notes: string[];
    outsideGeofenceCount: number;
    unscheduledCount: number;
    windowFrom: string;
    windowTo: string;
  };
};

/** `GET /substitute-groups` — List substitute groups. — Substitute groups with their member stock items. */
export type ProductionController_listGroupsResponse = ({
  id: string;
  members: ({
    stockItemId: string;
  })[];
  name: string;
  tenantId: string;
})[];

/** `POST /substitute-groups` — Create a substitute group, optionally seeded with member stock items. — The newly created substitute group. */
export type ProductionController_createGroupResponse = {
  id: string;
  name: string;
};

export type ProductionController_createGroupBody = CreateSubstituteGroupDto;

/** `POST /substitute-groups/{groupId}/members` — Add a stock item to a substitute group. — The newly created membership row. */
export type ProductionController_addGroupMemberResponse = {
  stockItemId: string;
  substituteGroupId: string;
  tenantId: string;
};

export type ProductionController_addGroupMemberBody = AddSubstituteMemberDto;

/** `POST /v1/sync/batch` — Upload a batch of offline operations — Per-operation results. Always 200 for a well-formed authorised batch, whatever the individual outcomes. */
export type SyncController_uploadBatch_v1Response = {
  /** The batch id the client supplied, echoed unchanged. */
  batchId: string;
  /** True when the skew exceeded the configured threshold (default 5 minutes). The skew is recorded and an alert raised; the operations are still accepted and their original timestamps preserved. */
  clockSkewExceededThreshold: boolean;
  /** Largest observed |device HLC physical clock − server receipt|, signed: positive means the device runs AHEAD. Reported, never silently corrected (FR-OFF-042). */
  clockSkewMs: number;
  /** Per-status totals for this batch. */
  counts: {
    accepted: number;
    conflict: number;
    deferred: number;
    duplicate: number;
    rejected: number;
  };
  protocolVersion: number;
  /** The server's own receipt instant. */
  receivedAt: string;
  /** True when this batch had already been completed and the stored response was replayed verbatim. Nothing was re-applied (FR-OFF-025). */
  replayed: boolean;
  /** One result per submitted operation, in submission order. */
  results: ({
    /** The sync.conflict_records row raised for this operation, when status is conflict. */
    conflictId: string | null;
    /** True exactly when the client may delete this operation from its outbox. Restated as a field so a client never has to hard-code the status vocabulary to decide. */
    definitive: boolean;
    /** Handler-supplied result detail, echoed to the client. */
    detail: Record<string, unknown> | null;
    /** The client-generated operation id, echoed back UNCHANGED — FR-OFF-015: the server never reassigns an identifier. */
    opId: string;
    /** Machine-readable reason. Always present on rejected, conflict and deferred, so a client can decide between dead-lettering, fixing and resending, or waiting for a causal parent. */
    reasonCode: string | null;
    /** Human-readable explanation. */
    reasonDetail: string | null;
    /** accepted | duplicate | conflict | rejected are DEFINITIVE — the client may remove the operation from its outbox. deferred is NOT definitive: the causal parent has not been applied, so retain the operation and resend it once the parent is accepted (FR-OFF-022 / FR-OFF-024). */
    status: "accepted" | "duplicate" | "conflict" | "rejected" | "deferred";
  })[];
};

export type SyncController_uploadBatch_v1Body = SyncBatchDto;

/** `POST /v1/sync/recovery/grants` — Authorize a bounded, one-shot recovery upload window for a disabled or revoked terminal's committed offline backlog (D1-1 GD-D1-07). — The recovery grant. */
export type SyncRecoveryController_issueGrant_v1Response = {
  branchId: string;
  expiresAt: string;
  id: string;
  issuedAt: string;
  status: "pending";
  terminalId: string;
};

export type SyncRecoveryController_issueGrant_v1Body = IssueRecoveryGrantDto;

/** `POST /v1/sync/recovery/{grantId}/batch` — Upload one batch of a revoked terminal's committed offline backlog, authenticated as the admin who holds (or was granted) recovery authority for it — never as the terminal itself (see the service docblock for why). — Per-operation results — identical shape to ordinary sync. */
export type SyncRecoveryController_uploadRecoveryBatch_v1Response = {
  /** The batch id the client supplied, echoed unchanged. */
  batchId: string;
  /** True when the skew exceeded the configured threshold (default 5 minutes). The skew is recorded and an alert raised; the operations are still accepted and their original timestamps preserved. */
  clockSkewExceededThreshold: boolean;
  /** Largest observed |device HLC physical clock − server receipt|, signed: positive means the device runs AHEAD. Reported, never silently corrected (FR-OFF-042). */
  clockSkewMs: number;
  /** Per-status totals for this batch. */
  counts: {
    accepted: number;
    conflict: number;
    deferred: number;
    duplicate: number;
    rejected: number;
  };
  protocolVersion: number;
  /** The server's own receipt instant. */
  receivedAt: string;
  /** True when this batch had already been completed and the stored response was replayed verbatim. Nothing was re-applied (FR-OFF-025). */
  replayed: boolean;
  /** One result per submitted operation, in submission order. */
  results: ({
    /** The sync.conflict_records row raised for this operation, when status is conflict. */
    conflictId: string | null;
    /** True exactly when the client may delete this operation from its outbox. Restated as a field so a client never has to hard-code the status vocabulary to decide. */
    definitive: boolean;
    /** Handler-supplied result detail, echoed to the client. */
    detail: Record<string, unknown> | null;
    /** The client-generated operation id, echoed back UNCHANGED — FR-OFF-015: the server never reassigns an identifier. */
    opId: string;
    /** Machine-readable reason. Always present on rejected, conflict and deferred, so a client can decide between dead-lettering, fixing and resending, or waiting for a causal parent. */
    reasonCode: string | null;
    /** Human-readable explanation. */
    reasonDetail: string | null;
    /** accepted | duplicate | conflict | rejected are DEFINITIVE — the client may remove the operation from its outbox. deferred is NOT definitive: the causal parent has not been applied, so retain the operation and resend it once the parent is accepted (FR-OFF-022 / FR-OFF-024). */
    status: "accepted" | "duplicate" | "conflict" | "rejected" | "deferred";
  })[];
};

export type SyncRecoveryController_uploadRecoveryBatch_v1Body = SyncBatchDto;

/** `POST /workforce/attendance/clock-in` — FR-HRM-020/021/022/023 — POS-terminal PIN clock-in. NO `@RequirePermission`: the caller acts on their OWN employment record via a PIN-verified POS session, never on an RBAC grant — every active employee must be able to clock themselves in regardless of what else they are permitted to do. §15.2's Workforce catalogue has no "clock in" verb to invent one from. See `REVIEWED_UNPROTECTED_ROUTES` in `authorization-coverage.spec.ts`. */
export type AttendanceController_clockInResponse = {
  branchId: string;
  clockInAt: string;
  clockOutAt: string | null;
  createdAt: string;
  earlyDeparture: boolean;
  employeeId: string;
  id: string;
  lateArrival: boolean;
  missingClockOut: boolean;
  outsideGeofence: boolean;
  scheduledShiftId: string | null;
  status: "open" | "closed";
  tenantId: string;
  unscheduled: boolean;
};

export type AttendanceController_clockInBody = ClockInDto;

/** `POST /workforce/attendance/clock-out` — FR-HRM-020/021/022 — POS-terminal PIN clock-out. Same authority as clock-in. */
export type AttendanceController_clockOutResponse = {
  branchId: string;
  clockInAt: string;
  clockOutAt: string | null;
  createdAt: string;
  earlyDeparture: boolean;
  employeeId: string;
  id: string;
  lateArrival: boolean;
  missingClockOut: boolean;
  outsideGeofence: boolean;
  scheduledShiftId: string | null;
  status: "open" | "closed";
  tenantId: string;
  unscheduled: boolean;
};

export type AttendanceController_clockOutBody = ClockOutDto;

/** `POST /workforce/attendance/settings` — FR-HRM-022/023 threshold configuration — a NEW effective-dated version. `settings.branch.manage` ("Branch configuration"), NOT an HR code: the exact `treasury/cash-close-policy` precedent for reusing this already-seeded Organisation permission for a new per-branch policy table, declared as a plain string literal to avoid a new `workforce->organisation` private-path import. */
export type AttendanceController_setSettingsResponse = {
  branchId: string;
  createdAt: string;
  createdBy: string;
  earlyClockInMinutes: number | null;
  effectiveFrom: string;
  geofenceCenterLat: string | null;
  geofenceCenterLng: string | null;
  geofenceRadiusMeters: number | null;
  graceMinutes: number | null;
  id: string;
  tenantId: string;
};

export type AttendanceController_setSettingsBody = SetAttendanceSettingsDto;

/** `GET /workforce/attendance/{attendanceRecordId}` */
export type AttendanceController_getResponse = {
  branchId: string;
  clockEvents: ({
    attendanceRecordId: string;
    branchId: string;
    deviceId: string | null;
    employeeId: string;
    eventType: "clock_in" | "clock_out";
    gpsLat: string | null;
    gpsLng: string | null;
    id: string;
    method: "pos_pin" | "mobile" | "biometric";
    occurredAt: string;
    tenantId: string;
    terminalId: string | null;
  })[];
  clockInAt: string;
  clockOutAt: string | null;
  corrections: ({
    actorId: string;
    attendanceRecordId: string;
    branchId: string;
    correctedValue: string;
    createdAt: string;
    employeeId: string;
    field: "clock_in_at" | "clock_out_at";
    id: string;
    originalValue: string | null;
    reason: string;
    tenantId: string;
  })[];
  createdAt: string;
  earlyDeparture: boolean;
  employeeId: string;
  id: string;
  lateArrival: boolean;
  missingClockOut: boolean;
  outsideGeofence: boolean;
  scheduledShiftId: string | null;
  status: "open" | "closed";
  tenantId: string;
  unscheduled: boolean;
};

/** `POST /workforce/attendance/{attendanceRecordId}/correct` — FR-HRM-025 — manual correction: permission-gated, reasoned, evidenced. */
export type AttendanceController_correctResponse = {
  actorId: string;
  attendanceRecordId: string;
  branchId: string;
  correctedValue: string;
  createdAt: string;
  employeeId: string;
  field: "clock_in_at" | "clock_out_at";
  id: string;
  originalValue: string | null;
  reason: string;
  tenantId: string;
};

export type AttendanceController_correctBody = CorrectAttendanceDto;

/** `GET /workforce/employees` */
export type EmployeesController_listResponse = ({
  branches: ({
    branchId: string;
  })[];
  code: string;
  /** { phone?, email?, address? } */
  contactDetails: Record<string, unknown> | null;
  createdAt: string;
  dateOfBirth: string | null;
  department: string | null;
  displayName: string;
  /** { name?, phone?, relation? } */
  emergencyContact: Record<string, unknown> | null;
  employmentType: "full_time" | "part_time" | "casual" | "contractor" | "trainee" | null | null;
  hireDate: string | null;
  homeBranchId: string;
  id: string;
  /** Locale -> localised name, e.g. {"en": "...", "ar": "..."}. */
  namesLocalized: Record<string, unknown>;
  nationalId: string | null;
  position: string | null;
  status: "active" | "suspended" | "terminated";
  tenantId: string;
  terminationDate: string | null;
  updatedAt: string;
  userId: string | null;
})[];

/** `POST /workforce/employees` — FR-HRM-001/002/005 — create a full employee record. */
export type EmployeesController_createResponse = {
  branches: ({
    branchId: string;
  })[];
  code: string;
  /** { phone?, email?, address? } */
  contactDetails: Record<string, unknown> | null;
  createdAt: string;
  dateOfBirth: string | null;
  department: string | null;
  displayName: string;
  /** { name?, phone?, relation? } */
  emergencyContact: Record<string, unknown> | null;
  employmentType: "full_time" | "part_time" | "casual" | "contractor" | "trainee" | null | null;
  hireDate: string | null;
  homeBranchId: string;
  id: string;
  /** Locale -> localised name, e.g. {"en": "...", "ar": "..."}. */
  namesLocalized: Record<string, unknown>;
  nationalId: string | null;
  permittedBranchIds: string[];
  position: string | null;
  status: "active" | "suspended" | "terminated";
  tenantId: string;
  terminationDate: string | null;
  updatedAt: string;
  userId: string | null;
};

export type EmployeesController_createBody = CreateEmployeeDto;

/** `GET /workforce/employees/{employeeId}` */
export type EmployeesController_getResponse = {
  branches: ({
    branchId: string;
  })[];
  code: string;
  /** { phone?, email?, address? } */
  contactDetails: Record<string, unknown> | null;
  createdAt: string;
  dateOfBirth: string | null;
  department: string | null;
  displayName: string;
  /** { name?, phone?, relation? } */
  emergencyContact: Record<string, unknown> | null;
  employmentType: "full_time" | "part_time" | "casual" | "contractor" | "trainee" | null | null;
  hireDate: string | null;
  homeBranchId: string;
  id: string;
  /** Locale -> localised name, e.g. {"en": "...", "ar": "..."}. */
  namesLocalized: Record<string, unknown>;
  nationalId: string | null;
  position: string | null;
  status: "active" | "suspended" | "terminated";
  tenantId: string;
  terminationDate: string | null;
  updatedAt: string;
  userId: string | null;
};

/** `PATCH /workforce/employees/{employeeId}` */
export type EmployeesController_updateResponse = {
  branches: ({
    branchId: string;
  })[];
  code: string;
  /** { phone?, email?, address? } */
  contactDetails: Record<string, unknown> | null;
  createdAt: string;
  dateOfBirth: string | null;
  department: string | null;
  displayName: string;
  /** { name?, phone?, relation? } */
  emergencyContact: Record<string, unknown> | null;
  employmentType: "full_time" | "part_time" | "casual" | "contractor" | "trainee" | null | null;
  hireDate: string | null;
  homeBranchId: string;
  id: string;
  /** Locale -> localised name, e.g. {"en": "...", "ar": "..."}. */
  namesLocalized: Record<string, unknown>;
  nationalId: string | null;
  position: string | null;
  status: "active" | "suspended" | "terminated";
  tenantId: string;
  terminationDate: string | null;
  updatedAt: string;
  userId: string | null;
};

export type EmployeesController_updateBody = UpdateEmployeeDto;

/** `POST /workforce/employees/{employeeId}/branches` — FR-HRM-005 — multi-branch assignment. */
export type EmployeesController_addBranchResponse = {
  branchId: string;
  createdAt: string;
  employeeId: string;
  tenantId: string;
};

export type EmployeesController_addBranchBody = AddPermittedBranchDto;

/** `GET /workforce/employees/{employeeId}/compensation` — FR-HRM-003 — restricted to `hr.compensation.view` holders only. — The current compensation version, or null if none has ever been set. */
export type EmployeesController_currentCompensationResponse = {
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  amountMinorUnits: string;
  basis: "hourly" | "monthly_salary" | "per_shift";
  createdAt: string;
  createdBy: string;
  currency: string;
  effectiveFrom: string;
  employeeId: string;
  id: string;
  tenantId: string;
} | null;

/** `POST /workforce/employees/{employeeId}/compensation` — FR-HRM-003 — a new effective-dated version. No `hr.compensation.manage` code exists in §15.2 (only `.view`); writing pay is therefore gated on `hr.employee.manage`, the same "no write verb given" discipline `SALES_PERMISSIONS` documents for `pos.order.create`. */
export type EmployeesController_setCompensationResponse = {
  /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
  amountMinorUnits: string;
  basis: "hourly" | "monthly_salary" | "per_shift";
  createdAt: string;
  createdBy: string;
  currency: string;
  effectiveFrom: string;
  employeeId: string;
  id: string;
  tenantId: string;
};

export type EmployeesController_setCompensationBody = SetCompensationDto;

/** `POST /workforce/employees/{employeeId}/deactivate` — FR-HRM-006 — deactivate, never hard-delete. */
export type EmployeesController_deactivateResponse = {
  branches: ({
    branchId: string;
  })[];
  code: string;
  /** { phone?, email?, address? } */
  contactDetails: Record<string, unknown> | null;
  createdAt: string;
  dateOfBirth: string | null;
  department: string | null;
  displayName: string;
  /** { name?, phone?, relation? } */
  emergencyContact: Record<string, unknown> | null;
  employmentType: "full_time" | "part_time" | "casual" | "contractor" | "trainee" | null | null;
  hireDate: string | null;
  homeBranchId: string;
  id: string;
  /** Locale -> localised name, e.g. {"en": "...", "ar": "..."}. */
  namesLocalized: Record<string, unknown>;
  nationalId: string | null;
  position: string | null;
  status: "active" | "suspended" | "terminated";
  tenantId: string;
  terminationDate: string | null;
  updatedAt: string;
  userId: string | null;
};

export type EmployeesController_deactivateBody = DeactivateEmployeeDto;

/** `POST /workforce/employees/{employeeId}/pin` — LIVE-DEMO-HOTFIX-1 — set/rotate this employee's POS PIN through the real Workforce Employees surface. Thin passthrough to the existing `PinService.setPin` (identity/employees) — no logic duplicated here, and `PinService.authenticate`'s verification path is completely untouched. */
export type EmployeesController_setPinResponse = void;

export type EmployeesController_setPinBody = SetEmployeePinDto;

/** `POST /workforce/schedules` — FR-HRM-010 — create a schedule by branch and week. */
export type ScheduleController_createResponse = {
  branchId: string;
  createdAt: string;
  createdBy: string;
  id: string;
  tenantId: string;
  weekStartDate: string;
};

export type ScheduleController_createBody = CreateScheduleDto;

/** `GET /workforce/schedules/{scheduleId}` */
export type ScheduleController_getResponse = {
  branchId: string;
  createdAt: string;
  createdBy: string;
  id: string;
  shifts: ({
    branchId: string;
    createdAt: string;
    createdBy: string;
    employeeId: string;
    endsAt: string;
    id: string;
    position: string | null;
    scheduleId: string;
    startsAt: string;
    tenantId: string;
  })[];
  tenantId: string;
  weekStartDate: string;
};

/** `POST /workforce/schedules/{scheduleId}/shifts` — FR-HRM-010/012 — create one validated scheduled shift. */
export type ScheduleController_createShiftResponse = {
  branchId: string;
  createdAt: string;
  createdBy: string;
  employeeId: string;
  endsAt: string;
  id: string;
  position: string | null;
  scheduleId: string;
  startsAt: string;
  tenantId: string;
};

export type ScheduleController_createShiftBody = CreateScheduledShiftDto;

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

export const ROUTES = {
  AuthController_login: { method: "POST", path: "/auth/login" },
  AuthController_logout: { method: "POST", path: "/auth/logout" },
  AuthController_me: { method: "GET", path: "/auth/me" },
  RbacController_listAssignments: { method: "GET", path: "/auth/memberships/{membershipId}/roles" },
  RbacController_assignRole: { method: "POST", path: "/auth/memberships/{membershipId}/roles" },
  RbacController_removeRole: { method: "DELETE", path: "/auth/memberships/{membershipId}/roles/{roleId}" },
  PasswordController_change: { method: "POST", path: "/auth/password/change" },
  PasswordController_forgot: { method: "POST", path: "/auth/password/forgot" },
  PasswordController_reset: { method: "POST", path: "/auth/password/reset" },
  RbacController_myPermissions: { method: "GET", path: "/auth/permissions" },
  AuthController_loginWithPin: { method: "POST", path: "/auth/pin" },
  AuthController_refresh: { method: "POST", path: "/auth/refresh" },
  RegistrationsController_register: { method: "POST", path: "/auth/registrations" },
  RbacController_updateAssignment: { method: "PATCH", path: "/auth/role-assignments/{assignmentId}" },
  RbacController_removeAssignment: { method: "DELETE", path: "/auth/role-assignments/{assignmentId}" },
  RbacController_reviewAssignment: { method: "POST", path: "/auth/role-assignments/{assignmentId}/review" },
  RbacController_listRoles: { method: "GET", path: "/auth/roles" },
  RbacController_createRole: { method: "POST", path: "/auth/roles" },
  RbacController_addRolePermissions: { method: "POST", path: "/auth/roles/{roleId}/permissions" },
  TenantController_currentTenant: { method: "GET", path: "/auth/tenant" },
  TenantController_selectTenant: { method: "POST", path: "/auth/tenant" },
  TenantController_listTenants: { method: "GET", path: "/auth/tenants" },
  TerminalController_currentTerminal: { method: "GET", path: "/auth/terminal" },
  TerminalController_bind: { method: "POST", path: "/auth/terminal" },
  TerminalController_list: { method: "GET", path: "/auth/terminals" },
  TerminalController_register: { method: "POST", path: "/auth/terminals" },
  TerminalController_addFingerprint: { method: "POST", path: "/auth/terminals/{terminalId}/fingerprints" },
  TerminalController_setStatus: { method: "POST", path: "/auth/terminals/{terminalId}/status" },
  CashClosePolicyController_createPolicy: { method: "POST", path: "/branches/{branchId}/cash-close-policy" },
  DayCloseController_get: { method: "GET", path: "/branches/{branchId}/day-closes/{businessDay}" },
  DayCloseController_post: { method: "POST", path: "/branches/{branchId}/day-closes/{businessDay}" },
  TreasuryController_openCashSession: { method: "POST", path: "/cash-sessions" },
  TreasuryController_declareClose: { method: "POST", path: "/cash-sessions/{sessionId}/close" },
  TreasuryController_getCloseContext: { method: "GET", path: "/cash-sessions/{sessionId}/close-context" },
  TreasuryController_finalizeClose: { method: "POST", path: "/cash-sessions/{sessionId}/close/finalize" },
  TreasuryController_payIn: { method: "POST", path: "/cash-sessions/{sessionId}/pay-in" },
  TreasuryController_payOut: { method: "POST", path: "/cash-sessions/{sessionId}/pay-out" },
  TreasuryController_safeDrop: { method: "POST", path: "/cash-sessions/{sessionId}/safe-drop" },
  CatalogueController_listAvailabilityRules: { method: "GET", path: "/catalogue/availability-rules" },
  CatalogueController_createAvailabilityRule: { method: "POST", path: "/catalogue/availability-rules" },
  CatalogueController_toggle86: { method: "POST", path: "/catalogue/availability-rules/{ruleId}/86" },
  CatalogueController_resolveMenus: { method: "GET", path: "/catalogue/branches/{branchId}/menus" },
  CatalogueController_updateCategory: { method: "PATCH", path: "/catalogue/categories/{categoryId}" },
  CatalogueController_completenessReport: { method: "GET", path: "/catalogue/completeness" },
  CatalogueController_listItems: { method: "GET", path: "/catalogue/items" },
  CatalogueController_createItem: { method: "POST", path: "/catalogue/items" },
  CatalogueController_getItem: { method: "GET", path: "/catalogue/items/{itemId}" },
  CatalogueController_updateItem: { method: "PATCH", path: "/catalogue/items/{itemId}" },
  CatalogueController_linkModifierGroup: { method: "POST", path: "/catalogue/items/{itemId}/modifier-groups" },
  CatalogueController_listPlacements: { method: "GET", path: "/catalogue/items/{itemId}/placements" },
  CatalogueController_placeItem: { method: "POST", path: "/catalogue/items/{itemId}/placements" },
  CatalogueController_unplaceItem: { method: "DELETE", path: "/catalogue/items/{itemId}/placements/{categoryId}" },
  CatalogueController_setItemActive: { method: "POST", path: "/catalogue/items/{itemId}/status" },
  CatalogueController_listVariants: { method: "GET", path: "/catalogue/items/{itemId}/variants" },
  CatalogueController_addVariant: { method: "POST", path: "/catalogue/items/{itemId}/variants" },
  CatalogueController_listMenus: { method: "GET", path: "/catalogue/menus" },
  CatalogueController_createMenu: { method: "POST", path: "/catalogue/menus" },
  CatalogueController_getMenu: { method: "GET", path: "/catalogue/menus/{menuId}" },
  CatalogueController_updateMenu: { method: "PATCH", path: "/catalogue/menus/{menuId}" },
  CatalogueController_listMenuBranches: { method: "GET", path: "/catalogue/menus/{menuId}/branches" },
  CatalogueController_assignBranch: { method: "POST", path: "/catalogue/menus/{menuId}/branches" },
  CatalogueController_unassignBranch: { method: "DELETE", path: "/catalogue/menus/{menuId}/branches/{branchId}" },
  CatalogueController_listCategories: { method: "GET", path: "/catalogue/menus/{menuId}/categories" },
  CatalogueController_createCategory: { method: "POST", path: "/catalogue/menus/{menuId}/categories" },
  CatalogueController_setMenuActive: { method: "POST", path: "/catalogue/menus/{menuId}/status" },
  CatalogueController_listModifierGroups: { method: "GET", path: "/catalogue/modifier-groups" },
  CatalogueController_createModifierGroup: { method: "POST", path: "/catalogue/modifier-groups" },
  CatalogueController_updateModifierGroup: { method: "PATCH", path: "/catalogue/modifier-groups/{groupId}" },
  CatalogueController_listModifiers: { method: "GET", path: "/catalogue/modifier-groups/{groupId}/modifiers" },
  CatalogueController_addModifier: { method: "POST", path: "/catalogue/modifier-groups/{groupId}/modifiers" },
  CatalogueController_listPriceLists: { method: "GET", path: "/catalogue/price-lists" },
  CatalogueController_createPriceList: { method: "POST", path: "/catalogue/price-lists" },
  CatalogueController_getPriceList: { method: "GET", path: "/catalogue/price-lists/{priceListId}" },
  CatalogueController_listPriceEntries: { method: "GET", path: "/catalogue/price-lists/{priceListId}/entries" },
  CatalogueController_setPriceEntry: { method: "POST", path: "/catalogue/price-lists/{priceListId}/entries" },
  CatalogueController_setVariantActive: { method: "POST", path: "/catalogue/variants/{variantId}/status" },
  AuditQueryController_search: { method: "GET", path: "/governance/audit/entries" },
  AuditQueryController_exportEntries: { method: "GET", path: "/governance/audit/entries/export" },
  HealthController_check: { method: "GET", path: "/health" },
  InventoryController_recordCount: { method: "POST", path: "/inventory/count-lines/{lineId}" },
  InventoryController_openCount: { method: "POST", path: "/inventory/counts" },
  InventoryController_countLines: { method: "GET", path: "/inventory/counts/{sessionId}/lines" },
  InventoryController_postCount: { method: "POST", path: "/inventory/counts/{sessionId}/post" },
  InventoryController_expiring: { method: "GET", path: "/inventory/expiring" },
  InventoryController_listItems: { method: "GET", path: "/inventory/items" },
  InventoryController_createItem: { method: "POST", path: "/inventory/items" },
  InventoryController_getItem: { method: "GET", path: "/inventory/items/{itemId}" },
  InventoryController_changeBaseUnit: { method: "POST", path: "/inventory/items/{itemId}/base-unit" },
  InventoryController_listMovements: { method: "GET", path: "/inventory/items/{itemId}/movements" },
  InventoryController_setReorderConfig: { method: "POST", path: "/inventory/items/{itemId}/reorder-config" },
  InventoryController_levels: { method: "GET", path: "/inventory/levels" },
  InventoryController_lowStock: { method: "GET", path: "/inventory/low-stock" },
  InventoryController_postMovement: { method: "POST", path: "/inventory/movements" },
  InventoryController_negativeStock: { method: "GET", path: "/inventory/negative-stock" },
  InventoryController_listReasonCodes: { method: "GET", path: "/inventory/reason-codes" },
  InventoryController_createReasonCode: { method: "POST", path: "/inventory/reason-codes" },
  InventoryController_reconcile: { method: "GET", path: "/inventory/reconciliation" },
  InventoryController_dispatch: { method: "POST", path: "/inventory/transfers" },
  InventoryController_receive: { method: "POST", path: "/inventory/transfers/receive" },
  InventoryController_listWaste: { method: "GET", path: "/inventory/waste" },
  InventoryController_recordWaste: { method: "POST", path: "/inventory/waste" },
  KitchenController_getStationQueue: { method: "GET", path: "/kds/stations/{stationId}/queue" },
  KitchenController_acknowledgeViewed: { method: "POST", path: "/kds/stations/{stationId}/tickets/view" },
  KitchenController_bumpAll: { method: "POST", path: "/kds/tickets/{ticketId}/bump-all" },
  KitchenController_bumpLine: { method: "POST", path: "/kds/tickets/{ticketId}/lines/{lineId}/bump" },
  KitchenController_startLine: { method: "POST", path: "/kds/tickets/{ticketId}/lines/{lineId}/start" },
  KitchenController_recall: { method: "POST", path: "/kds/tickets/{ticketId}/recall" },
  ProductionController_listModifierRecipeEffects: { method: "GET", path: "/modifiers/{modifierId}/recipe-effects" },
  ProductionController_replaceModifierRecipeEffects: { method: "PUT", path: "/modifiers/{modifierId}/recipe-effects" },
  OrdersController_list: { method: "GET", path: "/orders" },
  OrdersController_create: { method: "POST", path: "/orders" },
  OrdersController_findOne: { method: "GET", path: "/orders/{businessDay}/{id}" },
  OrdersController_applyOrderDiscount: { method: "POST", path: "/orders/{businessDay}/{id}/discount" },
  OrdersController_fire: { method: "POST", path: "/orders/{businessDay}/{id}/fire" },
  OrdersController_addLine: { method: "POST", path: "/orders/{businessDay}/{id}/lines" },
  OrdersController_voidLine: { method: "DELETE", path: "/orders/{businessDay}/{id}/lines/{lineId}" },
  OrdersController_applyComp: { method: "POST", path: "/orders/{businessDay}/{id}/lines/{lineId}/comp" },
  OrdersController_applyLineDiscount: { method: "POST", path: "/orders/{businessDay}/{id}/lines/{lineId}/discount" },
  OrdersController_voidLinePostFire: { method: "POST", path: "/orders/{businessDay}/{id}/lines/{lineId}/void-postfire" },
  OrdersController_capturePayment: { method: "POST", path: "/orders/{businessDay}/{id}/payments" },
  OrdersController_receipt: { method: "GET", path: "/orders/{businessDay}/{id}/receipt" },
  OrdersController_issueRefund: { method: "POST", path: "/orders/{businessDay}/{id}/refunds" },
  OrganisationController_getAccessibleScope: { method: "GET", path: "/org/access" },
  OrganisationController_listBranches: { method: "GET", path: "/org/branches" },
  OrganisationController_createBranch: { method: "POST", path: "/org/branches" },
  OrganisationController_getBranch: { method: "GET", path: "/org/branches/{branchId}" },
  OrganisationController_updateBranch: { method: "PATCH", path: "/org/branches/{branchId}" },
  OrganisationController_reassignBranchBrand: { method: "POST", path: "/org/branches/{branchId}/brand" },
  OrganisationController_listOperatingHours: { method: "GET", path: "/org/branches/{branchId}/operating-hours" },
  OrganisationController_createOperatingHours: { method: "POST", path: "/org/branches/{branchId}/operating-hours" },
  OrganisationController_listPrintRouting: { method: "GET", path: "/org/branches/{branchId}/print-routing" },
  OrganisationController_createPrintRouting: { method: "POST", path: "/org/branches/{branchId}/print-routing" },
  OrganisationController_listStationRoutingRules: { method: "GET", path: "/org/branches/{branchId}/station-routing-rules" },
  OrganisationController_createStationRoutingRule: { method: "POST", path: "/org/branches/{branchId}/station-routing-rules" },
  OrganisationController_listStations: { method: "GET", path: "/org/branches/{branchId}/stations" },
  OrganisationController_createStation: { method: "POST", path: "/org/branches/{branchId}/stations" },
  OrganisationController_setBranchStatus: { method: "POST", path: "/org/branches/{branchId}/status" },
  OrganisationController_listTables: { method: "GET", path: "/org/branches/{branchId}/tables" },
  OrganisationController_createTable: { method: "POST", path: "/org/branches/{branchId}/tables" },
  OrganisationController_listBrands: { method: "GET", path: "/org/brands" },
  OrganisationController_createBrand: { method: "POST", path: "/org/brands" },
  OrganisationController_getBrand: { method: "GET", path: "/org/brands/{brandId}" },
  OrganisationController_updateBrand: { method: "PATCH", path: "/org/brands/{brandId}" },
  OrganisationController_listCentralKitchens: { method: "GET", path: "/org/central-kitchens" },
  OrganisationController_createCentralKitchen: { method: "POST", path: "/org/central-kitchens" },
  OrganisationController_getCentralKitchen: { method: "GET", path: "/org/central-kitchens/{centralKitchenId}" },
  OrganisationController_updateCentralKitchen: { method: "PATCH", path: "/org/central-kitchens/{centralKitchenId}" },
  OrganisationController_getStation: { method: "GET", path: "/org/stations/{stationId}" },
  OrganisationController_updateStation: { method: "PATCH", path: "/org/stations/{stationId}" },
  OrganisationController_updateTable: { method: "PATCH", path: "/org/tables/{tableId}" },
  OrganisationController_listWarehouses: { method: "GET", path: "/org/warehouses" },
  OrganisationController_createWarehouse: { method: "POST", path: "/org/warehouses" },
  OrganisationController_getWarehouse: { method: "GET", path: "/org/warehouses/{warehouseId}" },
  OrganisationController_updateWarehouse: { method: "PATCH", path: "/org/warehouses/{warehouseId}" },
  ProductionController_listRecipes: { method: "GET", path: "/recipes" },
  ProductionController_createRecipe: { method: "POST", path: "/recipes" },
  ProductionController_recipesRequiringCompletion: { method: "GET", path: "/recipes/requiring-completion" },
  ProductionController_listVersions: { method: "GET", path: "/recipes/{recipeId}/versions" },
  ProductionController_createVersion: { method: "POST", path: "/recipes/{recipeId}/versions" },
  ProductionController_replaceLines: { method: "PUT", path: "/recipes/{recipeId}/versions/{version}/lines" },
  ProductionController_publish: { method: "POST", path: "/recipes/{recipeId}/versions/{version}/publish" },
  ReportingController_getDailyTradingReport: { method: "GET", path: "/reports/branches/{branchId}/daily-trading/{businessDay}" },
  ReportingController_getOperationalOverview: { method: "GET", path: "/reports/branches/{branchId}/overview" },
  ProductionController_listGroups: { method: "GET", path: "/substitute-groups" },
  ProductionController_createGroup: { method: "POST", path: "/substitute-groups" },
  ProductionController_addGroupMember: { method: "POST", path: "/substitute-groups/{groupId}/members" },
  SyncController_uploadBatch_v1: { method: "POST", path: "/v1/sync/batch" },
  SyncRecoveryController_issueGrant_v1: { method: "POST", path: "/v1/sync/recovery/grants" },
  SyncRecoveryController_uploadRecoveryBatch_v1: { method: "POST", path: "/v1/sync/recovery/{grantId}/batch" },
  AttendanceController_clockIn: { method: "POST", path: "/workforce/attendance/clock-in" },
  AttendanceController_clockOut: { method: "POST", path: "/workforce/attendance/clock-out" },
  AttendanceController_setSettings: { method: "POST", path: "/workforce/attendance/settings" },
  AttendanceController_get: { method: "GET", path: "/workforce/attendance/{attendanceRecordId}" },
  AttendanceController_correct: { method: "POST", path: "/workforce/attendance/{attendanceRecordId}/correct" },
  EmployeesController_list: { method: "GET", path: "/workforce/employees" },
  EmployeesController_create: { method: "POST", path: "/workforce/employees" },
  EmployeesController_get: { method: "GET", path: "/workforce/employees/{employeeId}" },
  EmployeesController_update: { method: "PATCH", path: "/workforce/employees/{employeeId}" },
  EmployeesController_addBranch: { method: "POST", path: "/workforce/employees/{employeeId}/branches" },
  EmployeesController_currentCompensation: { method: "GET", path: "/workforce/employees/{employeeId}/compensation" },
  EmployeesController_setCompensation: { method: "POST", path: "/workforce/employees/{employeeId}/compensation" },
  EmployeesController_deactivate: { method: "POST", path: "/workforce/employees/{employeeId}/deactivate" },
  EmployeesController_setPin: { method: "POST", path: "/workforce/employees/{employeeId}/pin" },
  ScheduleController_create: { method: "POST", path: "/workforce/schedules" },
  ScheduleController_get: { method: "GET", path: "/workforce/schedules/{scheduleId}" },
  ScheduleController_createShift: { method: "POST", path: "/workforce/schedules/{scheduleId}/shifts" },
} as const;

/** Every operation the document describes. */
export type OperationId = keyof typeof ROUTES;
