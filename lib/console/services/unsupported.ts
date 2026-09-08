/**
 * The parts of the registry this backend has no endpoint for.
 *
 * The ROS API implements 151 operations and the console reaches all of them.
 * What is left over is not unfinished wiring — purchasing, workforce, costing
 * analytics, governance and the platform catalogue are absent from the server
 * entirely, as is a user index, a combo, a cash-session index, an expense
 * ledger and a standalone adjustment document.
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
import type { Combo, Page, StockAdjustment, User } from "../types";

/**
 * The one failure every absent endpoint raises.
 *
 * `what` names the console feature and `detail` names the gap, because the
 * useful question on that screen is "will this ever work?", and the honest
 * answer is "not until the server grows the route".
 *
 * This is a synchronous `throw` — callers that are already inside an
 * `async` function (every guard clause in http.ts) get the rejected promise
 * they expect for free. A bare `() => notImplemented(...)` does not: it
 * throws *before* returning anything, so `useAsync`'s `producer().catch(...)`
 * never runs and the throw crashes the render tree instead of surfacing as
 * `ErrorPanel`. Every member below is `async () => notImplemented(...)` for
 * exactly that reason — do not drop the `async`.
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
    list: async () => notImplemented(what),
    get: async () => notImplemented(what),
    create: async () => notImplemented(what),
    update: async () => notImplemented(what),
    remove: async () => notImplemented(what),
  };
}

function absentReadonly<T>(what: string): ReadonlyCollectionService<T> {
  return {
    list: async () => notImplemented(what),
    get: async () => notImplemented(what),
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
  get: async () => notImplemented("The dashboard aggregate"),
};

export const unsupportedPurchasing: PurchasingService = {
  suppliers: absentCollection("Suppliers"),
  requisitions: absentCollection("Purchase requisitions"),
  orders: absentCollection("Purchase orders"),
  receipts: absentCollection("Goods receipts"),
  invoices: absentCollection("Supplier invoices"),
  approveOrder: async () => notImplemented("Approving a purchase order"),
};

export const unsupportedCosting: CostingService = {
  foodCostByBranch: async () => notImplemented("Food cost by branch"),
  foodCostByCategory: async () => notImplemented("Food cost by category"),
  foodCostByBrand: async () => notImplemented("Food cost by brand"),
  variance: async () => notImplemented("Theoretical-versus-actual variance"),
  wasteAnalysis: async () => notImplemented("Waste analysis"),
  wasteTotals: async () => notImplemented("Waste totals"),
  contributionMargin: async () => notImplemented("Contribution margin"),
  channelProfitability: async () => notImplemented("Channel profitability"),
  branchProfitability: async () => notImplemented("Branch profitability"),
};

export const unsupportedWorkforce: WorkforceService = {
  employees: absentCollection("Employees"),
  shifts: absentCollection("Shift schedules"),
  attendance: absentCollection("Attendance"),
  overtime: absentCollection("Overtime"),
  performance: absentReadonly("Employee performance"),
  setEmployeePin: async () => notImplemented("Employee PIN"),
  roleAssignments: async () => notImplemented("Employee role assignments"),
  assignEmployeeRole: async () => notImplemented("Employee role assignments"),
  removeEmployeeRoleAssignment: async () => notImplemented("Employee role assignments"),
};

/**
 * Most of finance is live now; two members are not.
 *
 * The drawer runs on `treasury.*`, and the day close, the Z snapshot and the
 * tender and tax summaries run on the day-close and daily-trading endpoints —
 * `http.ts` implements all of those and takes only `cashSessions` and
 * `expenses` from here. There is still no `GET /cash-sessions` to build a
 * session index from, and no expense resource of any kind.
 *
 * The whole object stays for the mock registry's failure modes and so that a
 * future caller reaching for a finance member it has not implemented refuses
 * rather than fabricates.
 */
export const unsupportedFinance: FinanceService = {
  cashSessions: absentReadonly("A cash-session index"),
  expenses: absentCollection("Expenses"),
  dayCloses: absentReadonly("Day-close records"),
  paymentSummary: async () => notImplemented("The tender summary"),
  taxSummary: async () => notImplemented("The tax summary"),
  closeDay: async () => notImplemented("Closing a business day"),
};

export const unsupportedGovernance: GovernanceService = {
  approvals: absentReadonly("Approval requests"),
  audit: absentReadonly("The audit trail"),
  anomalies: absentReadonly("Anomaly flags"),
  sodConflicts: async () => notImplemented("Segregation-of-duties analysis"),
  decide: async () => notImplemented("Deciding an approval"),
};

export const unsupportedPlatform: PlatformService = {
  countryPacks: absentReadonly("Country packs"),
  integrations: absentCollection("Integrations"),
  reports: async () => notImplemented("The report catalogue"),
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
  list: async (): Promise<Page<StockAdjustment>> =>
    notImplemented("An adjustment document index"),
  get: async (): Promise<StockAdjustment | null> =>
    notImplemented("An adjustment document"),
};

/**
 * `GET /auth/tenants` returns the caller's own memberships and nothing else;
 * there is no tenant-wide user index to list.
 */
export const unsupportedUsers: CollectionService<User> =
  absentCollection<User>("A user directory");
