"use client";

/**
 * Purchase order workflow — SRS §12.4, FR-PRC-016, FR-PRC-019, FR-PRC-020,
 * FR-PRC-021, FR-PRC-023.
 *
 * What happens to an order after it is raised, each step on the record:
 *
 *   - **Decide** (019). Approve or reject, refused outright when the person
 *     deciding raised the order, and when their permissions do not reach the
 *     order's value band. The check runs in the service, not just here.
 *   - **Approve by link** (020). A single-use, time-limited link for an
 *     approver away from the console. Only the token's hash is stored. The
 *     link is *issued* here; *emailing* it needs the server, so the screen
 *     hands over the link to copy or open in a mail client and says so.
 *   - **Amend** (023). Before goods arrive, with a reason, the before/after
 *     kept, and the order sent back for approval when the new value climbs
 *     out of the band it was approved in.
 *   - **Send** (021). A PDF and a structured JSON attachment built in the
 *     browser, handed to a mail client or WhatsApp. Nothing here claims
 *     delivery; the sender confirms they sent it.
 *   - **Branch attribution** (016). An order consolidated from requisitions
 *     shows which branch asked for how much, and what share of cost is theirs.
 */

import { useEffect, useMemo, useState } from "react";
import { Copy, FileDown, Link2, Mail, MessageCircle, Plug, Trash2 } from "lucide-react";

import type { PurchaseOrder, PurchaseOrderLine, Supplier } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import {
  linkState,
  type ApprovalChannel,
  type ApprovalLink,
  type OrderWorkflow,
  type TransmissionChannel,
} from "@/lib/console/services/purchasing-local";
import {
  amendmentNeedsReapproval,
  approvalPermissionsFor,
  isAmendable,
  isSelfApproval,
  linesTotal,
  tierForTotal,
} from "@/lib/console/purchasing-rules";
import { toCsv, toPdf } from "@/lib/console/export";
import { useAction } from "@/lib/console/actions";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatDateTime, formatMoney, formatQuantity, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { MoneyInput } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { useActor } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, DescList, DescRow, Drawer, Field, IconButton, Input, Modal, Textarea } from "@/components/console/ui";

// ---------------------------------------------------------------------------
// FR-PRC-019 — approve / reject
// ---------------------------------------------------------------------------

export function useOrderWorkflow(orderId: string | null) {
  return useAsync(() => (orderId ? services.procurement.workflows.get(orderId) : Promise.resolve(null as OrderWorkflow | null)), [orderId]);
}

/** Why the signed-in person may not decide this order, or null when they may. */
export function useDecisionBlock(order: PurchaseOrder | null, workflow: OrderWorkflow | null): string | null {
  const { t } = useI18n();
  const { session, can } = useSession();
  if (!order || order.status !== "pending_approval") return t("prc.decide.notPending");
  const requester = workflow?.requesterId
    ? { id: workflow.requesterId, name: null }
    : { id: null, name: workflow?.requesterName || order.createdBy };
  if (isSelfApproval(requester, session?.user ?? null)) return t("prc.decide.selfApproval");
  if (!approvalPermissionsFor(order.approvalTier).some((key) => can(key))) return t("prc.decide.tierTooHigh");
  return null;
}

export function OrderDecision({
  order,
  workflow,
  channel,
  onDone,
}: {
  order: PurchaseOrder;
  workflow: OrderWorkflow | null;
  channel: ApprovalChannel;
  onDone: (updated: PurchaseOrder, message: string) => void;
}) {
  const { t } = useI18n();
  const actor = useActor();
  const action = useAction();
  const block = useDecisionBlock(order, workflow);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  if (order.status !== "pending_approval") return null;

  async function decide(decision: "approved" | "rejected") {
    await action.run(
      () =>
        services.procurement.decideOrder(order, decision, { actor, channel, note }, {
          orders: services.purchasing.orders,
          approveOrder: services.purchasing.approveOrder,
        }),
      {
        onSuccess: (updated) => {
          setRejecting(false);
          setNote("");
          onDone(updated, decision === "approved" ? t("pur.approved") : t("prc.decide.rejected"));
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      {block ? (
        <Callout tone="warn" title={t("prc.decide.cannotTitle")}>
          {block}
        </Callout>
      ) : null}
      {action.error && !rejecting ? <Callout tone="bad">{action.error}</Callout> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={Boolean(block)} loading={action.pending && !rejecting} onClick={() => void decide("approved")}>
          {t("pur.approveOrder")}
        </Button>
        <Button variant="danger" disabled={Boolean(block)} onClick={() => setRejecting(true)}>
          {t("prc.decide.reject")}
        </Button>
      </div>

      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={t("prc.decide.rejectTitle").replace("{ref}", order.reference)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={action.pending} disabled={note.trim().length < 8} onClick={() => void decide("rejected")}>
              {t("prc.decide.reject")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
          <p className="text-fg-muted text-xs">{t("prc.decide.rejectBody")}</p>
          <Field label={t("prc.reason")} hint={t("prc.reasonHint")} required>
            <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} data-autofocus />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History: approvals, amendments, transmissions, branch attribution
// ---------------------------------------------------------------------------

export function OrderHistory({ order, workflow }: { order: PurchaseOrder; workflow: OrderWorkflow | null }) {
  const { t, tx, fmt } = useI18n();
  const currency = order.total.currency;

  if (!workflow) {
    return <p className="text-fg-subtle text-xs">{t("prc.history.none")}</p>;
  }

  return (
    <div className="space-y-4">
      <DescList>
        <DescRow label={t("prc.history.requester")}>{workflow.requesterName || tx(order.createdBy)}</DescRow>
        <DescRow label={t("prc.history.source")}>{t(`prc.source.${workflow.source}` as ConsoleKey)}</DescRow>
        {workflow.approvedTier !== null ? (
          <DescRow label={t("prc.history.approvedUpTo")} mono>
            {formatMoney(money(workflow.approvedTotalMinor ?? 0, currency), fmt)}
          </DescRow>
        ) : null}
      </DescList>

      {workflow.offListCategories.length > 0 ? (
        <Callout tone="warn" title={t("prc.history.offList")}>
          {workflow.offListCategories.join(", ")}
        </Callout>
      ) : null}

      {/* FR-PRC-016 */}
      {workflow.allocations.length > 0 ? (
        <section>
          <h4 className="text-fg mb-1 text-xs font-semibold">{t("prc.history.attribution")}</h4>
          <ul className="border-line divide-line divide-y rounded-lg border text-xs">
            {workflow.allocations.map((row, index) => {
              const line = order.lines.find((entry) => entry.itemId === row.itemId);
              return (
                <li key={`${row.requisitionId}-${row.itemId}-${index}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="text-fg min-w-0 flex-1">
                    {line ? tx(line.itemName) : row.itemId} · {tx(row.branchName)}
                  </span>
                  <span className="text-fg-subtle font-mono">{row.requisitionRef}</span>
                  <span className="font-mono tabular-nums">{formatQuantity({ value: row.quantity, unit: row.unit }, fmt)}</span>
                  <span className="font-mono tabular-nums">{formatMoney(money(row.costMinor, currency), fmt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <h4 className="text-fg mb-1 text-xs font-semibold">{t("prc.history.decisions")}</h4>
        {workflow.approvals.length === 0 ? (
          <p className="text-fg-subtle text-xs">{t("prc.history.noDecisions")}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {workflow.approvals.map((event, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <Badge tone={event.decision === "approved" ? "good" : "bad"}>{t(`prc.decision.${event.decision}` as ConsoleKey)}</Badge>
                <span className="text-fg">{event.byName}</span>
                <span className="text-fg-subtle">{formatDateTime(event.at, fmt)}</span>
                <Badge tone="muted">{t(`prc.channel.${event.channel}` as ConsoleKey)}</Badge>
                {event.note ? <span className="text-fg-muted w-full">{event.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* FR-PRC-023 */}
      <section>
        <h4 className="text-fg mb-1 text-xs font-semibold">{t("prc.history.amendments")}</h4>
        {workflow.amendments.length === 0 ? (
          <p className="text-fg-subtle text-xs">{t("prc.history.noAmendments")}</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {workflow.amendments.map((amendment) => (
              <li key={amendment.id} className="border-line rounded-lg border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-fg">{amendment.byName}</span>
                  <span className="text-fg-subtle">{formatDateTime(amendment.at, fmt)}</span>
                  {amendment.reapprovalRequired ? <Badge tone="warn">{t("prc.amend.reapproval")}</Badge> : null}
                </div>
                <p className="text-fg-muted mt-1">{amendment.reason}</p>
                <p className="mt-1 font-mono tabular-nums">
                  {formatMoney(money(amendment.before.totalMinor, currency), fmt)} → {formatMoney(money(amendment.after.totalMinor, currency), fmt)}
                  {amendment.before.expectedDelivery !== amendment.after.expectedDelivery
                    ? ` · ${formatDate(amendment.before.expectedDelivery, fmt)} → ${formatDate(amendment.after.expectedDelivery, fmt)}`
                    : ""}
                </p>
                <AmendmentLineDiff before={amendment.before.lines} after={amendment.after.lines} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* FR-PRC-021 */}
      <section>
        <h4 className="text-fg mb-1 text-xs font-semibold">{t("prc.history.transmissions")}</h4>
        {workflow.transmissions.length === 0 ? (
          <p className="text-fg-subtle text-xs">{t("prc.history.noTransmissions")}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {workflow.transmissions.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{t(`prc.send.channel.${row.channel}` as ConsoleKey)}</Badge>
                <span className="text-fg" dir="ltr">
                  {row.recipient}
                </span>
                <span className="text-fg-subtle">{formatDateTime(row.at, fmt)}</span>
                <Badge tone={row.outcome === "confirmed_sent" ? "good" : "muted"}>{t(`prc.send.outcome.${row.outcome}` as ConsoleKey)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AmendmentLineDiff({ before, after }: { before: PurchaseOrderLine[]; after: PurchaseOrderLine[] }) {
  const { tx, fmt } = useI18n();
  const ids = [...new Set([...before.map((line) => line.itemId), ...after.map((line) => line.itemId)])];
  const changes = ids
    .map((id) => ({ id, a: before.find((line) => line.itemId === id), b: after.find((line) => line.itemId === id) }))
    .filter(({ a, b }) => !a || !b || a.quantity.value !== b.quantity.value || a.unitPrice.amount !== b.unitPrice.amount);
  if (changes.length === 0) return null;
  return (
    <ul className="text-fg-muted mt-1 space-y-0.5">
      {changes.map(({ id, a, b }) => (
        <li key={id}>
          {tx((a ?? b)!.itemName)}: {a ? `${formatQuantity(a.quantity, fmt)} × ${formatMoney(a.unitPrice, fmt)}` : "—"} →{" "}
          {b ? `${formatQuantity(b.quantity, fmt)} × ${formatMoney(b.unitPrice, fmt)}` : "—"}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-023 — amend before receipt
// ---------------------------------------------------------------------------

export function AmendOrderDrawer({
  order,
  workflow,
  onClose,
  onSaved,
}: {
  order: PurchaseOrder;
  workflow: OrderWorkflow | null;
  onClose: () => void;
  onSaved: (updated: PurchaseOrder, message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const [lines, setLines] = useState<PurchaseOrderLine[]>(order.lines);
  const [expected, setExpected] = useState(order.expectedDelivery);
  const [reason, setReason] = useState("");

  const currency = order.total.currency;
  const totals = linesTotal(lines.filter((line) => Number(line.quantity.value) > 0));
  const approvedTier = workflow ? workflow.approvedTier : order.status === "approved" || order.status === "sent" ? order.approvalTier : null;
  const reapproval = amendmentNeedsReapproval(approvedTier, totals.total);
  const changed =
    expected !== order.expectedDelivery ||
    lines.some((line, index) => line.quantity.value !== order.lines[index]?.quantity.value || line.unitPrice.amount !== order.lines[index]?.unitPrice.amount);
  const invalidQuantity = lines.some((line) => line.quantity.value.trim() !== "" && !/^\d*\.?\d*$/.test(line.quantity.value.trim()));
  const allZero = lines.every((line) => !(Number(line.quantity.value) > 0));

  function patch(id: string, part: Partial<PurchaseOrderLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...part } : line)));
  }

  async function save() {
    if (reapproval) {
      const ok = await confirm({
        title: t("prc.amend.confirmTitle"),
        body: t("prc.amend.confirmBody"),
        confirmLabel: t("prc.amend.save"),
        tone: "warn",
      });
      if (!ok) return;
    }
    await action.run(
      () => services.procurement.amendOrder(order, { lines, expectedDelivery: expected, reason, actor }, { orders: services.purchasing.orders }),
      {
        onSuccess: ({ order: updated, amendment }) =>
          onSaved(updated, amendment.reapprovalRequired ? t("prc.amend.savedReapproval") : t("prc.amend.saved")),
      },
    );
  }

  const columns: Column<PurchaseOrderLine>[] = [
    { key: "item", header: t("prc.price.item"), render: (row) => <CellStack primary={tx(row.itemName)} secondary={formatQuantity(row.quantity, fmt)} /> },
    {
      key: "quantity",
      header: t("common.quantity"),
      render: (row) => (
        <Input
          dir="ltr"
          inputMode="decimal"
          aria-label={`${t("common.quantity")} ${tx(row.itemName)}`}
          value={row.quantity.value}
          onChange={(event) => patch(row.id, { quantity: { ...row.quantity, value: event.target.value } })}
          className="w-24 text-end font-mono tabular-nums"
        />
      ),
    },
    {
      key: "price",
      header: t("doc.unitPrice"),
      render: (row) => (
        <div className="w-32">
          <MoneyInput
            value={row.unitPrice.amount}
            currency={currency}
            onChange={(minor) => patch(row.id, { unitPrice: { ...row.unitPrice, amount: minor ?? 0 } })}
            aria-label={`${t("doc.unitPrice")} ${tx(row.itemName)}`}
          />
        </div>
      ),
    },
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("prc.amend.title").replace("{ref}", order.reference)}
      subtitle="FR-PRC-023"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={action.pending}
            disabled={!changed || reason.trim().length < 8 || invalidQuantity || allZero}
            onClick={save}
          >
            {t("prc.amend.save")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("prc.amend.note")}</Callout>

        <DataTable columns={columns} rows={lines} rowKey={(row) => row.id} caption={order.reference} dense />
        <p className="text-fg-subtle text-xs">{t("prc.amend.zeroRemoves")}</p>

        <Field label={t("pur.expectedDelivery")}>
          <Input type="date" dir="ltr" value={expected} onChange={(event) => setExpected(event.target.value)} />
        </Field>

        <DescList>
          <DescRow label={t("prc.amend.before")} mono>
            {formatMoney(order.total, fmt)}
          </DescRow>
          <DescRow label={t("prc.amend.after")} mono>
            {formatMoney(money(totals.total, currency), fmt)}
          </DescRow>
        </DescList>

        {reapproval ? (
          <Callout tone="warn" title={t("prc.amend.reapproval")}>
            {t("prc.amend.reapprovalBody").replace("{tier}", String(tierForTotal(totals.total)))}
          </Callout>
        ) : approvedTier !== null && changed ? (
          <Callout tone="good">{t("prc.amend.withinBand")}</Callout>
        ) : null}

        {allZero ? <Callout tone="bad">{t("prc.amend.allZero")}</Callout> : null}

        <Field label={t("prc.reason")} hint={t("prc.reasonHint")} required>
          <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-021 — send to the supplier
// ---------------------------------------------------------------------------

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** The structured attachment: the order as data, for a supplier system to import. */
function orderAsJson(order: PurchaseOrder, supplier: Supplier | null): Blob {
  const body = {
    documentType: "purchase_order",
    version: 1,
    reference: order.reference,
    issuedAt: order.createdAt,
    expectedDelivery: order.expectedDelivery,
    currency: order.total.currency,
    buyer: { deliveryLocationId: order.deliveryLocationId, deliveryLocation: order.deliveryLocationName.en },
    supplier: supplier ? { id: supplier.id, code: supplier.code, name: supplier.legalName.en, taxRegistration: supplier.taxRegistration } : { id: order.supplierId },
    lines: order.lines.map((line, index) => ({
      lineNumber: index + 1,
      itemId: line.itemId,
      description: line.itemName.en,
      quantity: line.quantity.value,
      unit: line.quantity.unit,
      unitPriceMinor: line.unitPrice.amount,
      taxRatePercent: line.taxRate,
      lineTotalMinor: line.lineTotal.amount,
    })),
    subtotalMinor: order.subtotal.amount,
    taxMinor: order.taxTotal.amount,
    totalMinor: order.total.amount,
  };
  return new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
}

export function TransmitOrderDrawer({
  order,
  supplier,
  onClose,
  onSent,
}: {
  order: PurchaseOrder;
  supplier: Supplier | null;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const { t, tx, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const terms = useAsync(() => services.procurement.supplierTerms.get(order.supplierId), [order.supplierId]);
  const [channel, setChannel] = useState<TransmissionChannel>("email");
  const [recipient, setRecipient] = useState("");
  const [prepared, setPrepared] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);

  useEffect(() => {
    const email = terms.data?.orderEmail || supplier?.email || "";
    const phone = terms.data?.whatsapp || supplier?.phone || "";
    setRecipient(channel === "email" ? email : channel === "whatsapp" ? phone : terms.data?.portalUrl ?? "");
    setPrepared(false);
  }, [channel, terms.data, supplier]);

  const summary = useMemo(
    () =>
      [
        `${t("prc.send.poLabel")} ${order.reference}`,
        `${t("pur.expectedDelivery")}: ${order.expectedDelivery}`,
        `${t("pur.deliverTo")}: ${tx(order.deliveryLocationName)}`,
        "",
        ...order.lines.map((line) => `• ${tx(line.itemName)} — ${line.quantity.value} ${line.quantity.unit} × ${formatMoney(line.unitPrice, fmt)}`),
        "",
        `${t("common.total")}: ${formatMoney(order.total, fmt)}`,
      ].join("\n"),
    [order, t, tx, fmt],
  );

  function buildDocuments(): string[] {
    const base = order.reference.replace(/[^\w-]+/g, "_");
    const pdf = toPdf({
      filename: base,
      title: `${t("prc.send.poLabel")} ${order.reference} — ${supplier ? tx(supplier.legalName) : ""}`,
      subtitle: `${t("pur.expectedDelivery")}: ${order.expectedDelivery} · ${t("pur.deliverTo")}: ${tx(order.deliveryLocationName)} · ${t("common.total")}: ${formatMoney(order.total, fmt)}`,
      rows: order.lines,
      columns: [
        { key: "item", header: t("prc.price.item"), value: (line) => tx(line.itemName) },
        { key: "qty", header: t("common.quantity"), value: (line) => `${line.quantity.value} ${line.quantity.unit}` },
        { key: "price", header: t("doc.unitPrice"), value: (line) => formatMoney(line.unitPrice, fmt) },
        { key: "tax", header: t("fin.taxAmount"), value: (line) => `${line.taxRate}%` },
        { key: "total", header: t("common.total"), value: (line) => formatMoney(line.lineTotal, fmt) },
      ],
    });
    saveBlob(pdf.blob, `${base}.pdf`);
    saveBlob(orderAsJson(order, supplier), `${base}.json`);
    saveBlob(
      toCsv({
        filename: base,
        rows: order.lines,
        columns: [
          { key: "item", header: "item", value: (line) => line.itemName.en },
          { key: "quantity", header: "quantity", value: (line) => line.quantity.value },
          { key: "unit", header: "unit", value: (line) => line.quantity.unit },
          { key: "unitPriceMinor", header: "unit_price_minor", value: (line) => line.unitPrice.amount },
          { key: "taxRate", header: "tax_rate_percent", value: (line) => line.taxRate },
        ],
      }),
      `${base}.csv`,
    );
    return [`${base}.pdf`, `${base}.json`, `${base}.csv`];
  }

  async function prepare() {
    if (channel === "email") {
      const files = buildDocuments();
      setAttachments(files);
      const subject = encodeURIComponent(`${t("prc.send.poLabel")} ${order.reference}`);
      const body = encodeURIComponent(`${summary}\n\n${t("prc.send.attachReminder").replace("{files}", files.join(", "))}`);
      window.location.href = `mailto:${encodeURIComponent(recipient)}?subject=${subject}&body=${body}`;
      await action.run(() =>
        services.procurement.recordTransmission(order, { byName: actor.name, channel, recipient, outcome: "documents_prepared", attachments: files }, false, {
          orders: services.purchasing.orders,
        }),
      );
    } else if (channel === "whatsapp") {
      const digits = recipient.replace(/[^\d]/g, "");
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(summary)}`, "_blank", "noopener,noreferrer");
      await action.run(() =>
        services.procurement.recordTransmission(order, { byName: actor.name, channel, recipient, outcome: "handed_to_whatsapp", attachments: [] }, false, {
          orders: services.purchasing.orders,
        }),
      );
    }
    setPrepared(true);
  }

  async function confirmSent() {
    await action.run(
      () =>
        services.procurement.recordTransmission(order, { byName: actor.name, channel, recipient, outcome: "confirmed_sent", attachments }, true, {
          orders: services.purchasing.orders,
        }),
      { onSuccess: () => onSent(t("prc.send.markedSent")) },
    );
  }

  const recipientValid =
    channel === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim()) : channel === "whatsapp" ? recipient.replace(/[^\d]/g, "").length >= 8 : false;

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("prc.send.title").replace("{ref}", order.reference)}
      subtitle="FR-PRC-021"
      footer={
        <div className="flex flex-wrap gap-2">
          {channel !== "portal" ? (
            <Button variant={prepared ? "secondary" : "primary"} loading={action.pending && !prepared} disabled={!recipientValid} icon={channel === "email" ? <Mail size={14} /> : <MessageCircle size={14} />} onClick={prepare}>
              {channel === "email" ? t("prc.send.prepareEmail") : t("prc.send.openWhatsapp")}
            </Button>
          ) : null}
          {prepared ? (
            <Button variant="primary" loading={action.pending} onClick={confirmSent}>
              {t("prc.send.confirmSent")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="muted">{t("prc.send.honestNote")}</Callout>

        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("prc.send.channel")}>
          {(["email", "whatsapp", "portal"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={channel === value}
              onClick={() => setChannel(value)}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs ${channel === value ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-muted"}`}
            >
              {value === "email" ? <Mail size={16} /> : value === "whatsapp" ? <MessageCircle size={16} /> : <Plug size={16} />}
              {t(`prc.send.channel.${value}` as ConsoleKey)}
            </button>
          ))}
        </div>

        {channel === "portal" ? (
          <Callout tone="warn" title={t("prc.send.portalTitle")}>
            {t("prc.send.portalBody")}
          </Callout>
        ) : (
          <Field label={channel === "email" ? t("prc.terms.orderEmail") : t("prc.terms.whatsapp")} required>
            <Input dir="ltr" inputMode={channel === "email" ? "email" : "tel"} value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </Field>
        )}

        {channel === "email" ? (
          <Callout tone="accent" icon={<FileDown size={14} />}>
            {t("prc.send.emailExplain")}
          </Callout>
        ) : null}

        <section>
          <h3 className="text-fg mb-1 text-sm font-semibold">{t("prc.send.preview")}</h3>
          <pre className="bg-sunken text-fg-muted max-h-64 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">{summary}</pre>
        </section>

        {prepared ? <Callout tone="warn">{t("prc.send.confirmPrompt")}</Callout> : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-020 — approval links
// ---------------------------------------------------------------------------

export function ApprovalLinkDrawer({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const actor = useActor();
  const action = useAction();
  const confirm = useConfirm();
  const links = useAsync(
    () => services.procurement.approvalLinks.all().then((rows) => rows.filter((row) => row.orderId === order.id)),
    [order.id],
  );
  const [email, setEmail] = useState("");
  const [issued, setIssued] = useState<{ url: string; link: ApprovalLink } | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    await action.run(() => services.procurement.createApprovalLink(order, email, actor), {
      onSuccess: ({ link, token }) => {
        setIssued({ url: `${window.location.origin}/purchasing/approve/${token}`, link });
        setCopied(false);
        links.reload();
      },
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(link: ApprovalLink) {
    const ok = await confirm({
      title: t("prc.link.revokeTitle"),
      body: t("prc.link.revokeBody").replace("{email}", link.approverEmail),
      confirmLabel: t("prc.link.revoke"),
      tone: "danger",
    });
    if (!ok) return;
    await action.run(() => services.procurement.revokeApprovalLink(link.id), { onSuccess: () => links.reload() });
  }

  return (
    <Drawer open onClose={onClose} title={t("prc.link.title").replace("{ref}", order.reference)} subtitle="FR-PRC-020">
      <div className="space-y-4">
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <Callout tone="warn" title={t("prc.link.serverTitle")}>
          {t("prc.link.serverBody")}
        </Callout>

        {order.status === "pending_approval" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Field label={t("prc.link.approverEmail")} required>
                <Input dir="ltr" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
            </div>
            <Button variant="primary" icon={<Link2 size={14} />} loading={action.pending} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={issue}>
              {t("prc.link.issue")}
            </Button>
          </div>
        ) : (
          <Callout tone="muted">{t("prc.decide.notPending")}</Callout>
        )}

        {issued ? (
          <Callout tone="good" title={t("prc.link.issuedTitle")}>
            <p className="mb-2">{t("prc.link.issuedBody").replace("{when}", formatDateTime(issued.link.expiresAt, fmt))}</p>
            <div className="flex items-center gap-2">
              <code className="bg-raised text-fg min-w-0 flex-1 truncate rounded px-2 py-1 text-[0.7rem]" dir="ltr">
                {issued.url}
              </code>
              <IconButton label={t("prc.link.copy")} icon={<Copy size={14} />} onClick={() => void copy(issued.url)} />
              <a
                className="text-fg-muted hover:text-fg inline-flex h-8 w-8 items-center justify-center"
                aria-label={t("prc.link.openMail")}
                title={t("prc.link.openMail")}
                href={`mailto:${encodeURIComponent(issued.link.approverEmail)}?subject=${encodeURIComponent(`${t("prc.link.mailSubject")} ${order.reference}`)}&body=${encodeURIComponent(issued.url)}`}
              >
                <Mail size={14} />
              </a>
            </div>
            {copied ? <p className="mt-1">{t("prc.link.copied")}</p> : null}
          </Callout>
        ) : null}

        <section>
          <h3 className="text-fg mb-1 text-sm font-semibold">{t("prc.link.issued")}</h3>
          {(links.data ?? []).length === 0 ? (
            <p className="text-fg-subtle text-xs">{t("prc.link.none")}</p>
          ) : (
            <ul className="border-line divide-line divide-y rounded-lg border text-xs">
              {(links.data ?? []).map((link) => {
                const state = linkState(link);
                return (
                  <li key={link.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="text-fg min-w-0 flex-1" dir="ltr">
                      {link.approverEmail}
                    </span>
                    <span className="text-fg-subtle">{formatDateTime(link.createdAt, fmt)}</span>
                    <Badge tone={state === "valid" ? "accent" : state === "used" ? "good" : "muted"}>{t(`prc.link.state.${state}` as ConsoleKey)}</Badge>
                    {link.decision ? <Badge tone={link.decision === "approved" ? "good" : "bad"}>{t(`prc.decision.${link.decision}` as ConsoleKey)}</Badge> : null}
                    {state === "valid" ? (
                      <IconButton label={t("prc.link.revoke")} icon={<Trash2 size={14} />} onClick={() => void revoke(link)} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

export function canAmend(order: PurchaseOrder): boolean {
  return isAmendable(order.status);
}
