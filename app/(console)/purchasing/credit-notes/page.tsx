"use client";

/**
 * Supplier credit notes — SRS §12.6, FR-PRC-043.
 *
 * Credits arise from goods rejected at the door (FR-PRC-036), returns after
 * receipt (FR-PRC-037), dispute settlements (FR-PRC-042) or are entered by
 * hand. Each starts *expected* until the supplier actually issues it — only
 * an issued credit, with the supplier's own number, can be applied against
 * that supplier's outstanding invoices.
 */

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Link2, Plus } from "lucide-react";

import { services } from "@/lib/console/services";
import { creditAvailable, type CreditNote } from "@/lib/console/services/purchasing-local";
import { useAction } from "@/lib/console/actions";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission } from "@/lib/console/providers";
import { formatDate, formatMoney, money } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { ExportButton } from "@/components/console/export-button";
import { Gate } from "@/components/console/states";
import { useConfirm } from "@/components/console/confirm";
import { ApplyToInvoiceModal, ConfirmCreditModal, CreditNoteDrawer } from "@/components/console/purchasing-payables";
import { useSupplierList } from "@/components/console/purchasing-shared";
import { Badge, Button, Callout, Field, IconButton, Select, Toast } from "@/components/console/ui";

const STATUS_TONE = { expected: "warn", received: "good", cancelled: "muted" } as const;

export default function CreditNotesPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <CreditNotesScreen />
    </Gate>
  );
}

function CreditNotesScreen() {
  const { t, tx, fmt } = useI18n();
  const canRecord = usePermission("purchase.invoice.record");
  const confirm = useConfirm();
  const action = useAction();
  const suppliers = useSupplierList();
  const notes = useAsync(() => services.procurement.creditNotes.all(), []);
  const [message, setMessage] = useTransientMessage();
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<CreditNote | null>(null);
  const [applying, setApplying] = useState<CreditNote | null>(null);
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const rows = useMemo(
    () =>
      (notes.data ?? [])
        .filter((row) => !status || row.status === status)
        .filter((row) => !supplierId || row.supplierId === supplierId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes.data, status, supplierId],
  );

  const all = notes.data ?? [];
  const expected = all.filter((row) => row.status === "expected").reduce((sum, row) => sum + row.amountMinor, 0);
  const unapplied = all.reduce((sum, row) => sum + creditAvailable(row), 0);

  const done = (note: string) => {
    setConfirming(null);
    setApplying(null);
    setCreating(false);
    setMessage(note);
    notes.reload();
  };

  const columns: Column<CreditNote>[] = [
    {
      key: "reference",
      header: t("common.reference"),
      render: (row) => (
        <CellStack
          primary={<span className="font-mono">{row.supplierCreditNumber || row.reference}</span>}
          secondary={row.supplierCreditNumber ? <span className="font-mono">{row.reference}</span> : t("prc.credit.notIssued")}
        />
      ),
    },
    { key: "supplier", header: t("pur.supplier"), render: (row) => tx(row.supplierName) },
    {
      key: "source",
      header: t("prc.credit.source"),
      secondary: true,
      render: (row) => (
        <CellStack primary={t(`prc.credit.sourceKind.${row.source}` as ConsoleKey)} secondary={row.sourceRef ? <span className="font-mono">{row.sourceRef}</span> : undefined} />
      ),
    },
    { key: "issuedOn", header: t("prc.credit.issuedOn"), secondary: true, render: (row) => (row.issuedOn ? formatDate(row.issuedOn, fmt) : "—") },
    { key: "amount", header: t("prc.credit.amount"), numeric: true, render: (row) => formatMoney(money(row.amountMinor, row.currency as "EGP"), fmt) },
    {
      key: "available",
      header: t("prc.credit.available"),
      numeric: true,
      render: (row) => (row.status === "received" ? formatMoney(money(creditAvailable(row), row.currency as "EGP"), fmt) : "—"),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]} dot>
          {t(`prc.credit.status.${row.status}` as ConsoleKey)}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("common.actions")}</span>,
      align: "end",
      render: (row) =>
        canRecord ? (
          <div className="flex justify-end gap-1">
            {row.status === "expected" ? <IconButton label={t("prc.credit.confirm")} icon={<CheckCircle2 size={14} />} onClick={() => setConfirming(row)} /> : null}
            {row.status === "received" && creditAvailable(row) > 0 ? <IconButton label={t("prc.credit.apply")} icon={<Link2 size={14} />} onClick={() => setApplying(row)} /> : null}
            {row.status !== "cancelled" && row.applications.length === 0 ? (
              <IconButton
                label={t("prc.credit.cancel")}
                icon={<Ban size={14} />}
                onClick={async () => {
                  const ok = await confirm({
                    title: t("prc.credit.cancelTitle"),
                    body: t("prc.credit.cancelBody").replace("{ref}", row.reference),
                    confirmLabel: t("prc.credit.cancel"),
                    tone: "danger",
                  });
                  if (!ok) return;
                  await action.run(() => services.procurement.cancelCreditNote(row.id), { onSuccess: () => done(t("prc.credit.cancelled")) });
                }}
              />
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("prc.credit.title")}
        subtitle={t("prc.credit.subtitle")}
        spec="FR-PRC-043"
        actions={
          <div className="flex gap-2">
            <ExportButton
              filename="supplier-credit-notes"
              title={t("prc.credit.title")}
              rows={rows}
              columns={[
                { key: "ref", header: t("common.reference"), value: (row) => row.reference },
                { key: "number", header: t("prc.credit.supplierNumber"), value: (row) => row.supplierCreditNumber },
                { key: "supplier", header: t("pur.supplier"), value: (row) => tx(row.supplierName) },
                { key: "source", header: t("prc.credit.source"), value: (row) => t(`prc.credit.sourceKind.${row.source}` as ConsoleKey) },
                { key: "amount", header: t("prc.credit.amount"), value: (row) => (row.amountMinor / 100).toFixed(2) },
                { key: "available", header: t("prc.credit.available"), value: (row) => (creditAvailable(row) / 100).toFixed(2) },
                { key: "status", header: t("common.status"), value: (row) => t(`prc.credit.status.${row.status}` as ConsoleKey) },
              ]}
            />
            {canRecord ? (
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                {t("prc.credit.new")}
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        <Callout tone="muted">{t("prc.localNote")}</Callout>
        {action.error ? <Callout tone="bad">{action.error}</Callout> : null}
        <TileGrid columns={3}>
          <MetricTile label={t("prc.credit.expectedTotal")} value={formatMoney(money(expected, "EGP"), fmt, true)} spec="FR-PRC-043" />
          <MetricTile label={t("prc.credit.unappliedTotal")} value={formatMoney(money(unapplied, "EGP"), fmt, true)} />
          <MetricTile label={t("prc.credit.count")} value={String(all.filter((row) => row.status !== "cancelled").length)} />
        </TileGrid>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("common.status")}>
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {(["expected", "received", "cancelled"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`prc.credit.status.${value}` as ConsoleKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pur.supplier")}>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">{t("common.all")}</option>
              {suppliers.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {tx(row.tradingName)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={notes.loading}
          error={notes.error}
          onRetry={notes.reload}
          caption={t("prc.credit.title")}
          emptyTitle={t("prc.credit.emptyTitle")}
          emptyBody={t("prc.credit.emptyBody")}
          filtered={Boolean(status || supplierId)}
          onClearFilters={() => {
            setStatus("");
            setSupplierId("");
          }}
          dense
        />
      </PageBody>

      {creating ? <CreditNoteDrawer suppliers={suppliers.rows} onClose={() => setCreating(false)} onSaved={done} /> : null}
      {confirming ? <ConfirmCreditModal note={confirming} onClose={() => setConfirming(null)} onDone={done} /> : null}
      {applying ? <ApplyToInvoiceModal note={applying} onClose={() => setApplying(null)} onDone={done} /> : null}
      <Toast message={message} />
    </>
  );
}
