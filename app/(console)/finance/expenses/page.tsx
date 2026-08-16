"use client";

/**
 * Expenses — SRS §16.4.
 *
 * Branch operating expenses: the line between gross profit and operating
 * profit. They are captured per branch rather than centrally because that is
 * the only way branch P&L means anything — a laundry contract billed to head
 * office and spread evenly makes an efficient branch subsidise a wasteful one.
 *
 * Petty cash is the category that needs the attachment. It is the one payment
 * method with no counterparty record anywhere else in the system: a bank
 * transfer reconciles against a statement, a card against a settlement file,
 * and petty cash against nothing but the receipt somebody remembered to keep.
 */

import { useMemo, useState } from "react";
import { Paperclip, Plus, Repeat } from "lucide-react";
import type { Expense } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useCollection, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, usePermission, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney, formatNumber } from "@/lib/console/format";
import { EXPENSE_STATUS, PAYMENT_METHOD, labelOf } from "@/lib/console/labels";
import { expenses as allExpenses } from "@/lib/console/mock/finance";
import { branches } from "@/lib/console/mock/org";
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

export default function ExpensesPage() {
  return (
    <Gate permissions={["finance.expense.view"]}>
      <ExpensesScreen />
    </Gate>
  );
}

function ExpensesScreen() {
  const { t, tx, fmt } = useI18n();
  const { scope } = useSession();
  const canManage = usePermission("finance.expense.manage");
  const [selected, setSelected] = useState<Expense | null>(null);
  const [message, setMessage] = useTransientMessage();

  const collection = useCollection<Expense>(
    (query) => services.finance.expenses.list(query),
    { scope, initialSort: "-incurredOn", pageSize: 25 },
  );

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const expense of allExpenses) {
      if (!seen.has(expense.category.en)) seen.set(expense.category.en, tx(expense.category));
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tx]);

  const totals = useMemo(() => {
    const rows = collection.rows;
    return {
      total: rows.reduce((sum, row) => sum + row.amount.amount, 0),
      pending: rows.filter((row) => row.status === "pending_approval").length,
      // Petty cash without a receipt is the gap worth surfacing.
      missingAttachment: rows.filter(
        (row) => row.paymentMethod === "petty_cash" && !row.hasAttachment,
      ).length,
    };
  }, [collection.rows]);

  const currency = collection.rows[0]?.amount.currency ?? "EGP";

  const columns = useMemo<Column<Expense>[]>(
    () => [
      {
        key: "reference",
        header: t("common.reference"),
        render: (row) => (
          <CellStack
            primary={tx(row.description)}
            secondary={<span className="font-mono">{row.reference}</span>}
          />
        ),
      },
      {
        key: "category",
        header: t("fin.expenseCategory"),
        render: (row) => <span className="text-fg-muted text-xs">{tx(row.category)}</span>,
      },
      {
        key: "branch",
        header: t("common.branch"),
        secondary: true,
        render: (row) => tx(row.branchName),
      },
      {
        key: "incurredOn",
        header: t("fin.incurredOn"),
        sortable: true,
        render: (row) => formatDate(row.incurredOn, fmt),
      },
      {
        key: "paymentMethod",
        header: t("fin.paymentMethod"),
        secondary: true,
        render: (row) => {
          const method = labelOf(PAYMENT_METHOD, row.paymentMethod);
          return <Badge tone={method.tone}>{tx(method.label)}</Badge>;
        },
      },
      {
        key: "flags",
        header: "",
        width: "4rem",
        render: (row) => (
          <span className="text-fg-subtle flex items-center gap-1.5">
            {row.recurring ? <Repeat size={13} aria-label={t("fin.recurring")} /> : null}
            {row.hasAttachment ? (
              <Paperclip size={13} aria-label={t("fin.attachment")} />
            ) : null}
          </span>
        ),
      },
      {
        key: "amount",
        header: t("fin.amount"),
        sortable: true,
        numeric: true,
        render: (row) => formatMoney(row.amount, fmt),
      },
      {
        key: "status",
        header: t("common.status"),
        render: (row) => {
          const status = labelOf(EXPENSE_STATUS, row.status);
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
        title={t("fin.expensesTitle")}
        subtitle={t("fin.expensesSubtitle")}
        spec="FR-FIN-030"
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setMessage(t("common.notInBuild"))}
            >
              {t("common.new")}
            </Button>
          ) : null
        }
      />

      <PageBody>
        <TileGrid columns={3}>
          <MetricTile
            label={t("pl.opex")}
            value={formatMoney({ amount: totals.total, currency }, fmt, true)}
          />
          <MetricTile
            label={t("common.pending")}
            value={formatNumber(totals.pending, fmt)}
            spec="FR-FIN-032"
          />
          <MetricTile
            label={t("fin.missingReceipt")}
            value={formatNumber(totals.missingAttachment, fmt)}
            hint={t("fin.missingReceiptHint")}
          />
        </TileGrid>

        <CollectionToolbar
          collection={collection}
          filters={[
            {
              key: "status",
              label: t("common.status"),
              options: Object.entries(EXPENSE_STATUS).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            { key: "category", label: t("fin.expenseCategory"), options: categories },
            {
              key: "paymentMethod",
              label: t("fin.paymentMethod"),
              options: Object.entries(PAYMENT_METHOD).map(([value, entry]) => ({
                value,
                label: tx(entry.label),
              })),
            },
            {
              key: "recurring",
              label: t("fin.recurring"),
              options: [
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
            },
          ]}
        />

        <CollectionTable
          collection={collection}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t("fin.expensesTitle")}
          onRowClick={setSelected}
          activeRowKey={selected?.id ?? null}
          dense
        />
      </PageBody>

      <ExpenseDrawer expense={selected} onClose={() => setSelected(null)} />
      <Toast message={message} />
    </>
  );
}

// ---------------------------------------------------------------------------

function ExpenseDrawer({
  expense,
  onClose,
}: {
  expense: Expense | null;
  onClose: () => void;
}) {
  const { t, tx, fmt } = useI18n();
  if (!expense) return null;

  const status = labelOf(EXPENSE_STATUS, expense.status);
  const method = labelOf(PAYMENT_METHOD, expense.paymentMethod);
  const missingReceipt = expense.paymentMethod === "petty_cash" && !expense.hasAttachment;

  return (
    <Drawer
      open
      onClose={onClose}
      title={tx(expense.description)}
      subtitle={
        <span className="font-mono text-xs" dir="ltr">
          {expense.reference}
        </span>
      }
    >
      <div className="space-y-5">
        {missingReceipt ? (
          <Callout tone="warn" title={t("fin.missingReceipt")}>
            {t("fin.missingReceiptHint")}
          </Callout>
        ) : null}

        <DescList>
          <DescRow label={t("common.status")}>
            <Badge tone={status.tone} dot>
              {tx(status.label)}
            </Badge>
          </DescRow>
          <DescRow label={t("fin.expenseCategory")}>{tx(expense.category)}</DescRow>
          <DescRow label={t("common.branch")}>{tx(expense.branchName)}</DescRow>
          <DescRow label={t("fin.amount")} mono>
            {formatMoney(expense.amount, fmt)}
          </DescRow>
          <DescRow label={t("fin.paymentMethod")}>
            <Badge tone={method.tone}>{tx(method.label)}</Badge>
          </DescRow>
          <DescRow label={t("pur.supplier")}>
            {expense.supplierName ? tx(expense.supplierName) : t("common.none")}
          </DescRow>
          <DescRow label={t("fin.incurredOn")}>{formatDate(expense.incurredOn, fmt)}</DescRow>
          <DescRow label={t("fin.recurring")}>
            {expense.recurring ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("fin.attachment")}>
            {expense.hasAttachment ? t("common.yes") : t("common.no")}
          </DescRow>
          <DescRow label={t("common.by")}>{tx(expense.createdBy)}</DescRow>
        </DescList>
      </div>
    </Drawer>
  );
}
