"use client";

/**
 * Payment proposals — SRS §12.6, FR-PRC-045.
 *
 * "Which supplier invoices should we pay this week?" Every invoice with
 * something owed that falls due within the horizon — or whose early-settlement
 * discount deadline does — with the pay-by date that keeps the discount and
 * the discount it is worth (`buildProposal`). Only invoices approved for
 * payment are selectable; due invoices stuck in dispute or awaiting approval
 * are listed with the reason rather than silently missing.
 *
 * A proposal is saved, approved by someone other than whoever prepared it,
 * and recorded as paid once the bank transfer has gone. Making the transfer
 * itself happens in the bank, not here — the page says so.
 */

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Wallet } from "lucide-react";

import type { Id, Localised, SupplierInvoice } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { buildProposal, type ProposalCandidate } from "@/lib/console/purchasing-payables";
import type { PaymentMethod, PaymentProposal } from "@/lib/console/services/purchasing-local";
import type { SettlementTerms } from "@/lib/console/purchasing-rules";
import { isSelfApproval } from "@/lib/console/purchasing-rules";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, money } from "@/lib/console/format";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { AsyncPanel, EmptyPanel, Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { PRC_CURRENCY, useActor, usePolicy } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Field, Input, Modal, Select, Toast } from "@/components/console/ui";

export default function PaymentProposalsPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <PaymentsScreen />
    </Gate>
  );
}

function PaymentsScreen() {
  const { t, tx, fmt } = useI18n();
  const { session } = useSession();
  const canPay = usePermission("purchase.invoice.approve_payment");
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const { policy } = usePolicy();
  const [message, setMessage] = useTransientMessage();
  const [asOf, setAsOf] = useState(todayIso());
  const [horizon, setHorizon] = useState("7");
  const [picked, setPicked] = useState<Set<Id>>(new Set());
  const [paying, setPaying] = useState<PaymentProposal | null>(null);

  const data = useAsync(async () => {
    const [invoices, suppliers, credits, payments, reviews, terms, proposals] = await Promise.all([
      services.purchasing.invoices.list({ limit: 5000 }).then((page) => page.rows),
      services.purchasing.suppliers.list({ limit: 500 }).then((page) => page.rows),
      services.procurement.creditNotes.all(),
      services.procurement.payments.all(),
      services.procurement.invoiceReviews.all(),
      services.procurement.supplierTerms.all(),
      services.procurement.proposals.all(),
    ]);
    return { invoices, suppliers, credits, payments, reviews, terms, proposals };
  }, []);

  const horizonDays = Math.trunc(Number(horizon));
  const horizonValid = Number.isInteger(horizonDays) && horizonDays >= 0 && horizonDays <= 120;

  // FR-PRC-045 — due within the horizon, respecting terms and discounts.
  const candidates = useMemo<ProposalCandidate[]>(() => {
    if (!data.data || !horizonValid) return [];
    const terms = new Map<Id, SettlementTerms>(data.data.terms.map((row) => [row.supplierId, row]));
    const names = new Map<Id, Localised>(data.data.suppliers.map((row) => [row.id, row.tradingName]));
    // Invoices already in an open proposal are not proposed twice.
    const inFlight = new Set(
      data.data.proposals.filter((row) => row.status === "proposed" || row.status === "approved").flatMap((row) => row.lines.map((line) => line.invoiceId)),
    );
    return buildProposal({
      asOf,
      horizonDays,
      invoices: data.data.invoices.filter((row) => !inFlight.has(row.id)),
      credits: data.data.credits,
      payments: data.data.payments,
      reviews: data.data.reviews,
      terms,
      supplierNames: names,
      paymentApprovalSkipped: policy ? !policy.steps.paymentApproval : false,
    });
  }, [data.data, asOf, horizonDays, horizonValid, policy]);

  const eligible = candidates.filter((row) => !row.excluded);
  const blocked = candidates.filter((row) => row.excluded);
  const selected = eligible.filter((row) => picked.has(row.invoiceId));
  const selectedTotal = selected.reduce((sum, row) => sum + row.payMinor, 0);
  const discountTotal = selected.reduce((sum, row) => sum + row.discountMinor, 0);

  function toggle(id: Id) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    await action.run(
      () => services.procurement.createProposal({ asOf, horizonDays, lines: selected, currency: PRC_CURRENCY }, actor),
      {
        onSuccess: (created) => {
          setPicked(new Set());
          setMessage(t("prc.prop.saved").replace("{ref}", created.reference));
          data.reload();
        },
      },
    );
  }

  async function approve(row: PaymentProposal) {
    await action.run(() => services.procurement.approveProposal(row.id, actor), {
      onSuccess: () => {
        setMessage(t("prc.prop.approved"));
        data.reload();
      },
    });
  }

  async function cancel(row: PaymentProposal) {
    const ok = await confirm({ title: t("prc.prop.cancelTitle"), body: t("prc.prop.cancelBody").replace("{ref}", row.reference), confirmLabel: t("prc.prop.cancel"), tone: "danger" });
    if (!ok) return;
    await action.run(() => services.procurement.cancelProposal(row.id), {
      onSuccess: () => {
        setMessage(t("prc.prop.cancelled"));
        data.reload();
      },
    });
  }

  return (
    <>
      <PageHeader title={t("prc.prop.title")} subtitle={t("prc.prop.subtitle")} spec="FR-PRC-045" />
      <PageBody>
        <Callout tone="muted">{t("prc.prop.bankNote")}</Callout>
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

        <AsyncPanel state={data}>
          {(loaded) => (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("prc.prop.asOf")}>
                  <Input type="date" dir="ltr" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
                </Field>
                <Field label={t("prc.prop.horizon")} hint={t("prc.prop.horizonHint")} error={horizonValid ? undefined : t("prc.prop.badHorizon")}>
                  <Input dir="ltr" inputMode="numeric" value={horizon} onChange={(event) => setHorizon(event.target.value)} className="text-end font-mono tabular-nums" />
                </Field>
              </div>

              <TileGrid columns={3}>
                <MetricTile label={t("prc.prop.eligible")} value={String(eligible.length)} spec="FR-PRC-045" />
                <MetricTile label={t("prc.prop.selectedTotal")} value={formatMoney(money(selectedTotal, PRC_CURRENCY), fmt)} />
                <MetricTile label={t("prc.prop.discounts")} value={formatMoney(money(discountTotal, PRC_CURRENCY), fmt)} hint={t("prc.prop.discountsHint")} />
              </TileGrid>

              <Section
                title={t("prc.prop.candidates")}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={eligible.length === 0} onClick={() => setPicked(new Set(eligible.map((row) => row.invoiceId)))}>
                      {t("prc.prop.selectAll")}
                    </Button>
                    <ExportButton
                      filename="payment-proposal"
                      title={t("prc.prop.title")}
                      filterSummary={`${asOf} +${horizon}d`}
                      size="sm"
                      rows={candidates}
                      columns={[
                        { key: "supplier", header: t("pur.supplier"), value: (row) => tx(row.supplierName) },
                        { key: "invoice", header: t("pur.invoiceNumber"), value: (row) => row.invoiceNumber },
                        { key: "due", header: t("pur.dueDate"), value: (row) => row.dueDate },
                        { key: "payBy", header: t("prc.prop.payBy"), value: (row) => row.payBy },
                        { key: "outstanding", header: t("prc.pay.outstanding"), value: (row) => (row.outstandingMinor / 100).toFixed(2) },
                        { key: "discount", header: t("prc.pay.discount"), value: (row) => (row.discountMinor / 100).toFixed(2) },
                        { key: "pay", header: t("prc.prop.pay"), value: (row) => (row.payMinor / 100).toFixed(2) },
                        { key: "excluded", header: t("common.status"), value: (row) => (row.excluded ? t(`prc.prop.excluded.${row.excluded}` as ConsoleKey) : "") },
                      ]}
                    />
                  </div>
                }
              >
                {candidates.length === 0 ? (
                  <EmptyPanel compact title={t("prc.prop.emptyTitle")} body={t("prc.prop.emptyBody")} />
                ) : (
                  <ul className="divide-line divide-y">
                    {candidates.map((row) => (
                      <li key={row.invoiceId} className="flex flex-wrap items-center gap-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`${t("prc.prop.select")} ${row.invoiceNumber}`}
                          disabled={Boolean(row.excluded)}
                          checked={picked.has(row.invoiceId)}
                          onChange={() => toggle(row.invoiceId)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-fg text-sm">
                            {tx(row.supplierName)} · <span className="font-mono">{row.invoiceNumber}</span>
                          </p>
                          <p className="text-fg-subtle text-xs">
                            {t("pur.dueDate")} {formatDate(row.dueDate, fmt)} · {t("prc.prop.payBy")} {formatDate(row.payBy, fmt)}
                          </p>
                        </div>
                        <Badge tone={row.reason === "overdue" ? "bad" : row.reason === "discount" ? "good" : "neutral"}>{t(`prc.prop.reason.${row.reason}` as ConsoleKey)}</Badge>
                        {row.excluded ? <Badge tone="warn">{t(`prc.prop.excluded.${row.excluded}` as ConsoleKey)}</Badge> : null}
                        <div className="text-end">
                          <p className="font-mono text-sm tabular-nums">{formatMoney(money(row.payMinor, PRC_CURRENCY), fmt)}</p>
                          {row.discountMinor > 0 ? (
                            <p className="text-good text-xs">−{formatMoney(money(row.discountMinor, PRC_CURRENCY), fmt)}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {blocked.length > 0 ? <Callout tone="warn" className="mt-3">{t("prc.prop.blockedNote").replace("{n}", String(blocked.length))}</Callout> : null}
                {canPay ? (
                  <div className="mt-3">
                    <Button variant="primary" icon={<Wallet size={14} />} loading={action.pending} disabled={selected.length === 0} onClick={save}>
                      {t("prc.prop.save").replace("{n}", String(selected.length))}
                    </Button>
                  </div>
                ) : null}
              </Section>

              <Section title={t("prc.prop.runs")}>
                {loaded.proposals.length === 0 ? (
                  <p className="text-fg-subtle text-xs">{t("prc.prop.noRuns")}</p>
                ) : (
                  <ul className="divide-line divide-y">
                    {[...loaded.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => {
                      const total = row.lines.reduce((sum, line) => sum + line.payMinor, 0);
                      const selfApproval = isSelfApproval({ id: row.createdById, name: row.createdById ? null : row.createdBy }, session?.user ?? null);
                      return (
                        <li key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                          <span className="font-mono">{row.reference}</span>
                          <span className="text-fg-subtle text-xs">
                            {formatDateTime(row.createdAt, fmt)} · {row.createdBy} · {t("prc.inbox.lines").replace("{n}", String(row.lines.length))}
                          </span>
                          <Badge tone={row.status === "paid" ? "good" : row.status === "approved" ? "accent" : row.status === "cancelled" ? "muted" : "warn"}>{t(`prc.prop.status.${row.status}` as ConsoleKey)}</Badge>
                          <span className="ms-auto font-mono tabular-nums">{formatMoney(money(total, PRC_CURRENCY), fmt)}</span>
                          {canPay ? (
                            <div className="flex gap-1">
                              {row.status === "proposed" ? (
                                <Button size="sm" icon={<CheckCircle2 size={12} />} disabled={selfApproval} title={selfApproval ? t("prc.prop.selfApproval") : undefined} onClick={() => void approve(row)}>
                                  {t("prc.prop.approve")}
                                </Button>
                              ) : null}
                              {row.status === "approved" ? (
                                <Button size="sm" variant="primary" onClick={() => setPaying(row)}>
                                  {t("prc.prop.markPaid")}
                                </Button>
                              ) : null}
                              {row.status === "proposed" || row.status === "approved" ? (
                                <Button size="sm" variant="ghost" icon={<Ban size={12} />} onClick={() => void cancel(row)}>
                                  {t("prc.prop.cancel")}
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              {paying ? (
                <MarkPaidModal
                  proposal={paying}
                  invoices={loaded.invoices}
                  onClose={() => setPaying(null)}
                  onDone={() => {
                    setPaying(null);
                    setMessage(t("prc.prop.paid"));
                    data.reload();
                  }}
                />
              ) : null}
            </>
          )}
        </AsyncPanel>
      </PageBody>
      <Toast message={message} />
    </>
  );
}

function MarkPaidModal({ proposal, invoices, onClose, onDone }: { proposal: PaymentProposal; invoices: SupplierInvoice[]; onClose: () => void; onDone: () => void }) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const [paidOn, setPaidOn] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const lost = proposal.lines.filter((line) => line.discountMinor > 0 && paidOn > line.payBy);

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.prop.markPaidTitle").replace("{ref}", proposal.reference)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!paidOn}
            onClick={() =>
              void action.run(
                () => services.procurement.markProposalPaid(proposal.id, { paidOn, method, reference: reference.trim(), invoices }, actor, { invoices: services.purchasing.invoices }),
                { onSuccess: onDone },
              )
            }
          >
            {t("prc.prop.markPaid")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <p className="text-fg-muted text-xs">{t("prc.prop.markPaidBody")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t("prc.pay.paidOn")}>
            <Input type="date" dir="ltr" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
          </Field>
          <Field label={t("prc.pay.method")}>
            <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
              {(["bank_transfer", "cheque", "cash"] as const).map((value) => (
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
        {lost.length > 0 ? (
          <Callout tone="warn">
            {t("prc.prop.discountLost")
              .replace("{n}", String(lost.length))
              .replace("{amount}", formatMoney(money(lost.reduce((sum, line) => sum + line.discountMinor, 0), PRC_CURRENCY), fmt))}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
