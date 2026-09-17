/**
 * Procure-to-pay rules — SRS ch.12.
 *
 * Everything here is pure: no services, no React, no storage. The screens
 * call these to decide what to show and the procurement service calls the
 * same functions to decide what to refuse, so a rule cannot be satisfied in
 * the UI and broken in the write (or the other way round).
 *
 * Money is minor units, quantities are decimal strings, dates are ISO
 * `YYYY-MM-DD`. Dates are compared as strings — ISO dates sort correctly —
 * and day arithmetic is done in UTC so a DST change cannot move a due date.
 */

import type { Id, IsoDate, Localised, PurchaseOrderLine, UnitCode, User } from "./types";
import { decimalCompare, decimalDiv, isPositiveDecimal, toScaled } from "./stock-units";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function addDays(date: IsoDate, days: number): IsoDate {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) return date;
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(x) || Number.isNaN(y)) return 0;
  return Math.round((y - x) / DAY_MS);
}

// ---------------------------------------------------------------------------
// FR-PRC-001 / FR-PRC-002 — the configurable procure-to-pay cycle
// ---------------------------------------------------------------------------

export type ProcurementStep =
  | "requisition"
  | "poApproval"
  | "goodsReceipt"
  | "threeWayMatch"
  | "paymentApproval";

/** In the order money moves; the purchase order itself is not skippable. */
export const PROCUREMENT_STEPS: ProcurementStep[] = [
  "requisition",
  "poApproval",
  "goodsReceipt",
  "threeWayMatch",
  "paymentApproval",
];

export type ApprovedSupplierMode = "off" | "warn" | "block";

export interface MatchTolerances {
  /** FR-PRC-041 — invoice quantity against receipt. Default 0%. */
  quantityPercent: number;
  /** FR-PRC-041 — invoice unit price against the PO. Default 2%. */
  pricePercent: number;
  /** FR-PRC-041 — computed total against the stated total, in minor units. */
  totalMinor: number;
}

export interface ProcurementPolicy {
  /** FR-PRC-001 — each optional step, on or skipped. */
  steps: Record<ProcurementStep, boolean>;
  /** FR-PRC-002 — order and receipt captured together at the door. */
  simpleMode: boolean;
  /** FR-PRC-010 — what happens when a category is bought off-list. */
  approvedSupplierMode: ApprovedSupplierMode;
  /** FR-PRC-011 — how far ahead an expiring document starts alerting. */
  complianceAlertDays: number;
  /** FR-PRC-011 — refuse new orders to a supplier with an expired document. */
  blockExpiredCompliance: boolean;
  tolerances: MatchTolerances;
  /** FR-PRC-020 — lifetime of an emailed approval link. */
  approvalLinkHours: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_POLICY: ProcurementPolicy = {
  steps: {
    requisition: true,
    poApproval: true,
    goodsReceipt: true,
    threeWayMatch: true,
    paymentApproval: true,
  },
  simpleMode: false,
  approvedSupplierMode: "warn",
  complianceAlertDays: 30,
  blockExpiredCompliance: false,
  tolerances: { quantityPercent: 0, pricePercent: 2, totalMinor: 1 },
  approvalLinkHours: 48,
  updatedAt: null,
  updatedBy: null,
};

export type PolicyProblem =
  | "match_needs_receipt"
  | "simple_needs_receipt"
  | "simple_conflicts_approval"
  | "bad_tolerance"
  | "bad_alert_days"
  | "bad_link_hours";

/**
 * FR-PRC-001 — combinations that cannot be operated.
 *
 * A three-way match without a receipt has nothing to match against, and
 * simple mode *is* a receipt, captured at the door — it cannot wait for an
 * approver, so it cannot coexist with mandatory PO approval.
 */
export function policyProblems(policy: ProcurementPolicy): PolicyProblem[] {
  const out: PolicyProblem[] = [];
  if (policy.steps.threeWayMatch && !policy.steps.goodsReceipt) out.push("match_needs_receipt");
  if (policy.simpleMode && !policy.steps.goodsReceipt) out.push("simple_needs_receipt");
  if (policy.simpleMode && policy.steps.poApproval) out.push("simple_conflicts_approval");
  const tol = policy.tolerances;
  if (
    !(tol.quantityPercent >= 0 && tol.quantityPercent <= 50) ||
    !(tol.pricePercent >= 0 && tol.pricePercent <= 50) ||
    !(Number.isInteger(tol.totalMinor) && tol.totalMinor >= 0)
  ) {
    out.push("bad_tolerance");
  }
  if (!(Number.isInteger(policy.complianceAlertDays) && policy.complianceAlertDays >= 1 && policy.complianceAlertDays <= 365)) {
    out.push("bad_alert_days");
  }
  if (!(Number.isInteger(policy.approvalLinkHours) && policy.approvalLinkHours >= 1 && policy.approvalLinkHours <= 168)) {
    out.push("bad_link_hours");
  }
  return out;
}

// ---------------------------------------------------------------------------
// FR-PRC-018 / FR-PRC-019 / FR-PRC-023 — approval
// ---------------------------------------------------------------------------

export type ApprovalTier = 0 | 1 | 2 | 3;

/** FR-PRC-018 — the same bands the order service derives. */
export function tierForTotal(totalMinor: number): ApprovalTier {
  if (totalMinor < 500_00) return 0;
  if (totalMinor < 5_000_00) return 1;
  if (totalMinor < 25_000_00) return 2;
  return 3;
}

/** The permissions that may approve an order in `tier` — a higher band covers the lower. */
export function approvalPermissionsFor(tier: ApprovalTier) {
  const all = [
    "purchase.order.approve_tier_1",
    "purchase.order.approve_tier_2",
    "purchase.order.approve_tier_3",
  ] as const;
  return all.slice(Math.max(0, tier - 1));
}

/**
 * FR-PRC-019 — the requester SHALL NOT approve their own requisition or order.
 *
 * The id is authoritative. Rows raised before ids were recorded carry only a
 * display name, and for those a name match is treated as the same person —
 * refusing a legitimate approver by accident is recoverable (someone else
 * approves); letting a requester through is not.
 */
export function isSelfApproval(
  requester: { id: Id | null; name: Localised | string | null },
  user: Pick<User, "id" | "name"> | null,
): boolean {
  if (!user) return false;
  if (requester.id) return requester.id === user.id;
  if (!requester.name) return false;
  const names = typeof requester.name === "string" ? [requester.name] : [requester.name.en, requester.name.ar];
  const mine = [user.name.en, user.name.ar].map((value) => value.trim().toLowerCase()).filter(Boolean);
  return names.some((value) => mine.includes(value.trim().toLowerCase()));
}

/**
 * FR-PRC-023 — does an amendment need approving again?
 *
 * Only when the value climbs out of the band it was approved in. A decrease,
 * or an increase that stays inside the band, keeps the approval: the approver
 * already agreed to spend up to that band's ceiling.
 */
export function amendmentNeedsReapproval(approvedTier: ApprovalTier | null, newTotalMinor: number): boolean {
  if (approvedTier === null) return false;
  return tierForTotal(newTotalMinor) > approvedTier;
}

/** FR-PRC-023 — amendable until goods arrive. */
export function isAmendable(status: string): boolean {
  return status === "draft" || status === "pending_approval" || status === "approved" || status === "sent";
}

// ---------------------------------------------------------------------------
// FR-PRC-006 / FR-PRC-007 — price lists and comparative pricing
// ---------------------------------------------------------------------------

export interface PriceTier {
  /** Order quantity (in the entry's unit) from which this price applies. */
  minQuantity: string;
  /** Price per pack at or above `minQuantity`. */
  priceMinor: number;
}

export interface SupplierPriceEntry {
  id: Id;
  supplierId: Id;
  itemId: Id;
  itemName: Localised;
  /** The supplier's own code for the item, printed on their documents. */
  supplierItemCode: string;
  /** The unit an order line is placed in. */
  unit: UnitCode;
  /** How many `unit`s one priced pack holds. "1" when priced per unit. */
  packSize: string;
  /** Price per pack, minor units. */
  priceMinor: number;
  currency: string;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  tiers: PriceTier[];
  createdAt: string;
  updatedAt: string;
}

export type PriceEntryProblem =
  | "no_supplier"
  | "no_item"
  | "bad_pack"
  | "bad_price"
  | "bad_window"
  | "bad_tier"
  | "tier_order"
  | "overlap";

/** FR-PRC-006 — what makes an entry unusable, including an overlapping window. */
export function priceEntryProblems(entry: Omit<SupplierPriceEntry, "id" | "createdAt" | "updatedAt"> & { id?: Id }, others: SupplierPriceEntry[]): PriceEntryProblem[] {
  const out: PriceEntryProblem[] = [];
  if (!entry.supplierId) out.push("no_supplier");
  if (!entry.itemId) out.push("no_item");
  if (!isPositiveDecimal(entry.packSize)) out.push("bad_pack");
  if (!(Number.isInteger(entry.priceMinor) && entry.priceMinor > 0)) out.push("bad_price");
  if (!entry.validFrom || (entry.validTo && entry.validTo < entry.validFrom)) out.push("bad_window");
  let previous: string | null = null;
  for (const tier of entry.tiers) {
    if (!isPositiveDecimal(tier.minQuantity) || !(Number.isInteger(tier.priceMinor) && tier.priceMinor > 0)) {
      out.push("bad_tier");
      break;
    }
    if (previous !== null && decimalCompare(tier.minQuantity, previous) <= 0) {
      out.push("tier_order");
      break;
    }
    previous = tier.minQuantity;
  }
  // Two live prices for the same thing on the same day is an ambiguity the
  // order form would have to guess its way out of.
  const clash = others.some(
    (other) =>
      other.id !== entry.id &&
      other.supplierId === entry.supplierId &&
      other.itemId === entry.itemId &&
      other.unit === entry.unit &&
      windowsOverlap(other.validFrom, other.validTo, entry.validFrom, entry.validTo),
  );
  if (clash) out.push("overlap");
  return out;
}

function windowsOverlap(aFrom: IsoDate, aTo: IsoDate | null, bFrom: IsoDate, bTo: IsoDate | null): boolean {
  const aEnd = aTo ?? "9999-12-31";
  const bEnd = bTo ?? "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

export function isEntryValidOn(entry: SupplierPriceEntry, on: IsoDate): boolean {
  return entry.validFrom <= on && (entry.validTo === null || entry.validTo >= on);
}

export interface ResolvedPrice {
  entry: SupplierPriceEntry;
  /** Per pack, after volume tiers. */
  packPriceMinor: number;
  /** Per `unit`, rounded to the minor unit — what a PO line carries. */
  unitPriceMinor: number;
  tier: PriceTier | null;
}

/**
 * FR-PRC-006 — the price that applies to `quantity` of an item on `on`.
 *
 * The highest tier the quantity reaches wins. `null` when the supplier has no
 * valid entry in that unit — a missing price is reported, never guessed.
 */
export function resolvePrice(
  entries: SupplierPriceEntry[],
  supplierId: Id,
  itemId: Id,
  unit: UnitCode | null,
  quantity: string,
  on: IsoDate,
): ResolvedPrice | null {
  const entry = entries.find(
    (row) =>
      row.supplierId === supplierId &&
      row.itemId === itemId &&
      (unit === null || row.unit === unit) &&
      isEntryValidOn(row, on),
  );
  if (!entry) return null;
  const qty = toScaled(quantity || "0") ?? BigInt(0);
  let tier: PriceTier | null = null;
  for (const candidate of entry.tiers) {
    const min = toScaled(candidate.minQuantity);
    if (min !== null && qty >= min) tier = candidate;
  }
  const packPriceMinor = tier?.priceMinor ?? entry.priceMinor;
  const perUnit = decimalDiv(String(packPriceMinor), entry.packSize);
  return {
    entry,
    packPriceMinor,
    unitPriceMinor: perUnit === null ? packPriceMinor : Math.round(Number(perUnit)),
    tier,
  };
}

export interface PriceComparisonRow {
  supplierId: Id;
  /** 1-based position in the item's preference ranking; null when unranked. */
  rank: number | null;
  price: ResolvedPrice | null;
  /** Minor units above the cheapest priced supplier; 0 for the cheapest. */
  premiumMinor: number | null;
}

/**
 * FR-PRC-007 — every supplier that sells the item, preferred first, with the
 * price each would charge for this quantity today.
 */
export function comparePrices(
  entries: SupplierPriceEntry[],
  ranking: Id[],
  itemId: Id,
  unit: UnitCode | null,
  quantity: string,
  on: IsoDate,
): PriceComparisonRow[] {
  const supplierIds = new Set<Id>(ranking);
  for (const entry of entries) if (entry.itemId === itemId) supplierIds.add(entry.supplierId);

  const rows: PriceComparisonRow[] = [...supplierIds].map((supplierId) => {
    const position = ranking.indexOf(supplierId);
    return {
      supplierId,
      rank: position === -1 ? null : position + 1,
      price: resolvePrice(entries, supplierId, itemId, unit, quantity, on),
      premiumMinor: null,
    };
  });
  const priced = rows.filter((row) => row.price).map((row) => row.price!.unitPriceMinor);
  const cheapest = priced.length > 0 ? Math.min(...priced) : null;
  for (const row of rows) {
    row.premiumMinor = row.price && cheapest !== null ? row.price.unitPriceMinor - cheapest : null;
  }
  return rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
}

// ---------------------------------------------------------------------------
// FR-PRC-010 — approved suppliers per category
// ---------------------------------------------------------------------------

export interface ApprovedSupplierList {
  /** The category key — its English name, lower-cased. */
  id: string;
  category: Localised;
  supplierIds: Id[];
  updatedAt: string;
  updatedBy: string | null;
}

export function categoryKey(category: Localised): string {
  return (category.en || category.ar).trim().toLowerCase();
}

export type ApprovedSupplierVerdict = "unrestricted" | "approved" | "warn" | "block";

/**
 * FR-PRC-010 — may this supplier be ordered from for this category?
 *
 * A category with no list is unrestricted: an empty list would otherwise
 * block every category the day the feature is switched on.
 */
export function approvedSupplierVerdict(
  lists: ApprovedSupplierList[],
  category: Localised,
  supplierId: Id,
  mode: ApprovedSupplierMode,
): ApprovedSupplierVerdict {
  if (mode === "off") return "unrestricted";
  const list = lists.find((row) => row.id === categoryKey(category));
  if (!list || list.supplierIds.length === 0) return "unrestricted";
  if (list.supplierIds.includes(supplierId)) return "approved";
  return mode;
}

// ---------------------------------------------------------------------------
// FR-PRC-011 — compliance documents
// ---------------------------------------------------------------------------

export type ComplianceKind = "food_safety" | "licence" | "insurance" | "halal" | "other";
export const COMPLIANCE_KINDS: ComplianceKind[] = ["food_safety", "licence", "insurance", "halal", "other"];

export type ComplianceState = "valid" | "expiring" | "expired";

export function complianceState(expiresOn: IsoDate, today: IsoDate, alertDays: number): ComplianceState {
  if (expiresOn < today) return "expired";
  if (daysBetween(today, expiresOn) <= alertDays) return "expiring";
  return "valid";
}

// ---------------------------------------------------------------------------
// FR-PRC-016 — consolidation with branch attribution
// ---------------------------------------------------------------------------

export interface BranchAllocation {
  itemId: Id;
  branchId: Id;
  branchName: Localised;
  requisitionId: Id;
  requisitionRef: string;
  quantity: string;
  unit: UnitCode;
  /** Share of the consolidated line's cost, minor units. */
  costMinor: number;
}

export interface ConsolidatedLine {
  itemId: Id;
  itemName: Localised;
  unit: UnitCode;
  quantity: string;
  allocations: BranchAllocation[];
}

/**
 * Split a line's cost across the branches that asked for it, in proportion
 * to quantity, by largest remainder so the shares sum to the line exactly.
 */
export function allocateCost(totalMinor: number, quantities: string[]): number[] {
  const weights = quantities.map((value) => Number(value) || 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (totalMinor * weight) / sum);
  const floors = raw.map(Math.floor);
  let left = totalMinor - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors;
}

// ---------------------------------------------------------------------------
// FR-PRC-042 — match evaluation with configurable tolerances
// ---------------------------------------------------------------------------

export interface MatchCheckResult {
  check: "quantity" | "price" | "total";
  expected: number;
  stated: number;
  /** Percentage drift for quantity and price; minor units for total. */
  drift: number;
  tolerance: number;
  ok: boolean;
}

/**
 * FR-PRC-041/042 — the three checks, each against the tenant's tolerance.
 *
 * Quantity compares invoiced goods value at receipt prices with the receipt
 * value (a restaurant invoice rarely restates quantities line by line, and
 * value at agreed price is the quantity signal that survives that).
 */
export function evaluateMatch(input: {
  receiptValueMinor: number;
  orderValueMinor: number | null;
  invoiceSubtotalMinor: number;
  invoiceTaxMinor: number;
  invoiceTotalMinor: number;
  tolerances: MatchTolerances;
}): MatchCheckResult[] {
  const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 100) : Math.abs((a - b) / b) * 100);
  const reference = input.orderValueMinor ?? input.receiptValueMinor;
  const quantityDrift = pct(input.invoiceSubtotalMinor, input.receiptValueMinor);
  const priceDrift = pct(input.invoiceSubtotalMinor, reference);
  const computed = input.invoiceSubtotalMinor + input.invoiceTaxMinor;
  const totalDrift = Math.abs(computed - input.invoiceTotalMinor);
  return [
    {
      check: "quantity",
      expected: input.receiptValueMinor,
      stated: input.invoiceSubtotalMinor,
      drift: quantityDrift,
      tolerance: input.tolerances.quantityPercent,
      ok: quantityDrift <= input.tolerances.quantityPercent + 1e-9,
    },
    {
      check: "price",
      expected: reference,
      stated: input.invoiceSubtotalMinor,
      drift: priceDrift,
      tolerance: input.tolerances.pricePercent,
      ok: priceDrift <= input.tolerances.pricePercent + 1e-9,
    },
    {
      check: "total",
      expected: computed,
      stated: input.invoiceTotalMinor,
      drift: totalDrift,
      tolerance: input.tolerances.totalMinor,
      ok: totalDrift <= input.tolerances.totalMinor,
    },
  ];
}

// ---------------------------------------------------------------------------
// FR-PRC-044 — ageing
// ---------------------------------------------------------------------------

export type AgeingBand = "current" | "1_30" | "31_60" | "61_90" | "90_plus";
export const AGEING_BANDS: AgeingBand[] = ["current", "1_30", "31_60", "61_90", "90_plus"];

/** Days past due decide the band; not yet due is current. */
export function ageingBand(dueDate: IsoDate, asOf: IsoDate): AgeingBand {
  const overdue = daysBetween(dueDate, asOf);
  if (overdue <= 0) return "current";
  if (overdue <= 30) return "1_30";
  if (overdue <= 60) return "31_60";
  if (overdue <= 90) return "61_90";
  return "90_plus";
}

// ---------------------------------------------------------------------------
// FR-PRC-045 — early-settlement discounts
// ---------------------------------------------------------------------------

export interface SettlementTerms {
  earlyDiscountPercent: number;
  earlyDiscountDays: number;
}

export interface SettlementOption {
  /** Pay by this date to take the discount; null when none applies. */
  discountDeadline: IsoDate | null;
  discountMinor: number;
}

export function settlementOption(
  invoiceDate: IsoDate,
  outstandingMinor: number,
  terms: SettlementTerms | null,
  asOf: IsoDate,
): SettlementOption {
  if (!terms || terms.earlyDiscountPercent <= 0 || terms.earlyDiscountDays <= 0) {
    return { discountDeadline: null, discountMinor: 0 };
  }
  const deadline = addDays(invoiceDate, terms.earlyDiscountDays);
  if (deadline < asOf) return { discountDeadline: null, discountMinor: 0 };
  return {
    discountDeadline: deadline,
    discountMinor: Math.round((outstandingMinor * terms.earlyDiscountPercent) / 100),
  };
}

// ---------------------------------------------------------------------------
// Order lines
// ---------------------------------------------------------------------------

export function linesTotal(lines: PurchaseOrderLine[]): { subtotal: number; tax: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    const net = Math.round(Number(line.quantity.value || 0) * line.unitPrice.amount);
    subtotal += net;
    tax += Math.round(net * (line.taxRate / 100));
  }
  return { subtotal, tax, total: subtotal + tax };
}
