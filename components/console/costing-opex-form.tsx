"use client";

/**
 * Create / edit a branch operating expense — FR-CST-036.
 *
 * Hand-written rather than a `RecordDrawer`, because the allocation part is
 * conditional (one branch vs. several) and manual percentages need a live
 * running total that must reach exactly 100 before the form can be saved.
 */

import { useMemo, useState } from "react";
import type { Branch, Currency, Id } from "@/lib/console/types";
import type { OperatingExpenseInput } from "@/lib/console/services/costing-opex";
import { services } from "@/lib/console/services";
import { useI18n, useSession } from "@/lib/console/providers";
import {
  OPEX_ALLOCATION,
  OPEX_CATEGORIES,
  OPEX_RECURRENCE,
  validateExpense,
  type AllocationInputs,
  type OperatingExpense,
  type OpexAllocation,
  type OpexCategory,
  type OpexRecurrence,
} from "@/lib/console/costing-opex";
import { MoneyInput } from "@/components/console/fields";
import { Button, Callout, Drawer, Field, Input, Select, Toggle } from "@/components/console/ui";

export function OperatingExpenseDrawer({
  open,
  expense,
  branches,
  currency,
  onClose,
  onSaved,
}: {
  open: boolean;
  expense: OperatingExpense | null;
  branches: Branch[];
  currency: Currency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, tx } = useI18n();
  const { session } = useSession();

  const [description, setDescription] = useState(expense?.description ?? "");
  const [category, setCategory] = useState<OpexCategory>(expense?.category ?? "rent");
  const [amountMinor, setAmountMinor] = useState<number | null>(expense?.amountMinor ?? null);
  const [recurrence, setRecurrence] = useState<OpexRecurrence>(expense?.recurrence ?? "monthly");
  const [startsOn, setStartsOn] = useState(expense?.startsOn ?? new Date().toISOString().slice(0, 8) + "01");
  const [endsOn, setEndsOn] = useState(expense?.endsOn ?? "");
  const [fixed, setFixed] = useState(expense?.fixed ?? true);
  const [allocation, setAllocation] = useState<OpexAllocation>(expense?.allocation ?? "single");
  const [branchIds, setBranchIds] = useState<string[]>(expense?.branchIds ?? (branches[0] ? [branches[0].id] : []));
  const [manual, setManual] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(expense?.manualPercent ?? {}).map(([id, value]) => [id, String(value)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const input: OperatingExpenseInput = useMemo(
    () => ({
      description,
      category,
      amountMinor: amountMinor ?? 0,
      currency,
      recurrence,
      startsOn,
      endsOn: endsOn || null,
      fixed,
      allocation,
      branchIds,
      manualPercent: Object.fromEntries(branchIds.map((id) => [id, Number(manual[id] ?? 0) || 0])),
      createdBy: session?.user ? tx(session.user.name) : null,
    }),
    [description, category, amountMinor, currency, recurrence, startsOn, endsOn, fixed, allocation, branchIds, manual, session, tx],
  );

  const manualTotal = branchIds.reduce((sum, id) => sum + (Number(manual[id] ?? 0) || 0), 0);
  const problem = validateExpense(input);

  function toggleBranch(id: string, on: boolean) {
    setBranchIds((current) => (on ? [...current.filter((row) => row !== id), id] : current.filter((row) => row !== id)));
  }

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (expense) await services.operatingExpenses.update(expense.id, input);
      else await services.operatingExpenses.create(input);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={expense ? t("cst.opex.edit") : t("cst.opex.add")}
      footer={
        <Button variant="primary" loading={saving} onClick={save}>
          {t("common.save")}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <Callout tone="bad">{error}</Callout> : null}

        <Field label={t("cst.opex.description")} required>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} data-autofocus />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.category")} required>
            <Select value={category} onChange={(event) => setCategory(event.target.value as OpexCategory)}>
              {OPEX_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {tx(option.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cst.opex.amount")} required hint={t("cst.opex.amountHint")}>
            <MoneyInput value={amountMinor} onChange={setAmountMinor} currency={currency} min={0} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("cst.opex.recurrence")} required>
            <Select value={recurrence} onChange={(event) => setRecurrence(event.target.value as OpexRecurrence)}>
              {OPEX_RECURRENCE.map((option) => (
                <option key={option.value} value={option.value}>
                  {tx(option.label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cst.opex.startsOn")} required>
            <Input type="date" dir="ltr" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
          </Field>
          <Field label={t("cst.opex.endsOn")} hint={t("cst.opex.endsOnHint")}>
            <Input type="date" dir="ltr" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </Field>
        </div>

        <Toggle checked={fixed} onChange={setFixed} label={t("cst.opex.fixed")} hint={t("cst.opex.fixedHint")} />

        <Field label={t("cst.opex.allocation")} required>
          <Select
            value={allocation}
            onChange={(event) => {
              const next = event.target.value as OpexAllocation;
              setAllocation(next);
              if (next === "single") setBranchIds((current) => current.slice(0, 1));
            }}
          >
            {OPEX_ALLOCATION.map((option) => (
              <option key={option.value} value={option.value}>
                {tx(option.label)}
              </option>
            ))}
          </Select>
        </Field>

        {allocation === "single" ? (
          <Field label={t("common.branch")} required>
            <Select value={branchIds[0] ?? ""} onChange={(event) => setBranchIds([event.target.value])}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {tx(branch.name)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="border-line rounded-lg border px-3">
            {branches.map((branch) => {
              const on = branchIds.includes(branch.id);
              return (
                <div key={branch.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Toggle checked={on} onChange={(next) => toggleBranch(branch.id, next)} label={tx(branch.name)} />
                  </div>
                  {allocation === "manual" && on ? (
                    <div className="w-24">
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={`${tx(branch.name)} %`}
                        value={manual[branch.id] ?? ""}
                        onChange={(event) => setManual((current) => ({ ...current, [branch.id]: event.target.value }))}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {allocation === "manual" ? (
              <p className={`py-2 text-xs ${Math.abs(manualTotal - 100) > 0.001 ? "text-bad" : "text-fg-subtle"}`}>
                {t("cst.opex.manualTotal").replace("{n}", String(Math.round(manualTotal * 100) / 100))}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Net sales per branch as allocation weights; null when the backend has no figure. */
export async function loadAllocationInputs(scope: ReturnType<typeof useSession>["scope"], areas: Map<Id, number>) {
  const netSales = await services.costing
    .branchProfitability({ ...scope, branchId: null })
    .then((rows) => new Map(rows.map((row) => [row.branchId, row.netSales.amount])))
    .catch(() => null);
  const inputs: AllocationInputs = { netSalesByBranch: netSales ?? new Map(), areaByBranch: areas };
  return { inputs, netSalesAvailable: netSales !== null };
}
