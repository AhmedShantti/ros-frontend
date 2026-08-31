/**
 * The parts of the registry this backend has no endpoint for.
 *
 * The ROS API implements 142 operations and the console reaches all of them.
 * What is left over is not unfinished wiring — purchasing, workforce, the
 * finance ledgers, costing analytics, governance and the platform catalogue
 * are absent from the server entirely, as is a user index, a combo, a KDS
 * queue and a standalone adjustment document.
 *
 * Every one of those used to fall back to an in-memory fixture. It no longer
 * does. A console wired to a live deployment must never show a row the
 * server did not send: a fabricated purchase order is indistinguishable on
 * screen from a real one, and someone will act on it.
 *
 * So each member here fails with a single stable code, `NOT_IMPLEMENTED`,
 * which `ErrorPanel` renders as a neutral "not available from this backend"
 * panel rather than as an outage. Nothing retries it, because retrying an
 * endpoint that does not exist cannot help.
 */

import { ServiceError } from "./types";
import type {
  CollectionService,
  CostingService,
  DashboardService,
  FinanceService,
  GovernanceService,
  PlatformService,
  PurchasingService,
  ReadonlyCollectionService,
  WorkforceService,
} from "./types";
import type { Combo, KitchenTicket, Page, StockAdjustment, User } from "../types";

/**
 * The one failure every absent endpoint raises.
 *
 * `what` names the console feature and `detail` names the gap, because the
 * useful question on that screen is "will this ever work?", and the honest
 * answer is "not until the server grows the route".
 */
export function notImplemented(what: string): never {
  throw new ServiceError(
    "NOT_IMPLEMENTED",
    "The backend does not offer that yet.",
    501,
    `${what} has no endpoint in api/openapi.json.`,
  );
}

/** A collection whose every operation is absent. */
function absentCollection<T>(what: string): CollectionService<T> {
  return {
    list: () => notImplemented(what),
    get: () => notImplemented(what),
    create: () => notImplemented(what),
    update: () => notImplemented(what),
    remove: () => notImplemented(what),
  };
}

function absentReadonly<T>(what: string): ReadonlyCollectionService<T> {
  return {
    list: () => notImplemented(what),
    get: () => notImplemented(what),
  };
}

// ---------------------------------------------------------------------------
// Whole domains
// ---------------------------------------------------------------------------

/**
 * Every tile on the dashboard is an aggregate the API does not compute.
 * `http.ts` builds what it can from live orders instead; this is only the
 * shape a caller sees when even that is unavailable.
 */
export const unsupportedDashboard: DashboardService = {
  get: () => notImplemented("The dashboard aggregate"),
};

export const unsupportedPurchasing: PurchasingService = {
  suppliers: absentCollection("Suppliers"),
  requisitions: absentCollection("Purchase requisitions"),
  orders: absentCollection("Purchase orders"),
  receipts: absentCollection("Goods receipts"),
  invoices: absentCollection("Supplier invoices"),
  approveOrder: () => notImplemented("Approving a purchase order"),
};

export const unsupportedCosting: CostingService = {
  foodCostByBranch: () => notImplemented("Food cost by branch"),
  foodCostByCategory: () => notImplemented("Food cost by category"),
  foodCostByBrand: () => notImplemented("Food cost by brand"),
  variance: () => notImplemented("Theoretical-versus-actual variance"),
  wasteAnalysis: () => notImplemented("Waste analysis"),
  wasteTotals: () => notImplemented("Waste totals"),
  contributionMargin: () => notImplemented("Contribution margin"),
  channelProfitability: () => notImplemented("Channel profitability"),
  branchProfitability: () => notImplemented("Branch profitability"),
};

export const unsupportedWorkforce: WorkforceService = {
  employees: absentCollection("Employees"),
  shifts: absentCollection("Shift schedules"),
  attendance: absentCollection("Attendance"),
  overtime: absentCollection("Overtime"),
  performance: absentReadonly("Employee performance"),
};

/**
 * The cash *drawer* is live — see `treasury.*` in `http.ts`. What is absent
 * is everything the finance screens read back afterwards: a session index,
 * expenses, day-close, and the tender and tax summaries.
 */
export const unsupportedFinance: FinanceService = {
  cashSessions: absentReadonly("A cash-session index"),
  expenses: absentCollection("Expenses"),
  dayCloses: absentReadonly("Day-close records"),
  paymentSummary: () => notImplemented("The tender summary"),
  taxSummary: () => notImplemented("The tax summary"),
  closeDay: () => notImplemented("Closing a business day"),
};

export const unsupportedGovernance: GovernanceService = {
  approvals: absentReadonly("Approval requests"),
  audit: absentReadonly("The audit trail"),
  anomalies: absentReadonly("Anomaly flags"),
  sodConflicts: () => notImplemented("Segregation-of-duties analysis"),
  decide: () => notImplemented("Deciding an approval"),
};

export const unsupportedPlatform: PlatformService = {
  countryPacks: absentReadonly("Country packs"),
  integrations: absentCollection("Integrations"),
  reports: () => notImplemented("The report catalogue"),
};

// ---------------------------------------------------------------------------
// Single members of otherwise-live domains
// ---------------------------------------------------------------------------

/** No combo endpoint exists; an item with components is not modelled. */
export const unsupportedCombos: CollectionService<Combo> =
  absentCollection<Combo>("Combos");

/**
 * An adjustment is a `manual_adjustment` movement on the API, not a document
 * of its own, so there is nothing to read back. The write half is live and
 * stays in `http.ts`.
 */
export const unsupportedAdjustmentReads = {
  list: (): Promise<Page<StockAdjustment>> =>
    notImplemented("An adjustment document index"),
  get: (): Promise<StockAdjustment | null> =>
    notImplemented("An adjustment document"),
};

/** No KDS endpoints at all — no queue, no bump, no recall. */
export const unsupportedKitchenQueue = (): Promise<Page<KitchenTicket>> =>
  notImplemented("The kitchen display queue");

/**
 * `GET /auth/tenants` returns the caller's own memberships and nothing else;
 * there is no tenant-wide user index to list.
 */
export const unsupportedUsers: CollectionService<User> =
  absentCollection<User>("A user directory");
