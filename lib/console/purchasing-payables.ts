/**
 * Supplier payables — SRS §12.6, FR-PRC-044, FR-PRC-045.
 *
 * Pure: the statement and the payment proposal are computed from invoices
 * (the purchasing service), credit notes and payments (the procurement
 * service), so every screen that shows a balance shows the same balance.
 */

import type { Id, IsoDate, Localised, SupplierInvoice } from "./types";
import {
  ageingBand,
  AGEING_BANDS,
  settlementOption,
  type AgeingBand,
  type SettlementTerms,
} from "./purchasing-rules";
import {
  invoiceOutstanding,
  isRejectedInvoice,
  type CreditNote,
  type InvoiceReview,
  type ProposalLine,
  type SupplierPayment,
} from "./services/purchasing-local";

// ---------------------------------------------------------------------------
// FR-PRC-044 — account statement with ageing
// ---------------------------------------------------------------------------

export type StatementKind = "invoice" | "credit" | "payment" | "discount" | "settled_before";

export interface StatementEntry {
  date: IsoDate;
  kind: StatementKind;
  reference: string;
  /** Positive raises what is owed; negative reduces it. Minor units. */
  amountMinor: number;
  balanceMinor: number;
  note: string;
}

export interface SupplierStatement {
  supplierId: Id;
  from: IsoDate;
  to: IsoDate;
  openingMinor: number;
  entries: StatementEntry[];
  closingMinor: number;
  invoicedMinor: number;
  creditedMinor: number;
  paidMinor: number;
  /** Outstanding per invoice, by days past due as of `to`. */
  ageing: Record<AgeingBand, number>;
  /** Credits the supplier has issued that are not yet applied to an invoice. */
  unappliedCreditMinor: number;
  rejectedInvoices: number;
}

/**
 * Invoices are debits; issued credit notes and payments (with any discount
 * taken) are credits. Invoices marked paid before this ledger kept payments
 * get a "settled before" credit, so their balance is not overstated.
 * Invoices refused in dispute are left out and counted separately.
 */
export function buildStatement(input: {
  supplierId: Id;
  from: IsoDate;
  to: IsoDate;
  invoices: SupplierInvoice[];
  credits: CreditNote[];
  payments: SupplierPayment[];
  reviews: InvoiceReview[];
}): SupplierStatement {
  const reviewById = new Map(input.reviews.map((row) => [row.invoiceId, row]));
  const rejected = input.invoices.filter((row) => row.supplierId === input.supplierId && isRejectedInvoice(reviewById.get(row.id)));
  const invoices = input.invoices.filter((row) => row.supplierId === input.supplierId && !isRejectedInvoice(reviewById.get(row.id)));
  const credits = input.credits.filter((row) => row.supplierId === input.supplierId && row.status === "received");
  const payments = input.payments.filter((row) => row.supplierId === input.supplierId);

  const all: Omit<StatementEntry, "balanceMinor">[] = [];
  for (const invoice of invoices) {
    all.push({ date: invoice.invoiceDate, kind: "invoice", reference: invoice.supplierInvoiceNumber, amountMinor: invoice.total.amount, note: invoice.reference });
    if (invoice.status === "paid" && !payments.some((row) => row.invoiceId === invoice.id)) {
      const applied = credits.flatMap((row) => row.applications).filter((row) => row.invoiceId === invoice.id).reduce((sum, row) => sum + row.amountMinor, 0);
      const settled = invoice.total.amount - applied;
      if (settled > 0) {
        all.push({ date: invoice.dueDate, kind: "settled_before", reference: invoice.supplierInvoiceNumber, amountMinor: -settled, note: "" });
      }
    }
  }
  for (const note of credits) {
    all.push({ date: note.issuedOn ?? note.createdAt.slice(0, 10), kind: "credit", reference: note.supplierCreditNumber || note.reference, amountMinor: -note.amountMinor, note: note.reason });
  }
  for (const payment of payments) {
    all.push({ date: payment.paidOn, kind: "payment", reference: payment.reference || payment.invoiceNumber, amountMinor: -payment.amountMinor, note: payment.invoiceNumber });
    if (payment.discountMinor > 0) {
      all.push({ date: payment.paidOn, kind: "discount", reference: payment.invoiceNumber, amountMinor: -payment.discountMinor, note: "" });
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "invoice" ? -1 : 1));

  const openingMinor = all.filter((row) => row.date < input.from).reduce((sum, row) => sum + row.amountMinor, 0);
  let balance = openingMinor;
  const entries: StatementEntry[] = [];
  for (const row of all.filter((entry) => entry.date >= input.from && entry.date <= input.to)) {
    balance += row.amountMinor;
    entries.push({ ...row, balanceMinor: balance });
  }

  const ageing = Object.fromEntries(AGEING_BANDS.map((band) => [band, 0])) as Record<AgeingBand, number>;
  for (const invoice of invoices.filter((row) => row.invoiceDate <= input.to)) {
    const outstanding = invoiceOutstanding(invoice, credits, payments);
    if (outstanding > 0) ageing[ageingBand(invoice.dueDate, input.to)] += outstanding;
  }
  const unappliedCreditMinor = credits.reduce(
    (sum, note) => sum + note.amountMinor - note.applications.reduce((s, row) => s + row.amountMinor, 0),
    0,
  );

  return {
    supplierId: input.supplierId,
    from: input.from,
    to: input.to,
    openingMinor,
    entries,
    closingMinor: balance,
    invoicedMinor: entries.filter((row) => row.kind === "invoice").reduce((sum, row) => sum + row.amountMinor, 0),
    creditedMinor: -entries.filter((row) => row.kind === "credit").reduce((sum, row) => sum + row.amountMinor, 0),
    paidMinor: -entries.filter((row) => row.kind === "payment" || row.kind === "discount" || row.kind === "settled_before").reduce((sum, row) => sum + row.amountMinor, 0),
    ageing,
    unappliedCreditMinor,
    rejectedInvoices: rejected.length,
  };
}

// ---------------------------------------------------------------------------
// FR-PRC-045 — payment proposal
// ---------------------------------------------------------------------------

export interface ProposalCandidate extends ProposalLine {
  /** Why an invoice due in the horizon is not proposed; null when it is. */
  excluded: "disputed" | "awaiting_approval" | "rejected" | null;
}

/**
 * Every invoice with something owed that falls due within the horizon, or
 * whose early-settlement discount deadline does. Only invoices approved for
 * payment are proposed; the rest are listed with the reason, so a due invoice
 * that is stuck is visible rather than silently missing. The pay-by date is
 * the discount deadline when a discount is still available, otherwise the due
 * date; overdue invoices come first.
 */
export function buildProposal(input: {
  asOf: IsoDate;
  horizonDays: number;
  invoices: SupplierInvoice[];
  credits: CreditNote[];
  payments: SupplierPayment[];
  reviews: InvoiceReview[];
  terms: Map<Id, SettlementTerms>;
  supplierNames: Map<Id, Localised>;
  /** FR-PRC-001 — with payment approval skipped, matched invoices are payable. */
  paymentApprovalSkipped: boolean;
}): ProposalCandidate[] {
  const end = addDaysIso(input.asOf, input.horizonDays);
  const reviewById = new Map(input.reviews.map((row) => [row.invoiceId, row]));
  const out: ProposalCandidate[] = [];

  for (const invoice of input.invoices) {
    if (invoice.status === "paid") continue;
    const outstanding = invoiceOutstanding(invoice, input.credits, input.payments);
    if (outstanding <= 0) continue;
    const option = settlementOption(invoice.invoiceDate, outstanding, input.terms.get(invoice.supplierId) ?? null, input.asOf);
    const discountInHorizon = option.discountDeadline !== null && option.discountDeadline <= end;
    const dueInHorizon = invoice.dueDate <= end;
    if (!dueInHorizon && !discountInHorizon) continue;

    const payBy = discountInHorizon ? option.discountDeadline! : invoice.dueDate;
    const discountMinor = discountInHorizon ? option.discountMinor : 0;
    const payable =
      invoice.status === "approved_for_payment" || (input.paymentApprovalSkipped && invoice.status === "matched");
    out.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.supplierInvoiceNumber,
      supplierId: invoice.supplierId,
      supplierName: input.supplierNames.get(invoice.supplierId) ?? invoice.supplierName,
      dueDate: invoice.dueDate,
      payBy,
      outstandingMinor: outstanding,
      discountMinor,
      payMinor: outstanding - discountMinor,
      reason: invoice.dueDate < input.asOf ? "overdue" : discountInHorizon ? "discount" : "due",
      excluded: isRejectedInvoice(reviewById.get(invoice.id))
        ? "rejected"
        : invoice.status === "disputed"
          ? "disputed"
          : payable
            ? null
            : "awaiting_approval",
    });
  }
  return out.sort((a, b) => a.payBy.localeCompare(b.payBy));
}

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
