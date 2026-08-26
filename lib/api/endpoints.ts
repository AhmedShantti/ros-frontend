/**
 * Typed calls, one per operation in the document, grouped by its tag.
 *
 * GENERATED — do not edit. Run `npm run api:types`.
 *
 * Path parameters are positional in the order the URL declares them; a
 * request body follows them; query parameters and optional headers arrive
 * last as one options object. Endpoints the document marks as requiring an
 * `idempotency-key` send one automatically.
 */

import { http } from "./client";
import type * as S from "./schema";

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

export const auth = {
  /** `POST /auth/login` — Authenticate with email + password. — Access token, refresh token, and user. */
  login: (body: S.LoginDto) =>
    http.post<S.AuthController_loginResponse>("/auth/login", { body }),

  /** `POST /auth/logout` — Revoke the current session. — Current session revoked. */
  logout: () =>
    http.post<S.AuthController_logoutResponse>("/auth/logout"),

  /** `GET /auth/me` — The authenticated user. — The authenticated user (no credentials), plus whether their password must be reset before further use. */
  me: () =>
    http.get<S.AuthController_meResponse>("/auth/me"),

  /** `POST /auth/pin` — Authenticate with a terminal-scoped employee PIN (POS). — Access token, refresh token, and user. The session is POS-only. */
  loginWithPin: (body: S.PinLoginDto) =>
    http.post<S.AuthController_loginWithPinResponse>("/auth/pin", { body }),

  /** `POST /auth/refresh` — Rotate a refresh token for a new access + refresh token pair. — A rotated access + refresh token pair. */
  refresh: (body: S.RefreshDto) =>
    http.post<S.AuthController_refreshResponse>("/auth/refresh", { body }),

};

// ---------------------------------------------------------------------------
// rbac
// ---------------------------------------------------------------------------

export const rbac = {
  /** `POST /auth/memberships/{membershipId}/roles` — Assign a role to a membership. — Role assigned. */
  assignRole: (membershipId: string, body: S.AssignRoleDto) =>
    http.post<S.RbacController_assignRoleResponse>("/auth/memberships/{membershipId}/roles", { params: { membershipId }, body }),

  /** `DELETE /auth/memberships/{membershipId}/roles/{roleId}` — Remove a role from a membership. — Role removed. */
  removeRole: (membershipId: string, roleId: string) =>
    http.delete<S.RbacController_removeRoleResponse>("/auth/memberships/{membershipId}/roles/{roleId}", { params: { membershipId, roleId } }),

  /** `GET /auth/permissions` — Effective permissions of the caller's active membership. — The caller's effective permission codes, sorted. */
  myPermissions: () =>
    http.get<S.RbacController_myPermissionsResponse>("/auth/permissions"),

  /** `GET /auth/roles` — Roles visible to the tenant: its own roles plus shared system roles. — Roles, system roles first, then by name. */
  listRoles: () =>
    http.get<S.RbacController_listRolesResponse>("/auth/roles"),

  /** `POST /auth/roles` — Create a tenant-owned role. — The newly created role. */
  createRole: (body: S.CreateRoleDto) =>
    http.post<S.RbacController_createRoleResponse>("/auth/roles", { body }),

  /** `POST /auth/roles/{roleId}/permissions` — Grant permissions to a tenant-owned role. — Permissions granted. */
  addRolePermissions: (roleId: string, body: S.AddPermissionsDto) =>
    http.post<S.RbacController_addRolePermissionsResponse>("/auth/roles/{roleId}/permissions", { params: { roleId }, body }),

};

// ---------------------------------------------------------------------------
// password
// ---------------------------------------------------------------------------

export const password = {
  /** `POST /auth/password/change` — Change password (proves the current password). — Password changed; other sessions revoked. */
  change: (body: S.ChangePasswordDto) =>
    http.post<S.PasswordController_changeResponse>("/auth/password/change", { body }),

  /** `POST /auth/password/forgot` — Request a password reset (no account enumeration). */
  forgot: (body: S.ForgotPasswordDto) =>
    http.post<S.PasswordController_forgotResponse>("/auth/password/forgot", { body }),

  /** `POST /auth/password/reset` — Complete a password reset with a single-use token. — Password reset; all sessions revoked. */
  reset: (body: S.ResetPasswordDto) =>
    http.post<S.PasswordController_resetResponse>("/auth/password/reset", { body }),

};

// ---------------------------------------------------------------------------
// tenants
// ---------------------------------------------------------------------------

export const tenants = {
  /** `GET /auth/tenant` — Current tenant context on the request. — Current tenant context on the request. Both fields are null before a tenant is selected. */
  currentTenant: () =>
    http.get<S.TenantController_currentTenantResponse>("/auth/tenant"),

  /** `POST /auth/tenant` — Select a tenant, obtaining a tenant-scoped access token. — Tenant selected; tenant-scoped access token. */
  selectTenant: (body: S.SelectTenantDto) =>
    http.post<S.TenantController_selectTenantResponse>("/auth/tenant", { body }),

  /** `GET /auth/tenants` — The caller's selectable tenants. — The caller's selectable tenants. */
  listTenants: () =>
    http.get<S.TenantController_listTenantsResponse>("/auth/tenants"),

};

// ---------------------------------------------------------------------------
// terminals
// ---------------------------------------------------------------------------

export const terminals = {
  /** `GET /auth/terminal` — Current terminal binding on the request. — Current terminal binding. Null before a terminal is bound. */
  currentTerminal: () =>
    http.get<S.TerminalController_currentTerminalResponse>("/auth/terminal"),

  /** `POST /auth/terminal` — Bind the caller's current session to a terminal. — The session is now bound; a terminal-scoped access token. */
  bind: (body: S.BindTerminalDto) =>
    http.post<S.TerminalController_bindResponse>("/auth/terminal", { body }),

  /** `GET /auth/terminals` — List terminals registered to the tenant. — Terminals, oldest first. */
  list: () =>
    http.get<S.TerminalController_listResponse>("/auth/terminals"),

  /** `POST /auth/terminals` — Register a terminal. — The newly registered terminal. */
  register: (body: S.RegisterTerminalDto) =>
    http.post<S.TerminalController_registerResponse>("/auth/terminals", { body }),

  /** `POST /auth/terminals/{terminalId}/fingerprints` — Register a device fingerprint on a terminal (idempotent: same fingerprint on the same terminal is a no-op). — Fingerprint registered (or already present). */
  addFingerprint: (terminalId: string, body: S.AddFingerprintDto) =>
    http.post<S.TerminalController_addFingerprintResponse>("/auth/terminals/{terminalId}/fingerprints", { params: { terminalId }, body }),

  /** `POST /auth/terminals/{terminalId}/status` — Set a terminal's status. — The updated terminal. */
  setStatus: (terminalId: string, body: S.SetTerminalStatusDto) =>
    http.post<S.TerminalController_setStatusResponse>("/auth/terminals/{terminalId}/status", { params: { terminalId }, body }),

};

// ---------------------------------------------------------------------------
// treasury
// ---------------------------------------------------------------------------

export const treasury = {
  /** `POST /cash-sessions` — Open a cashier shift and its cash session — FR-POS-090, FR-FIN-001/002. ONE command for the cashier, two records for the model. FR-POS-090 describes a single action ("open a shift, declaring an opening float"), and the cashier should not have to know that a shift is a Workforce concept and a session a Treasury one. They stay distinct in the schema (carried item P1D-A); only the command is unified, and both are written in one transaction. `Idempotency-Key` is MANDATORY (FR-API-020): opening a drawer is a financially significant act, and a retry over a flaky link must not produce a second shift or a second session. The two client ULIDs are independent duplicate protection beneath it. — The opened cash session and its shift, plus whether this call created them (false on an idempotent replay of an already-open pair). */
  openCashSession: (body: S.OpenCashSessionDto) =>
    http.post<S.TreasuryController_openCashSessionResponse>("/cash-sessions", { body, idempotent: true }),

};

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

export const catalogue = {
  /** `GET /catalogue/availability-rules` — Availability rules, optionally filtered to one menu item. */
  listAvailabilityRules: (options: { menuItemId?: string } = {}) =>
    http.get<S.CatalogueController_listAvailabilityRulesResponse>("/catalogue/availability-rules", { query: { menuItemId: options.menuItemId } }),

  /** `POST /catalogue/availability-rules` — The newly created availability rule. */
  createAvailabilityRule: (body: S.CreateAvailabilityRuleDto) =>
    http.post<S.CatalogueController_createAvailabilityRuleResponse>("/catalogue/availability-rules", { body }),

  /** `POST /catalogue/availability-rules/{ruleId}/86` — FR-MNU-030/032: manual 86 and authorised override, both audited. — The updated availability rule. */
  toggle86: (ruleId: string, body: S.Toggle86Dto) =>
    http.post<S.CatalogueController_toggle86Response>("/catalogue/availability-rules/{ruleId}/86", { params: { ruleId }, body }),

  /** `GET /catalogue/branches/{branchId}/menus` — FR-MNU-003: priority-ordered resolution with an ambiguity warning. — Active menus assigned to this branch, priority order (highest first). */
  resolveMenus: (branchId: string) =>
    http.get<S.CatalogueController_resolveMenusResponse>("/catalogue/branches/{branchId}/menus", { params: { branchId } }),

  /** `PATCH /catalogue/categories/{categoryId}` — The updated category. */
  updateCategory: (categoryId: string, body: S.UpdateCategoryDto) =>
    http.patch<S.CatalogueController_updateCategoryResponse>("/catalogue/categories/{categoryId}", { params: { categoryId }, body }),

  /** `GET /catalogue/completeness` — C-11 (amended) completeness report: what would block sellability, without blocking anything itself. */
  completenessReport: () =>
    http.get<S.CatalogueController_completenessReportResponse>("/catalogue/completeness"),

  /** `GET /catalogue/items` — All menu items for this tenant. */
  listItems: () =>
    http.get<S.CatalogueController_listItemsResponse>("/catalogue/items"),

  /** `POST /catalogue/items` — The newly created menu item. */
  createItem: (body: S.CreateMenuItemDto) =>
    http.post<S.CatalogueController_createItemResponse>("/catalogue/items", { body }),

  /** `GET /catalogue/items/{itemId}` — The menu item. */
  getItem: (itemId: string) =>
    http.get<S.CatalogueController_getItemResponse>("/catalogue/items/{itemId}", { params: { itemId } }),

  /** `PATCH /catalogue/items/{itemId}` — The updated menu item. */
  updateItem: (itemId: string, body: S.UpdateMenuItemDto) =>
    http.patch<S.CatalogueController_updateItemResponse>("/catalogue/items/{itemId}", { params: { itemId }, body }),

  /** `POST /catalogue/items/{itemId}/modifier-groups` — Attach a reusable modifier group to an item, with optional per-item overrides (FR-MNU-010). — Linked. */
  linkModifierGroup: (itemId: string, body: S.LinkModifierGroupDto) =>
    http.post<S.CatalogueController_linkModifierGroupResponse>("/catalogue/items/{itemId}/modifier-groups", { params: { itemId }, body }),

  /** `GET /catalogue/items/{itemId}/placements` — Categories (and their menus) this item is placed in. */
  listPlacements: (itemId: string) =>
    http.get<S.CatalogueController_listPlacementsResponse>("/catalogue/items/{itemId}/placements", { params: { itemId } }),

  /** `POST /catalogue/items/{itemId}/placements` — Place an item into a category (C-02) — an item may be placed in many categories. — Placed. */
  placeItem: (itemId: string, body: S.PlaceMenuItemDto) =>
    http.post<S.CatalogueController_placeItemResponse>("/catalogue/items/{itemId}/placements", { params: { itemId }, body }),

  /** `DELETE /catalogue/items/{itemId}/placements/{categoryId}` — Unplaced. */
  unplaceItem: (itemId: string, categoryId: string) =>
    http.delete<S.CatalogueController_unplaceItemResponse>("/catalogue/items/{itemId}/placements/{categoryId}", { params: { itemId, categoryId } }),

  /** `POST /catalogue/items/{itemId}/status` — Activate/deactivate a menu item (C-09 explicit, audited lifecycle). — The updated menu item. */
  setItemActive: (itemId: string, body: S.SetActiveDto) =>
    http.post<S.CatalogueController_setItemActiveResponse>("/catalogue/items/{itemId}/status", { params: { itemId }, body }),

  /** `GET /catalogue/items/{itemId}/variants` — Variants of this item, sort order. */
  listVariants: (itemId: string) =>
    http.get<S.CatalogueController_listVariantsResponse>("/catalogue/items/{itemId}/variants", { params: { itemId } }),

  /** `POST /catalogue/items/{itemId}/variants` — The newly created variant. */
  addVariant: (itemId: string, body: S.CreateVariantDto) =>
    http.post<S.CatalogueController_addVariantResponse>("/catalogue/items/{itemId}/variants", { params: { itemId }, body }),

  /** `GET /catalogue/menus` — All menus for this tenant. */
  listMenus: () =>
    http.get<S.CatalogueController_listMenusResponse>("/catalogue/menus"),

  /** `POST /catalogue/menus` — The newly created menu. */
  createMenu: (body: S.CreateMenuDto) =>
    http.post<S.CatalogueController_createMenuResponse>("/catalogue/menus", { body }),

  /** `GET /catalogue/menus/{menuId}` — The menu. */
  getMenu: (menuId: string) =>
    http.get<S.CatalogueController_getMenuResponse>("/catalogue/menus/{menuId}", { params: { menuId } }),

  /** `PATCH /catalogue/menus/{menuId}` — The updated menu. */
  updateMenu: (menuId: string, body: S.UpdateMenuDto) =>
    http.patch<S.CatalogueController_updateMenuResponse>("/catalogue/menus/{menuId}", { params: { menuId }, body }),

  /** `GET /catalogue/menus/{menuId}/branches` — Branch ids this menu is assigned to. */
  listMenuBranches: (menuId: string) =>
    http.get<S.CatalogueController_listMenuBranchesResponse>("/catalogue/menus/{menuId}/branches", { params: { menuId } }),

  /** `POST /catalogue/menus/{menuId}/branches` — Assign a menu to a branch (C-01). — Assigned. */
  assignBranch: (menuId: string, body: S.AssignBranchDto) =>
    http.post<S.CatalogueController_assignBranchResponse>("/catalogue/menus/{menuId}/branches", { params: { menuId }, body }),

  /** `DELETE /catalogue/menus/{menuId}/branches/{branchId}` — Unassigned. */
  unassignBranch: (menuId: string, branchId: string) =>
    http.delete<S.CatalogueController_unassignBranchResponse>("/catalogue/menus/{menuId}/branches/{branchId}", { params: { menuId, branchId } }),

  /** `GET /catalogue/menus/{menuId}/categories` — Categories on this menu, sort order. */
  listCategories: (menuId: string) =>
    http.get<S.CatalogueController_listCategoriesResponse>("/catalogue/menus/{menuId}/categories", { params: { menuId } }),

  /** `POST /catalogue/menus/{menuId}/categories` — The newly created category. */
  createCategory: (menuId: string, body: S.CreateCategoryDto) =>
    http.post<S.CatalogueController_createCategoryResponse>("/catalogue/menus/{menuId}/categories", { params: { menuId }, body }),

  /** `POST /catalogue/menus/{menuId}/status` — Activate/deactivate a menu (C-09 explicit, audited lifecycle). — The updated menu. */
  setMenuActive: (menuId: string, body: S.SetActiveDto) =>
    http.post<S.CatalogueController_setMenuActiveResponse>("/catalogue/menus/{menuId}/status", { params: { menuId }, body }),

  /** `GET /catalogue/modifier-groups` — All modifier groups for this tenant. */
  listModifierGroups: () =>
    http.get<S.CatalogueController_listModifierGroupsResponse>("/catalogue/modifier-groups"),

  /** `POST /catalogue/modifier-groups` — The newly created modifier group. */
  createModifierGroup: (body: S.CreateModifierGroupDto) =>
    http.post<S.CatalogueController_createModifierGroupResponse>("/catalogue/modifier-groups", { body }),

  /** `PATCH /catalogue/modifier-groups/{groupId}` — The updated modifier group. */
  updateModifierGroup: (groupId: string, body: S.UpdateModifierGroupDto) =>
    http.patch<S.CatalogueController_updateModifierGroupResponse>("/catalogue/modifier-groups/{groupId}", { params: { groupId }, body }),

  /** `GET /catalogue/modifier-groups/{groupId}/modifiers` — Modifiers in this group, sort order. */
  listModifiers: (groupId: string) =>
    http.get<S.CatalogueController_listModifiersResponse>("/catalogue/modifier-groups/{groupId}/modifiers", { params: { groupId } }),

  /** `POST /catalogue/modifier-groups/{groupId}/modifiers` — The newly created modifier. */
  addModifier: (groupId: string, body: S.CreateModifierDto) =>
    http.post<S.CatalogueController_addModifierResponse>("/catalogue/modifier-groups/{groupId}/modifiers", { params: { groupId }, body }),

  /** `GET /catalogue/price-lists` — All price lists for this tenant, priority descending. */
  listPriceLists: () =>
    http.get<S.CatalogueController_listPriceListsResponse>("/catalogue/price-lists"),

  /** `POST /catalogue/price-lists` — The newly created price list. */
  createPriceList: (body: S.CreatePriceListDto) =>
    http.post<S.CatalogueController_createPriceListResponse>("/catalogue/price-lists", { body }),

  /** `GET /catalogue/price-lists/{priceListId}` — The price list. */
  getPriceList: (priceListId: string) =>
    http.get<S.CatalogueController_getPriceListResponse>("/catalogue/price-lists/{priceListId}", { params: { priceListId } }),

  /** `GET /catalogue/price-lists/{priceListId}/entries` — Price entries in this list. */
  listPriceEntries: (priceListId: string) =>
    http.get<S.CatalogueController_listPriceEntriesResponse>("/catalogue/price-lists/{priceListId}/entries", { params: { priceListId } }),

  /** `POST /catalogue/price-lists/{priceListId}/entries` — Set (create or overwrite) a variant's price within this list (FR-MNU-023/024). — The saved price entry. */
  setPriceEntry: (priceListId: string, body: S.SetPriceEntryDto) =>
    http.post<S.CatalogueController_setPriceEntryResponse>("/catalogue/price-lists/{priceListId}/entries", { params: { priceListId }, body }),

  /** `POST /catalogue/variants/{variantId}/status` — Activate/deactivate a variant (C-09 explicit, audited lifecycle). — The updated variant. */
  setVariantActive: (variantId: string, body: S.SetActiveDto) =>
    http.post<S.CatalogueController_setVariantActiveResponse>("/catalogue/variants/{variantId}/status", { params: { variantId }, body }),

};

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

export const health = {
  /** `GET /health` — Service is up. */
  check: () =>
    http.get<S.HealthController_checkResponse>("/health"),

};

// ---------------------------------------------------------------------------
// inventory
// ---------------------------------------------------------------------------

export const inventory = {
  /** `POST /inventory/count-lines/{lineId}` — Record a counted quantity for one count line. — The updated count line. */
  recordCount: (lineId: string, body: S.RecordCountDto) =>
    http.post<S.InventoryController_recordCountResponse>("/inventory/count-lines/{lineId}", { params: { lineId }, body }),

  /** `POST /inventory/counts` — Open a count session and freeze expected quantities for its scope. — The opened count session. */
  openCount: (body: S.OpenCountDto) =>
    http.post<S.InventoryController_openCountResponse>("/inventory/counts", { body }),

  /** `GET /inventory/counts/{sessionId}/lines` — This session's count lines. expectedQuantity/countedQuantity/variance are null while a blind count is still in_progress and not yet recorded. */
  countLines: (sessionId: string) =>
    http.get<S.InventoryController_countLinesResponse>("/inventory/counts/{sessionId}/lines", { params: { sessionId } }),

  /** `POST /inventory/counts/{sessionId}/post` — Post a count session: writes count_adjustment movements bringing recorded stock to counted stock. — The posted count session. */
  postCount: (sessionId: string) =>
    http.post<S.InventoryController_postCountResponse>("/inventory/counts/{sessionId}/post", { params: { sessionId } }),

  /** `GET /inventory/expiring` — FR-INV-024 computation. Alert delivery deferred. — Batches expiring within `days` (default 7) (FR-INV-024). */
  expiring: (options: { days?: string } = {}) =>
    http.get<S.InventoryController_expiringResponse>("/inventory/expiring", { query: { days: options.days } }),

  /** `GET /inventory/items` — All stock items in the tenant. */
  listItems: () =>
    http.get<S.InventoryController_listItemsResponse>("/inventory/items"),

  /** `POST /inventory/items` — Create a stock item (FR-INV-001). — The created stock item. */
  createItem: (body: S.CreateStockItemDto) =>
    http.post<S.InventoryController_createItemResponse>("/inventory/items", { body }),

  /** `GET /inventory/items/{itemId}` — The stock item. */
  getItem: (itemId: string) =>
    http.get<S.InventoryController_getItemResponse>("/inventory/items/{itemId}", { params: { itemId } }),

  /** `POST /inventory/items/{itemId}/base-unit` — FR-INV-002: rejected once any movement exists. — The updated stock item. */
  changeBaseUnit: (itemId: string, body: S.ChangeBaseUnitDto) =>
    http.post<S.InventoryController_changeBaseUnitResponse>("/inventory/items/{itemId}/base-unit", { params: { itemId }, body }),

  /** `GET /inventory/items/{itemId}/movements` — Cost-bearing read — gated by inventory.cost.view, not inventory.view. — The most recent 200 ledger movements for this item, newest first. */
  listMovements: (itemId: string, options: { locationId?: string } = {}) =>
    http.get<S.InventoryController_listMovementsResponse>("/inventory/items/{itemId}/movements", { params: { itemId }, query: { locationId: options.locationId } }),

  /** `POST /inventory/items/{itemId}/reorder-config` — FR-INV-065: per-location reorder configuration. — The upserted reorder configuration. */
  setReorderConfig: (itemId: string, body: S.SetReorderConfigDto) =>
    http.post<S.InventoryController_setReorderConfigResponse>("/inventory/items/{itemId}/reorder-config", { params: { itemId }, body }),

  /** `GET /inventory/levels` — Current stock levels (FR-INV-010/015). */
  levels: (options: { locationId?: string } = {}) =>
    http.get<S.InventoryController_levelsResponse>("/inventory/levels", { query: { locationId: options.locationId } }),

  /** `GET /inventory/low-stock` — FR-INV-066 computation against per-location reorder points. — Levels below their per-location reorder point (FR-INV-066/065). */
  lowStock: () =>
    http.get<S.InventoryController_lowStockResponse>("/inventory/low-stock"),

  /** `POST /inventory/movements` — Post a standalone movement (opening balance / manual adjustment) to the ledger. — The posted movement. */
  postMovement: (body: S.PostMovementDto) =>
    http.post<S.InventoryController_postMovementResponse>("/inventory/movements", { body }),

  /** `GET /inventory/negative-stock` — FR-INV-014 computation. Alert delivery deferred. — Stock levels currently below zero (FR-INV-014; negative levels are permitted and recorded, this surfaces them). */
  negativeStock: () =>
    http.get<S.InventoryController_negativeStockResponse>("/inventory/negative-stock"),

  /** `GET /inventory/reason-codes` — All reason codes in the tenant. */
  listReasonCodes: () =>
    http.get<S.InventoryController_listReasonCodesResponse>("/inventory/reason-codes"),

  /** `POST /inventory/reason-codes` — The created reason code. */
  createReasonCode: (body: S.CreateReasonCodeDto) =>
    http.post<S.InventoryController_createReasonCodeResponse>("/inventory/reason-codes", { body }),

  /** `GET /inventory/reconciliation` — FR-INV-011/051 computation. Scheduling deferred (D-INV-08). — On-demand ledger-vs-projection reconciliation (FR-INV-011/051). Scheduling and alert delivery are deferred (D-INV-08). */
  reconcile: () =>
    http.get<S.InventoryController_reconcileResponse>("/inventory/reconciliation"),

  /** `POST /inventory/transfers` — Dispatch a transfer (writes the transfer_out leg). — The dispatched transfer. */
  dispatch: (body: S.DispatchTransferDto) =>
    http.post<S.InventoryController_dispatchResponse>("/inventory/transfers", { body }),

  /** `POST /inventory/transfers/receive` — Receive a dispatched transfer (writes the transfer_in leg, plus a discrepancy adjustment if the received quantity differs). — The received transfer. */
  receive: (body: S.ReceiveTransferDto) =>
    http.post<S.InventoryController_receiveResponse>("/inventory/transfers/receive", { body }),

  /** `GET /inventory/waste` — The most recent 200 waste records, newest first. */
  listWaste: () =>
    http.get<S.InventoryController_listWasteResponse>("/inventory/waste"),

  /** `POST /inventory/waste` — Record waste (writes waste movements for each line; FR-INV-055…059). — The recorded waste. */
  recordWaste: (body: S.RecordWasteDto) =>
    http.post<S.InventoryController_recordWasteResponse>("/inventory/waste", { body }),

};

// ---------------------------------------------------------------------------
// sales
// ---------------------------------------------------------------------------

export const sales = {
  /** `GET /orders` — List orders, cursor-paginated. — A page of orders (no line snapshots) plus an opaque cursor for the next page. */
  list: (options: { branchId?: string; cursorId?: string; cursorBusinessDay?: string; limit?: number } = {}) =>
    http.get<S.OrdersController_listResponse>("/orders", { query: { branchId: options.branchId, cursorId: options.cursorId, cursorBusinessDay: options.cursorBusinessDay, limit: options.limit } }),

  /** `POST /orders` — Open an order. — The newly opened order. */
  create: (body: S.CreateOrderDto) =>
    http.post<S.OrdersController_createResponse>("/orders", { body, idempotent: true }),

  /** `GET /orders/{businessDay}/{id}` — One order, with its persisted line snapshots. — The order, including its lines. */
  findOne: (businessDay: string, id: string) =>
    http.get<S.OrdersController_findOneResponse>("/orders/{businessDay}/{id}", { params: { businessDay, id } }),

  /** `POST /orders/{businessDay}/{id}/fire` — Fire eligible pending lines to production (explicit MVP Fire — no auto-Fire). — The order after Fire, including every line (previously-fired and newly-fired alike). */
  fire: (businessDay: string, id: string, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_fireResponse>("/orders/{businessDay}/{id}/fire", { params: { businessDay, id }, ifMatch: options.ifMatch, idempotent: true }),

  /** `POST /orders/{businessDay}/{id}/lines` — Capture a line on an open order. — The newly captured line and the order it now belongs to. */
  addLine: (businessDay: string, id: string, body: S.AddOrderLineDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_addLineResponse>("/orders/{businessDay}/{id}/lines", { params: { businessDay, id }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `DELETE /orders/{businessDay}/{id}/lines/{lineId}` — Void a pre-fire line (the ordinary cashier correction). — The voided line and the order it belongs to. */
  voidLine: (businessDay: string, id: string, lineId: string, body: S.VoidOrderLineDto, options: { ifMatch?: string | number } = {}) =>
    http.delete<S.OrdersController_voidLineResponse>("/orders/{businessDay}/{id}/lines/{lineId}", { params: { businessDay, id, lineId }, body, ifMatch: options.ifMatch }),

  /** `POST /orders/{businessDay}/{id}/payments` — Capture a partial CASH or manual/external-card payment (full settlement is refused — Completion does not exist yet). — The newly captured Payment and the order it now belongs to (paidTotal/roundingAdjustment/state/version updated). */
  capturePayment: (businessDay: string, id: string, body: S.CapturePaymentDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_capturePaymentResponse>("/orders/{businessDay}/{id}/payments", { params: { businessDay, id }, body, ifMatch: options.ifMatch, idempotent: true }),

};

// ---------------------------------------------------------------------------
// organisation
// ---------------------------------------------------------------------------

export const organisation = {
  /** `GET /org/branches` — All branches in the tenant. */
  listBranches: () =>
    http.get<S.OrganisationController_listBranchesResponse>("/org/branches"),

  /** `POST /org/branches` — The newly created branch. */
  createBranch: (body: S.CreateBranchDto) =>
    http.post<S.OrganisationController_createBranchResponse>("/org/branches", { body }),

  /** `GET /org/branches/{branchId}` — The branch. */
  getBranch: (branchId: string) =>
    http.get<S.OrganisationController_getBranchResponse>("/org/branches/{branchId}", { params: { branchId } }),

  /** `PATCH /org/branches/{branchId}` — The updated branch. */
  updateBranch: (branchId: string, body: S.UpdateBranchDto) =>
    http.patch<S.OrganisationController_updateBranchResponse>("/org/branches/{branchId}", { params: { branchId }, body }),

  /** `POST /org/branches/{branchId}/brand` — Reassign a branch to another brand within the same tenant. — The updated branch. */
  reassignBranchBrand: (branchId: string, body: S.ReassignBrandDto) =>
    http.post<S.OrganisationController_reassignBranchBrandResponse>("/org/branches/{branchId}/brand", { params: { branchId }, body }),

  /** `GET /org/branches/{branchId}/operating-hours` — All operating-hours intervals for the branch. */
  listOperatingHours: (branchId: string) =>
    http.get<S.OrganisationController_listOperatingHoursResponse>("/org/branches/{branchId}/operating-hours", { params: { branchId } }),

  /** `POST /org/branches/{branchId}/operating-hours` — The newly created operating-hours interval. */
  createOperatingHours: (branchId: string, body: S.CreateOperatingHoursDto) =>
    http.post<S.OrganisationController_createOperatingHoursResponse>("/org/branches/{branchId}/operating-hours", { params: { branchId }, body }),

  /** `GET /org/branches/{branchId}/print-routing` — All print-routing rules for the branch. */
  listPrintRouting: (branchId: string) =>
    http.get<S.OrganisationController_listPrintRoutingResponse>("/org/branches/{branchId}/print-routing", { params: { branchId } }),

  /** `POST /org/branches/{branchId}/print-routing` — The newly created print-routing rule. */
  createPrintRouting: (branchId: string, body: S.CreatePrintRoutingDto) =>
    http.post<S.OrganisationController_createPrintRoutingResponse>("/org/branches/{branchId}/print-routing", { params: { branchId }, body }),

  /** `GET /org/branches/{branchId}/station-routing-rules` — All station-routing rules for the branch. */
  listStationRoutingRules: (branchId: string) =>
    http.get<S.OrganisationController_listStationRoutingRulesResponse>("/org/branches/{branchId}/station-routing-rules", { params: { branchId } }),

  /** `POST /org/branches/{branchId}/station-routing-rules` — The newly created station-routing rule. */
  createStationRoutingRule: (branchId: string, body: S.CreateStationRoutingRuleDto) =>
    http.post<S.OrganisationController_createStationRoutingRuleResponse>("/org/branches/{branchId}/station-routing-rules", { params: { branchId }, body }),

  /** `GET /org/branches/{branchId}/stations` — All stations in the branch. */
  listStations: (branchId: string) =>
    http.get<S.OrganisationController_listStationsResponse>("/org/branches/{branchId}/stations", { params: { branchId } }),

  /** `POST /org/branches/{branchId}/stations` — The newly created station. */
  createStation: (branchId: string, body: S.CreateStationDto) =>
    http.post<S.OrganisationController_createStationResponse>("/org/branches/{branchId}/stations", { params: { branchId }, body }),

  /** `POST /org/branches/{branchId}/status` — Set a branch active/inactive. — The updated branch. */
  setBranchStatus: (branchId: string, body: S.SetBranchStatusDto) =>
    http.post<S.OrganisationController_setBranchStatusResponse>("/org/branches/{branchId}/status", { params: { branchId }, body }),

  /** `GET /org/branches/{branchId}/tables` — All tables in the branch. */
  listTables: (branchId: string) =>
    http.get<S.OrganisationController_listTablesResponse>("/org/branches/{branchId}/tables", { params: { branchId } }),

  /** `POST /org/branches/{branchId}/tables` — The newly created table. */
  createTable: (branchId: string, body: S.CreateTableDto) =>
    http.post<S.OrganisationController_createTableResponse>("/org/branches/{branchId}/tables", { params: { branchId }, body }),

  /** `GET /org/brands` — All brands in the tenant. */
  listBrands: () =>
    http.get<S.OrganisationController_listBrandsResponse>("/org/brands"),

  /** `POST /org/brands` — The newly created brand. */
  createBrand: (body: S.CreateBrandDto) =>
    http.post<S.OrganisationController_createBrandResponse>("/org/brands", { body }),

  /** `GET /org/brands/{brandId}` — The brand. */
  getBrand: (brandId: string) =>
    http.get<S.OrganisationController_getBrandResponse>("/org/brands/{brandId}", { params: { brandId } }),

  /** `PATCH /org/brands/{brandId}` — The updated brand. */
  updateBrand: (brandId: string, body: S.UpdateBrandDto) =>
    http.patch<S.OrganisationController_updateBrandResponse>("/org/brands/{brandId}", { params: { brandId }, body }),

  /** `GET /org/central-kitchens` — All central kitchens in the tenant. */
  listCentralKitchens: () =>
    http.get<S.OrganisationController_listCentralKitchensResponse>("/org/central-kitchens"),

  /** `POST /org/central-kitchens` — The newly created central kitchen. */
  createCentralKitchen: (body: S.CreateCentralKitchenDto) =>
    http.post<S.OrganisationController_createCentralKitchenResponse>("/org/central-kitchens", { body }),

  /** `GET /org/central-kitchens/{centralKitchenId}` — The central kitchen. */
  getCentralKitchen: (centralKitchenId: string) =>
    http.get<S.OrganisationController_getCentralKitchenResponse>("/org/central-kitchens/{centralKitchenId}", { params: { centralKitchenId } }),

  /** `PATCH /org/central-kitchens/{centralKitchenId}` — The updated central kitchen. */
  updateCentralKitchen: (centralKitchenId: string, body: S.UpdateCentralKitchenDto) =>
    http.patch<S.OrganisationController_updateCentralKitchenResponse>("/org/central-kitchens/{centralKitchenId}", { params: { centralKitchenId }, body }),

  /** `GET /org/stations/{stationId}` — The station. */
  getStation: (stationId: string) =>
    http.get<S.OrganisationController_getStationResponse>("/org/stations/{stationId}", { params: { stationId } }),

  /** `PATCH /org/stations/{stationId}` — The updated station. */
  updateStation: (stationId: string, body: S.UpdateStationDto) =>
    http.patch<S.OrganisationController_updateStationResponse>("/org/stations/{stationId}", { params: { stationId }, body }),

  /** `PATCH /org/tables/{tableId}` — The updated table. */
  updateTable: (tableId: string, body: S.UpdateTableDto) =>
    http.patch<S.OrganisationController_updateTableResponse>("/org/tables/{tableId}", { params: { tableId }, body }),

  /** `GET /org/warehouses` — All warehouses in the tenant. */
  listWarehouses: () =>
    http.get<S.OrganisationController_listWarehousesResponse>("/org/warehouses"),

  /** `POST /org/warehouses` — The newly created warehouse. */
  createWarehouse: (body: S.CreateWarehouseDto) =>
    http.post<S.OrganisationController_createWarehouseResponse>("/org/warehouses", { body }),

  /** `GET /org/warehouses/{warehouseId}` — The warehouse. */
  getWarehouse: (warehouseId: string) =>
    http.get<S.OrganisationController_getWarehouseResponse>("/org/warehouses/{warehouseId}", { params: { warehouseId } }),

  /** `PATCH /org/warehouses/{warehouseId}` — The updated warehouse. */
  updateWarehouse: (warehouseId: string, body: S.UpdateWarehouseDto) =>
    http.patch<S.OrganisationController_updateWarehouseResponse>("/org/warehouses/{warehouseId}", { params: { warehouseId }, body }),

};

// ---------------------------------------------------------------------------
// production
// ---------------------------------------------------------------------------

export const production = {
  /** `GET /recipes` — List recipes, optionally filtered by type. — Recipes visible to this tenant. */
  listRecipes: (options: { recipeType?: string } = {}) =>
    http.get<S.ProductionController_listRecipesResponse>("/recipes", { query: { recipeType: options.recipeType } }),

  /** `POST /recipes` — The newly created recipe. */
  createRecipe: (body: S.CreateRecipeDto) =>
    http.post<S.ProductionController_createRecipeResponse>("/recipes", { body }),

  /** `GET /recipes/requiring-completion` — The BR-MNU-012 completeness report. */
  recipesRequiringCompletion: (options: { branchId?: string } = {}) =>
    http.get<S.ProductionController_recipesRequiringCompletionResponse>("/recipes/requiring-completion", { query: { branchId: options.branchId } }),

  /** `GET /recipes/{recipeId}/versions` — Version history, newest first, each with its lines. */
  listVersions: (recipeId: string) =>
    http.get<S.ProductionController_listVersionsResponse>("/recipes/{recipeId}/versions", { params: { recipeId } }),

  /** `POST /recipes/{recipeId}/versions` — SRS §26.3 — create a draft version. A recipe is NEVER auto-created here (GAP-1): an unknown id is a 404. — The newly created draft version. */
  createVersion: (recipeId: string, body: S.CreateRecipeVersionDto) =>
    http.post<S.ProductionController_createVersionResponse>("/recipes/{recipeId}/versions", { params: { recipeId }, body }),

  /** `PUT /recipes/{recipeId}/versions/{version}/lines` — Replace a draft version's lines. Published versions are refused (409). — The version row (raw, not the view shape) plus the new line count. */
  replaceLines: (recipeId: string, version: string, body: S.ReplaceRecipeLinesDto) =>
    http.put<S.ProductionController_replaceLinesResponse>("/recipes/{recipeId}/versions/{version}/lines", { params: { recipeId, version }, body }),

  /** `POST /recipes/{recipeId}/versions/{version}/publish` — SRS §26.3 — publish. Demotes the incumbent, promotes the target, one txn. — The now-published version, plus the id of the version it superseded (if any). */
  publish: (recipeId: string, version: string) =>
    http.post<S.ProductionController_publishResponse>("/recipes/{recipeId}/versions/{version}/publish", { params: { recipeId, version } }),

  /** `GET /substitute-groups` — List substitute groups. — Substitute groups with their member stock items. */
  listGroups: () =>
    http.get<S.ProductionController_listGroupsResponse>("/substitute-groups"),

  /** `POST /substitute-groups` — Create a substitute group, optionally seeded with member stock items. — The newly created substitute group. */
  createGroup: (body: S.CreateSubstituteGroupDto) =>
    http.post<S.ProductionController_createGroupResponse>("/substitute-groups", { body }),

  /** `POST /substitute-groups/{groupId}/members` — Add a stock item to a substitute group. — The newly created membership row. */
  addGroupMember: (groupId: string, body: S.AddSubstituteMemberDto) =>
    http.post<S.ProductionController_addGroupMemberResponse>("/substitute-groups/{groupId}/members", { params: { groupId }, body }),

};

/** Every group, for the diagnostics screen and for `api.catalogue.listItems()` style calls. */
export const api = { auth, rbac, password, tenants, terminals, treasury, catalogue, health, inventory, sales, organisation, production };
