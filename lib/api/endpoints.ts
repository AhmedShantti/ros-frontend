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

  /** `POST /auth/registrations` — Tenant self-service signup (FR-PLT-020). Creates a first user, a tenant, a working branch, and an Owner role with the full permission catalog, atomically. Returns a tenant-scoped auth result so the caller can enter the dashboard immediately. Supports roleKey "owner" only in this slice. — Tenant created; tenant-scoped access token issued. */
  register: (body: S.RegisterTenantDto) =>
    http.post<S.RegistrationsController_registerResponse>("/auth/registrations", { body }),

};

// ---------------------------------------------------------------------------
// rbac
// ---------------------------------------------------------------------------

export const rbac = {
  /** `GET /auth/memberships/{membershipId}/roles` — A membership's scoped role assignments, including expired ones. — Assignments, oldest first. */
  listAssignments: (membershipId: string) =>
    http.get<S.RbacController_listAssignmentsResponse>("/auth/memberships/{membershipId}/roles", { params: { membershipId } }),

  /** `POST /auth/memberships/{membershipId}/roles` — Assign a role to a membership at an EXPLICIT scope (tenant, brand or branch). — The created assignment. */
  assignRole: (membershipId: string, body: S.AssignRoleDto) =>
    http.post<S.RbacController_assignRoleResponse>("/auth/memberships/{membershipId}/roles", { params: { membershipId }, body }),

  /** `DELETE /auth/memberships/{membershipId}/roles/{roleId}` — DEPRECATED — remove a role from a membership by role id. — Role removed (or already absent). */
  removeRole: (membershipId: string, roleId: string) =>
    http.delete<S.RbacController_removeRoleResponse>("/auth/memberships/{membershipId}/roles/{roleId}", { params: { membershipId, roleId } }),

  /** `GET /auth/permissions` — The caller's effective, scope-qualified authority (presentation only). — Tenant-scoped permission codes, every scoped grant, the symbolic permitted-branch set, the live authorization epoch, and whether inherited-scope review is still outstanding. */
  myPermissions: () =>
    http.get<S.RbacController_myPermissionsResponse>("/auth/permissions"),

  /** `PATCH /auth/role-assignments/{assignmentId}` — Re-scope an assignment and/or change its validity window. — The updated assignment. */
  updateAssignment: (assignmentId: string, body: S.UpdateAssignmentDto) =>
    http.patch<S.RbacController_updateAssignmentResponse>("/auth/role-assignments/{assignmentId}", { params: { assignmentId }, body }),

  /** `DELETE /auth/role-assignments/{assignmentId}` — Remove ONE scoped assignment by its stable id. — Assignment removed. */
  removeAssignment: (assignmentId: string) =>
    http.delete<S.RbacController_removeAssignmentResponse>("/auth/role-assignments/{assignmentId}", { params: { assignmentId } }),

  /** `POST /auth/role-assignments/{assignmentId}/review` — Explicitly review an INHERITED (migration-originated) tenant-wide assignment. — The reviewed assignment. */
  reviewAssignment: (assignmentId: string) =>
    http.post<S.RbacController_reviewAssignmentResponse>("/auth/role-assignments/{assignmentId}/review", { params: { assignmentId } }),

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
  /** `POST /branches/{branchId}/cash-close-policy` — Create a new immutable cash-close policy version for a branch — R-1(a), R-4(a), R-5. `Idempotency-Key` is MANDATORY (FR-API-020): a retry over a flaky link must not produce a second version. — The newly created cash-close policy version. */
  createPolicy: (branchId: string, body: S.CreateCashClosePolicyDto) =>
    http.post<S.CashClosePolicyController_createPolicyResponse>("/branches/{branchId}/cash-close-policy", { params: { branchId }, body, idempotent: true }),

  /** `GET /branches/{branchId}/day-closes/{businessDay}` — Retrieve a historical DayClose / Z (persisted records only). — The persisted Z snapshot. */
  getDayClose: (branchId: string, businessDay: string) =>
    http.get<S.DayCloseController_getResponse>("/branches/{branchId}/day-closes/{businessDay}", { params: { branchId, businessDay } }),

  /** `POST /branches/{branchId}/day-closes/{businessDay}` — Close a business day, or — on the branch’s first ever DayClose request — activate the branch’s DayClose epoch. — ACTIVATED (no day sealed) or CLOSED (with the Z snapshot). Never 409 for a successful activation. */
  postDayClose: (branchId: string, businessDay: string, body: S.PostDayCloseDto) =>
    http.post<S.DayCloseController_postResponse>("/branches/{branchId}/day-closes/{businessDay}", { params: { branchId, businessDay }, body, idempotent: true }),

  /** `POST /cash-sessions` — Open a cashier shift and its cash session — FR-POS-090, FR-FIN-001/002. ONE command for the cashier, two records for the model. FR-POS-090 describes a single action ("open a shift, declaring an opening float"), and the cashier should not have to know that a shift is a Workforce concept and a session a Treasury one. They stay distinct in the schema (carried item P1D-A); only the command is unified, and both are written in one transaction. `Idempotency-Key` is MANDATORY (FR-API-020): opening a drawer is a financially significant act, and a retry over a flaky link must not produce a second shift or a second session. The two client ULIDs are independent duplicate protection beneath it. — The opened cash session and its shift, plus whether this call created them (false on an idempotent replay of an already-open pair). */
  openCashSession: (body: S.OpenCashSessionDto) =>
    http.post<S.TreasuryController_openCashSessionResponse>("/cash-sessions", { body, idempotent: true }),

  /** `POST /cash-sessions/{sessionId}/close` — Declare the physical cash count — FR-POS-094/096/097 [M]. Within tolerance, this closes the session in the SAME request. Above tolerance, it freezes the session (`open -> closing`) and the disclosed figures in THIS response are the first and only legitimate disclosure — FR-POS-095's blind-count control is that expected cash/variance are revealed strictly AFTER the count is durably committed, never before. `POST .../close/finalize` is the ONLY way out of `closing` — there is no above-tolerance one-request path (a manager PIN entered before this response exists could not be an informed decision). — The committed count declaration — closed immediately if within tolerance, otherwise frozen awaiting a manager decision. */
  declareClose: (sessionId: string, body: S.DeclareCashSessionCloseDto) =>
    http.post<S.TreasuryController_declareCloseResponse>("/cash-sessions/{sessionId}/close", { params: { sessionId }, body, idempotent: true }),

  /** `GET /cash-sessions/{sessionId}/close-context` — The close context — FR-POS-094/095. Read-only. `cash.session.close` (own) / `cash.session.close_other` (another employee's) — the SAME own/other split `declareClose`/`finalizeClose` enforce, checked here too so a caller cannot probe another employee's session state without holding the right authority. While `open` in BLIND mode (FR-POS-095's default), `toleranceMinorUnits`/ `expectedCashMinorUnits` are structurally ABSENT from the response — never merely `null` — until a count is durably declared. While `open` in open-count mode, they are a PREVIEW only (not authoritative — the actual close re-resolves everything fresh, under the advisory lock). — The close context for this cash session. */
  getCloseContext: (sessionId: string) =>
    http.get<S.TreasuryController_getCloseContextResponse>("/cash-sessions/{sessionId}/close-context", { params: { sessionId } }),

  /** `POST /cash-sessions/{sessionId}/close/finalize` — The manager's decision on a frozen (above-tolerance) close — FR-FIN-006 [M], FR-SEC-016/030/032/033. The manager PIN is verified BEFORE the business transaction opens (`identity/contract`'s `TERMINAL_PIN_VERIFIER` — a failed-attempt/ lockout counter must survive a later rollback, and never runs at all on an idempotent replay). The verified manager's permission set — not the calling cashier's — is what `cash.variance.approve` is checked against, by the Approval Runtime itself, never by a route-level permission guard (the approver is a different actor than the caller). R-6(a): an explicit REJECTED decision COMMITS and returns 200 with `outcome: "rejected"` — never an error. The session stays `closing`; a retry supplies FRESH `approvalRequestId`/`approvalDecisionId` values. — The manager decision outcome — "closed" (approved) or "rejected" (R-6(a); the session remains closing). */
  finalizeClose: (sessionId: string, body: S.FinalizeCashSessionCloseDto) =>
    http.post<S.TreasuryController_finalizeCloseResponse>("/cash-sessions/{sessionId}/close/finalize", { params: { sessionId }, body, idempotent: true }),

  /** `POST /cash-sessions/{sessionId}/pay-in` — Record cash added to the drawer — FR-POS-091 [M]. — The recorded pay-in movement. */
  payIn: (sessionId: string, body: S.CashMovementDto) =>
    http.post<S.TreasuryController_payInResponse>("/cash-sessions/{sessionId}/pay-in", { params: { sessionId }, body, idempotent: true }),

  /** `POST /cash-sessions/{sessionId}/pay-out` — Record cash removed from the drawer for an expense — FR-POS-091 [M]. — The recorded pay-out movement. */
  payOut: (sessionId: string, body: S.CashMovementDto) =>
    http.post<S.TreasuryController_payOutResponse>("/cash-sessions/{sessionId}/pay-out", { params: { sessionId }, body, idempotent: true }),

  /** `POST /cash-sessions/{sessionId}/safe-drop` — Record excess cash removed to the safe — FR-POS-091 [M]. — The recorded safe-drop movement. */
  safeDrop: (sessionId: string, body: S.CashMovementDto) =>
    http.post<S.TreasuryController_safeDropResponse>("/cash-sessions/{sessionId}/safe-drop", { params: { sessionId }, body, idempotent: true }),

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
// governance
// ---------------------------------------------------------------------------

export const governance = {
  /** `GET /governance/audit/entries` — Search/filter the tenant audit log (FR-AUD-008). Requires audit.view. — A page of audit entries, most recent first. */
  search: (options: { dateFrom?: string; dateTo?: string; cursor?: string; limit?: number; branchId?: string; actorId?: string; entityType?: string; entityId?: string; action?: string; correlationId?: string } = {}) =>
    http.get<S.AuditQueryController_searchResponse>("/governance/audit/entries", { query: { dateFrom: options.dateFrom, dateTo: options.dateTo, cursor: options.cursor, limit: options.limit, branchId: options.branchId, actorId: options.actorId, entityType: options.entityType, entityId: options.entityId, action: options.action, correlationId: options.correlationId } }),

  /** `GET /governance/audit/entries/export` — Export the tenant audit log (FR-AUD-008). Requires audit.view AND report.export. — The complete, bounded set of matching audit entries. */
  exportEntries: (options: { dateFrom?: string; dateTo?: string; branchId?: string; actorId?: string; entityType?: string; entityId?: string; action?: string; correlationId?: string } = {}) =>
    http.get<S.AuditQueryController_exportEntriesResponse>("/governance/audit/entries/export", { query: { dateFrom: options.dateFrom, dateTo: options.dateTo, branchId: options.branchId, actorId: options.actorId, entityType: options.entityType, entityId: options.entityId, action: options.action, correlationId: options.correlationId } }),

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
// kitchen
// ---------------------------------------------------------------------------

export const kitchen = {
  /** `GET /kds/stations/{stationId}/queue` — Read a KDS station queue (FIFO, read-only). — The station queue and branch KDS config facts. */
  getStationQueue: (stationId: string, options: { sort?: "fifo" } = {}) =>
    http.get<S.KitchenController_getStationQueueResponse>("/kds/stations/{stationId}/queue", { params: { stationId }, query: { sort: options.sort } }),

  /** `POST /kds/stations/{stationId}/tickets/view` — Acknowledge tickets as first-viewed on this station. — Count of newly-acknowledged tickets. */
  acknowledgeViewed: (stationId: string, body: S.AcknowledgeViewedDto) =>
    http.post<S.KitchenController_acknowledgeViewedResponse>("/kds/stations/{stationId}/tickets/view", { params: { stationId }, body, idempotent: true }),

  /** `POST /kds/tickets/{ticketId}/bump-all` — Mark every eligible line on a ticket ready (bump all). — The updated ticket and the ids of lines this action bumped. */
  bumpAll: (ticketId: string) =>
    http.post<S.KitchenController_bumpAllResponse>("/kds/tickets/{ticketId}/bump-all", { params: { ticketId } }),

  /** `POST /kds/tickets/{ticketId}/lines/{lineId}/bump` — Mark a ticket line ready (bump item). — The updated ticket and line. */
  bumpLine: (ticketId: string, lineId: string) =>
    http.post<S.KitchenController_bumpLineResponse>("/kds/tickets/{ticketId}/lines/{lineId}/bump", { params: { ticketId, lineId } }),

  /** `POST /kds/tickets/{ticketId}/lines/{lineId}/start` — Mark a ticket line started. — The updated ticket and line. */
  startLine: (ticketId: string, lineId: string) =>
    http.post<S.KitchenController_startLineResponse>("/kds/tickets/{ticketId}/lines/{lineId}/start", { params: { ticketId, lineId } }),

  /** `POST /kds/tickets/{ticketId}/recall` — Recall a bumped ticket back to active work. — The recalled ticket. */
  recall: (ticketId: string) =>
    http.post<S.KitchenController_recallResponse>("/kds/tickets/{ticketId}/recall", { params: { ticketId }, idempotent: true }),

};

// ---------------------------------------------------------------------------
// production
// ---------------------------------------------------------------------------

export const production = {
  /** `GET /modifiers/{modifierId}/recipe-effects` — The modifier's recipe effects, in sequence order. */
  listModifierRecipeEffects: (modifierId: string) =>
    http.get<S.ProductionController_listModifierRecipeEffectsResponse>("/modifiers/{modifierId}/recipe-effects", { params: { modifierId } }),

  /** `PUT /modifiers/{modifierId}/recipe-effects` — Full replace, shaped like `PUT /recipes/:id/versions/:v/lines`. — The replaced set of recipe effects. */
  replaceModifierRecipeEffects: (modifierId: string, body: S.ReplaceModifierRecipeEffectsDto) =>
    http.put<S.ProductionController_replaceModifierRecipeEffectsResponse>("/modifiers/{modifierId}/recipe-effects", { params: { modifierId }, body }),

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

  /** `POST /orders/{businessDay}/{id}/discount` — Apply an order-level discount. — The order with its new discount applied. */
  applyOrderDiscount: (businessDay: string, id: string, body: S.ApplyDiscountDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_applyOrderDiscountResponse>("/orders/{businessDay}/{id}/discount", { params: { businessDay, id }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `POST /orders/{businessDay}/{id}/fire` — Fire eligible pending lines to production (explicit MVP Fire — no auto-Fire). — The order after Fire, including every line (previously-fired and newly-fired alike). */
  fire: (businessDay: string, id: string, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_fireResponse>("/orders/{businessDay}/{id}/fire", { params: { businessDay, id }, ifMatch: options.ifMatch, idempotent: true }),

  /** `POST /orders/{businessDay}/{id}/lines` — Capture a line on an open order. — The newly captured line and the order it now belongs to. */
  addLine: (businessDay: string, id: string, body: S.AddOrderLineDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_addLineResponse>("/orders/{businessDay}/{id}/lines", { params: { businessDay, id }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `DELETE /orders/{businessDay}/{id}/lines/{lineId}` — Void a pre-fire line (the ordinary cashier correction). — The voided line and the order it belongs to. */
  voidLine: (businessDay: string, id: string, lineId: string, body: S.VoidOrderLineDto, options: { ifMatch?: string | number } = {}) =>
    http.delete<S.OrdersController_voidLineResponse>("/orders/{businessDay}/{id}/lines/{lineId}", { params: { businessDay, id, lineId }, body, ifMatch: options.ifMatch }),

  /** `POST /orders/{businessDay}/{id}/lines/{lineId}/comp` — Give a complimentary item (comp). — The comped line and the order it belongs to. */
  applyComp: (businessDay: string, id: string, lineId: string, body: S.ApplyCompDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_applyCompResponse>("/orders/{businessDay}/{id}/lines/{lineId}/comp", { params: { businessDay, id, lineId }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `POST /orders/{businessDay}/{id}/lines/{lineId}/discount` — Apply a line-level discount. — The discounted line and the order it belongs to. */
  applyLineDiscount: (businessDay: string, id: string, lineId: string, body: S.ApplyDiscountDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_applyLineDiscountResponse>("/orders/{businessDay}/{id}/lines/{lineId}/discount", { params: { businessDay, id, lineId }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `POST /orders/{businessDay}/{id}/lines/{lineId}/void-postfire` — Void a post-fire line, with mandatory disposition. — The voided line, the order, and the disposition record. */
  voidLinePostFire: (businessDay: string, id: string, lineId: string, body: S.VoidOrderLinePostFireDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_voidLinePostFireResponse>("/orders/{businessDay}/{id}/lines/{lineId}/void-postfire", { params: { businessDay, id, lineId }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `POST /orders/{businessDay}/{id}/payments` — Capture a partial, or final settling, CASH or manual/external-card payment. A settling payment completes the order atomically. — The newly captured Payment and the order it now belongs to (paidTotal/roundingAdjustment/state/version updated). */
  capturePayment: (businessDay: string, id: string, body: S.CapturePaymentDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_capturePaymentResponse>("/orders/{businessDay}/{id}/payments", { params: { businessDay, id }, body, ifMatch: options.ifMatch, idempotent: true }),

  /** `GET /orders/{businessDay}/{id}/receipt` — An itemized, INTERNAL, NON-FISCAL receipt for a completed order. — The non-fiscal receipt document. Available only once the order is completed. */
  receipt: (businessDay: string, id: string) =>
    http.get<S.OrdersController_receiptResponse>("/orders/{businessDay}/{id}/receipt", { params: { businessDay, id } }),

  /** `POST /orders/{businessDay}/{id}/refunds` — Issue a refund against a completed order. — The new Refund and the order it was issued against. */
  issueRefund: (businessDay: string, id: string, body: S.IssueRefundDto, options: { ifMatch?: string | number } = {}) =>
    http.post<S.OrdersController_issueRefundResponse>("/orders/{businessDay}/{id}/refunds", { params: { businessDay, id }, body, ifMatch: options.ifMatch, idempotent: true }),

};

// ---------------------------------------------------------------------------
// organisation
// ---------------------------------------------------------------------------

export const organisation = {
  /** `GET /org/access` — The caller's live, authorized brands and branches (frontend discovery). — Brands and branches visible under the current, live scoped authority. */
  getAccessibleScope: () =>
    http.get<S.OrganisationController_getAccessibleScopeResponse>("/org/access"),

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
// reporting
// ---------------------------------------------------------------------------

export const reporting = {
  /** `GET /reports/branches/{branchId}/daily-trading/{businessDay}` — Branch daily-trading report (dashboard-only; authorized against the branch it names). — The daily-trading report: salesSummary, tenderTotals (incl. completedExcessCapturedTotal), taxSummary, cashReconciliation (WHOLE_SESSION scope), dataAsOf, periodStatus (OPEN/UNSEALED/SETTLED — no SEALED, no FUTURE), currency/currencySource, and a scope block disclosing exactly what this Internal-MVP slice does and does not cover. */
  getDailyTradingReport: (branchId: string, businessDay: string) =>
    http.get<S.ReportingController_getDailyTradingReportResponse>("/reports/branches/{branchId}/daily-trading/{businessDay}", { params: { branchId, businessDay } }),

  /** `GET /reports/branches/{branchId}/overview` — Branch operational overview — sales, cash, inventory, workforce, kds (dashboard-only; authorized against the branch it names). — The operational overview: sales, cash (WHOLE_SESSION scope, unchanged from daily-trading), inventory (branch-scoped low-stock count + calendar-day waste), workforce (branch-scoped calendar-day attendance summary), kds (business-day ticket counts + real prep duration where measurable), and a scope block disclosing exactly what this Demo/Operational slice does and does not cover. */
  getOperationalOverview: (branchId: string, options: { businessDay?: string } = {}) =>
    http.get<S.ReportingController_getOperationalOverviewResponse>("/reports/branches/{branchId}/overview", { params: { branchId }, query: { businessDay: options.businessDay } }),

};

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

export const sync = {
  /** `POST /v1/sync/batch` — Upload a batch of offline operations — Per-operation results. Always 200 for a well-formed authorised batch, whatever the individual outcomes. */
  uploadBatch_v1: (body: S.SyncBatchDto) =>
    http.post<S.SyncController_uploadBatch_v1Response>("/v1/sync/batch", { body }),

  /** `POST /v1/sync/recovery/grants` — Authorize a bounded, one-shot recovery upload window for a disabled or revoked terminal's committed offline backlog (D1-1 GD-D1-07). — The recovery grant. */
  issueGrant_v1: (body: S.IssueRecoveryGrantDto) =>
    http.post<S.SyncRecoveryController_issueGrant_v1Response>("/v1/sync/recovery/grants", { body }),

  /** `POST /v1/sync/recovery/{grantId}/batch` — Upload one batch of a revoked terminal's committed offline backlog, authenticated as the admin who holds (or was granted) recovery authority for it — never as the terminal itself (see the service docblock for why). — Per-operation results — identical shape to ordinary sync. */
  uploadRecoveryBatch_v1: (grantId: string, body: S.SyncBatchDto) =>
    http.post<S.SyncRecoveryController_uploadRecoveryBatch_v1Response>("/v1/sync/recovery/{grantId}/batch", { params: { grantId }, body }),

};

// ---------------------------------------------------------------------------
// workforce-attendance
// ---------------------------------------------------------------------------

export const workforceAttendance = {
  /** `POST /workforce/attendance/clock-in` — FR-HRM-020/021/022/023 — POS-terminal PIN clock-in. NO `@RequirePermission`: the caller acts on their OWN employment record via a PIN-verified POS session, never on an RBAC grant — every active employee must be able to clock themselves in regardless of what else they are permitted to do. §15.2's Workforce catalogue has no "clock in" verb to invent one from. See `REVIEWED_UNPROTECTED_ROUTES` in `authorization-coverage.spec.ts`. */
  clockIn: (body: S.ClockInDto) =>
    http.post<S.AttendanceController_clockInResponse>("/workforce/attendance/clock-in", { body }),

  /** `POST /workforce/attendance/clock-out` — FR-HRM-020/021/022 — POS-terminal PIN clock-out. Same authority as clock-in. */
  clockOut: (body: S.ClockOutDto) =>
    http.post<S.AttendanceController_clockOutResponse>("/workforce/attendance/clock-out", { body }),

  /** `POST /workforce/attendance/settings` — FR-HRM-022/023 threshold configuration — a NEW effective-dated version. `settings.branch.manage` ("Branch configuration"), NOT an HR code: the exact `treasury/cash-close-policy` precedent for reusing this already-seeded Organisation permission for a new per-branch policy table, declared as a plain string literal to avoid a new `workforce->organisation` private-path import. */
  setSettings: (body: S.SetAttendanceSettingsDto) =>
    http.post<S.AttendanceController_setSettingsResponse>("/workforce/attendance/settings", { body }),

  /** `GET /workforce/attendance/{attendanceRecordId}` */
  getAttendance: (attendanceRecordId: string) =>
    http.get<S.AttendanceController_getResponse>("/workforce/attendance/{attendanceRecordId}", { params: { attendanceRecordId } }),

  /** `POST /workforce/attendance/{attendanceRecordId}/correct` — FR-HRM-025 — manual correction: permission-gated, reasoned, evidenced. */
  correct: (attendanceRecordId: string, body: S.CorrectAttendanceDto) =>
    http.post<S.AttendanceController_correctResponse>("/workforce/attendance/{attendanceRecordId}/correct", { params: { attendanceRecordId }, body }),

};

// ---------------------------------------------------------------------------
// workforce-employees
// ---------------------------------------------------------------------------

export const workforceEmployees = {
  /** `GET /workforce/employees` */
  list: (options: { branchId?: string } = {}) =>
    http.get<S.EmployeesController_listResponse>("/workforce/employees", { query: { branchId: options.branchId } }),

  /** `POST /workforce/employees` — FR-HRM-001/002/005 — create a full employee record. */
  create: (body: S.CreateEmployeeDto) =>
    http.post<S.EmployeesController_createResponse>("/workforce/employees", { body }),

  /** `GET /workforce/employees/{employeeId}` */
  getEmployees: (employeeId: string) =>
    http.get<S.EmployeesController_getResponse>("/workforce/employees/{employeeId}", { params: { employeeId } }),

  /** `PATCH /workforce/employees/{employeeId}` */
  update: (employeeId: string, body: S.UpdateEmployeeDto) =>
    http.patch<S.EmployeesController_updateResponse>("/workforce/employees/{employeeId}", { params: { employeeId }, body }),

  /** `POST /workforce/employees/{employeeId}/branches` — FR-HRM-005 — multi-branch assignment. */
  addBranch: (employeeId: string, body: S.AddPermittedBranchDto) =>
    http.post<S.EmployeesController_addBranchResponse>("/workforce/employees/{employeeId}/branches", { params: { employeeId }, body }),

  /** `GET /workforce/employees/{employeeId}/compensation` — FR-HRM-003 — restricted to `hr.compensation.view` holders only. — The current compensation version, or null if none has ever been set. */
  currentCompensation: (employeeId: string) =>
    http.get<S.EmployeesController_currentCompensationResponse>("/workforce/employees/{employeeId}/compensation", { params: { employeeId } }),

  /** `POST /workforce/employees/{employeeId}/compensation` — FR-HRM-003 — a new effective-dated version. No `hr.compensation.manage` code exists in §15.2 (only `.view`); writing pay is therefore gated on `hr.employee.manage`, the same "no write verb given" discipline `SALES_PERMISSIONS` documents for `pos.order.create`. */
  setCompensation: (employeeId: string, body: S.SetCompensationDto) =>
    http.post<S.EmployeesController_setCompensationResponse>("/workforce/employees/{employeeId}/compensation", { params: { employeeId }, body }),

  /** `POST /workforce/employees/{employeeId}/deactivate` — FR-HRM-006 — deactivate, never hard-delete. */
  deactivate: (employeeId: string, body: S.DeactivateEmployeeDto) =>
    http.post<S.EmployeesController_deactivateResponse>("/workforce/employees/{employeeId}/deactivate", { params: { employeeId }, body }),

  /** `POST /workforce/employees/{employeeId}/pin` — LIVE-DEMO-HOTFIX-1 — set/rotate this employee's POS PIN through the real Workforce Employees surface. Thin passthrough to the existing `PinService.setPin` (identity/employees) — no logic duplicated here, and `PinService.authenticate`'s verification path is completely untouched. */
  setPin: (employeeId: string, body: S.SetEmployeePinDto) =>
    http.post<S.EmployeesController_setPinResponse>("/workforce/employees/{employeeId}/pin", { params: { employeeId }, body }),

};

// ---------------------------------------------------------------------------
// workforce-schedules
// ---------------------------------------------------------------------------

export const workforceSchedules = {
  /** `POST /workforce/schedules` — FR-HRM-010 — create a schedule by branch and week. */
  create: (body: S.CreateScheduleDto) =>
    http.post<S.ScheduleController_createResponse>("/workforce/schedules", { body }),

  /** `GET /workforce/schedules/{scheduleId}` */
  getSchedule: (scheduleId: string) =>
    http.get<S.ScheduleController_getResponse>("/workforce/schedules/{scheduleId}", { params: { scheduleId } }),

  /** `POST /workforce/schedules/{scheduleId}/shifts` — FR-HRM-010/012 — create one validated scheduled shift. */
  createShift: (scheduleId: string, body: S.CreateScheduledShiftDto) =>
    http.post<S.ScheduleController_createShiftResponse>("/workforce/schedules/{scheduleId}/shifts", { params: { scheduleId }, body }),

};

/** Every group, for the diagnostics screen and for `api.catalogue.listItems()` style calls. */
export const api = { auth, rbac, password, tenants, terminals, treasury, catalogue, governance, health, inventory, kitchen, production, sales, organisation, reporting, sync, workforceAttendance, workforceEmployees, workforceSchedules };
