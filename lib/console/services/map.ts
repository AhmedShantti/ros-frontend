/**
 * Wire shapes → domain model.
 *
 * The backend and this console do not describe a restaurant the same way,
 * and pretending otherwise is how a UI ends up rendering `[object Object]`
 * in a price column. Three differences account for most of this file:
 *
 *  1. **Names.** `/org/*` sends one plain string; `/catalogue/*` and
 *     `/inventory/*` send an open `{ en, ar, … }` map. The console wants a
 *     `Localised` either way, and falls back to the other language rather
 *     than showing an empty cell (FR-LOC-007).
 *
 *  2. **Money.** The API carries exact decimal strings — "12.500" — because
 *     a float cannot price a sale (BR-CORE-003). The console carries minor
 *     units plus a currency. The conversion here is string arithmetic; it
 *     never goes near `parseFloat` for the fractional part.
 *
 *  3. **Absent fields.** The backend is younger than the SRS the UI was
 *     built against. Where it has nothing to say — a branch's seat count, a
 *     stock item's landed cost, a table's live state — the mapper fills a
 *     documented neutral value rather than inventing a plausible one. Every
 *     such spot is marked `// gap:` and listed in BACKEND_INTEGRATION.md.
 */

import type { ModifierRecipeEffect } from "./types";

import type {
  ActorType,
  AuditEntry,
  Batch,
  Branch,
  Brand,
  CatalogueCompleteness,
  CentralKitchen,
  CountLine,
  CountSession,
  CountryCode,
  Currency,
  DayClose,
  Employee,
  EmployeeStatus,
  EmploymentType,
  Id,
  IsoDate,
  KitchenTicket,
  Localised,
  Menu,
  MenuCategory,
  MenuItem,
  MenuItemVariant,
  MenuResolution,
  Modifier,
  ModifierGroup,
  ModifierKind,
  Money,
  Order,
  OrderLine,
  OrderLineState,
  OrderType,
  PriceList,
  PriceListEntry,
  Quantity,
  Recipe,
  RecipeLine,
  RestaurantTable,
  Role,
  StationType,
  Station,
  StockItem,
  StockLevel,
  StockLocation,
  StockMovement,
  TaxClassCode,
  TaxSummaryRow,
  TenderSummaryRow,
  Tenant,
  Terminal,
  TicketLine,
  TicketState,
  TicketUrgency,
  UnitCode,
  Warehouse,
  WasteRecord,
} from "../types";
import type * as S from "@/lib/api/schema";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const EMPTY: Localised = { en: "", ar: "" };

/**
 * Accepts either form the API uses. An unlabelled string is shown in both
 * languages — better a name the reader can act on than a blank in one of them.
 */
export function localised(value: unknown, fallback: Localised = EMPTY): Localised {
  if (value === null || value === undefined) return fallback;

  if (typeof value === "string") {
    return value.trim() ? { en: value, ar: value } : fallback;
  }

  if (typeof value === "object") {
    const map = value as Record<string, unknown>;
    const en = typeof map.en === "string" ? map.en : "";
    const ar = typeof map.ar === "string" ? map.ar : "";
    if (!en && !ar) {
      // Some other locale key, or a shape we do not know. Take the first
      // string in the object rather than render nothing.
      const first = Object.values(map).find((v) => typeof v === "string" && v.trim());
      if (typeof first === "string") return { en: first, ar: first };
      return fallback;
    }
    return { en: en || ar, ar: ar || en };
  }

  return fallback;
}

/** The reverse, for request bodies that take a localised map. */
export function toNameMap(value: Localised | string | undefined): Record<string, string> {
  if (!value) return { en: "", ar: "" };
  if (typeof value === "string") return { en: value, ar: value };
  return { en: value.en, ar: value.ar || value.en };
}

/** `/org/*` create and update DTOs take a single string. */
export function toPlainName(value: Localised | string | undefined, fallback = ""): string {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value.en || value.ar || fallback;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

const SUPPORTED_CURRENCIES: Currency[] = ["EGP", "SAR", "AED"];

/**
 * The tenant's currency, learned at sign-in from `/auth/tenants`. Rows that
 * carry no currency of their own are denominated in it — a branch total in
 * the wrong symbol is worse than a slightly late one.
 */
let defaultCurrency: Currency = "EGP";

export function setDefaultCurrency(code: string | null | undefined): void {
  const resolved = currencyOf(code, null);
  if (resolved) defaultCurrency = resolved;
}

export function getDefaultCurrency(): Currency {
  return defaultCurrency;
}

export function currencyOf(code: string | null | undefined): Currency;
export function currencyOf(code: string | null | undefined, fallback: null): Currency | null;
export function currencyOf(
  code: string | null | undefined,
  fallback: Currency | null = defaultCurrency,
): Currency | null {
  const upper = (code ?? "").toUpperCase();
  return (SUPPORTED_CURRENCIES as string[]).includes(upper) ? (upper as Currency) : fallback;
}

/**
 * "12.5" → 1250. String arithmetic on the fraction, so 0.1 + 0.2 never
 * enters into it. All three supported currencies have two minor digits.
 */
export function minorUnits(decimal: string | number | null | undefined, exponent = 2): number {
  if (decimal === null || decimal === undefined || decimal === "") return 0;

  const text = String(decimal).trim();
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;

  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = fraction.padEnd(exponent + 1, "0");
  const kept = digits.slice(0, exponent);
  const next = Number(digits[exponent] ?? "0");

  const wholeDigits = whole.replace(/\D/g, "") || "0";
  let total = Number(`${wholeDigits}${kept}` || "0");
  if (!Number.isFinite(total)) return 0;
  if (next >= 5) total += 1;

  return negative ? -total : total;
}

export function money(
  decimal: string | number | null | undefined,
  currency?: string | null,
): Money {
  return { amount: minorUnits(decimal), currency: currencyOf(currency) };
}

/**
 * Treasury speaks in minor units already.
 *
 * `/cash-sessions/*` carries `openingFloatMinorUnits`, `amountMinor`,
 * `toleranceMinorUnits` and friends — "1250" means 12.50, not 1250.00.
 * Passing one of those through `money()`, which reads a *decimal* string,
 * multiplies every drawer figure by a hundred. This is the one place that
 * conversion is a straight parse.
 */
export function minorMoney(
  minor: string | null | undefined,
  currency?: string | null,
): Money {
  const text = String(minor ?? "").trim();
  const amount = /^-?\d+$/.test(text) ? Number(text) : 0;
  return { amount: Number.isFinite(amount) ? amount : 0, currency: currencyOf(currency) };
}

/** Back the other way, for request bodies that want a decimal string. */
export function toDecimal(value: Money | number, exponent = 2): string {
  const amount = typeof value === "number" ? value : value.amount;
  const negative = amount < 0;
  const digits = String(Math.abs(Math.round(amount))).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

/**
 * The API identifies units by UUID and publishes no unit catalogue, so a
 * quantity arrives as an exact string with an opaque unit reference. Until
 * a `/units` endpoint exists, register the tenant's units once at start-up
 * and every quantity is labelled correctly:
 *
 *   registerUnits({ "3fa85f64-…": "kg", "7c1d…": "l" });
 */
const unitsById = new Map<Id, UnitCode>();

export function registerUnits(map: Record<Id, UnitCode>): void {
  for (const [id, code] of Object.entries(map)) unitsById.set(id, code);
}

export function unitOf(unitId: string | null | undefined): UnitCode {
  if (!unitId) return "pc";
  // gap: no unit catalogue on the API — unknown ids read as pieces.
  return unitsById.get(unitId) ?? "pc";
}

export function quantity(
  value: string | number | null | undefined,
  unitId?: string | null,
): Quantity {
  return { value: value === null || value === undefined ? "0" : String(value), unit: unitOf(unitId) };
}

/**
 * Same thing, but for a unit already resolved to its code.
 *
 * The computed inventory reports (low stock, negative stock, reconciliation)
 * carry no unit at all — the quantity is implicitly in the stock item's own
 * base unit, which the caller already has from the item table.
 */
export function quantityOf(
  value: string | number | null | undefined,
  unit: UnitCode,
): Quantity {
  return { value: value === null || value === undefined ? "0" : String(value), unit };
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

const COUNTRY_CODES: CountryCode[] = ["EG", "SA", "AE", "JO", "KW", "QA"];

export function countryOf(code: string | null | undefined): CountryCode {
  const upper = (code ?? "").toUpperCase();
  return (COUNTRY_CODES as string[]).includes(upper) ? (upper as CountryCode) : "EG";
}

export function numberOf(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** An `address` blob is opaque JSON; render whatever line it holds. */
export function addressLine(address: Record<string, unknown> | null | undefined): string {
  if (!address) return "";
  const parts = ["line1", "line2", "street", "district", "city", "governorate", "country"]
    .map((key) => address[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (parts.length > 0) return parts.join(", ");
  const first = Object.values(address).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? first : "";
}

function colourOf(value: string | null | undefined, fallback = "#0f6f7a"): string {
  return value && value.trim() ? value : fallback;
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

type WireTenantMembership = S.TenantController_listTenantsResponse[number];

export function toTenant(row: WireTenantMembership): Tenant {
  const t = row.tenant;
  return {
    id: t.id,
    name: localised(t.legalName),
    slug: t.slug,
    // The API's tenant lifecycle is narrower than the SRS's seven states.
    state: t.status === "active" ? "active" : t.status === "suspended" ? "suspended" : "terminating",
    plan: "professional", // gap: no plan/subscription on the API.
    countryCode: countryOf(null), // gap: not exposed on the tenant record.
    baseCurrency: currencyOf(t.defaultCurrency),
    region: t.defaultLocale,
    brandCount: 0, // filled by the caller, which has the brand list.
    branchCount: 0,
    createdAt: new Date().toISOString(), // gap: not exposed.
  };
}

type WireBrand = S.OrganisationController_listBrandsResponse[number];

export function toBrand(row: WireBrand, tenantId: Id, branchCount = 0): Brand {
  const theme = (row.theme ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    code: typeof theme.code === "string" ? theme.code : row.name.slice(0, 4).toUpperCase(),
    colour: colourOf(typeof theme.colour === "string" ? theme.colour : null),
    branchCount,
    active: true, // gap: brands have no status on the API.
  };
}

type WireBranch = S.OrganisationController_listBranchesResponse[number];

export function toBranch(row: WireBranch, tenantId: Id): Branch {
  const address = (row.address ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenantId,
    brandId: row.brandId,
    name: localised(row.name),
    code: row.code,
    countryCode: countryOf(row.countryCode),
    currency: currencyOf(row.baseCurrency),
    timezone: row.timezone,
    // gap: the cutover lives on operating-hours rows, not on the branch.
    businessDayBoundary: "04:00",
    seats: numberOf(address.seats),
    areaSqm: numberOf(address.areaSqm),
    openedAt: row.createdAt.slice(0, 10),
    active: row.status === "active",
    isFranchise: Boolean(address.isFranchise),
    address: addressLine(address),
    // gap: drive-through is a console-only setting, the API has no field for it.
    driveThroughEnabled: false,
  };
}

type WireWarehouse = S.OrganisationController_listWarehousesResponse[number];

export function toWarehouse(row: WireWarehouse, tenantId: Id): Warehouse {
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    code: row.warehouseType.toUpperCase().slice(0, 3),
    warehouseType: row.warehouseType,
    attachedBranchId: row.branchId,
    countryCode: countryOf(null),
    active: true, // gap: warehouses have no status on the API.
  };
}

type WireCentralKitchen = S.OrganisationController_listCentralKitchensResponse[number];

export function toCentralKitchen(row: WireCentralKitchen, tenantId: Id): CentralKitchen {
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    code: row.id.slice(0, 4).toUpperCase(),
    countryCode: countryOf(null),
    servesBranchIds: [], // gap: the API models one warehouse, not a served set.
    active: true,
  };
}

export function branchLocation(branch: Branch): StockLocation {
  return { id: branch.id, kind: "branch", name: branch.name, code: branch.code };
}

export function warehouseLocation(row: WireWarehouse): StockLocation {
  return {
    id: row.id,
    kind: row.warehouseType === "central" ? "central_kitchen" : "warehouse",
    name: localised(row.name),
    code: row.warehouseType.toUpperCase().slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Terminals, stations, tables
// ---------------------------------------------------------------------------

type WireTerminal = S.TerminalController_listResponse[number];

/** "Online" is a live-connection idea the REST surface does not carry; the
 *  last heartbeat is the closest honest proxy. */
function terminalStatus(row: WireTerminal): Terminal["status"] {
  if (row.status === "revoked") return "revoked";
  if (row.status === "disabled") return "offline";
  if (!row.lastSeenAt) return "offline";
  const age = Date.now() - new Date(row.lastSeenAt).getTime();
  if (age < 2 * 60_000) return "online";
  if (age < 15 * 60_000) return "degraded";
  return "offline";
}

export function toTerminal(row: WireTerminal): Terminal {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    name: row.name,
    code: row.id.slice(0, 6).toUpperCase(),
    kind: row.terminalType === "handheld" ? "pos" : row.terminalType,
    status: terminalStatus(row),
    appVersion: "—", // gap: reported on fingerprints, not on the terminal row.
    lastSeenAt: row.lastSeenAt ?? row.createdAt,
    queuedOperations: 0, // gap: the outbox is a device-side count.
    batteryPercent: null,
    ipAddress: "—",
  };
}

const STATION_TYPES: StationType[] = [
  "grill",
  "fryer",
  "cold",
  "hot_line",
  "beverage",
  "barista",
  "dessert",
  "bakery",
  "shawarma",
  "packaging",
  "pass",
];

/** The API stores a free-text station name; the console keys off a type. */
function stationType(name: string): StationType {
  const needle = name.toLowerCase();
  return STATION_TYPES.find((type) => needle.includes(type.replace("_", " ")) || needle.includes(type)) ?? "pass";
}

type WireStation = S.OrganisationController_listStationsResponse[number];

export function toStation(row: WireStation): Station {
  const capacity = (row.capacityConfig ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    branchId: row.branchId,
    name: localised(row.name),
    type: stationType(row.name),
    colour: colourOf(row.displayColour),
    capacityPerHour: numberOf(capacity.perHour ?? capacity.capacityPerHour),
    active: true, // gap: stations have no status on the API.
  };
}

type WireTable = S.OrganisationController_listTablesResponse[number];

export function toTable(row: WireTable): RestaurantTable {
  return {
    id: row.id,
    branchId: row.branchId,
    area: localised(row.section, { en: "Main", ar: "الصالة" }),
    label: row.label,
    capacity: row.seatCapacity ?? 0,
    // gap: table state is a floor-plan concern the API does not model yet.
    // The operations screen overlays open orders onto this.
    state: "available",
    seatedAt: null,
    orderId: null,
    serverId: null,
  };
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

type WireRole = S.RbacController_listRolesResponse[number];

export function toRole(row: WireRole, permissions: Role["permissions"] = []): Role {
  return {
    id: row.id,
    key: row.name.toLowerCase().replace(/\s+/g, "_") as Role["key"],
    name: localised(row.name),
    description: localised(row.description),
    system: row.isSystem,
    permissions,
    defaultScope: row.tenantId === null ? "tenant" : "branch",
    userCount: 0, // gap: no membership count on the role record.
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

type WireMenu = S.CatalogueController_listMenusResponse[number];

export function toMenu(row: WireMenu, tenantId: Id, branchIds: Id[] = []): Menu {
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    priority: row.priority,
    orderTypes: row.orderTypes ?? [],
    branchIds,
    active: row.isActive,
    createdAt: row.createdAt,
  };
}

export function toMenuResolution(
  response: S.CatalogueController_resolveMenusResponse,
  tenantId: Id,
): MenuResolution {
  return {
    menus: response.menus.map((row) => toMenu(row, tenantId)),
    ambiguous: response.ambiguous,
    // The document declares `warning` present only when ambiguous is true.
    warning: response.ambiguous ? (response.warning ?? null) : null,
  };
}

export function toCompleteness(
  response: S.CatalogueController_completenessReportResponse,
): CatalogueCompleteness {
  return {
    sellable: response.sellable,
    unpricedVariants: (response.unpricedVariants ?? []).map((row) => ({
      menuItemId: row.menuItemId,
      variantId: row.variantId,
    })),
    itemsWithoutActiveVariant: response.itemsWithoutActiveVariant ?? [],
    activeListGaps: (response.activeListGaps ?? []).map((row) => ({
      priceListId: row.priceListId,
      priceListName: row.priceListName,
      menuItemVariantId: row.menuItemVariantId,
    })),
  };
}

type WireCategory = S.CatalogueController_listCategoriesResponse[number];

export function toCategory(row: WireCategory, tenantId: Id, itemCount = 0): MenuCategory {
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    parentId: row.parentCategoryId,
    sortOrder: row.sortOrder,
    colour: colourOf(row.colour),
    itemCount,
    active: true, // gap: categories have no status on the API.
  };
}

type WireMenuItem = S.CatalogueController_listItemsResponse[number];
type WireVariant = S.CatalogueController_listVariantsResponse[number];

const TAX_CLASSES: TaxClassCode[] = ["standard", "reduced", "zero", "exempt"];

export function toVariant(row: WireVariant, price: Money | null): MenuItemVariant {
  return {
    id: row.id,
    name: localised(row.name),
    basePrice: price ?? money(0),
    barcode: row.barcode,
    recipeId: null, // filled from /recipes when the recipe list is loaded.
    available: row.isActive,
  };
}

export interface MenuItemContext {
  tenantId: Id;
  /** From `/catalogue/items/{id}/placements` — the item's first placement. */
  categoryId?: Id | null;
  variants?: MenuItemVariant[];
  /** From `/catalogue/availability-rules` — a live manual 86. */
  unavailableReason?: string | null;
  prepTimeSeconds?: number;
}

export function toMenuItem(row: WireMenuItem, context: MenuItemContext): MenuItem {
  const name = localised(row.names);
  const taxClass = TAX_CLASSES.find((code) => code === row.taxClassId) ?? "standard";

  return {
    id: row.id,
    tenantId: context.tenantId,
    categoryId: context.categoryId ?? "",
    name,
    kitchenName: localised(row.kitchenNames, name),
    receiptName: localised(row.aggregatorNames, name),
    description: localised(row.description),
    taxClass,
    // gap: routing lives in station-routing-rules, per branch, not on the item.
    stationType: "pass",
    prepTimeSeconds: context.prepTimeSeconds ?? 0,
    variants: context.variants ?? [],
    allergens: row.allergens,
    isCombo: row.isCombo,
    isOpenPrice: row.isOpenPrice,
    isWeighed: row.isWeighed,
    available: row.isActive && !context.unavailableReason,
    unavailableReason: context.unavailableReason ?? null,
    remainingSellable: null, // gap: FR-MNU-033 is not computed by the API.
    sortOrder: row.sortOrder,
    colour: colourOf(row.colour),
    imageEmoji: "",
  };
}

type WireModifierGroup = S.CatalogueController_listModifierGroupsResponse[number];
type WireModifier = S.CatalogueController_listModifiersResponse[number];

export function toModifier(row: WireModifier): Modifier {
  const kind: ModifierKind =
    row.kind === "removal" || row.kind === "substitution" ? row.kind : "addition";
  return {
    id: row.id,
    name: localised(row.name),
    kind,
    priceDelta: money(row.priceDelta),
    recipeDelta: [], // gap: recipeDelta is an opaque blob on the API.
    isDefault: row.isDefault,
  };
}

export function toModifierGroup(
  row: WireModifierGroup,
  tenantId: Id,
  modifiers: Modifier[] = [],
): ModifierGroup {
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    minSelections: row.minSelections,
    maxSelections: row.maxSelections,
    required: row.isRequired,
    allowRepeat: row.allowRepeat,
    freeQuantityThreshold: row.freeQuantityThreshold || null,
    modifiers,
    attachedItemCount: 0, // gap: no reverse index on the API.
  };
}

type WirePriceList = S.CatalogueController_listPriceListsResponse[number];
type WirePriceEntry = S.CatalogueController_listPriceEntriesResponse[number];

export function toPriceEntry(
  row: WirePriceEntry,
  itemName: Localised = EMPTY,
  menuItemId: Id = "",
): PriceListEntry {
  return {
    menuItemId,
    variantId: row.menuItemVariantId,
    itemName,
    price: money(row.price, row.currency),
    previousPrice: null, // gap: no price history on the API.
  };
}

export function toPriceList(
  row: WirePriceList,
  tenantId: Id,
  entries: PriceListEntry[] = [],
): PriceList {
  const orderTypes = row.orderType ? [row.orderType as PriceList["orderTypes"][number]] : [];
  return {
    id: row.id,
    tenantId,
    name: localised(row.name),
    scope: row.scopeType,
    scopeId: row.scopeId,
    orderTypes,
    priority: row.priority,
    validFrom: (row.validFrom ?? "").slice(0, 10),
    validTo: row.validTo ? row.validTo.slice(0, 10) : null,
    recurrence: row.recurrenceRule ? JSON.stringify(row.recurrenceRule) : null,
    entryCount: entries.length,
    entries,
    active: row.status === "active",
  };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

type WireRecipe = S.ProductionController_listRecipesResponse[number];
type WireRecipeVersion = S.ProductionController_listVersionsResponse[number];
type WireRecipeLine = WireRecipeVersion["lines"][number];

export function toRecipeLine(row: WireRecipeLine, componentName: Localised = EMPTY): RecipeLine {
  return {
    id: row.id,
    sequence: row.sequence,
    componentType: row.componentType,
    componentId: row.stockItemId ?? row.subRecipeId ?? "",
    componentName,
    quantity: quantity(row.quantity, row.unitId),
    wastagePercentage: numberOf(row.wastagePercentage),
    isOptional: row.isOptional,
    unitCost: money(0), // gap: line costing is not returned with the version.
    lineCost: money(0),
  };
}

/**
 * FR-MNU — one modifier's effect on the plate's recipe.
 *
 * Near-passthrough: the wire shape already matches what the console wants,
 * and the only thing worth normalising is that a `remove_all` genuinely
 * carries no quantity rather than a zero that would read as one.
 */
export function toModifierRecipeEffect(row: {
  id: string;
  modifierId: string;
  sequence: number;
  operation: "add" | "remove_all";
  componentType: "stock_item" | "sub_recipe";
  stockItemId: string | null;
  subRecipeId: string | null;
  quantity: string | null;
  unitId: string | null;
  createdAt: string;
}): ModifierRecipeEffect {
  const additive = row.operation === "add";
  return {
    id: row.id,
    modifierId: row.modifierId,
    sequence: row.sequence,
    operation: row.operation,
    componentType: row.componentType,
    stockItemId: row.stockItemId,
    subRecipeId: row.subRecipeId,
    quantity: additive ? row.quantity : null,
    unitId: additive ? row.unitId : null,
    createdAt: row.createdAt,
  };
}

export interface RecipeContext {
  tenantId: Id;
  name?: Localised;
  targetName?: Localised | null;
  version?: WireRecipeVersion | null;
  lines?: RecipeLine[];
  sellingPrice?: Money | null;
}

export function toRecipe(row: WireRecipe, context: RecipeContext): Recipe {
  const version = context.version ?? null;
  const lines = context.lines ?? [];
  const computedCost = money(version?.computedCost ?? 0);
  const yieldQty = numberOf(version?.yieldQuantity, 1) || 1;

  return {
    id: row.id,
    tenantId: context.tenantId,
    name: context.name ?? context.targetName ?? EMPTY,
    recipeType: row.recipeType,
    targetId: row.menuItemVariantId ?? row.stockItemId,
    targetName: context.targetName ?? null,
    version: version?.version ?? 0,
    status: version?.status ?? "draft",
    yieldQuantity: quantity(version?.yieldQuantity ?? "1", version?.yieldUnitId),
    yieldPercentage: numberOf(version?.yieldPercentage, 100),
    prepTimeSeconds: version?.prepTimeSeconds ?? 0,
    lines,
    computedCost,
    costPerPortion: { amount: Math.round(computedCost.amount / yieldQty), currency: computedCost.currency },
    sellingPrice: context.sellingPrice ?? null,
    costComputedAt: version?.costComputedAt ?? version?.createdAt ?? new Date().toISOString(),
    effectiveFrom: (version?.effectiveFrom ?? version?.createdAt ?? "").slice(0, 10),
    // BR-MNU-012 — a published version with at least one line is complete.
    complete: version?.status === "published" && lines.length > 0,
    instructions: localised(version?.instructions),
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

type WireStockItem = S.InventoryController_listItemsResponse[number];

export function toStockItem(row: WireStockItem, tenantId: Id, category: Localised = EMPTY): StockItem {
  return {
    id: row.id,
    tenantId,
    sku: row.sku,
    name: localised(row.names),
    category,
    baseUnit: unitOf(row.baseUnitId),
    baseUnitId: row.baseUnitId,
    purchaseUnit: unitOf(row.baseUnitId), // gap: no purchase-unit conversion yet.
    purchaseConversion: 1,
    costingMethod: row.costingMethod,
    batchTracked: row.isBatchTracked,
    expiryTracked: row.expiryTracked,
    // gap: storageRequirements is an opaque blob and not returned on reads.
    storage: "ambient",
    shelfLifeDays: row.shelfLifeDays,
    defaultSupplierId: null, // gap: purchasing is not implemented.
    allergens: [],
    unitCost: money(row.standardCost),
    active: row.isActive,
  };
}

type WireLevel = S.InventoryController_levelsResponse[number];

export interface LevelContext {
  item?: StockItem;
  location?: StockLocation;
  reorderPoint?: number;
  reorderQuantity?: number;
}

function levelStatus(onHand: number, reorderPoint: number): StockLevel["status"] {
  if (onHand < 0) return "negative";
  if (reorderPoint > 0 && onHand <= reorderPoint / 2) return "critical";
  if (reorderPoint > 0 && onHand <= reorderPoint) return "low";
  return "ok";
}

export function toStockLevel(row: WireLevel, context: LevelContext = {}): StockLevel {
  const onHand = numberOf(row.quantityOnHand);
  const reorderPoint = context.reorderPoint ?? 0;
  const unitCost = context.item?.unitCost ?? money(0);

  return {
    itemId: row.stockItemId,
    itemName: context.item?.name ?? EMPTY,
    sku: context.item?.sku ?? "",
    locationId: row.locationId,
    locationName: context.location?.name ?? EMPTY,
    onHand: quantity(row.quantityOnHand),
    allocated: quantity(row.quantityReserved),
    onOrder: quantity("0"), // gap: purchasing is not implemented.
    reorderPoint,
    reorderQuantity: context.reorderQuantity ?? 0,
    parLevel: 0,
    unitCost,
    value: { amount: Math.round(unitCost.amount * onHand), currency: unitCost.currency },
    daysOfCover: null, // gap: needs a usage series the API does not expose.
    lastCountedAt: row.lastReconciledAt,
    status: levelStatus(onHand, reorderPoint),
  };
}

type WireMovement = S.InventoryController_listMovementsResponse[number];

export interface MovementContext {
  tenantId: Id;
  item?: StockItem;
  location?: StockLocation;
}

export function toMovement(row: WireMovement, context: MovementContext): StockMovement {
  const qty = numberOf(row.quantity);
  const unitCost = context.item?.unitCost ?? money(0);

  return {
    id: row.id,
    tenantId: context.tenantId,
    locationId: row.locationId,
    locationName: context.location?.name ?? EMPTY,
    itemId: context.item?.id ?? "",
    itemName: context.item?.name ?? EMPTY,
    batchId: row.batchId,
    movementType: row.movementType,
    quantity: { value: row.quantity, unit: context.item?.baseUnit ?? "pc" },
    unitCost,
    totalCost: { amount: Math.round(unitCost.amount * Math.abs(qty)), currency: unitCost.currency },
    balanceAfter: quantity(row.balanceAfter),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    counterpartMovementId: row.counterpartMovementId,
    occurredAt: row.occurredAt,
    recordedAt: row.occurredAt,
    performedBy: "", // gap: the ledger row does not carry an actor.
    performedByName: EMPTY,
    reasonCode: null,
    notes: null,
  };
}

type WireExpiring = S.InventoryController_expiringResponse[number];

export function toBatch(row: WireExpiring, context: LevelContext = {}): Batch {
  const expiry = row.expiryDate ?? "";
  const days = expiry
    ? Math.round((new Date(expiry).getTime() - Date.now()) / 86_400_000)
    : 0;
  const unitCost = context.item?.unitCost ?? money(0);
  const qty = numberOf(row.quantityRemaining);

  return {
    id: row.batchId,
    itemId: row.stockItemId,
    itemName: context.item?.name ?? EMPTY,
    locationId: row.locationId,
    locationName: context.location?.name ?? EMPTY,
    batchNumber: row.batchId.slice(0, 8).toUpperCase(),
    productionDate: null,
    expiryDate: expiry.slice(0, 10),
    quantity: quantity(row.quantityRemaining),
    unitCost,
    value: { amount: Math.round(unitCost.amount * qty), currency: unitCost.currency },
    supplierId: null,
    supplierName: null,
    daysToExpiry: days,
    status: days < 0 ? "expired" : days <= 2 ? "critical" : days <= 7 ? "expiring" : "fresh",
  };
}

type WireCountLine = S.InventoryController_countLinesResponse[number];

export function toCountLine(row: WireCountLine, context: LevelContext = {}): CountLine {
  const variance = numberOf(row.variance);
  const expected = numberOf(row.expectedQuantity);
  const unitCost = context.item?.unitCost ?? money(0);

  return {
    id: row.id,
    itemId: row.stockItemId,
    itemName: context.item?.name ?? EMPTY,
    sku: context.item?.sku ?? "",
    expected: quantity(row.expectedQuantity ?? "0"),
    counted: row.countedQuantity === null ? null : quantity(row.countedQuantity),
    varianceQty: variance,
    varianceValue: { amount: Math.round(unitCost.amount * variance), currency: unitCost.currency },
    variancePercent: expected === 0 ? 0 : (variance / expected) * 100,
    flagged: Math.abs(variance) > 0,
    recount: false,
  };
}

/**
 * `POST /inventory/counts` answers with the session it opened. The list of
 * sessions is not exposed, so a count only appears here once this client has
 * opened or read it.
 */
export function toCountSession(
  row: S.InventoryController_openCountResponse,
  context: { tenantId: Id; location?: StockLocation; lines?: CountLine[] },
): CountSession {
  const lines = context.lines ?? [];
  const record = row as unknown as Record<string, unknown>;
  const id = String(record.id ?? "");

  return {
    id,
    tenantId: context.tenantId,
    locationId: String(record.locationId ?? ""),
    locationName: context.location?.name ?? EMPTY,
    reference: id.slice(0, 8).toUpperCase(),
    scope: localised(record.scopeType ?? "full_location"),
    mode: record.isBlindCount ? "blind" : "open",
    status: (record.status as CountSession["status"]) ?? "counting",
    openedAt: String(record.openedAt ?? new Date().toISOString()),
    submittedAt: null,
    postedAt: (record.postedAt as string) ?? null,
    countedBy: String(record.openedBy ?? ""),
    countedByName: EMPTY,
    postedBy: (record.postedBy as string) ?? null,
    lineCount: lines.length,
    flaggedCount: lines.filter((line) => line.flagged).length,
    netVarianceValue: lines.reduce(
      (total, line) => ({
        amount: total.amount + line.varianceValue.amount,
        currency: line.varianceValue.currency,
      }),
      money(0),
    ),
    lines,
  };
}

type WireWaste = S.InventoryController_listWasteResponse[number];

export function toWasteRecord(
  row: WireWaste,
  context: { tenantId: Id; location?: StockLocation; reason?: { code: string; name: Localised; category: WasteRecord["category"]; isTrueWaste: boolean } },
): WasteRecord {
  return {
    id: row.id,
    tenantId: context.tenantId,
    locationId: row.locationId,
    locationName: context.location?.name ?? EMPTY,
    // The list endpoint returns the header only; lines are not included.
    itemId: "",
    itemName: EMPTY,
    quantity: quantity("0"),
    reasonCode: context.reason?.code ?? row.reasonCodeId,
    reasonName: context.reason?.name ?? EMPTY,
    category: context.reason?.category ?? "kitchen",
    isTrueWaste: context.reason?.isTrueWaste ?? true,
    value: money(row.totalValue),
    recordedAt: row.recordedAt,
    recordedBy: "",
    recordedByName: EMPTY,
    stationId: null,
    approval: row.requiresApproval ? "pending" : "not_required",
    notes: null,
  };
}

type WireReasonCode = S.InventoryController_listReasonCodesResponse[number];

const WASTE_CATEGORIES = new Set<WasteRecord["category"]>([
  "storage",
  "supplier",
  "kitchen",
  "service",
  "policy",
  "facility",
  "control",
]);

export function toWasteReason(row: WireReasonCode) {
  const category = WASTE_CATEGORIES.has(row.category as WasteRecord["category"])
    ? (row.category as WasteRecord["category"])
    : "kitchen";
  return {
    id: row.id,
    code: row.code,
    name: localised(row.label),
    category,
    // FR-INV-059 — staff meals and tastings are consumption, not waste.
    isTrueWaste: category !== "control" && category !== "policy",
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

type WireOrder = S.OrdersController_findOneResponse;
type WireOrderLine = WireOrder["lines"][number];

export function toOrderLine(row: WireOrderLine, currency: Currency): OrderLine {
  const at = (value: string | null | undefined) => value ?? null;
  return {
    id: row.id,
    sequence: row.sequence,
    menuItemId: row.menuItemId,
    variantId: row.variantId,
    itemNameSnapshot: localised(row.itemNameSnapshot),
    quantity: numberOf(row.quantity),
    unitPrice: money(row.unitPrice, currency),
    modifiers: [], // gap: line modifiers are not returned with the order.
    modifierTotal: money(row.modifierTotal, currency),
    lineDiscount: money(row.lineDiscount, currency),
    lineSubtotal: money(row.lineSubtotal, currency),
    taxAmount: money(row.taxAmount, currency),
    lineTotal: money(row.lineTotal, currency),
    unitCostSnapshot: money(row.unitCostSnapshot, currency),
    recipeVersionId: row.recipeVersionId,
    course: row.course ?? 1,
    seatNumber: row.seatNumber,
    state: row.state,
    stationId: null, // gap: routing is resolved at fire time, which is unbuilt.
    firedAt: at(row.firedAt),
    readyAt: at(row.readyAt),
    voidReason: null,
    isComp: row.isComp,
    notes: row.notes,
  };
}

export interface OrderContext {
  tenantId: Id;
  branchName?: Localised;
  tableLabel?: string | null;
  terminalName?: string;
}

export function toOrder(row: WireOrder, context: OrderContext): Order {
  const currency = currencyOf(row.currency);
  const lines = row.lines.map((line) => toOrderLine(line, currency));

  const cogsTotal = lines.reduce(
    (total, line) => total + line.unitCostSnapshot.amount * line.quantity,
    0,
  );

  return {
    id: row.id,
    tenantId: context.tenantId,
    branchId: row.branchId,
    branchName: context.branchName ?? EMPTY,
    terminalId: row.terminalId ?? "",
    terminalName: context.terminalName ?? "",
    orderNumber: row.orderNumber,
    businessDay: row.businessDay,
    orderType: row.orderType,
    channel: row.channel,
    state: row.state,
    tableId: row.tableId,
    tableLabel: context.tableLabel ?? null,
    guestCount: row.guestCount,
    customerId: null, // gap: CRM is not implemented.
    customerName: null,
    openedBy: row.openedBy,
    openedByName: EMPTY,
    servedByName: null,
    currency,
    subtotal: money(row.subtotal, currency),
    discountTotal: money(row.discountTotal, currency),
    serviceChargeTotal: money(row.serviceChargeTotal, currency),
    taxTotal: money(row.taxTotal, currency),
    roundingAdjustment: money(row.roundingAdjustment, currency),
    grandTotal: money(row.grandTotal, currency),
    paidTotal: money(row.paidTotal, currency),
    tipTotal: money(row.tipTotal, currency),
    cogsTotal: { amount: Math.round(cogsTotal), currency },
    lines,
    payments: [], // gap: the Payment endpoints are deliberately absent.
    discounts: [],
    openedAt: row.openedAt,
    firstFiredAt: row.firstFiredAt,
    completedAt: row.completedAt,
    // gap: the API has no cancellation-metadata fields on the order resource.
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    // Anything the server has answered with is, by definition, synced.
    syncState: "synced",
    syncedAt: row.completedAt ?? row.openedAt,
    aggregatorRef: null,
    notes: row.notes,
    version: row.version,
  };
}

// ---------------------------------------------------------------------------
// Kitchen — SRS ch.9
// ---------------------------------------------------------------------------

type WireStationQueue = S.KitchenController_getStationQueueResponse;
type WireTicket = WireStationQueue["tickets"][number];
type WireTicketLine = WireTicket["lines"][number];

/**
 * State is read from the timestamps, not from `status`.
 *
 * The document declares both `ticket.status` and `line.status` as a bare
 * `{"type":"string"}` with no enum, so the set of values it can take is not
 * knowable from the contract — and a mapping table built on guesses would
 * mislabel a card the first time the backend used a word this file had not
 * anticipated. The timestamps *are* specified: `startedAt`, `readyAt`,
 * `bumpedAt`, `recalledAt` and (on a line) `cancelledAt`. They carry the
 * same information and cannot drift.
 *
 * `status` is still honoured when it happens to spell a state this console
 * knows, so a future enum needs no change here.
 */
const TICKET_STATES = new Set<TicketState>([
  "queued",
  "started",
  "ready",
  "bumped",
  "recalled",
  "cancelled",
]);

function ticketState(row: WireTicket, lines: TicketLine[]): TicketState {
  const declared = String(row.status ?? "").toLowerCase();
  if (TICKET_STATES.has(declared as TicketState)) return declared as TicketState;

  // Every line struck off at the till: the card exists only to stop a cook.
  if (lines.length > 0 && lines.every((line) => line.state === "voided")) return "cancelled";

  if (row.bumpedAt) return "bumped";
  if (row.recalledAt) return "recalled";
  if (row.readyAt) return "ready";
  if (row.startedAt) return "started";
  return "queued";
}

function ticketLineState(row: WireTicketLine): OrderLineState {
  if (row.cancelledAt) return "voided";
  if (row.bumpedAt || row.readyAt) return "ready";
  if (row.startedAt) return "preparing";
  // Routed to a station is, by definition, fired.
  return "fired";
}

const ORDER_TYPES: OrderType[] = [
  "dine_in",
  "takeaway",
  "delivery",
  "drive_thru",
  "pickup",
  "aggregator",
];

/** `orderType` is an open string on the KDS routes, unlike on `/orders`. */
export function orderTypeOf(value: string | null | undefined): OrderType {
  const needle = String(value ?? "").toLowerCase();
  return ORDER_TYPES.find((type) => type === needle) ?? "dine_in";
}

const MODIFIER_KINDS: ModifierKind[] = ["addition", "removal", "substitution"];

export function toTicketLine(row: WireTicketLine): TicketLine {
  return {
    id: row.id,
    name: localised(row.itemNameSnapshot),
    quantity: numberOf(row.quantity),
    modifiers: (row.modifiers ?? []).map((modifier) => ({
      name: localised(modifier.nameSnapshot),
      kind: MODIFIER_KINDS.includes(modifier.kind) ? modifier.kind : "addition",
    })),
    state: ticketLineState(row),
    notes: row.preparationNotes,
    cancelledAt: row.cancelledAt,
  };
}

export interface TicketContext {
  /** The station's branch — a ticket carries only its station id. */
  branchId: Id;
  stationName: Localised;
}

export function toKitchenTicket(row: WireTicket, context: TicketContext): KitchenTicket {
  const lines = (row.lines ?? []).map(toTicketLine);

  // FR-KDS-022 — the target is a moment on the wire and a duration here.
  const routedMs = new Date(row.routedAt).getTime();
  const targetMs = row.targetReadyAt ? new Date(row.targetReadyAt).getTime() : null;
  const targetSeconds =
    targetMs !== null && Number.isFinite(targetMs) && Number.isFinite(routedMs)
      ? Math.max(0, Math.round((targetMs - routedMs) / 1000))
      : 0;

  const courses = (row.lines ?? [])
    .map((line) => line.course)
    .filter((course): course is number => typeof course === "number");

  return {
    id: row.id,
    branchId: context.branchId,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    orderType: orderTypeOf(row.orderType),
    // The service reference is the table on a dine-in order and the collection
    // or delivery reference otherwise — the same slot either way.
    tableLabel: row.serviceReference,
    stationId: row.stationId,
    stationName: context.stationName,
    state: ticketState(row, lines),
    urgency: urgencyOf(row.elapsedSeconds, targetSeconds),
    course: courses.length > 0 ? Math.min(...courses) : 1,
    // gap: the KDS routes carry no priority flag — no rush, VIP or remake.
    priority: "normal",
    firedAt: row.routedAt,
    startedAt: row.startedAt,
    bumpedAt: row.bumpedAt,
    // gap: no cancellation reason is carried on a ticket or its lines.
    cancelReason: null,
    targetSeconds,
    // Server-computed at response time; the display re-derives it from
    // `firedAt` between polls so the clock keeps running.
    elapsedSeconds: row.elapsedSeconds,
    lines,
  };
}

/** The same rule as `live/engine.ts`, kept here so mapping needs no import. */
function urgencyOf(elapsedSeconds: number, targetSeconds: number): TicketUrgency {
  if (targetSeconds <= 0) return "on_target";
  const ratio = elapsedSeconds / targetSeconds;
  if (ratio < 0.75) return "on_target";
  if (ratio < 1) return "approaching";
  if (ratio < 1.5) return "exceeded";
  return "critical";
}

// ---------------------------------------------------------------------------
// Day close and daily trading — SRS §16.5, FR-FIN-021/023, FR-RPT
// ---------------------------------------------------------------------------

/**
 * Both of these endpoints carry money in **minor units**, like the rest of
 * the treasury surface and unlike everything else: every amount is declared
 * `pattern: ^-?\d+$` with "Minor-unit money amount as a decimal string".
 * "1250" is 12.50. They go through `minorMoney`, never `money`.
 */

type WireDayClose = S.DayCloseController_getResponse;
type WireDailyTrading = S.ReportingController_getDailyTradingReportResponse;

export interface DayCloseContext {
  tenantId: Id;
  branchName: Localised;
}

const TAX_CLASS_CODES: TaxClassCode[] = ["standard", "reduced", "zero", "exempt"];

/** taxAmount ÷ netAmount, as the whole-number percentage the table shows. */
function taxRate(taxAmount: number, netAmount: number): number {
  if (netAmount === 0) return 0;
  return Math.round((taxAmount / netAmount) * 1000) / 10;
}

function taxClassOf(code: string | null | undefined, fallbackId: string): TaxSummaryRow["taxClass"] {
  const needle = String(code ?? "").toLowerCase();
  if ((TAX_CLASS_CODES as string[]).includes(needle)) return needle as TaxClassCode;
  // gap: the Z snapshot carries only `taxClassId`, an opaque uuid, and the
  // daily-trading report's `taxClassCode` is a country pack's own string.
  // Either is shown as itself rather than relabelled as standard-rated.
  return code?.trim() ? code.trim() : fallbackId;
}

/**
 * The two tenders this backend settles.
 *
 * `POST /payments` accepts cash and a manually-keyed external card, and the
 * totals blocks carry exactly those two. A row is emitted for each even at
 * zero, so the tender table has a stable shape across days.
 */
function tenderRows(
  totals: {
    cash: { amountTotal: string; paymentCount: number };
    manualExternalCard: { amountTotal: string; paymentCount: number };
  },
  currency: Currency,
): TenderSummaryRow[] {
  return [
    {
      tender: "cash",
      count: totals.cash.paymentCount,
      amount: minorMoney(totals.cash.amountTotal, currency),
    },
    {
      tender: "card",
      count: totals.manualExternalCard.paymentCount,
      amount: minorMoney(totals.manualExternalCard.amountTotal, currency),
    },
  ];
}

/** A persisted Z snapshot. Byte-stable forever, so this is always `closed`. */
export function toDayClose(row: WireDayClose, context: DayCloseContext): DayClose {
  const currency = currencyOf(row.currency);
  const sales = row.salesSummary;

  const zNumber = Number(row.zNumber);

  return {
    id: row.id,
    tenantId: context.tenantId,
    branchId: row.branchId,
    branchName: context.branchName,
    businessDay: row.businessDay,
    status: "closed",
    zReportNumber: Number.isFinite(zNumber) ? zNumber : null,
    closedAt: row.closedAt,
    // gap: the snapshot carries the closer's ids, not a name — there is no
    // employee-directory endpoint to resolve either one against.
    closedBy: personLabel(row.closedBy?.employeeId ?? row.closedBy?.userId),
    // A sealed day had nothing left open; that is what let it seal.
    blockingSessions: [],
    blockingOrderCount: 0,
    grossSales: minorMoney(sales.grossSales, currency),
    discounts: minorMoney(sales.discounts, currency),
    refunds: minorMoney(sales.refunds, currency),
    netSales: minorMoney(sales.netSales, currency),
    taxTotal: minorMoney(sales.taxTotal, currency),
    transactionCount: sales.completedOrderCount,
    averageOrderValue: minorMoney(sales.averageOrderValue, currency),
    voidCount: row.voidAndCompSummary.voidedLineCount,
    compValue: minorMoney(row.voidAndCompSummary.compLineValue, currency),
    cashVariance: minorMoney(row.cashReconciliation.varianceTotal, currency),
    tenders: tenderRows(row.tenderTotals, currency),
    taxRows: row.taxByClass.map((entry) => {
      const net = minorMoney(entry.netAmount, currency);
      const tax = minorMoney(entry.taxAmount, currency);
      return {
        taxClass: taxClassOf(null, entry.taxClassId),
        rate: taxRate(tax.amount, net.amount),
        netAmount: net,
        taxAmount: tax,
        grossAmount: minorMoney(entry.grossAmount, currency),
      };
    }),
  };
}

/**
 * A day that has no Z yet, read from the live report instead.
 *
 * The day-close screen lists days and offers to close one, and against a
 * backend the persisted records are all sealed — so without this the screen
 * could only ever show history and never the day a manager actually needs to
 * close. `periodStatus` and the two blocking counts are what the report
 * exists to answer, and they map exactly onto the status the screen renders.
 */
export function dayCloseFromReport(
  row: WireDailyTrading,
  context: DayCloseContext,
): DayClose {
  const currency = currencyOf(row.currency);
  const sales = row.salesSummary;

  // FR-FIN-021 — the drawers standing between this day and its Z, by id.
  const blockingSessions = row.cashReconciliation.sessions
    .filter((session) => session.status !== "closed")
    .map((session) => session.cashSessionId);

  const blocked = blockingSessions.length > 0 || row.openOrderCount > 0;

  const variance = row.cashReconciliation.sessions.reduce(
    (total, session) => total + minorMoney(session.variance, currency).amount,
    0,
  );

  return {
    // No persisted row exists yet, so the branch and day are the identity —
    // the same pair the two endpoints are addressed by.
    id: `${row.branchId}:${row.businessDay}`,
    tenantId: context.tenantId,
    branchId: row.branchId,
    branchName: context.branchName,
    businessDay: row.businessDay,
    status: blocked ? "blocked" : "open",
    zReportNumber: null,
    closedAt: null,
    closedBy: null,
    blockingSessions,
    blockingOrderCount: row.openOrderCount,
    grossSales: minorMoney(sales.grossSales, currency),
    discounts: minorMoney(sales.discounts, currency),
    refunds: minorMoney(sales.refunds, currency),
    netSales: minorMoney(sales.netSales, currency),
    taxTotal: minorMoney(sales.taxTotal, currency),
    transactionCount: sales.completedOrderCount,
    averageOrderValue: minorMoney(sales.averageOrderValue, currency),
    // gap: the report counts voided *lines* only through the day close; the
    // live report carries no void or comp block of its own.
    voidCount: 0,
    compValue: minorMoney("0", currency),
    cashVariance: { amount: variance, currency },
    tenders: tenderRows(row.tenderTotals, currency),
    taxRows: reportTaxRows(row),
  };
}

export function reportTaxRows(row: WireDailyTrading): TaxSummaryRow[] {
  const currency = currencyOf(row.currency);
  return row.taxSummary.byClass.map((entry) => {
    const net = minorMoney(entry.netAmount, currency);
    const tax = minorMoney(entry.taxAmount, currency);
    return {
      taxClass: taxClassOf(entry.taxClassCode, entry.taxClassId),
      rate: taxRate(tax.amount, net.amount),
      netAmount: net,
      taxAmount: tax,
      grossAmount: minorMoney(entry.grossAmount, currency),
    };
  });
}

export function reportTenderRows(row: WireDailyTrading): TenderSummaryRow[] {
  return tenderRows(row.tenderTotals, currencyOf(row.currency));
}

/** An identifier where a name belongs — shown as itself in both languages. */
function personLabel(value: string | null | undefined): Localised | null {
  const text = value?.trim();
  return text ? { en: text, ar: text } : null;
}

// ---------------------------------------------------------------------------
// Governance — SRS ch.20
// ---------------------------------------------------------------------------

type WireAuditEntry = S.AuditQueryController_searchResponse["entries"][number];

/**
 * `AuditEntry.actorType` has no `anonymous` member — the console never had
 * an unauthenticated actor to model before this endpoint. Read as `system`
 * rather than invented, since neither is a person and the label the reader
 * sees ("System") is the less misleading of the two.
 */
function actorTypeOf(value: WireAuditEntry["actorType"]): ActorType {
  if (value === "terminal") return "device";
  if (value === "anonymous") return "system"; // gap: no "anonymous" actor type on the console.
  return value;
}

/**
 * There is no join here — `GET /governance/audit/entries` returns ids, not
 * names, for the actor, approver and impersonator, and there is no roster
 * endpoint in scope to resolve them against (workforce is out of scope; see
 * BACKEND_INTEGRATION.md). Showing the id via `personLabel` is the honest
 * middle ground between a blank cell and a fabricated name. The branch is
 * different: branches are already live and memoised, so its name is a real
 * join via `branchName`.
 */
export function toAuditEntry(row: WireAuditEntry, branchName: Localised | null): AuditEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    branchName,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    actorId: row.actorId ?? "",
    actorName: personLabel(row.actorId) ?? EMPTY,
    actorType: actorTypeOf(row.actorType),
    impersonatedBy: personLabel(row.impersonatedBy),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? "",
    before: (row.beforeState as Record<string, unknown> | null) ?? null,
    after: (row.afterState as Record<string, unknown> | null) ?? null,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    approverName: personLabel(row.approverId),
    ipAddress: row.ipAddress ?? "",
    terminalId: row.terminalId,
    correlationId: row.correlationId,
    hash: row.entryHash,
    // gap: the document marks this null only for a chain's first entry —
    // the domain type carries no null arm, so the genesis entry reads as
    // an empty string rather than a fabricated hash.
    previousHash: row.previousHash ?? "",
  };
}

/**
 * LIVE-DEMO-HOTFIX-1 — the shape common to every `workforce/employees`
 * response the console actually renders a row from (list/get/create/update
 * all share these fields; `branches`/`permittedBranchIds` differ by
 * endpoint, so both are accepted and normalised here).
 */
interface WireEmployee {
  id: string;
  tenantId: string;
  code: string;
  displayName: string;
  namesLocalized: Record<string, unknown>;
  homeBranchId: string;
  employmentType: EmploymentType | null;
  status: EmployeeStatus;
  hireDate: string | null;
  createdAt: string;
  position: string | null;
  department: string | null;
  contactDetails: Record<string, unknown> | null;
  userId: string | null;
  branches?: { branchId: string }[];
  permittedBranchIds?: string[];
}

export function toEmployee(
  row: WireEmployee,
  branchesById: Map<Id, Branch>,
): Employee {
  const contact = (row.contactDetails ?? {}) as {
    phone?: string;
    email?: string;
  };
  const permittedBranchIds =
    row.permittedBranchIds ?? row.branches?.map((b) => b.branchId) ?? [];
  const homeBranch = branchesById.get(row.homeBranchId);
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: localised(row.namesLocalized, { en: row.displayName, ar: row.displayName }),
    // gap: position/department are the API's single default-locale strings,
    // not a localised map.
    position: { en: row.position ?? "", ar: row.position ?? "" },
    department: { en: row.department ?? "", ar: row.department ?? "" },
    homeBranchId: row.homeBranchId,
    homeBranchName: homeBranch?.name ?? EMPTY,
    permittedBranchIds,
    // gap: `employmentType`/`status` are nullable pre-HR-1 rows on the API;
    // the console's domain type is not, so a genuinely absent value falls
    // back to the least-privileged reading rather than a guess.
    employmentType: row.employmentType ?? "casual",
    status: row.status,
    hiredOn: (row.hireDate ?? row.createdAt ?? "").slice(0, 10) as IsoDate,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    // gap: compensation is its own endpoint (`GET .../compensation`), fetched
    // separately by `get()` — `list()` never carries it, matching this
    // file's own "list() returns what one call gives, get() fills the detail
    // in" fan-out convention.
    hourlyRate: { amount: 0, currency: "EGP" },
    userId: row.userId,
    // gap: no document-storage endpoint exists.
    documents: [],
  };
}
