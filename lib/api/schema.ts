/**
 * Wire types for ROS Backend API v0.0.1.
 *
 * GENERATED — do not edit. Run `npm run api:types` after replacing
 * `api/openapi.json`. 111 paths, 82 request DTOs.
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

export interface AddSubstituteMemberDto {
  stockItemId: string;
}

export interface AssignBranchDto {
  branchId: string;
}

export interface AssignRoleDto {
  roleId: string;
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
  scopeType: "branch" | "tenant" | "brand";
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

export interface SetBranchStatusDto {
  status: "active" | "inactive";
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

export interface Toggle86Dto {
  autoReenableAt?: string;
  isManual86: boolean;
  reasonText?: string;
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

/** `POST /auth/memberships/{membershipId}/roles` — Assign a role to a membership. — Role assigned. */
export type RbacController_assignRoleResponse = void;

export type RbacController_assignRoleBody = AssignRoleDto;

/** `DELETE /auth/memberships/{membershipId}/roles/{roleId}` — Remove a role from a membership. — Role removed. */
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

/** `GET /auth/permissions` — Effective permissions of the caller's active membership. — The caller's effective permission codes, sorted. */
export type RbacController_myPermissionsResponse = {
  permissions: string[];
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
    countryPackVersion: number;
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
      priceRule: Record<string, unknown>;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string | null;
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
  countryPackVersion: number;
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
    priceRule: Record<string, unknown>;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string | null;
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
  countryPackVersion: number;
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
    priceRule: Record<string, unknown>;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string | null;
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

/** `POST /orders/{businessDay}/{id}/fire` — Fire eligible pending lines to production (explicit MVP Fire — no auto-Fire). — The order after Fire, including every line (previously-fired and newly-fired alike). */
export type OrdersController_fireResponse = {
  branchId: string;
  /** Business-day partition key (YYYY-MM-DD), not a timestamp. */
  businessDay: string;
  channel: "pos" | "kiosk" | "qr" | "aggregator" | "phone" | "api";
  closedBy: string | null;
  completedAt: string | null;
  /** FR-LOC-021 — the pack version this order was priced under, pinned. */
  countryPackVersion: number;
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
    priceRule: Record<string, unknown>;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string | null;
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
    priceRule: Record<string, unknown>;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string | null;
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
    countryPackVersion: number;
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
      priceRule: Record<string, unknown>;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string | null;
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
    priceRule: Record<string, unknown>;
    /** Decimal quantity as a string (preserves exact precision). */
    quantity: string;
    readyAt: string | null;
    recipeVersionId: string | null;
    seatNumber: number | null;
    sequence: number;
    state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
    /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
    taxAmount: string;
    taxClassId: string | null;
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
    countryPackVersion: number;
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
      priceRule: Record<string, unknown>;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string | null;
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
    countryPackVersion: number;
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
      priceRule: Record<string, unknown>;
      /** Decimal quantity as a string (preserves exact precision). */
      quantity: string;
      readyAt: string | null;
      recipeVersionId: string | null;
      seatNumber: number | null;
      sequence: number;
      state: "pending" | "fired" | "preparing" | "ready" | "served" | "voided" | "comped";
      /** Minor-unit money amount as a decimal string (never a JSON number, to avoid IEEE-754 precision loss). */
      taxAmount: string;
      taxClassId: string | null;
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

/** `GET /reports/branches/{branchId}/daily-trading/{businessDay}` — Branch daily-trading report (Internal-MVP: dashboard-only, one tenant, exactly one active branch). — The daily-trading report: salesSummary, tenderTotals (incl. completedExcessCapturedTotal), taxSummary, cashReconciliation (WHOLE_SESSION scope), dataAsOf, periodStatus (OPEN/UNSEALED/SETTLED — no SEALED, no FUTURE), currency/currencySource, and a scope block disclosing exactly what this Internal-MVP slice does and does not cover. */
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

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

export const ROUTES = {
  AuthController_login: { method: "POST", path: "/auth/login" },
  AuthController_logout: { method: "POST", path: "/auth/logout" },
  AuthController_me: { method: "GET", path: "/auth/me" },
  RbacController_assignRole: { method: "POST", path: "/auth/memberships/{membershipId}/roles" },
  RbacController_removeRole: { method: "DELETE", path: "/auth/memberships/{membershipId}/roles/{roleId}" },
  PasswordController_change: { method: "POST", path: "/auth/password/change" },
  PasswordController_forgot: { method: "POST", path: "/auth/password/forgot" },
  PasswordController_reset: { method: "POST", path: "/auth/password/reset" },
  RbacController_myPermissions: { method: "GET", path: "/auth/permissions" },
  AuthController_loginWithPin: { method: "POST", path: "/auth/pin" },
  AuthController_refresh: { method: "POST", path: "/auth/refresh" },
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
  OrdersController_fire: { method: "POST", path: "/orders/{businessDay}/{id}/fire" },
  OrdersController_addLine: { method: "POST", path: "/orders/{businessDay}/{id}/lines" },
  OrdersController_voidLine: { method: "DELETE", path: "/orders/{businessDay}/{id}/lines/{lineId}" },
  OrdersController_capturePayment: { method: "POST", path: "/orders/{businessDay}/{id}/payments" },
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
  ProductionController_listGroups: { method: "GET", path: "/substitute-groups" },
  ProductionController_createGroup: { method: "POST", path: "/substitute-groups" },
  ProductionController_addGroupMember: { method: "POST", path: "/substitute-groups/{groupId}/members" },
} as const;

/** Every operation the document describes. */
export type OperationId = keyof typeof ROUTES;
