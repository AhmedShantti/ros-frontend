"use client";

/**
 * Procure-to-pay controls the backend has no model for — SRS ch.12.
 *
 * The backend serves no purchasing domain at all (see `API_COVERAGE` in
 * `./http`), so everything a purchasing control needs to *remember* is kept
 * here, behind one interface a server can take over: the tenant's P2P policy,
 * price lists and supplier ranking, approved-supplier lists, compliance
 * documents, the approval / amendment / transmission history of each order,
 * approval links, receipt postings, supplier returns, credit notes, payments,
 * payment proposals and invoice captures.
 *
 * What moves stock does not stay here. Receipts and returns post
 * `purchase_receipt` / `purchase_return` movements through the inventory
 * service — the real `POST /inventory/movements` when connected — one leg per
 * line, with each movement id written back as it lands so a retry never posts
 * the same line twice (the same pattern as `./production`).
 *
 * Callers pass the services a write depends on (`deps`) rather than this file
 * importing the registry, which would be a cycle: the registry imports this.
 */

import type {
  GoodsReceipt,
  Id,
  IsoDate,
  IsoDateTime,
  Localised,
  PurchaseOrder,
  PurchaseOrderLine,
  Requisition,
  StockItem,
  SupplierInvoice,
  UnitCode,
} from "../types";
import { localCollection, localDocument, nowIso } from "../local-store";
import {
  DEFAULT_POLICY,
  amendmentNeedsReapproval,
  approvalPermissionsFor,
  isAmendable,
  isSelfApproval,
  linesTotal,
  policyProblems,
  priceEntryProblems,
  tierForTotal,
  type ApprovalTier,
  type ApprovedSupplierList,
  type BranchAllocation,
  type ComplianceKind,
  type SupplierPriceEntry,
  type ProcurementPolicy,
  type SettlementTerms,
} from "../purchasing-rules";
import { decimalCompare, decimalDiv, decimalMul, decimalSub, isPositiveDecimal } from "../stock-units";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type InventoryService, type PurchasingService } from "./types";

const tenant = () => getActiveTenantId();

/** Who is acting. `can` is the session's permission check. */
export interface Actor {
  id: Id | null;
  name: string;
  can?: (permission: string) => boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextNumber(prefix: string, taken: string[]): string {
  let max = 0;
  for (const value of taken) {
    const match = value.match(/-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// FR-PRC-001 / 002 — policy
// ---------------------------------------------------------------------------

const policyDoc = localDocument<ProcurementPolicy>("prc-policy", () => structuredClone(DEFAULT_POLICY), tenant);

// ---------------------------------------------------------------------------
// FR-PRC-006 / 007 / 010 / 011 — sourcing and suppliers
// ---------------------------------------------------------------------------

const priceEntries = localCollection<SupplierPriceEntry>(
  {
    name: "prc-price-lists",
    idOf: (row) => row.id,
    search: (row) => [row.itemName, row.supplierItemCode],
    filters: { supplierId: (row) => row.supplierId, itemId: (row) => row.itemId },
    sorters: { validFrom: (row) => row.validFrom, item: (row) => row.itemName.en },
    factory: (input, id) => ({
      id,
      supplierId: input.supplierId ?? "",
      itemId: input.itemId ?? "",
      itemName: input.itemName ?? { en: "", ar: "" },
      supplierItemCode: input.supplierItemCode ?? "",
      unit: input.unit ?? "pc",
      packSize: input.packSize ?? "1",
      priceMinor: input.priceMinor ?? 0,
      currency: input.currency ?? "EGP",
      validFrom: input.validFrom ?? new Date().toISOString().slice(0, 10),
      validTo: input.validTo ?? null,
      tiers: input.tiers ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  tenant,
);

/** FR-PRC-007 — an item's suppliers in order of preference. */
export interface ItemSourcing {
  id: Id;
  itemId: Id;
  supplierIds: Id[];
  updatedAt: IsoDateTime;
}

const sourcing = localCollection<ItemSourcing>(
  {
    name: "prc-sourcing",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.itemId ?? id,
      itemId: input.itemId ?? id,
      supplierIds: input.supplierIds ?? [],
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  tenant,
);

const approvedLists = localCollection<ApprovedSupplierList>(
  {
    name: "prc-approved-suppliers",
    idOf: (row) => row.id,
    search: (row) => [row.category],
    factory: (input, id) => ({
      id: input.id ?? id,
      category: input.category ?? { en: "", ar: "" },
      supplierIds: input.supplierIds ?? [],
      updatedAt: nowIso(),
      updatedBy: input.updatedBy ?? null,
    }),
  },
  tenant,
);

export interface StoredFile {
  name: string;
  type: string;
  size: number;
  /** Null when the file was too large to keep in this browser. */
  dataUrl: string | null;
}

/** FR-PRC-011 — a certificate, licence or policy with an expiry date. */
export interface ComplianceDocument {
  id: Id;
  supplierId: Id;
  kind: ComplianceKind;
  title: string;
  reference: string;
  issuedOn: IsoDate | null;
  expiresOn: IsoDate;
  file: StoredFile | null;
  notes: string;
  createdAt: IsoDateTime;
  createdBy: string | null;
  /** Set when a renewal was uploaded in its place. The old one is kept. */
  supersededBy: Id | null;
}

const complianceDocs = localCollection<ComplianceDocument>(
  {
    name: "prc-compliance",
    idOf: (row) => row.id,
    search: (row) => [row.title, row.reference],
    filters: { supplierId: (row) => row.supplierId, kind: (row) => row.kind },
    sorters: { expiresOn: (row) => row.expiresOn },
    factory: (input, id) => ({
      id,
      supplierId: input.supplierId ?? "",
      kind: input.kind ?? "other",
      title: input.title ?? "",
      reference: input.reference ?? "",
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? "",
      file: input.file ?? null,
      notes: input.notes ?? "",
      createdAt: nowIso(),
      createdBy: input.createdBy ?? null,
      supersededBy: null,
    }),
  },
  tenant,
);

/** FR-PRC-021 / FR-PRC-045 — supplier details the master has no field for. */
export interface SupplierTerms extends SettlementTerms {
  id: Id;
  supplierId: Id;
  whatsapp: string;
  orderEmail: string;
  portalUrl: string;
  updatedAt: IsoDateTime;
}

const supplierTerms = localCollection<SupplierTerms>(
  {
    name: "prc-supplier-terms",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.supplierId ?? id,
      supplierId: input.supplierId ?? id,
      earlyDiscountPercent: input.earlyDiscountPercent ?? 0,
      earlyDiscountDays: input.earlyDiscountDays ?? 0,
      whatsapp: input.whatsapp ?? "",
      orderEmail: input.orderEmail ?? "",
      portalUrl: input.portalUrl ?? "",
      updatedAt: nowIso(),
    }),
    onUpdate: (row, patch) => ({ ...row, ...patch, updatedAt: nowIso() }),
  },
  tenant,
);

// ---------------------------------------------------------------------------
// FR-PRC-016 / 019 / 020 / 021 / 023 — order workflow
// ---------------------------------------------------------------------------

export type ApprovalChannel = "console" | "mobile" | "email_link";

export interface ApprovalEvent {
  at: IsoDateTime;
  byId: Id | null;
  byName: string;
  channel: ApprovalChannel;
  decision: "approved" | "rejected";
  tier: ApprovalTier;
  totalMinor: number;
  note: string;
}

export interface OrderSnapshot {
  lines: PurchaseOrderLine[];
  totalMinor: number;
  expectedDelivery: IsoDate;
  status: PurchaseOrder["status"];
}

export interface Amendment {
  id: Id;
  at: IsoDateTime;
  byId: Id | null;
  byName: string;
  reason: string;
  before: OrderSnapshot;
  after: OrderSnapshot;
  reapprovalRequired: boolean;
}

export type TransmissionChannel = "email" | "whatsapp" | "portal";

export interface Transmission {
  id: Id;
  at: IsoDateTime;
  byName: string;
  channel: TransmissionChannel;
  recipient: string;
  /**
   * What actually happened. Nothing here claims delivery: the browser can
   * build the documents and hand them to a mail client or WhatsApp, and only
   * the person sending knows whether they pressed send.
   */
  outcome: "documents_prepared" | "handed_to_whatsapp" | "confirmed_sent";
  attachments: string[];
}

export type OrderSource = "manual" | "suggested" | "consolidated" | "simple_mode";

export interface OrderWorkflow {
  id: Id;
  orderId: Id;
  source: OrderSource;
  requesterId: Id | null;
  requesterName: string;
  submittedAt: IsoDateTime;
  /** The band the current approval covers; null until approved. */
  approvedTier: ApprovalTier | null;
  approvedTotalMinor: number | null;
  approvals: ApprovalEvent[];
  amendments: Amendment[];
  transmissions: Transmission[];
  /** FR-PRC-016 — who asked for what, when this order came from requisitions. */
  allocations: BranchAllocation[];
  requisitionIds: Id[];
  /** FR-PRC-010 — categories ordered from a supplier not on their approved list (warn mode). */
  offListCategories: string[];
}

const workflows = localCollection<OrderWorkflow>(
  {
    name: "prc-order-workflow",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.orderId ?? id,
      orderId: input.orderId ?? id,
      source: input.source ?? "manual",
      requesterId: input.requesterId ?? null,
      requesterName: input.requesterName ?? "",
      submittedAt: nowIso(),
      approvedTier: input.approvedTier ?? null,
      approvedTotalMinor: input.approvedTotalMinor ?? null,
      approvals: input.approvals ?? [],
      amendments: input.amendments ?? [],
      transmissions: input.transmissions ?? [],
      allocations: input.allocations ?? [],
      requisitionIds: input.requisitionIds ?? [],
      offListCategories: input.offListCategories ?? [],
    }),
  },
  tenant,
);

/** FR-PRC-020 — an approval link. Only the token's hash is kept. */
export interface ApprovalLink {
  id: Id;
  orderId: Id;
  orderRef: string;
  tokenHash: string;
  approverEmail: string;
  createdAt: IsoDateTime;
  createdBy: string;
  expiresAt: IsoDateTime;
  usedAt: IsoDateTime | null;
  usedBy: string | null;
  decision: "approved" | "rejected" | null;
  revokedAt: IsoDateTime | null;
}

const approvalLinks = localCollection<ApprovalLink>(
  {
    name: "prc-approval-links",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id,
      orderId: input.orderId ?? "",
      orderRef: input.orderRef ?? "",
      tokenHash: input.tokenHash ?? "",
      approverEmail: input.approverEmail ?? "",
      createdAt: nowIso(),
      createdBy: input.createdBy ?? "",
      expiresAt: input.expiresAt ?? nowIso(),
      usedAt: null,
      usedBy: null,
      decision: null,
      revokedAt: null,
    }),
  },
  tenant,
);

export type LinkState = "valid" | "expired" | "used" | "revoked" | "unknown";

export function linkState(link: ApprovalLink | null, now = Date.now()): LinkState {
  if (!link) return "unknown";
  if (link.revokedAt) return "revoked";
  if (link.usedAt) return "used";
  if (Date.parse(link.expiresAt) <= now) return "expired";
  return "valid";
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** FR-PRC-019 — a requisition's requester and the decisions taken on it. */
export interface RequisitionReview {
  id: Id;
  requisitionId: Id;
  requesterId: Id | null;
  requesterName: string;
  decisions: { at: IsoDateTime; byId: Id | null; byName: string; decision: "approved" | "rejected"; note: string; channel: ApprovalChannel }[];
}

const requisitionReviews = localCollection<RequisitionReview>(
  {
    name: "prc-requisition-reviews",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.requisitionId ?? id,
      requisitionId: input.requisitionId ?? id,
      requesterId: input.requesterId ?? null,
      requesterName: input.requesterName ?? "",
      decisions: input.decisions ?? [],
    }),
  },
  tenant,
);

// ---------------------------------------------------------------------------
// FR-PRC-032 / 034 / 037 — receipts and returns
// ---------------------------------------------------------------------------

export interface PostingLeg {
  lineId: Id;
  itemId: Id;
  itemName: Localised;
  /** Base-unit quantity sent to the ledger (positive; direction gives the sign). */
  quantity: string;
  unit: UnitCode;
  unitCostMinor: string | null;
  batchNumber: string | null;
  expiryDate: IsoDate | null;
  movementId: Id | null;
  /** FR-PRC-032 — null when the ledger has nowhere to record a batch. */
  batchId: Id | null;
  error: string | null;
}

export interface ReceiptPosting {
  id: Id;
  receiptId: Id;
  legs: PostingLeg[];
  /** FR-PRC-034 — photo of the supplier's delivery note. */
  deliveryNote: StoredFile | null;
  /** FR-PRC-034 — codes scanned while receiving, in order. */
  scans: string[];
  postedAt: IsoDateTime;
}

const receiptPostings = localCollection<ReceiptPosting>(
  {
    name: "prc-receipt-postings",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.receiptId ?? id,
      receiptId: input.receiptId ?? id,
      legs: input.legs ?? [],
      deliveryNote: input.deliveryNote ?? null,
      scans: input.scans ?? [],
      postedAt: nowIso(),
    }),
  },
  tenant,
);

export interface SupplierReturnLine extends PostingLeg {
  /** In the receipt line's unit. */
  returned: string;
  receiptUnit: UnitCode;
  unitPriceMinor: number;
  reason: string;
}

export interface SupplierReturn {
  id: Id;
  reference: string;
  receiptId: Id;
  receiptRef: string;
  supplierId: Id;
  supplierName: Localised;
  locationId: Id;
  lines: SupplierReturnLine[];
  totalMinor: number;
  currency: string;
  createdAt: IsoDateTime;
  createdBy: string;
  creditNoteId: Id | null;
}

const supplierReturns = localCollection<SupplierReturn>(
  {
    name: "prc-supplier-returns",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.receiptRef, row.supplierName],
    filters: { supplierId: (row) => row.supplierId },
    sorters: { createdAt: (row) => row.createdAt },
    factory: (input, id) => ({
      id,
      reference: input.reference ?? "",
      receiptId: input.receiptId ?? "",
      receiptRef: input.receiptRef ?? "",
      supplierId: input.supplierId ?? "",
      supplierName: input.supplierName ?? { en: "", ar: "" },
      locationId: input.locationId ?? "",
      lines: input.lines ?? [],
      totalMinor: input.totalMinor ?? 0,
      currency: input.currency ?? "EGP",
      createdAt: nowIso(),
      createdBy: input.createdBy ?? "",
      creditNoteId: input.creditNoteId ?? null,
    }),
  },
  tenant,
);

// ---------------------------------------------------------------------------
// FR-PRC-042 … 046 — payables
// ---------------------------------------------------------------------------

export type CreditSource = "return" | "rejection" | "dispute" | "manual";
export type CreditStatus = "expected" | "received" | "cancelled";

export interface CreditApplication {
  id: Id;
  invoiceId: Id;
  invoiceNumber: string;
  amountMinor: number;
  at: IsoDateTime;
  byName: string;
}

/** FR-PRC-043 — a supplier credit, expected until the supplier issues it. */
export interface CreditNote {
  id: Id;
  reference: string;
  supplierId: Id;
  supplierName: Localised;
  supplierCreditNumber: string;
  source: CreditSource;
  sourceRef: string;
  status: CreditStatus;
  amountMinor: number;
  currency: string;
  issuedOn: IsoDate | null;
  reason: string;
  createdAt: IsoDateTime;
  createdBy: string;
  applications: CreditApplication[];
}

const creditNotes = localCollection<CreditNote>(
  {
    name: "prc-credit-notes",
    idOf: (row) => row.id,
    search: (row) => [row.reference, row.supplierCreditNumber, row.supplierName, row.sourceRef],
    filters: { status: (row) => row.status, supplierId: (row) => row.supplierId, source: (row) => row.source },
    sorters: { createdAt: (row) => row.createdAt, amount: (row) => row.amountMinor },
    factory: (input, id) => ({
      id,
      reference: input.reference ?? "",
      supplierId: input.supplierId ?? "",
      supplierName: input.supplierName ?? { en: "", ar: "" },
      supplierCreditNumber: input.supplierCreditNumber ?? "",
      source: input.source ?? "manual",
      sourceRef: input.sourceRef ?? "",
      status: input.status ?? "expected",
      amountMinor: input.amountMinor ?? 0,
      currency: input.currency ?? "EGP",
      issuedOn: input.issuedOn ?? null,
      reason: input.reason ?? "",
      createdAt: nowIso(),
      createdBy: input.createdBy ?? "",
      applications: input.applications ?? [],
    }),
  },
  tenant,
);

export function creditAvailable(note: CreditNote): number {
  if (note.status !== "received") return 0;
  return note.amountMinor - note.applications.reduce((sum, row) => sum + row.amountMinor, 0);
}

export type PaymentMethod = "bank_transfer" | "cheque" | "cash";

export interface SupplierPayment {
  id: Id;
  supplierId: Id;
  invoiceId: Id;
  invoiceNumber: string;
  amountMinor: number;
  discountMinor: number;
  currency: string;
  paidOn: IsoDate;
  method: PaymentMethod;
  reference: string;
  proposalId: Id | null;
  recordedAt: IsoDateTime;
  recordedBy: string;
}

const payments = localCollection<SupplierPayment>(
  {
    name: "prc-payments",
    idOf: (row) => row.id,
    filters: { supplierId: (row) => row.supplierId, invoiceId: (row) => row.invoiceId },
    sorters: { paidOn: (row) => row.paidOn },
    factory: (input, id) => ({
      id,
      supplierId: input.supplierId ?? "",
      invoiceId: input.invoiceId ?? "",
      invoiceNumber: input.invoiceNumber ?? "",
      amountMinor: input.amountMinor ?? 0,
      discountMinor: input.discountMinor ?? 0,
      currency: input.currency ?? "EGP",
      paidOn: input.paidOn ?? new Date().toISOString().slice(0, 10),
      method: input.method ?? "bank_transfer",
      reference: input.reference ?? "",
      proposalId: input.proposalId ?? null,
      recordedAt: nowIso(),
      recordedBy: input.recordedBy ?? "",
    }),
  },
  tenant,
);

/**
 * What an invoice still owes: total, less credits applied, less payments and
 * the settlement discounts taken with them. An invoice marked paid before any
 * payment was recorded here owes nothing — its payment predates this ledger.
 */
export function invoiceOutstanding(
  invoice: SupplierInvoice,
  credits: CreditNote[],
  paid: SupplierPayment[],
): number {
  if (invoice.status === "paid" && !paid.some((row) => row.invoiceId === invoice.id)) return 0;
  const applied = credits
    .flatMap((note) => note.applications)
    .filter((row) => row.invoiceId === invoice.id)
    .reduce((sum, row) => sum + row.amountMinor, 0);
  const settled = paid
    .filter((row) => row.invoiceId === invoice.id)
    .reduce((sum, row) => sum + row.amountMinor + row.discountMinor, 0);
  return Math.max(0, invoice.total.amount - applied - settled);
}

export type DisputeOutcome = "accept_variance" | "credit_requested" | "corrected" | "rejected";

/** True when the latest dispute resolution refused the invoice outright. */
export function isRejectedInvoice(review: InvoiceReview | undefined | null): boolean {
  const last = review?.resolutions[review.resolutions.length - 1];
  return last?.outcome === "rejected";
}

/** FR-PRC-042 — who recorded the invoice, and how a dispute was settled. */
export interface InvoiceReview {
  id: Id;
  invoiceId: Id;
  recordedById: Id | null;
  recordedByName: string;
  checks: { check: string; drift: number; tolerance: number; ok: boolean }[];
  resolutions: {
    at: IsoDateTime;
    byName: string;
    outcome: DisputeOutcome;
    note: string;
    creditNoteId: Id | null;
  }[];
  paymentApprovedBy: string | null;
  paymentApprovedAt: IsoDateTime | null;
  captureId: Id | null;
}

const invoiceReviews = localCollection<InvoiceReview>(
  {
    name: "prc-invoice-reviews",
    idOf: (row) => row.id,
    factory: (input, id) => ({
      id: input.invoiceId ?? id,
      invoiceId: input.invoiceId ?? id,
      recordedById: input.recordedById ?? null,
      recordedByName: input.recordedByName ?? "",
      checks: input.checks ?? [],
      resolutions: input.resolutions ?? [],
      paymentApprovedBy: null,
      paymentApprovedAt: null,
      captureId: input.captureId ?? null,
    }),
  },
  tenant,
);

export interface ProposalLine {
  invoiceId: Id;
  invoiceNumber: string;
  supplierId: Id;
  supplierName: Localised;
  dueDate: IsoDate;
  payBy: IsoDate;
  outstandingMinor: number;
  discountMinor: number;
  payMinor: number;
  reason: "overdue" | "due" | "discount";
}

/** FR-PRC-045 — invoices chosen for one payment run. */
export interface PaymentProposal {
  id: Id;
  reference: string;
  asOf: IsoDate;
  horizonDays: number;
  status: "proposed" | "approved" | "paid" | "cancelled";
  lines: ProposalLine[];
  currency: string;
  createdAt: IsoDateTime;
  createdById: Id | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
}

const proposals = localCollection<PaymentProposal>(
  {
    name: "prc-payment-proposals",
    idOf: (row) => row.id,
    sorters: { createdAt: (row) => row.createdAt },
    factory: (input, id) => ({
      id,
      reference: input.reference ?? "",
      asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
      horizonDays: input.horizonDays ?? 7,
      status: "proposed",
      lines: input.lines ?? [],
      currency: input.currency ?? "EGP",
      createdAt: nowIso(),
      createdById: input.createdById ?? null,
      createdBy: input.createdBy ?? "",
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
    }),
  },
  tenant,
);

/** FR-PRC-046 — a photographed invoice on its way to being keyed and verified. */
export interface InvoiceCapture {
  id: Id;
  image: StoredFile;
  status: "draft" | "posted" | "discarded";
  /** Which extractor, if any, pre-filled the form. */
  extractor: string | null;
  invoiceId: Id | null;
  createdAt: IsoDateTime;
  createdBy: string;
  postedAt: IsoDateTime | null;
}

const captures = localCollection<InvoiceCapture>(
  {
    name: "prc-invoice-captures",
    idOf: (row) => row.id,
    sorters: { createdAt: (row) => row.createdAt },
    factory: (input, id) => ({
      id,
      image: input.image ?? { name: "", type: "", size: 0, dataUrl: null },
      status: "draft",
      extractor: input.extractor ?? null,
      invoiceId: null,
      createdAt: nowIso(),
      createdBy: input.createdBy ?? "",
      postedAt: null,
    }),
  },
  tenant,
);

// ---------------------------------------------------------------------------
// Unit conversion for the ledger
// ---------------------------------------------------------------------------

/**
 * A receipt line's quantity and price in the item's base unit.
 *
 * Lines are captured in the unit the supplier sells in; the ledger counts in
 * the base unit. Anything that is neither refuses rather than guesses — a
 * wrong factor would silently multiply stock.
 */
export function toBaseUnit(
  item: StockItem | undefined,
  quantity: string,
  unit: UnitCode,
  unitPriceMinor: number,
): { quantity: string; unitCostMinor: string } | { error: string } {
  if (!item) return { error: "The stock item is no longer in the catalogue." };
  if (unit === item.baseUnit) return { quantity, unitCostMinor: String(unitPriceMinor) };
  if (unit === item.purchaseUnit && item.purchaseConversion > 0) {
    const factor = String(item.purchaseConversion);
    const base = decimalMul(quantity, factor);
    const cost = decimalDiv(String(unitPriceMinor), factor);
    if (base === null || cost === null) return { error: "The quantity is not a number." };
    return { quantity: base, unitCostMinor: cost };
  }
  return { error: `No conversion from ${unit} to ${item.baseUnit} for this item.` };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type Orders = Pick<PurchasingService, "orders">;
type Ledger = Pick<InventoryService, "postPurchaseMovement">;

export interface ProcurementService {
  // -- Policy ---------------------------------------------------------------
  policy(): ProcurementPolicy;
  savePolicy(next: ProcurementPolicy, actor: Actor): Promise<ProcurementPolicy>;

  // -- Sourcing -------------------------------------------------------------
  priceEntries: typeof priceEntries;
  savePriceEntry(input: Omit<SupplierPriceEntry, "id" | "createdAt" | "updatedAt">, id: Id | null): Promise<SupplierPriceEntry>;
  removePriceEntry(id: Id): Promise<void>;
  sourcing: typeof sourcing;
  setRanking(itemId: Id, supplierIds: Id[]): Promise<ItemSourcing>;
  approvedLists: typeof approvedLists;
  saveApprovedList(category: Localised, supplierIds: Id[], actor: Actor): Promise<ApprovedSupplierList>;
  complianceDocs: typeof complianceDocs;
  addComplianceDocument(
    input: Omit<ComplianceDocument, "id" | "createdAt" | "createdBy" | "supersededBy">,
    actor: Actor,
    replaces: Id | null,
  ): Promise<ComplianceDocument>;
  removeComplianceDocument(id: Id): Promise<void>;
  supplierTerms: typeof supplierTerms;
  saveSupplierTerms(supplierId: Id, patch: Partial<Omit<SupplierTerms, "id" | "supplierId">>): Promise<SupplierTerms>;

  // -- Orders ---------------------------------------------------------------
  workflows: typeof workflows;
  recordSubmission(
    order: PurchaseOrder,
    actor: Actor,
    extra?: { source?: OrderSource; allocations?: BranchAllocation[]; requisitionIds?: Id[]; offListCategories?: string[] },
  ): Promise<OrderWorkflow>;
  decideOrder(
    order: PurchaseOrder,
    decision: "approved" | "rejected",
    input: { actor: Actor; channel: ApprovalChannel; note: string },
    deps: Orders & Pick<PurchasingService, "approveOrder">,
  ): Promise<PurchaseOrder>;
  amendOrder(
    order: PurchaseOrder,
    input: { lines: PurchaseOrderLine[]; expectedDelivery: IsoDate; reason: string; actor: Actor },
    deps: Orders,
  ): Promise<{ order: PurchaseOrder; amendment: Amendment }>;
  recordTransmission(order: PurchaseOrder, entry: Omit<Transmission, "id" | "at">, markSent: boolean, deps: Orders): Promise<OrderWorkflow>;
  approvalLinks: typeof approvalLinks;
  createApprovalLink(order: PurchaseOrder, approverEmail: string, actor: Actor): Promise<{ link: ApprovalLink; token: string }>;
  findApprovalLink(token: string): Promise<ApprovalLink | null>;
  redeemApprovalLink(
    token: string,
    decision: "approved" | "rejected",
    input: { actor: Actor; note: string },
    deps: Orders & Pick<PurchasingService, "approveOrder">,
  ): Promise<PurchaseOrder>;
  revokeApprovalLink(id: Id): Promise<ApprovalLink>;

  // -- Requisitions ---------------------------------------------------------
  requisitionReviews: typeof requisitionReviews;
  recordRequisition(requisition: Requisition, actor: Actor): Promise<RequisitionReview>;
  decideRequisition(
    requisition: Requisition,
    decision: "approved" | "rejected",
    input: { actor: Actor; note: string; channel: ApprovalChannel },
    deps: Pick<PurchasingService, "requisitions">,
  ): Promise<Requisition>;

  // -- Receipts -------------------------------------------------------------
  receiptPostings: typeof receiptPostings;
  postReceipt(
    receipt: GoodsReceipt,
    input: { items: StockItem[]; deliveryNote: StoredFile | null; scans: string[]; actor: Actor },
    deps: { ledger: Ledger },
  ): Promise<ReceiptPosting>;
  retryReceiptPosting(receipt: GoodsReceipt, deps: { ledger: Ledger }): Promise<ReceiptPosting>;
  supplierReturns: typeof supplierReturns;
  returnedQuantities(receiptId: Id): Promise<Map<Id, string>>;
  createReturn(
    receipt: GoodsReceipt,
    input: { lines: { lineId: Id; quantity: string; reason: string }[]; items: StockItem[]; actor: Actor },
    deps: { ledger: Ledger },
  ): Promise<SupplierReturn>;
  retryReturn(id: Id, deps: { ledger: Ledger }): Promise<SupplierReturn>;

  // -- Payables -------------------------------------------------------------
  creditNotes: typeof creditNotes;
  createCreditNote(
    input: Pick<CreditNote, "supplierId" | "supplierName" | "source" | "sourceRef" | "amountMinor" | "currency" | "reason"> &
      Partial<Pick<CreditNote, "supplierCreditNumber" | "issuedOn" | "status">>,
    actor: Actor,
  ): Promise<CreditNote>;
  confirmCreditNote(id: Id, input: { supplierCreditNumber: string; amountMinor: number; issuedOn: IsoDate }): Promise<CreditNote>;
  cancelCreditNote(id: Id): Promise<CreditNote>;
  applyCredit(
    creditId: Id,
    invoice: SupplierInvoice,
    amountMinor: number,
    actor: Actor,
    deps: Pick<PurchasingService, "invoices">,
  ): Promise<CreditNote>;
  payments: typeof payments;
  invoiceReviews: typeof invoiceReviews;
  recordInvoiceReview(invoice: SupplierInvoice, input: Pick<InvoiceReview, "checks" | "captureId">, actor: Actor): Promise<InvoiceReview>;
  approveForPayment(invoice: SupplierInvoice, actor: Actor, deps: Pick<PurchasingService, "invoices">): Promise<SupplierInvoice>;
  resolveDispute(
    invoice: SupplierInvoice,
    input: {
      outcome: DisputeOutcome;
      note: string;
      actor: Actor;
      creditAmountMinor?: number;
      corrected?: { subtotalMinor: number; taxMinor: number; matched: boolean };
    },
    deps: Pick<PurchasingService, "invoices">,
  ): Promise<SupplierInvoice>;
  recordPayment(
    invoice: SupplierInvoice,
    input: Omit<SupplierPayment, "id" | "recordedAt" | "recordedBy" | "supplierId" | "invoiceId" | "invoiceNumber" | "currency">,
    actor: Actor,
    deps: Pick<PurchasingService, "invoices">,
  ): Promise<SupplierPayment>;
  proposals: typeof proposals;
  createProposal(input: Pick<PaymentProposal, "asOf" | "horizonDays" | "lines" | "currency">, actor: Actor): Promise<PaymentProposal>;
  approveProposal(id: Id, actor: Actor): Promise<PaymentProposal>;
  cancelProposal(id: Id): Promise<PaymentProposal>;
  markProposalPaid(
    id: Id,
    input: { paidOn: IsoDate; method: PaymentMethod; reference: string; invoices: SupplierInvoice[] },
    actor: Actor,
    deps: Pick<PurchasingService, "invoices">,
  ): Promise<PaymentProposal>;
  captures: typeof captures;
}

const MIN_REASON = 8;

/** FR-PRC-042 — approved for payment, or matched when policy skips payment approval (FR-PRC-001). */
function isPayable(invoice: SupplierInvoice): boolean {
  if (invoice.status === "approved_for_payment") return true;
  return invoice.status === "matched" && !procurementService.policy().steps.paymentApproval;
}

function requireReason(text: string, what: string): string {
  const trimmed = text.trim();
  if (trimmed.length < MIN_REASON) {
    throw new ServiceError("VALIDATION", `${what} needs a reason of at least ${MIN_REASON} characters.`, 400);
  }
  return trimmed;
}

async function workflowFor(order: PurchaseOrder): Promise<OrderWorkflow> {
  const existing = await workflows.get(order.id);
  if (existing) return existing;
  // An order raised before this record existed: its creator is known only
  // by name, which is what the self-approval check falls back to.
  return workflows.create({
    orderId: order.id,
    requesterId: null,
    requesterName: order.createdBy.en,
    approvedTier: order.status === "approved" || order.status === "sent" ? order.approvalTier : null,
    approvedTotalMinor: order.status === "approved" || order.status === "sent" ? order.total.amount : null,
  });
}

function snapshot(order: Pick<PurchaseOrder, "lines" | "total" | "expectedDelivery" | "status">): OrderSnapshot {
  return {
    lines: order.lines,
    totalMinor: order.total.amount,
    expectedDelivery: order.expectedDelivery,
    status: order.status,
  };
}

async function postLeg(
  leg: PostingLeg,
  input: { kind: "receipt" | "return"; locationId: Id; referenceId: Id; note: string; supplierId: Id },
  ledger: Ledger,
): Promise<PostingLeg> {
  if (leg.movementId) return { ...leg, error: null };
  if (!isPositiveDecimal(leg.quantity)) return { ...leg, error: leg.error ?? "Nothing to post." };
  try {
    const posted = await ledger.postPurchaseMovement({
      locationId: input.locationId,
      itemId: leg.itemId,
      kind: input.kind,
      quantity: leg.quantity,
      unitCostMinor: leg.unitCostMinor ?? undefined,
      referenceType: input.kind === "receipt" ? "goods_receipt" : "supplier_return",
      referenceId: input.referenceId,
      notes: input.note,
      batch:
        input.kind === "receipt" && leg.batchNumber
          ? { batchNumber: leg.batchNumber, productionDate: null, expiryDate: leg.expiryDate, supplierId: input.supplierId }
          : null,
    });
    return { ...leg, movementId: posted.movementId, batchId: posted.batchId, error: null };
  } catch (cause) {
    return { ...leg, error: errorText(cause) };
  }
}

export const procurementService: ProcurementService = {
  // -- Policy ---------------------------------------------------------------

  policy() {
    const stored = policyDoc.read();
    // Merge over the defaults so a policy saved before a field existed still reads whole.
    return {
      ...DEFAULT_POLICY,
      ...stored,
      steps: { ...DEFAULT_POLICY.steps, ...stored.steps },
      tolerances: { ...DEFAULT_POLICY.tolerances, ...stored.tolerances },
    };
  },

  async savePolicy(next, actor) {
    const problems = policyProblems(next);
    if (problems.length > 0) {
      throw new ServiceError("VALIDATION", "The procurement policy has combinations that cannot be operated.", 400, problems.join(", "));
    }
    const saved: ProcurementPolicy = { ...next, updatedAt: nowIso(), updatedBy: actor.name };
    policyDoc.write(saved);
    return saved;
  },

  // -- Sourcing -------------------------------------------------------------

  priceEntries,

  async savePriceEntry(input, id) {
    const others = await priceEntries.all();
    const problems = priceEntryProblems({ ...input, id: id ?? undefined }, others);
    if (problems.length > 0) {
      throw new ServiceError("VALIDATION", "The price list entry is not valid.", 400, problems.join(", "));
    }
    return id ? priceEntries.update(id, input) : priceEntries.create(input);
  },

  async removePriceEntry(id) {
    await priceEntries.remove(id);
  },

  sourcing,

  async setRanking(itemId, supplierIds) {
    const unique = [...new Set(supplierIds)];
    const existing = await sourcing.get(itemId);
    return existing ? sourcing.update(itemId, { supplierIds: unique }) : sourcing.create({ itemId, supplierIds: unique });
  },

  approvedLists,

  async saveApprovedList(category, supplierIds, actor) {
    const id = (category.en || category.ar).trim().toLowerCase();
    if (!id) throw new ServiceError("VALIDATION", "Choose a category.", 400);
    const existing = await approvedLists.get(id);
    const patch = { category, supplierIds: [...new Set(supplierIds)], updatedAt: nowIso(), updatedBy: actor.name };
    return existing ? approvedLists.update(id, patch) : approvedLists.create({ id, ...patch });
  },

  complianceDocs,

  async addComplianceDocument(input, actor, replaces) {
    if (!input.supplierId) throw new ServiceError("VALIDATION", "Choose the supplier.", 400);
    if (!input.title.trim()) throw new ServiceError("VALIDATION", "Name the document.", 400);
    if (!input.expiresOn) throw new ServiceError("VALIDATION", "A compliance document needs an expiry date.", 400);
    if (input.issuedOn && input.issuedOn > input.expiresOn) {
      throw new ServiceError("VALIDATION", "The document expires before it was issued.", 400);
    }
    const created = await complianceDocs.create({ ...input, title: input.title.trim(), createdBy: actor.name });
    if (replaces) await complianceDocs.update(replaces, { supersededBy: created.id });
    return created;
  },

  async removeComplianceDocument(id) {
    await complianceDocs.remove(id);
  },

  supplierTerms,

  async saveSupplierTerms(supplierId, patch) {
    if (patch.earlyDiscountPercent !== undefined && !(patch.earlyDiscountPercent >= 0 && patch.earlyDiscountPercent < 100)) {
      throw new ServiceError("VALIDATION", "The settlement discount must be between 0 and 100%.", 400);
    }
    if (patch.earlyDiscountDays !== undefined && !(Number.isInteger(patch.earlyDiscountDays) && patch.earlyDiscountDays >= 0)) {
      throw new ServiceError("VALIDATION", "The discount window is a whole number of days.", 400);
    }
    const existing = await supplierTerms.get(supplierId);
    return existing ? supplierTerms.update(supplierId, patch) : supplierTerms.create({ supplierId, ...patch });
  },

  // -- Orders ---------------------------------------------------------------

  workflows,

  async recordSubmission(order, actor, extra) {
    const approved = order.status === "approved";
    const existing = await workflows.get(order.id);
    const patch: Partial<OrderWorkflow> = {
      orderId: order.id,
      source: extra?.source ?? existing?.source ?? "manual",
      requesterId: actor.id,
      requesterName: actor.name,
      approvedTier: approved ? order.approvalTier : null,
      approvedTotalMinor: approved ? order.total.amount : null,
      allocations: extra?.allocations ?? existing?.allocations ?? [],
      requisitionIds: extra?.requisitionIds ?? existing?.requisitionIds ?? [],
      offListCategories: extra?.offListCategories ?? existing?.offListCategories ?? [],
    };
    return existing ? workflows.update(order.id, patch) : workflows.create(patch);
  },

  async decideOrder(order, decision, input, deps) {
    const current = await deps.orders.get(order.id);
    if (!current) throw new ServiceError("NOT_FOUND", "That purchase order no longer exists.", 404);
    if (current.status !== "pending_approval") {
      throw new ServiceError("CONFLICT", "Only an order waiting for approval can be decided.", 409, `It is ${current.status.replace(/_/g, " ")}.`);
    }
    const workflow = await workflowFor(current);
    // FR-PRC-019 — segregation of duties, enforced at the write.
    if (isSelfApproval({ id: workflow.requesterId, name: workflow.requesterId ? null : workflow.requesterName || current.createdBy }, input.actor.id ? { id: input.actor.id, name: { en: input.actor.name, ar: input.actor.name } } : null)) {
      throw new ServiceError("FORBIDDEN", "You raised this order, so you cannot approve or reject it.", 403, "FR-PRC-019 — another approver must decide.");
    }
    if (input.actor.can && !approvalPermissionsFor(current.approvalTier).some((key) => input.actor.can!(key))) {
      throw new ServiceError("FORBIDDEN", "This order's value band needs a more senior approver.", 403);
    }
    let updated: PurchaseOrder;
    let note = input.note.trim();
    if (decision === "approved") {
      updated = await deps.approveOrder(current.id);
      updated = await deps.orders.update(current.id, { approvedBy: { en: input.actor.name, ar: input.actor.name } });
    } else {
      note = requireReason(input.note, "Rejecting an order");
      // Rejection sends the order back to its requester as a draft rather than
      // deleting it: the history of why it was refused stays with it.
      updated = await deps.orders.update(current.id, { status: "draft" });
    }
    await workflows.update(workflow.id, {
      approvedTier: decision === "approved" ? current.approvalTier : null,
      approvedTotalMinor: decision === "approved" ? current.total.amount : null,
      approvals: [
        ...workflow.approvals,
        {
          at: nowIso(),
          byId: input.actor.id,
          byName: input.actor.name,
          channel: input.channel,
          decision,
          tier: current.approvalTier,
          totalMinor: current.total.amount,
          note,
        },
      ],
    });
    return updated;
  },

  async amendOrder(order, input, deps) {
    const current = await deps.orders.get(order.id);
    if (!current) throw new ServiceError("NOT_FOUND", "That purchase order no longer exists.", 404);
    // FR-PRC-023 — amendable before receipt only.
    if (!isAmendable(current.status)) {
      throw new ServiceError("CONFLICT", "Goods have been received against this order, so it can no longer be amended.", 409);
    }
    const reason = requireReason(input.reason, "An amendment");
    const lines = input.lines.filter((line) => Number(line.quantity.value) > 0);
    if (lines.length === 0) throw new ServiceError("VALIDATION", "An order needs at least one line. Cancel it instead.", 400);
    const totals = linesTotal(lines);
    const workflow = await workflowFor(current);
    const reapproval = amendmentNeedsReapproval(workflow.approvedTier, totals.total);
    const nextStatus: PurchaseOrder["status"] = reapproval ? "pending_approval" : current.status;
    const currency = current.total.currency;
    const updated = await deps.orders.update(current.id, {
      lines: lines.map((line) => ({
        ...line,
        lineTotal: { amount: Math.round(Number(line.quantity.value) * line.unitPrice.amount), currency },
      })),
      expectedDelivery: input.expectedDelivery,
      subtotal: { amount: totals.subtotal, currency },
      taxTotal: { amount: totals.tax, currency },
      total: { amount: totals.total, currency },
      approvalTier: tierForTotal(totals.total),
      status: nextStatus,
      ...(reapproval ? { approvedBy: null, approvedAt: null } : {}),
    });
    const amendment: Amendment = {
      id: `amd_${Date.now().toString(36)}`,
      at: nowIso(),
      byId: input.actor.id,
      byName: input.actor.name,
      reason,
      before: snapshot(current),
      after: snapshot(updated),
      reapprovalRequired: reapproval,
    };
    await workflows.update(workflow.id, {
      amendments: [...workflow.amendments, amendment],
      ...(reapproval ? { approvedTier: null, approvedTotalMinor: null } : {}),
    });
    return { order: updated, amendment };
  },

  async recordTransmission(order, entry, markSent, deps) {
    if (order.status !== "approved" && order.status !== "sent") {
      throw new ServiceError("CONFLICT", "Only an approved order can be sent to the supplier.", 409);
    }
    const workflow = await workflowFor(order);
    const saved = await workflows.update(workflow.id, {
      transmissions: [...workflow.transmissions, { ...entry, id: `trn_${Date.now().toString(36)}`, at: nowIso() }],
    });
    if (markSent && order.status === "approved") await deps.orders.update(order.id, { status: "sent" });
    return saved;
  },

  approvalLinks,

  async createApprovalLink(order, approverEmail, actor) {
    if (order.status !== "pending_approval") {
      throw new ServiceError("CONFLICT", "Only an order waiting for approval can have an approval link.", 409);
    }
    const email = approverEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ServiceError("VALIDATION", "Enter the approver's email address.", 400);
    }
    const hours = procurementService.policy().approvalLinkHours;
    const token = randomToken();
    // Only the hash is stored, so the list of links cannot be replayed into approvals.
    const link = await approvalLinks.create({
      orderId: order.id,
      orderRef: order.reference,
      tokenHash: await sha256(token),
      approverEmail: email,
      createdBy: actor.name,
      expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
    });
    return { link, token };
  },

  async findApprovalLink(token) {
    const hash = await sha256(token);
    return (await approvalLinks.all()).find((row) => row.tokenHash === hash) ?? null;
  },

  async redeemApprovalLink(token, decision, input, deps) {
    const link = await procurementService.findApprovalLink(token);
    const state = linkState(link);
    if (!link || state !== "valid") {
      throw new ServiceError("FORBIDDEN", "This approval link cannot be used.", 403, state);
    }
    const order = await deps.orders.get(link.orderId);
    if (!order) throw new ServiceError("NOT_FOUND", "That purchase order no longer exists.", 404);
    // Single use: burn the link before acting, so a double submit cannot decide twice.
    await approvalLinks.update(link.id, { usedAt: nowIso(), usedBy: input.actor.name, decision });
    try {
      return await procurementService.decideOrder(order, decision, { actor: input.actor, channel: "email_link", note: input.note }, deps);
    } catch (cause) {
      // The decision was refused (self-approval, band, state): give the link back.
      await approvalLinks.update(link.id, { usedAt: null, usedBy: null, decision: null });
      throw cause;
    }
  },

  async revokeApprovalLink(id) {
    return approvalLinks.update(id, { revokedAt: nowIso() });
  },

  // -- Requisitions ---------------------------------------------------------

  requisitionReviews,

  async recordRequisition(requisition, actor) {
    const existing = await requisitionReviews.get(requisition.id);
    const patch = { requisitionId: requisition.id, requesterId: actor.id, requesterName: actor.name };
    return existing ? requisitionReviews.update(requisition.id, patch) : requisitionReviews.create(patch);
  },

  async decideRequisition(requisition, decision, input, deps) {
    const current = await deps.requisitions.get(requisition.id);
    if (!current) throw new ServiceError("NOT_FOUND", "That requisition no longer exists.", 404);
    if (current.status !== "submitted") {
      throw new ServiceError("CONFLICT", "Only a submitted requisition can be decided.", 409);
    }
    const review =
      (await requisitionReviews.get(current.id)) ??
      (await requisitionReviews.create({ requisitionId: current.id, requesterId: null, requesterName: current.requestedBy.en }));
    // FR-PRC-019 — the requester SHALL NOT approve their own requisition.
    const requester = review.requesterId ? { id: review.requesterId, name: null } : { id: null, name: current.requestedBy };
    if (isSelfApproval(requester, { id: input.actor.id ?? "", name: { en: input.actor.name, ar: input.actor.name } })) {
      throw new ServiceError("FORBIDDEN", "You raised this requisition, so you cannot decide it.", 403, "FR-PRC-019 — another approver must decide.");
    }
    const note = decision === "rejected" ? requireReason(input.note, "Rejecting a requisition") : input.note.trim();
    const updated = await deps.requisitions.update(current.id, { status: decision });
    await requisitionReviews.update(review.id, {
      decisions: [
        ...review.decisions,
        { at: nowIso(), byId: input.actor.id, byName: input.actor.name, decision, note, channel: input.channel },
      ],
    });
    return updated;
  },

  // -- Receipts -------------------------------------------------------------

  receiptPostings,

  async postReceipt(receipt, input, deps) {
    const existing = await receiptPostings.get(receipt.id);
    if (existing) return procurementService.retryReceiptPosting(receipt, deps);
    const byId = new Map(input.items.map((item) => [item.id, item]));
    const legs: PostingLeg[] = receipt.lines.map((line) => {
      const converted = toBaseUnit(byId.get(line.itemId), line.received.value || "0", line.received.unit, line.unitPrice.amount);
      return {
        lineId: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        quantity: "error" in converted ? line.received.value : converted.quantity,
        unit: byId.get(line.itemId)?.baseUnit ?? line.received.unit,
        unitCostMinor: "error" in converted ? null : converted.unitCostMinor,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        movementId: null,
        batchId: null,
        error: "error" in converted ? converted.error : null,
      };
    });
    // Saved before posting so a tab closed mid-post still knows what it meant to do.
    await receiptPostings.create({ receiptId: receipt.id, legs, deliveryNote: input.deliveryNote, scans: input.scans });

    // FR-PRC-036 — goods turned away at the door leave an expected credit.
    const rejectedValue = receipt.lines.reduce(
      (sum, line) => sum + Math.round(Number(line.rejected.value || 0) * line.unitPrice.amount),
      0,
    );
    if (rejectedValue > 0) {
      await procurementService.createCreditNote(
        {
          supplierId: receipt.supplierId,
          supplierName: receipt.supplierName,
          source: "rejection",
          sourceRef: receipt.reference,
          amountMinor: rejectedValue,
          currency: receipt.total.currency,
          reason: receipt.lines
            .filter((line) => line.rejectionReason)
            .map((line) => `${line.itemName.en}: ${line.rejectionReason}`)
            .join("; "),
        },
        input.actor,
      );
    }
    return procurementService.retryReceiptPosting(receipt, deps);
  },

  async retryReceiptPosting(receipt, deps) {
    const posting = await receiptPostings.get(receipt.id);
    if (!posting) throw new ServiceError("NOT_FOUND", "This receipt has no ledger posting on record.", 404);
    const legs: PostingLeg[] = [];
    for (const leg of posting.legs) {
      // A conversion refusal is not retried: nothing about it changes on a retry.
      if (!leg.movementId && leg.unitCostMinor === null) {
        legs.push(leg);
        continue;
      }
      legs.push(
        await postLeg(leg, { kind: "receipt", locationId: receipt.locationId, referenceId: receipt.id, note: receipt.reference, supplierId: receipt.supplierId }, deps.ledger),
      );
    }
    return receiptPostings.update(receipt.id, { legs });
  },

  supplierReturns,

  async returnedQuantities(receiptId) {
    const out = new Map<Id, string>();
    for (const row of (await supplierReturns.all()).filter((entry) => entry.receiptId === receiptId)) {
      for (const line of row.lines) {
        out.set(line.lineId, String(Number(out.get(line.lineId) ?? "0") + Number(line.returned)));
      }
    }
    return out;
  },

  async createReturn(receipt, input, deps) {
    if (receipt.status !== "posted") {
      throw new ServiceError("CONFLICT", "Only a posted receipt can be returned against.", 409);
    }
    const already = await procurementService.returnedQuantities(receipt.id);
    const byId = new Map(input.items.map((item) => [item.id, item]));
    const lines: SupplierReturnLine[] = [];
    for (const request of input.lines) {
      if (!isPositiveDecimal(request.quantity)) continue;
      const line = receipt.lines.find((row) => row.id === request.lineId);
      if (!line) throw new ServiceError("NOT_FOUND", "A returned line is not on this receipt.", 404);
      const left = decimalSub(line.received.value || "0", already.get(line.id) ?? "0");
      if (decimalCompare(request.quantity, left) > 0) {
        throw new ServiceError("VALIDATION", `Only ${left} of ${line.itemName.en} is left to return.`, 400);
      }
      const reason = request.reason.trim();
      if (!reason) throw new ServiceError("VALIDATION", `Give a reason for returning ${line.itemName.en}.`, 400);
      const converted = toBaseUnit(byId.get(line.itemId), request.quantity, line.received.unit, line.unitPrice.amount);
      lines.push({
        lineId: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        quantity: "error" in converted ? request.quantity : converted.quantity,
        unit: byId.get(line.itemId)?.baseUnit ?? line.received.unit,
        unitCostMinor: "error" in converted ? null : converted.unitCostMinor,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        movementId: null,
        batchId: null,
        error: "error" in converted ? converted.error : null,
        returned: request.quantity,
        receiptUnit: line.received.unit,
        unitPriceMinor: line.unitPrice.amount,
        reason,
      });
    }
    if (lines.length === 0) throw new ServiceError("VALIDATION", "Enter a quantity to return on at least one line.", 400);

    const totalMinor = lines.reduce((sum, line) => sum + Math.round(Number(line.returned) * line.unitPriceMinor), 0);
    const reference = nextNumber("SRN", (await supplierReturns.all()).map((row) => row.reference));
    const created = await supplierReturns.create({
      reference,
      receiptId: receipt.id,
      receiptRef: receipt.reference,
      supplierId: receipt.supplierId,
      supplierName: receipt.supplierName,
      locationId: receipt.locationId,
      lines,
      totalMinor,
      currency: receipt.total.currency,
      createdBy: input.actor.name,
    });
    // FR-PRC-037 — a return raises a credit note expectation against the supplier.
    const credit = await procurementService.createCreditNote(
      {
        supplierId: receipt.supplierId,
        supplierName: receipt.supplierName,
        source: "return",
        sourceRef: reference,
        amountMinor: totalMinor,
        currency: receipt.total.currency,
        reason: lines.map((line) => `${line.itemName.en}: ${line.reason}`).join("; "),
      },
      input.actor,
    );
    await supplierReturns.update(created.id, { creditNoteId: credit.id });
    return procurementService.retryReturn(created.id, deps);
  },

  async retryReturn(id, deps) {
    const row = await supplierReturns.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That return no longer exists.", 404);
    const lines: SupplierReturnLine[] = [];
    for (const line of row.lines) {
      if (!line.movementId && line.unitCostMinor === null) {
        lines.push(line);
        continue;
      }
      // FR-PRC-037 — the negative movement: `purchase_return` out of the location.
      const posted = await postLeg(line, { kind: "return", locationId: row.locationId, referenceId: row.id, note: `${row.reference} · ${row.receiptRef}`, supplierId: row.supplierId }, deps.ledger);
      lines.push({ ...line, ...posted });
    }
    return supplierReturns.update(id, { lines });
  },

  // -- Payables -------------------------------------------------------------

  creditNotes,

  async createCreditNote(input, actor) {
    if (!input.supplierId) throw new ServiceError("VALIDATION", "Choose the supplier.", 400);
    if (!(Number.isInteger(input.amountMinor) && input.amountMinor > 0)) {
      throw new ServiceError("VALIDATION", "A credit note must be for more than zero.", 400);
    }
    const reference = nextNumber("SCN", (await creditNotes.all()).map((row) => row.reference));
    return creditNotes.create({ ...input, reference, createdBy: actor.name, status: input.status ?? "expected" });
  },

  async confirmCreditNote(id, input) {
    const note = await creditNotes.get(id);
    if (!note) throw new ServiceError("NOT_FOUND", "That credit note no longer exists.", 404);
    if (note.status !== "expected") throw new ServiceError("CONFLICT", "Only an expected credit can be confirmed.", 409);
    if (!input.supplierCreditNumber.trim()) throw new ServiceError("VALIDATION", "Enter the supplier's credit note number.", 400);
    if (!(input.amountMinor > 0)) throw new ServiceError("VALIDATION", "Enter the amount the supplier credited.", 400);
    return creditNotes.update(id, {
      status: "received",
      supplierCreditNumber: input.supplierCreditNumber.trim(),
      amountMinor: input.amountMinor,
      issuedOn: input.issuedOn,
    });
  },

  async cancelCreditNote(id) {
    const note = await creditNotes.get(id);
    if (!note) throw new ServiceError("NOT_FOUND", "That credit note no longer exists.", 404);
    if (note.applications.length > 0) throw new ServiceError("CONFLICT", "A credit already applied to invoices cannot be cancelled.", 409);
    return creditNotes.update(id, { status: "cancelled" });
  },

  async applyCredit(creditId, invoice, amountMinor, actor, deps) {
    const note = await creditNotes.get(creditId);
    if (!note) throw new ServiceError("NOT_FOUND", "That credit note no longer exists.", 404);
    if (note.status !== "received") {
      throw new ServiceError("CONFLICT", "Only a credit note the supplier has issued can be applied.", 409);
    }
    if (note.supplierId !== invoice.supplierId) {
      throw new ServiceError("VALIDATION", "A credit can only be applied to the same supplier's invoices.", 400);
    }
    const outstanding = invoiceOutstanding(invoice, await creditNotes.all(), await payments.all());
    if (!(Number.isInteger(amountMinor) && amountMinor > 0)) throw new ServiceError("VALIDATION", "Enter an amount to apply.", 400);
    if (amountMinor > creditAvailable(note)) throw new ServiceError("VALIDATION", "That is more than is left on the credit note.", 400);
    if (amountMinor > outstanding) throw new ServiceError("VALIDATION", "That is more than the invoice still owes.", 400);
    const updated = await creditNotes.update(creditId, {
      applications: [
        ...note.applications,
        { id: `cap_${Date.now().toString(36)}`, invoiceId: invoice.id, invoiceNumber: invoice.supplierInvoiceNumber, amountMinor, at: nowIso(), byName: actor.name },
      ],
    });
    if (amountMinor === outstanding) await deps.invoices.update(invoice.id, { status: "paid" });
    return updated;
  },

  payments,
  invoiceReviews,

  async recordInvoiceReview(invoice, input, actor) {
    const existing = await invoiceReviews.get(invoice.id);
    const patch = { invoiceId: invoice.id, recordedById: actor.id, recordedByName: actor.name, ...input };
    return existing ? invoiceReviews.update(invoice.id, patch) : invoiceReviews.create(patch);
  },

  async approveForPayment(invoice, actor, deps) {
    const policy = procurementService.policy();
    const current = await deps.invoices.get(invoice.id);
    if (!current) throw new ServiceError("NOT_FOUND", "That invoice no longer exists.", 404);
    // FR-PRC-042 — only an invoice within tolerance is eligible. With the
    // match step switched off by policy, a recorded invoice is eligible too.
    const eligible =
      current.status === "matched" || (!policy.steps.threeWayMatch && current.status === "recorded");
    if (!eligible) {
      throw new ServiceError(
        "CONFLICT",
        current.status === "disputed"
          ? "A disputed invoice must be resolved before it can be approved for payment."
          : "This invoice is not eligible for payment approval.",
        409,
      );
    }
    const updated = await deps.invoices.update(current.id, { status: "approved_for_payment" });
    const review = await invoiceReviews.get(current.id);
    const stamp = { paymentApprovedBy: actor.name, paymentApprovedAt: nowIso() };
    if (review) await invoiceReviews.update(current.id, stamp);
    else await invoiceReviews.update((await invoiceReviews.create({ invoiceId: current.id })).id, stamp);
    return updated;
  },

  async resolveDispute(invoice, input, deps) {
    const current = await deps.invoices.get(invoice.id);
    if (!current) throw new ServiceError("NOT_FOUND", "That invoice no longer exists.", 404);
    if (current.status !== "disputed") throw new ServiceError("CONFLICT", "This invoice is not in dispute.", 409);
    const note = requireReason(input.note, "Resolving a dispute");
    let creditNoteId: Id | null = null;
    let patch: Partial<SupplierInvoice>;
    const currency = current.total.currency;

    switch (input.outcome) {
      case "accept_variance":
        // Accepted on the record, by name, with the reason — not silently re-matched.
        patch = { status: "matched", matchResult: "within_tolerance", matchNotes: { en: note, ar: note } };
        break;
      case "credit_requested": {
        const amount = input.creditAmountMinor ?? 0;
        const credit = await procurementService.createCreditNote(
          {
            supplierId: current.supplierId,
            supplierName: current.supplierName,
            source: "dispute",
            sourceRef: current.supplierInvoiceNumber,
            amountMinor: amount,
            currency,
            reason: note,
          },
          input.actor,
        );
        creditNoteId = credit.id;
        patch = { status: "matched", matchResult: "within_tolerance", matchNotes: { en: note, ar: note } };
        break;
      }
      case "corrected": {
        const corrected = input.corrected;
        if (!corrected) throw new ServiceError("VALIDATION", "Enter the corrected figures.", 400);
        const total = corrected.subtotalMinor + corrected.taxMinor;
        patch = {
          subtotal: { amount: corrected.subtotalMinor, currency },
          taxTotal: { amount: corrected.taxMinor, currency },
          total: { amount: total, currency },
          status: corrected.matched ? "matched" : "disputed",
          matchResult: corrected.matched ? "matched" : "disputed",
          matchNotes: { en: note, ar: note },
        };
        break;
      }
      case "rejected":
        // Refused, and kept in dispute: nothing is owed on it until the supplier
        // reissues, and a reissue is resolved as `corrected`. Statements and
        // payment runs leave out an invoice whose latest resolution is this.
        patch = { matchResult: "disputed", matchNotes: { en: note, ar: note } };
        break;
    }

    const updated = await deps.invoices.update(current.id, patch);
    const review =
      (await invoiceReviews.get(current.id)) ?? (await invoiceReviews.create({ invoiceId: current.id }));
    await invoiceReviews.update(review.id, {
      resolutions: [...review.resolutions, { at: nowIso(), byName: input.actor.name, outcome: input.outcome, note, creditNoteId }],
    });
    return updated;
  },

  async recordPayment(invoice, input, actor, deps) {
    const outstanding = invoiceOutstanding(invoice, await creditNotes.all(), await payments.all());
    if (!isPayable(invoice)) {
      throw new ServiceError("CONFLICT", "Only an invoice approved for payment can be paid.", 409);
    }
    if (!(Number.isInteger(input.amountMinor) && input.amountMinor > 0)) throw new ServiceError("VALIDATION", "Enter the amount paid.", 400);
    if (input.amountMinor + input.discountMinor > outstanding) {
      throw new ServiceError("VALIDATION", "The payment and discount are more than the invoice still owes.", 400);
    }
    if (!input.paidOn) throw new ServiceError("VALIDATION", "Enter the payment date.", 400);
    const created = await payments.create({
      ...input,
      supplierId: invoice.supplierId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.supplierInvoiceNumber,
      currency: invoice.total.currency,
      recordedBy: actor.name,
    });
    if (input.amountMinor + input.discountMinor === outstanding) {
      await deps.invoices.update(invoice.id, { status: "paid" });
    }
    return created;
  },

  proposals,

  async createProposal(input, actor) {
    if (input.lines.length === 0) throw new ServiceError("VALIDATION", "Select at least one invoice to pay.", 400);
    const reference = nextNumber("PAY", (await proposals.all()).map((row) => row.reference));
    return proposals.create({ ...input, reference, createdById: actor.id, createdBy: actor.name });
  },

  async approveProposal(id, actor) {
    const row = await proposals.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That proposal no longer exists.", 404);
    if (row.status !== "proposed") throw new ServiceError("CONFLICT", "Only a proposed run can be approved.", 409);
    // The same segregation as orders: whoever builds a payment run does not release it.
    if (isSelfApproval({ id: row.createdById, name: row.createdById ? null : row.createdBy }, actor.id ? { id: actor.id, name: { en: actor.name, ar: actor.name } } : null)) {
      throw new ServiceError("FORBIDDEN", "You prepared this payment run, so someone else must approve it.", 403);
    }
    return proposals.update(id, { status: "approved", approvedBy: actor.name, approvedAt: nowIso() });
  },

  async cancelProposal(id) {
    const row = await proposals.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That proposal no longer exists.", 404);
    if (row.status === "paid") throw new ServiceError("CONFLICT", "A paid run cannot be cancelled.", 409);
    return proposals.update(id, { status: "cancelled" });
  },

  async markProposalPaid(id, input, actor, deps) {
    const row = await proposals.get(id);
    if (!row) throw new ServiceError("NOT_FOUND", "That proposal no longer exists.", 404);
    if (row.status !== "approved") throw new ServiceError("CONFLICT", "Approve the payment run before recording it as paid.", 409);
    for (const line of row.lines) {
      const invoice = input.invoices.find((entry) => entry.id === line.invoiceId);
      if (!invoice || !isPayable(invoice)) continue;
      // A discount is only taken if the run is paid by the discount deadline.
      const discount = input.paidOn <= line.payBy ? line.discountMinor : 0;
      const outstanding = invoiceOutstanding(invoice, await creditNotes.all(), await payments.all());
      const amount = Math.min(outstanding - discount, line.outstandingMinor - discount);
      if (amount <= 0) continue;
      await procurementService.recordPayment(
        invoice,
        { amountMinor: amount, discountMinor: discount, paidOn: input.paidOn, method: input.method, reference: input.reference, proposalId: id },
        actor,
        deps,
      );
    }
    return proposals.update(id, { status: "paid", paidAt: nowIso() });
  },

  captures,
};
