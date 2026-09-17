"use client";

/**
 * Branch operating expenses — SRS §13.6, FR-CST-036.
 *
 * Rent, utilities, maintenance and the rest, each with a category, a
 * recurrence and an allocation. The allocation matters as much as the
 * amount: a head-office lease split across five sites changes every branch's
 * operating profit, and "who carries it" should be a recorded decision, not
 * a spreadsheet nobody else can see.
 *
 * Persisted browser-locally (`services.operatingExpenses`) — the backend has
 * no operating-cost resource. The month view shows the monthly equivalent
 * each branch carries, which is what break-even (FR-CST-038) reads.
 */

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Id } from "@/lib/console/types";
import { services } from "@/lib/console/services";
import { useAsync, useTransientMessage } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { formatDate, formatMoney } from "@/lib/console/format";
import {
  OPEX_ALLOCATION,
  OPEX_CATEGORIES,
  OPEX_RECURRENCE,
  allocate,
  branchCostsForMonth,
  monthlyAmount,
  type OperatingExpense,
} from "@/lib/console/costing-opex";
import { CellStack, DataTable, type Column } from "@/components/console/data-table";
import { PageBody, PageHeader, Section, TileGrid } from "@/components/console/page";
import { MetricTile } from "@/components/console/charts";
import { AsyncPanel, Gate } from "@/components/console/states";
import { ExportButton } from "@/components/console/export-button";
import { EmptyState } from "@/components/console/fields";
import { useConfirm } from "@/components/console/confirm";
import { OperatingExpenseDrawer, loadAllocationInputs } from "@/components/console/costing-opex-form";
import { Badge, Button, Callout, Field, Input, Toast } from "@/components/console/ui";

export default function OperatingExpensesPage() {
  return (
    <Gate permissions={["costing.margin.view", "costing.view"]}>
      <OperatingExpenses />
    </Gate>
  );
}

function OperatingExpenses() {
  const { t, tx, fmt } = useI18n();
  const { scope, availableBranches, tenant } = useSession();
  const confirm = useConfirm();
  const [message, setMessage] = useTransientMessage();
  const [editing, setEditing] = useState<OperatingExpense | null>(null);
  const [creating, setCreating] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const currency = availableBranches[0]?.currency ?? tenant.baseCurrency;
  const areas = useMemo(() => new Map(availableBranches.map((branch) => [branch.id, branch.areaSqm])), [availableBranches]);

  const state = useAsync(async () => {
    const [expenses, allocation] = await Promise.all([services.operatingExpenses.all(), loadAllocationInputs(scope, areas)]);
    return { expenses, ...allocation };
  }, [scope.tenantId, scope.brandId, areas]);

  async function remove(expense: OperatingExpense) {
    const ok = await confirm({
      title: t("common.confirmDelete").replace("{name}", expense.description),
      body: t("cst.opex.deleteBody"),
      tone: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    await services.operatingExpenses.remove(expense.id);
    setMessage(t("cst.opex.deleted"));
    state.reload();
  }

  const branchName = (id: Id) => {
    const branch = availableBranches.find((row) => row.id === id);
    return branch ? tx(branch.name) : id;
  };

  return (
    <>
      <PageHeader
        title={t("cst.opex.title")}
        subtitle={t("cst.opex.subtitle")}
        spec="FR-CST-036"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            {t("cst.opex.add")}
          </Button>
        }
      />

      <PageBody>
        <Callout tone="muted">{t("cst.opex.localNote")}</Callout>

        <div className="w-48">
          <Field label={t("cst.opex.month")}>
            <Input type="month" dir="ltr" value={month} onChange={(event) => setMonth(event.target.value)} />
          </Field>
        </div>

        <AsyncPanel state={state}>
          {(ready) => {
            const scoped = ready.expenses.filter(
              (expense) => !scope.branchId || expense.branchIds.includes(scope.branchId),
            );
            const perBranch = branchCostsForMonth(scoped, month, ready.inputs);
            const fixedPerBranch = branchCostsForMonth(scoped, month, ready.inputs, { fixedOnly: true });
            const monthTotal = scoped.reduce((sum, expense) => sum + monthlyAmount(expense, month), 0);
            const fixedTotal = scoped.filter((row) => row.fixed).reduce((sum, expense) => sum + monthlyAmount(expense, month), 0);
            const usesSales = scoped.some((row) => row.allocation === "net_sales");

            const columns: Column<OperatingExpense>[] = [
              {
                key: "description",
                header: t("cst.opex.description"),
                render: (row) => (
                  <CellStack
                    primary={row.description}
                    secondary={tx(OPEX_CATEGORIES.find((option) => option.value === row.category)!.label)}
                  />
                ),
              },
              {
                key: "recurrence",
                header: t("cst.opex.recurrence"),
                render: (row) => (
                  <CellStack
                    primary={tx(OPEX_RECURRENCE.find((option) => option.value === row.recurrence)!.label)}
                    secondary={`${formatDate(row.startsOn, fmt)}${row.endsOn ? ` – ${formatDate(row.endsOn, fmt)}` : ""}`}
                  />
                ),
              },
              { key: "amount", header: t("cst.opex.amount"), numeric: true, render: (row) => formatMoney({ amount: row.amountMinor, currency: row.currency }, fmt) },
              {
                key: "fixed",
                header: t("cst.opex.type"),
                render: (row) => <Badge tone={row.fixed ? "accent" : "muted"}>{row.fixed ? t("cst.opex.fixedShort") : t("cst.opex.variableShort")}</Badge>,
              },
              {
                key: "allocation",
                header: t("cst.opex.allocation"),
                render: (row) => {
                  const shares = allocate(row, monthlyAmount(row, month), ready.inputs);
                  return (
                    <CellStack
                      primary={tx(OPEX_ALLOCATION.find((option) => option.value === row.allocation)!.label)}
                      secondary={
                        shares.size > 0
                          ? [...shares.entries()].map(([id, amount]) => `${branchName(id)} ${formatMoney({ amount, currency: row.currency }, fmt, true)}`).join(" · ")
                          : row.branchIds.map(branchName).join(" · ")
                      }
                    />
                  );
                },
              },
              {
                key: "month",
                header: t("cst.opex.inMonth"),
                numeric: true,
                render: (row) => formatMoney({ amount: monthlyAmount(row, month), currency: row.currency }, fmt),
              },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <span className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={() => setEditing(row)} aria-label={t("common.edit")} />
                    <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => remove(row)} aria-label={t("common.delete")} />
                  </span>
                ),
              },
            ];

            const branchRows = availableBranches
              .filter((branch) => !scope.branchId || branch.id === scope.branchId)
              .map((branch) => ({
                id: branch.id,
                name: tx(branch.name),
                fixed: fixedPerBranch.get(branch.id) ?? 0,
                total: perBranch.get(branch.id) ?? 0,
              }));

            return (
              <>
                <TileGrid columns={3}>
                  <MetricTile label={t("cst.opex.monthTotal")} value={formatMoney({ amount: monthTotal, currency }, fmt, true)} />
                  <MetricTile label={t("cst.opex.fixedTotal")} value={formatMoney({ amount: fixedTotal, currency }, fmt, true)} spec="FR-CST-038" />
                  <MetricTile label={t("cst.opex.count")} value={String(scoped.length)} />
                </TileGrid>

                {usesSales && !ready.netSalesAvailable ? <Callout tone="warn">{t("cst.opex.noSalesWeights")}</Callout> : null}

                {scoped.length === 0 ? (
                  <EmptyState
                    title={t("cst.opex.emptyTitle")}
                    body={t("cst.opex.emptyBody")}
                    action={
                      <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                        {t("cst.opex.add")}
                      </Button>
                    }
                  />
                ) : (
                  <DataTable columns={columns} rows={scoped} rowKey={(row) => row.id} caption={t("cst.opex.title")} dense />
                )}

                <Section
                  title={t("cst.opex.perBranchTitle")}
                  hint={t("cst.opex.perBranchHint")}
                  action={
                    <ExportButton
                      filename={`operating-expenses-${month}`}
                      title={t("cst.opex.perBranchTitle")}
                      filterSummary={month}
                      rows={branchRows}
                      columns={[
                        { key: "branch", header: t("common.branch"), value: (row) => row.name },
                        { key: "fixed", header: t("cst.opex.fixedTotal"), value: (row) => (row.fixed / 100).toFixed(2) },
                        { key: "total", header: t("cst.opex.monthTotal"), value: (row) => (row.total / 100).toFixed(2) },
                      ]}
                    />
                  }
                >
                  <DataTable
                    columns={[
                      { key: "branch", header: t("common.branch"), render: (row) => row.name },
                      { key: "fixed", header: t("cst.opex.fixedTotal"), numeric: true, render: (row) => formatMoney({ amount: row.fixed, currency }, fmt) },
                      { key: "total", header: t("cst.opex.monthTotal"), numeric: true, render: (row) => formatMoney({ amount: row.total, currency }, fmt) },
                    ]}
                    rows={branchRows}
                    rowKey={(row) => row.id}
                    caption={t("cst.opex.perBranchTitle")}
                    dense
                  />
                </Section>
              </>
            );
          }}
        </AsyncPanel>
      </PageBody>

      {creating || editing ? (
        <OperatingExpenseDrawer
          key={editing?.id ?? "new"}
          open
          expense={editing}
          branches={availableBranches}
          currency={currency}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            setMessage(t("cst.opex.saved"));
            state.reload();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}
