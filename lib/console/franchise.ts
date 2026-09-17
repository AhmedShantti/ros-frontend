/**
 * Franchise operations — SRS §17.7, FR-BRN-035 … FR-BRN-037.
 *
 *   - Restricted authority (FR-BRN-035). A franchise agreement names the
 *     configuration domains the brand keeps control of. A franchisee may run
 *     the branch — sell, count, close the day — but a change to a locked
 *     domain at that branch is refused unless the person making it holds
 *     franchisor authority (`org.manage`). `franchiseLockFor` is the one
 *     question every screen that edits branch-level menu, recipe or pricing
 *     asks.
 *   - Royalties (FR-BRN-036). A configurable percentage of net sales, per
 *     franchisee per period, with a minimum fee and an optional marketing
 *     fund contribution. Computed in integer minor units with the rounding
 *     done once, on the total — a percentage applied per order and summed
 *     drifts by a unit per order.
 *   - Compliance (FR-BRN-037). Menu, price and recipe deviation plus
 *     purchases from suppliers outside the mandated list, scored per branch.
 */

import type { Id, IsoDate, IsoDateTime, Localised, Money, Order } from "./types";
import type { MenuDeviation, PriceDeviation, RecipeDeviation } from "./branch-network";

export type FranchiseDomain = "menu" | "recipes" | "pricing" | "suppliers" | "receipt_branding" | "promotions";

export const FRANCHISE_DOMAINS: FranchiseDomain[] = ["menu", "recipes", "pricing", "suppliers", "receipt_branding", "promotions"];

export interface FranchiseAgreement {
  /** One per branch; the id is the branch id. */
  id: Id;
  branchId: Id;
  franchiseeName: string;
  franchiseeTaxId: string;
  contactEmail: string;
  /** Royalty on net sales, percent (e.g. 6 or 5.5). */
  royaltyPercent: number;
  /** Marketing fund contribution on net sales, percent. 0 for none. */
  marketingFundPercent: number;
  /** Floor per monthly statement, minor units in the branch currency. */
  minimumMonthlyFeeMinor: number;
  /** FR-BRN-035 — domains the franchisee may not change. */
  lockedDomains: FranchiseDomain[];
  /** FR-BRN-037 — suppliers the franchisee must buy from. Empty: no mandate. */
  mandatedSupplierIds: Id[];
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  active: boolean;
  updatedAt: IsoDateTime;
}

export const DEFAULT_LOCKS: FranchiseDomain[] = ["menu", "recipes", "pricing"];

export interface FranchiseLock {
  locked: boolean;
  /** True when the lock applies but this person may override it as franchisor. */
  franchisorOverride: boolean;
  agreement: FranchiseAgreement | null;
}

/**
 * FR-BRN-035 — may this person change `domain` at `branchId`? Blocked when an
 * active agreement locks the domain and the person lacks franchisor authority.
 */
export function franchiseLockFor(
  agreements: FranchiseAgreement[],
  branchId: Id | null,
  domain: FranchiseDomain,
  isFranchisor: boolean,
  today: IsoDate,
): FranchiseLock {
  const agreement = branchId ? agreements.find((row) => row.branchId === branchId && agreementInForce(row, today)) ?? null : null;
  const applies = Boolean(agreement?.lockedDomains.includes(domain));
  return { locked: applies && !isFranchisor, franchisorOverride: applies && isFranchisor, agreement };
}

export function agreementInForce(agreement: FranchiseAgreement, today: IsoDate): boolean {
  return agreement.active && agreement.startsOn <= today && (!agreement.endsOn || agreement.endsOn >= today);
}

export function agreementProblem(input: Partial<FranchiseAgreement>): string | null {
  if (!input.branchId) return "Choose the franchised branch.";
  if (!input.franchiseeName?.trim()) return "Name the franchisee.";
  const pct = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
  if (!pct(input.royaltyPercent)) return "The royalty must be a percentage between 0 and 100.";
  if (!pct(input.marketingFundPercent)) return "The marketing fund must be a percentage between 0 and 100.";
  if ((input.royaltyPercent ?? 0) + (input.marketingFundPercent ?? 0) > 50) {
    return "Royalty and marketing fund together exceed 50% of net sales — check the figures.";
  }
  if (!input.startsOn) return "Give the date the agreement starts.";
  if (input.endsOn && input.endsOn < input.startsOn) return "The agreement cannot end before it starts.";
  if ((input.minimumMonthlyFeeMinor ?? 0) < 0) return "The minimum fee cannot be negative.";
  return null;
}

// ---------------------------------------------------------------------------
// Royalties — FR-BRN-036
// ---------------------------------------------------------------------------

/** Orders that count as sales. Cancelled, merged and still-open orders do not. */
const SALE_STATES = new Set<Order["state"]>(["completed", "partially_refunded"]);

/** Net sales of one order: subtotal less discounts, before tax and service. */
export function orderNetSales(order: Order): number {
  return order.subtotal.amount - order.discountTotal.amount;
}

export interface RoyaltyStatement {
  id: Id;
  branchId: Id;
  franchiseeName: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  currency: Money["currency"];
  orderCount: number;
  netSalesMinor: number;
  royaltyPercent: number;
  marketingFundPercent: number;
  royaltyMinor: number;
  marketingFundMinor: number;
  /** Added when the percentage fell short of the monthly minimum. */
  minimumTopUpMinor: number;
  totalDueMinor: number;
  status: "draft" | "issued" | "void";
  /** True when the order read hit its cap — the figure may be incomplete. */
  truncated: boolean;
  computedAt: IsoDateTime;
  issuedAt: IsoDateTime | null;
  issuedBy: string | null;
}

/** percent (up to 4 dp) of minor units, half-up, exact. */
export function percentOfMinor(minor: number, percent: number): number {
  const basisTenThousandths = BigInt(Math.round(percent * 10_000));
  const product = BigInt(minor) * basisTenThousandths;
  const divisor = 1_000_000n;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs * 2n + divisor) / (divisor * 2n);
  return Number(negative ? -rounded : rounded);
}

/** Whole months covered by a period, at least one — for the minimum fee. */
export function monthsInPeriod(start: IsoDate, end: IsoDate): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return Math.max(1, (ey! - sy!) * 12 + (em! - sm!) + 1);
}

export function computeRoyalty(
  agreement: FranchiseAgreement,
  orders: Order[],
  periodStart: IsoDate,
  periodEnd: IsoDate,
  currency: Money["currency"],
  truncated: boolean,
): Omit<RoyaltyStatement, "id" | "status" | "computedAt" | "issuedAt" | "issuedBy"> {
  const inPeriod = orders.filter(
    (order) =>
      order.branchId === agreement.branchId &&
      SALE_STATES.has(order.state) &&
      order.businessDay >= periodStart &&
      order.businessDay <= periodEnd &&
      order.currency === currency,
  );
  const netSalesMinor = inPeriod.reduce((sum, order) => sum + orderNetSales(order), 0);
  const royaltyMinor = percentOfMinor(netSalesMinor, agreement.royaltyPercent);
  const marketingFundMinor = percentOfMinor(netSalesMinor, agreement.marketingFundPercent);
  const minimum = agreement.minimumMonthlyFeeMinor * monthsInPeriod(periodStart, periodEnd);
  const minimumTopUpMinor = Math.max(0, minimum - royaltyMinor);
  return {
    branchId: agreement.branchId,
    franchiseeName: agreement.franchiseeName,
    periodStart,
    periodEnd,
    currency,
    orderCount: inPeriod.length,
    netSalesMinor,
    royaltyPercent: agreement.royaltyPercent,
    marketingFundPercent: agreement.marketingFundPercent,
    royaltyMinor,
    marketingFundMinor,
    minimumTopUpMinor,
    totalDueMinor: royaltyMinor + marketingFundMinor + minimumTopUpMinor,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Compliance — FR-BRN-037
// ---------------------------------------------------------------------------

export interface OffListPurchase {
  purchaseOrderId: Id;
  reference: string;
  supplierName: Localised;
  total: Money;
  createdAt: IsoDateTime;
}

export interface ComplianceRow {
  branchId: Id;
  menu: MenuDeviation | null;
  prices: PriceDeviation[];
  recipes: RecipeDeviation[];
  offListPurchases: OffListPurchase[];
  /** 100 = no finding. Each finding class costs a fixed share. */
  score: number;
  findings: number;
}

export function complianceScore(row: Omit<ComplianceRow, "score" | "findings">): { score: number; findings: number } {
  const menuFindings = (row.menu?.missing.length ?? 0) + (row.menu?.extra.length ?? 0);
  const priceFindings = row.prices.filter((price) => price.beyondTolerance).length;
  const recipeFindings = row.recipes.filter((recipe) => recipe.override.status !== "approved").length;
  const supplierFindings = row.offListPurchases.length;
  const findings = menuFindings + priceFindings + recipeFindings + supplierFindings;
  const penalty =
    Math.min(25, menuFindings * 10) +
    Math.min(25, priceFindings * 5) +
    Math.min(25, recipeFindings * 10) +
    Math.min(25, supplierFindings * 10);
  return { score: 100 - penalty, findings };
}
