"use client";

/**
 * Supplier invoices after the match — SRS §12.6, FR-PRC-042, FR-PRC-043.
 *
 *   - **Payment approval** (042): an invoice within tolerance is eligible; the
 *     button is not there for one in dispute.
 *   - **Dispute resolution** (042): an invoice outside tolerance stays in
 *     dispute until someone resolves it, on the record with a reason — accept
 *     the variance, request a credit note, correct the figures (re-matched
 *     against the tenant's tolerances), or reject it outright.
 *   - **Credit notes** (043): an issued supplier credit applied against the
 *     same supplier's outstanding invoices, never beyond what either has left.
 *   - **Payments**: recorded against an approved invoice, which is what the
 *     statement (044) and payment proposals (045) read.
 */

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";

import type { Id, IsoDate, Localised, Supplier, SupplierInvoice } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  creditAvailable,
  invoiceOutstanding,
  isRejectedInvoice,
  type CreditNote,
  type CreditSource,
  type DisputeOutcome,
  type InvoiceReview,
  type PaymentMethod,
  type SupplierPayment,
} from "@/lib/console/services/purchasing-local";
import { evaluateMatch } from "@/lib/console/purchasing-rules";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, money } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { MoneyInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { useActor, usePolicy } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Field, Input, Modal, Select, Textarea, cx } from "@/components/console/ui";

export interface PayablesData {
  credits: CreditNote[];
  payments: SupplierPayment[];
  reviews: InvoiceReview[];
}

export function usePayablesData() {
  return useAsync<PayablesData>(async () => {
    const [credits, payments, reviews] = await Promise.all([
      services.procurement.creditNotes.all(),
      services.procurement.payments.all(),
      services.procurement.invoiceReviews.all(),
    ]);
    return { credits, payments, reviews };
  }, []);
}

const DISPUTE_OUTCOMES: DisputeOutcome[] = ["accept_variance", "credit_requested", "corrected", "rejected"];
const PAYMENT_METHODS: PaymentMethod[] = ["bank_transfer", "cheque", "cash"];

export function InvoicePayables({ invoice, onChanged }: { invoice: SupplierInvoice; onChanged: (updated: SupplierInvoice | null, message: string) => void }) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const { policy } = usePolicy();
  const canApprovePayment = usePermission("purchase.invoice.approve_payment");
  const canRecord = usePermission("purchase.invoice.record");
  const data = usePayablesData();
  const [panel, setPanel] = useState<"dispute" | "credit" | "payment" | null>(null);

  if (!data.data) return data.error ? <Callout tone="bad">{data.error.message}</Callout> : null;

  const { credits, payments, reviews } = data.data;
  const review = reviews.find((row) => row.invoiceId === invoice.id);
  const outstanding = invoiceOutstanding(invoice, credits, payments);
  const applied = credits.flatMap((note) => note.applications.map((row) => ({ ...row, note }))).filter((row) => row.invoiceId === invoice.id);
  const paid = payments.filter((row) => row.invoiceId === invoice.id);
  const availableCredits = credits.filter((note) => note.supplierId === invoice.supplierId && creditAvailable(note) > 0);
  const matchSkipped = policy ? !policy.steps.threeWayMatch : false;
  const eligible = invoice.status === "matched" || (matchSkipped && invoice.status === "recorded");
  const payable = invoice.status === "approved_for_payment" || (policy ? !policy.steps.paymentApproval && invoice.status === "matched" : false);
  const rejected = isRejectedInvoice(review);

  const done = (message: string) => {
    setPanel(null);
    data.reload();
    void services.purchasing.invoices.get(invoice.id).then((fresh) => onChanged(fresh, message));
  };

  async function approve() {
    await action.run(() => services.procurement.approveForPayment(invoice, actor, { invoices: services.purchasing.invoices }), {
      onSuccess: (updated) => {
        data.reload();
        onChanged(updated, t("prc.pay.approvedForPayment"));
      },
    });
  }

  return (
    <div className="space-y-4">
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <DescList>
        <DescRow label={t("prc.pay.outstanding")} mono>
          {formatMoney(money(outstanding, invoice.total.currency), fmt)}
        </DescRow>
        {review?.recordedByName ? <DescRow label={t("prc.pay.recordedBy")}>{review.recordedByName}</DescRow> : null}
        {review?.paymentApprovedBy ? (
          <DescRow label={t("prc.pay.paymentApprovedBy")}>
            {review.paymentApprovedBy} · {formatDateTime(review.paymentApprovedAt, fmt)}
          </DescRow>
        ) : null}
      </DescList>

      {review && review.checks.length > 0 ? (
        <ul className="border-line divide-line divide-y rounded-lg border text-xs">
          {review.checks.map((check) => (
            <li key={check.check} className="flex items-center gap-2 px-3 py-1.5">
              <span className={cx("flex h-4 w-4 items-center justify-center rounded-full", check.ok ? "bg-good/15 text-good" : "bg-bad/15 text-bad")} aria-hidden>
                {check.ok ? <Check size={10} /> : <X size={10} />}
              </span>
              <span className="text-fg flex-1">{t(`prc.check.${check.check}` as ConsoleKey)}</span>
              <span className="text-fg-subtle font-mono tabular-nums">
                {check.check === "total" ? check.drift : `${check.drift.toFixed(1)}%`} / {check.check === "total" ? check.tolerance : `${check.tolerance}%`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {rejected ? <Callout tone="bad" title={t("prc.dispute.rejectedTitle")}>{t("prc.dispute.rejectedBody")}</Callout> : null}

      <div className="flex flex-wrap gap-2">
        {/* FR-PRC-042 */}
        {eligible && canApprovePayment ? (
          <Button variant="primary" loading={action.pending} onClick={approve}>
            {t("prc.pay.approve")}
          </Button>
        ) : null}
        {invoice.status === "disputed" && canRecord ? (
          <Button variant="primary" onClick={() => setPanel("dispute")}>
            {t("prc.dispute.resolve")}
          </Button>
        ) : null}
        {/* FR-PRC-043 */}
        {outstanding > 0 && availableCredits.length > 0 && canRecord && !rejected ? (
          <Button onClick={() => setPanel("credit")}>{t("prc.credit.apply")}</Button>
        ) : null}
        {payable && outstanding > 0 && canApprovePayment ? <Button onClick={() => setPanel("payment")}>{t("prc.pay.record")}</Button> : null}
      </div>
      {invoice.status === "disputed" && !canRecord ? <p className="text-fg-subtle text-xs">{t("prc.dispute.noPermission")}</p> : null}

      {applied.length > 0 || paid.length > 0 ? (
        <section>
          <h4 className="text-fg mb-1 text-xs font-semibold">{t("prc.pay.settlements")}</h4>
          <ul className="space-y-1 text-xs">
            {applied.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <Badge tone="accent">{t("prc.stmt.kind.credit")}</Badge> {row.note.supplierCreditNumber || row.note.reference} · {row.byName}
                </span>
                <span className="font-mono tabular-nums">−{formatMoney(money(row.amountMinor, invoice.total.currency), fmt)}</span>
              </li>
            ))}
            {paid.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <Badge tone="good">{t("prc.stmt.kind.payment")}</Badge> {formatDate(row.paidOn, fmt)} · {t(`prc.method.${row.method}` as ConsoleKey)} {row.reference}
                </span>
                <span className="font-mono tabular-nums">
                  −{formatMoney(money(row.amountMinor, invoice.total.currency), fmt)}
                  {row.discountMinor > 0 ? ` (+${formatMoney(money(row.discountMinor, invoice.total.currency), fmt)} ${t("prc.pay.discount")})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {review && review.resolutions.length > 0 ? (
        <section>
          <h4 className="text-fg mb-1 text-xs font-semibold">{t("prc.dispute.history")}</h4>
          <ul className="space-y-1 text-xs">
            {review.resolutions.map((row, index) => (
              <li key={index}>
                <Badge tone="muted">{t(`prc.dispute.outcome.${row.outcome}` as ConsoleKey)}</Badge> {row.byName} · {formatDateTime(row.at, fmt)}
                <p className="text-fg-muted">{row.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {panel === "dispute" ? <ResolveDisputeModal invoice={invoice} onClose={() => setPanel(null)} onDone={done} /> : null}
      {panel === "credit" ? (
        <ApplyCreditModal invoice={invoice} outstanding={outstanding} credits={availableCredits} onClose={() => setPanel(null)} onDone={done} />
      ) : null}
      {panel === "payment" ? <RecordPaymentModal invoice={invoice} outstanding={outstanding} onClose={() => setPanel(null)} onDone={done} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-042 — resolve a dispute
// ---------------------------------------------------------------------------

function ResolveDisputeModal({ invoice, onClose, onDone }: { invoice: SupplierInvoice; onClose: () => void; onDone: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const { policy } = usePolicy();
  const receipt = useAsync(() => (invoice.goodsReceiptId ? services.purchasing.receipts.get(invoice.goodsReceiptId) : Promise.resolve(null)), [invoice.goodsReceiptId]);
  const [outcome, setOutcome] = useState<DisputeOutcome>("credit_requested");
  const [note, setNote] = useState("");
  const [credit, setCredit] = useState<number | null>(null);
  const [subtotal, setSubtotal] = useState<number | null>(invoice.subtotal.amount);
  const [tax, setTax] = useState<number | null>(invoice.taxTotal.amount);

  // Re-run the match on corrected figures, against the same tolerances.
  const corrected = useMemo(() => {
    if (outcome !== "corrected" || !receipt.data || !policy) return null;
    const results = evaluateMatch({
      receiptValueMinor: receipt.data.total.amount,
      orderValueMinor: null,
      invoiceSubtotalMinor: subtotal ?? 0,
      invoiceTaxMinor: tax ?? 0,
      invoiceTotalMinor: (subtotal ?? 0) + (tax ?? 0),
      tolerances: policy.tolerances,
    });
    return { results, matched: results.every((row) => row.ok) };
  }, [outcome, receipt.data, policy, subtotal, tax]);

  const invalid =
    note.trim().length < 8 ||
    (outcome === "credit_requested" && !(credit && credit > 0)) ||
    (outcome === "corrected" && (subtotal === null || !receipt.data));

  async function submit() {
    if (outcome === "rejected") {
      const ok = await confirm({
        title: t("prc.dispute.rejectTitle"),
        body: t("prc.dispute.rejectBody").replace("{number}", invoice.supplierInvoiceNumber),
        confirmLabel: t("prc.dispute.outcome.rejected"),
        tone: "danger",
      });
      if (!ok) return;
    }
    await action.run(
      () =>
        services.procurement.resolveDispute(
          invoice,
          {
            outcome,
            note,
            actor,
            creditAmountMinor: credit ?? undefined,
            corrected: outcome === "corrected" ? { subtotalMinor: subtotal ?? 0, taxMinor: tax ?? 0, matched: corrected?.matched ?? false } : undefined,
          },
          { invoices: services.purchasing.invoices },
        ),
      { onSuccess: () => onDone(t("prc.dispute.resolved")) },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.dispute.title").replace("{number}", invoice.supplierInvoiceNumber)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant={outcome === "rejected" ? "danger" : "primary"} loading={action.pending} disabled={invalid} onClick={submit}>
            {t("prc.dispute.resolve")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {invoice.matchNotes ? <Callout tone="warn">{invoice.matchNotes.en}</Callout> : null}
        <div role="radiogroup" aria-label={t("prc.dispute.outcomeLabel")} className="space-y-1">
          {DISPUTE_OUTCOMES.map((value) => (
            <label key={value} className={cx("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm", outcome === value ? "border-accent bg-accent-soft" : "border-line")}>
              <input type="radio" name="outcome" checked={outcome === value} onChange={() => setOutcome(value)} className="mt-1" />
              <span>
                <span className="text-fg block">{t(`prc.dispute.outcome.${value}` as ConsoleKey)}</span>
                <span className="text-fg-subtle block text-xs">{t(`prc.dispute.outcomeHint.${value}` as ConsoleKey)}</span>
              </span>
            </label>
          ))}
        </div>

        {outcome === "credit_requested" ? (
          <Field label={t("prc.dispute.creditAmount")} required>
            <MoneyInput value={credit} currency={invoice.total.currency} onChange={setCredit} aria-label={t("prc.dispute.creditAmount")} />
          </Field>
        ) : null}

        {outcome === "corrected" ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t("doc.subtotal")} required>
                <MoneyInput value={subtotal} currency={invoice.total.currency} onChange={setSubtotal} aria-label={t("doc.subtotal")} />
              </Field>
              <Field label={t("doc.tax")}>
                <MoneyInput value={tax} currency={invoice.total.currency} onChange={setTax} aria-label={t("doc.tax")} />
              </Field>
            </div>
            {!invoice.goodsReceiptId ? <Callout tone="warn">{t("pur.noReceiptNote")}</Callout> : null}
            {corrected ? (
              <Callout tone={corrected.matched ? "good" : "warn"}>
                {corrected.matched ? t("prc.dispute.correctedMatches") : t("prc.dispute.correctedStillOut")}{" "}
                ({formatMoney(money((subtotal ?? 0) + (tax ?? 0), invoice.total.currency), fmt)})
              </Callout>
            ) : null}
          </>
        ) : null}

        <Field label={t("prc.reason")} hint={t("prc.reasonHint")} required>
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-043 — apply a credit note
// ---------------------------------------------------------------------------

function ApplyCreditModal({
  invoice,
  outstanding,
  credits,
  onClose,
  onDone,
}: {
  invoice: SupplierInvoice;
  outstanding: number;
  credits: CreditNote[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const [creditId, setCreditId] = useState<Id>(credits[0]?.id ?? "");
  const credit = credits.find((row) => row.id === creditId) ?? null;
  const max = credit ? Math.min(creditAvailable(credit), outstanding) : 0;
  const [amount, setAmount] = useState<number | null>(max || null);
  const over = amount !== null && amount > max;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.credit.applyTitle").replace("{number}", invoice.supplierInvoiceNumber)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!credit || !amount || amount <= 0 || over}
            onClick={() =>
              void action.run(() => services.procurement.applyCredit(creditId, invoice, amount ?? 0, actor, { invoices: services.purchasing.invoices }), {
                onSuccess: () => onDone(t("prc.credit.applied")),
              })
            }
          >
            {t("prc.credit.apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Field label={t("prc.credit.note")}>
          <Select
            value={creditId}
            onChange={(event) => {
              setCreditId(event.target.value);
              const next = credits.find((row) => row.id === event.target.value);
              setAmount(next ? Math.min(creditAvailable(next), outstanding) : null);
            }}
          >
            {credits.map((row) => (
              <option key={row.id} value={row.id}>
                {(row.supplierCreditNumber || row.reference) + " · " + formatMoney(money(creditAvailable(row), row.currency as "EGP"), fmt)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("prc.credit.amount")} hint={t("prc.credit.maxHint").replace("{amount}", formatMoney(money(max, invoice.total.currency), fmt))} error={over ? t("prc.credit.over") : undefined}>
          <MoneyInput value={amount} currency={invoice.total.currency} onChange={setAmount} aria-label={t("prc.credit.amount")} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

function RecordPaymentModal({
  invoice,
  outstanding,
  onClose,
  onDone,
}: {
  invoice: SupplierInvoice;
  outstanding: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const [amount, setAmount] = useState<number | null>(outstanding);
  const [discount, setDiscount] = useState<number | null>(0);
  const [paidOn, setPaidOn] = useState<IsoDate>(todayIso());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const over = (amount ?? 0) + (discount ?? 0) > outstanding;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.pay.recordTitle").replace("{number}", invoice.supplierInvoiceNumber)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!amount || amount <= 0 || over || !paidOn}
            onClick={() =>
              void action.run(
                () =>
                  services.procurement.recordPayment(
                    invoice,
                    { amountMinor: amount ?? 0, discountMinor: discount ?? 0, paidOn, method, reference: reference.trim(), proposalId: null },
                    actor,
                    { invoices: services.purchasing.invoices },
                  ),
                { onSuccess: () => onDone(t("prc.pay.recorded")) },
              )
            }
          >
            {t("prc.pay.record")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("prc.pay.recordNote")}</Callout>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t("prc.pay.amount")} error={over ? t("prc.pay.over").replace("{amount}", formatMoney(money(outstanding, invoice.total.currency), fmt)) : undefined}>
            <MoneyInput value={amount} currency={invoice.total.currency} onChange={setAmount} aria-label={t("prc.pay.amount")} />
          </Field>
          <Field label={t("prc.pay.discount")}>
            <MoneyInput value={discount} currency={invoice.total.currency} onChange={setDiscount} aria-label={t("prc.pay.discount")} />
          </Field>
          <Field label={t("prc.pay.paidOn")}>
            <Input type="date" dir="ltr" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
          </Field>
          <Field label={t("prc.pay.method")}>
            <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {t(`prc.method.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("prc.pay.reference")}>
          <Input dir="ltr" value={reference} onChange={(event) => setReference(event.target.value)} className="font-mono" />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-043 — credit notes: create manually, confirm issued, cancel
// ---------------------------------------------------------------------------

export function CreditNoteDrawer({ suppliers, onClose, onSaved }: { suppliers: Supplier[]; onClose: () => void; onSaved: (message: string) => void }) {
  const { t, tx } = useI18n();
  const actor = useActor();
  const action = useAction();
  const [supplierId, setSupplierId] = useState<Id>("");
  const [amount, setAmount] = useState<number | null>(null);
  const [issued, setIssued] = useState(true);
  const [number, setNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [source, setSource] = useState<CreditSource>("manual");

  const supplier = suppliers.find((row) => row.id === supplierId);
  const invalid = !supplierId || !amount || amount <= 0 || reason.trim().length < 8 || (issued && !number.trim());

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("prc.credit.new")}
      subtitle="FR-PRC-043"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={invalid}
            onClick={() =>
              void action.run(
                () =>
                  services.procurement.createCreditNote(
                    {
                      supplierId,
                      supplierName: supplier?.tradingName ?? ({ en: "", ar: "" } as Localised),
                      source,
                      sourceRef: "",
                      amountMinor: amount ?? 0,
                      currency: supplier?.currency ?? "EGP",
                      reason: reason.trim(),
                      status: issued ? "received" : "expected",
                      supplierCreditNumber: issued ? number.trim() : "",
                      issuedOn: issued ? issuedOn : null,
                    },
                    actor,
                  ),
                { onSuccess: () => onSaved(t("prc.credit.created")) },
              )
            }
          >
            {t("common.create")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pur.supplier")} required>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">—</option>
              {suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.credit.source")}>
            <Select value={source} onChange={(event) => setSource(event.target.value as CreditSource)}>
              {(["manual", "dispute", "rejection", "return"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`prc.credit.sourceKind.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("prc.credit.amount")} required>
          <MoneyInput value={amount} currency={supplier?.currency ?? "EGP"} onChange={setAmount} aria-label={t("prc.credit.amount")} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={issued} onChange={(event) => setIssued(event.target.checked)} />
          {t("prc.credit.alreadyIssued")}
        </label>
        {issued ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("prc.credit.supplierNumber")} required>
              <Input dir="ltr" value={number} onChange={(event) => setNumber(event.target.value)} className="font-mono" />
            </Field>
            <Field label={t("prc.credit.issuedOn")}>
              <Input type="date" dir="ltr" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field label={t("prc.reason")} hint={t("prc.reasonHint")} required>
          <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

export function ConfirmCreditModal({ note, onClose, onDone }: { note: CreditNote; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n();
  const action = useAction();
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState<number | null>(note.amountMinor);
  const [issuedOn, setIssuedOn] = useState(todayIso());

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.credit.confirmTitle").replace("{ref}", note.reference)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!number.trim() || !amount || amount <= 0}
            onClick={() =>
              void action.run(() => services.procurement.confirmCreditNote(note.id, { supplierCreditNumber: number, amountMinor: amount ?? 0, issuedOn }), {
                onSuccess: () => onDone(t("prc.credit.confirmed")),
              })
            }
          >
            {t("prc.credit.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <p className="text-fg-muted text-xs">{t("prc.credit.confirmBody")}</p>
        <Field label={t("prc.credit.supplierNumber")} required>
          <Input dir="ltr" value={number} onChange={(event) => setNumber(event.target.value)} className="font-mono" data-autofocus />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t("prc.credit.amount")} hint={note.amountMinor !== amount ? t("prc.credit.amountDiffers") : undefined}>
            <MoneyInput value={amount} currency={note.currency as "EGP"} onChange={setAmount} aria-label={t("prc.credit.amount")} />
          </Field>
          <Field label={t("prc.credit.issuedOn")}>
            <Input type="date" dir="ltr" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** FR-PRC-043 — apply a credit to one of the supplier's open invoices, from the credit side. */
export function ApplyToInvoiceModal({ note, onClose, onDone }: { note: CreditNote; onClose: () => void; onDone: (message: string) => void }) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const data = useAsync(async () => {
    const [invoices, credits, payments] = await Promise.all([
      services.purchasing.invoices.list({ limit: 500, filters: { supplierId: note.supplierId } }).then((page) => page.rows),
      services.procurement.creditNotes.all(),
      services.procurement.payments.all(),
    ]);
    return invoices
      .map((invoice) => ({ invoice, outstanding: invoiceOutstanding(invoice, credits, payments) }))
      .filter((row) => row.outstanding > 0 && row.invoice.status !== "paid");
  }, [note.id]);
  const [invoiceId, setInvoiceId] = useState<Id>("");
  const [amount, setAmount] = useState<number | null>(null);
  const row = (data.data ?? []).find((entry) => entry.invoice.id === invoiceId);
  const max = row ? Math.min(row.outstanding, creditAvailable(note)) : 0;
  const over = amount !== null && amount > max;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.credit.applyFromTitle").replace("{ref}", note.supplierCreditNumber || note.reference)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!row || !amount || amount <= 0 || over}
            onClick={() =>
              row &&
              void action.run(() => services.procurement.applyCredit(note.id, row.invoice, amount ?? 0, actor, { invoices: services.purchasing.invoices }), {
                onSuccess: () => onDone(t("prc.credit.applied")),
              })
            }
          >
            {t("prc.credit.apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        {data.data && data.data.length === 0 ? <Callout tone="muted">{t("prc.credit.noOpenInvoices")}</Callout> : null}
        <Field label={t("prc.credit.invoice")}>
          <Select
            value={invoiceId}
            onChange={(event) => {
              setInvoiceId(event.target.value);
              const next = (data.data ?? []).find((entry) => entry.invoice.id === event.target.value);
              setAmount(next ? Math.min(next.outstanding, creditAvailable(note)) : null);
            }}
          >
            <option value="">—</option>
            {(data.data ?? []).map((entry) => (
              <option key={entry.invoice.id} value={entry.invoice.id}>
                {`${entry.invoice.supplierInvoiceNumber} · ${formatDate(entry.invoice.dueDate, fmt)} · ${formatMoney(money(entry.outstanding, entry.invoice.total.currency), fmt)}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("prc.credit.amount")} hint={row ? t("prc.credit.maxHint").replace("{amount}", formatMoney(money(max, note.currency as "EGP"), fmt)) : undefined} error={over ? t("prc.credit.over") : undefined}>
          <MoneyInput value={amount} currency={note.currency as "EGP"} onChange={setAmount} aria-label={t("prc.credit.amount")} />
        </Field>
      </div>
    </Modal>
  );
}
