"use client";

/**
 * Supplier invoices — SRS §12.6, FR-PRC-041.
 *
 * The three-way match is the control that stops a restaurant paying for goods
 * it did not order or did not receive. Purchase order says what was agreed,
 * goods receipt says what arrived, invoice says what is being charged. All
 * three must agree before payment is approved.
 *
 * The tolerances matter as much as the match: quantity must be exact, unit
 * price may drift 2%, and totals must land within one minor unit. Without a
 * tolerance band every rounding difference becomes a dispute and the control
 * gets switched off; with too wide a band the control stops catching anything.
 *
 * Ageing is shown alongside because an unmatched invoice that is also 90 days
 * old is a different problem from one raised this morning.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { SupplierInvoice } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { DATA_MODE } from "@/lib/api/config";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber } from "@/lib/console/format";
import { AGEING_BUCKET, INVOICE_STATUS, MATCH_RESULT, labelOf } from "@/lib/console/labels";
import { suppliers } from "@/lib/console/mock/purchasing";
import { CellStack, CollectionTable, type Column } from "@/components/console/data-table";
import { CollectionToolbar, PageBody, PageHeader, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { Gate } from "@/components/console/states";
import {
  Badge,
  Button,
  Callout,
  DescList,
  DescRow,
  Drawer,
  Toast,
} from "@/components/console/ui";

export default function InvoicesPage() {
  return (
    <Gate permissions={["purchase.view"]}>
      <InvoicesScreen />
    </Gate>
  );
}

function InvoicesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const [selected, setSelected] = useState<SupplierInvoice | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<SupplierInvoice>(
    (query) => services.purchasing.invoices.list(query),
    { scope, initialSort: "-invoiceDate", pageSize: 25 },
  );

  const totals = useMemo(() => {
    const rows = collection.rows;
    const unpaid = rows.filter((row) => row.status !== "paid");
    return {
      outstanding: unpaid.reduce((sum, row) => sum + row.total.amount, 0),
      disputed: rows.filter(
        (row) => row.matchResult === "disputed" || row.matchResult === "unmatched",
      ).length,
      overdue: rows.filter((row) => row.ageingBucket === "90+").length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.total.currency ?? "EGP";

  const columns = useMemo<Column<SupplierInvoice>[]>(
    () => [
      {
        key: "reference",
        header: t("pur.invoiceNumber"),
        render: (row) => (
          <CellStack
            primary={<span className="font-mono">{row.supplierInvoiceNumber}</span>}
            secondary={tx(row.supplierName)}
          />
        ),
      },
      {
        key: "purchaseOrderRef",
        header: t("nav.purchaseOrders"),
        secondary: true,
        render: (row) =>
          row.purchaseOrderRef ? (
            <span className="font-mono text-xs">{row.purchaseOrderRef}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        key: "invoiceDate",
        header: t("pur.invoiceDate"),
        sortable: true,
        secondary: true,
        render: (row) => formatDate(row.invoiceDate, fmt),
      },
      {
        key: "dueDate",
        header: t("pur.dueDate"),
        sortable: true,
        render: (row) => formatDate(row.dueDate, fmt),
      },
      {
        key: "ageingBucket",
        header: t("pur.ageing"),
        render: (row) => {
          const ageing = labelOf(AGEING_BUCKET, row.ageingBucket);
          return <Badge tone={ageing.tone}>{tx(ageing.label)}</Badge>;
        },
      },
      {
        key: "matchResult",
        header: t("pur.match"),
        render: (row) => {
          const match = labelOf(MATCH_RESULT, row.matchResult);
          return <Badge tone={match.tone}>{tx(match.label)}</Badge>;
        },
      },
      {
        key: "total",
        header: t("common.total"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.total, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(INVOICE_STATUS, row.status);
          return (
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          );
        },
      },
    ],
    [t, tx, fmt],
  );

  return (
    <>
      <PageHeader
        title={t("pur.invoicesTitle")}
        subtitle={t("pur.invoicesSubtitle")}
        spec="FR-PRC-041"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setMessage(t("common.notInBuild"))}
          >
            {t("common.new")}
          </Button>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("pur.threeWayNote")}</Callout>

        <TileGrid columns={3}>
          <MetricTile
            label={t("pur.outstanding")}
            value={formatMoney({ amount: totals.outstanding, currency }, fmt, true)}
          />
          <MetricTile
            label={t("pur.matchFailures")}
            value={formatNumber(totals.disputed, fmt)}
            spec="FR-PRC-041"
            hint={t("pur.matchFailuresHint")}
          />
          <MetricTile
            label={tx(AGEING_BUCKET["90+"]!.label)}
            value={formatNumber(totals.overdue, fmt)}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(INVOICE_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "matchResult",
              label: t("pur.match"),
              options: Object.entries(MATCH_RESULT).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "ageingBucket",
              label: t("pur.ageing"),
              options: Object.entries(AGEING_BUCKET).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "supplierId",
              label: t("pur.supplier"),
              options: (DATA_MODE === "http" ? [] : suppliers).map((supplier) => ({
                value: supplier.id,
                label: tx(supplier.tradingName),
              })),
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("pur.invoicesTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <InvoiceDrawer invoice={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function InvoiceDrawer({
  invoice,
  onClose,
}: {
  invoice: SupplierInvoice | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!invoice) return null;

  const status = labelOf(INVOICE_STATUS, invoice.status);
  const match = labelOf(MATCH_RESULT, invoice.matchResult);
  const ageing = labelOf(AGEING_BUCKET, invoice.ageingBucket);
  const failed = invoice.matchResult === "disputed" || invoice.matchResult === "unmatched";

  return (
    <Drawer
      open
      onClose={onClose}
      title={invoice.supplierInvoiceNumber}
      subtitle={tx(invoice.supplierName)}
    >
      <div className="space-y-5">
        {failed ? (
          <Callout tone="bad" title={t("pur.match")}>
            {invoice.matchNotes ? tx(invoice.matchNotes) : t("pur.matchFailedNote")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.reference")} mono>
            {invoice.reference}
          </DescRow>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("pur.match")}>
            <Badge tone={match.tone}>{tx(match.label)}</Badge>
          </DescRow>
          <DescRow label={t("nav.purchaseOrders")} mono>
            {invoice.purchaseOrderRef ?? "—"}
          </DescRow>
          <DescRow label={t("nav.receiving")} mono>
            {invoice.goodsReceiptRef ?? "—"}
          </DescRow>
          <DescRow label={t("pur.invoiceDate")}>{formatDate(invoice.invoiceDate, fmt)}</DescRow>
          <DescRow label={t("pur.dueDate")}>{formatDate(invoice.dueDate, fmt)}</DescRow>
          <DescRow label={t("pur.ageing")}>
            <Badge tone={ageing.tone}>{tx(ageing.label)}</Badge>
          </DescRow>
          <DescRow label={t("common.subtotal")} mono>
            {formatMoney(invoice.subtotal, fmt)}
          </DescRow>
          <DescRow label={t("fin.taxAmount")} mono>
            {formatMoney(invoice.taxTotal, fmt)}
          </DescRow>
          <DescRow label={t("common.total")} mono>
            {formatMoney(invoice.total, fmt)}
          </DescRow>
        </DescList>

        <Callout tone="muted">{t("pur.threeWayNote")}</Callout>
      </div>
    </Drawer>
  );
}
