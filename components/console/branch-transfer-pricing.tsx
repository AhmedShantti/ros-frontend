"use client";

/**
 * Central-kitchen transfer pricing — FR-BRN-030.
 *
 * What a branch is charged for what the central kitchen sends it decides how
 * the kitchen reads in the books:
 *
 *   - at cost, the kitchen recovers exactly its production cost and is a
 *     cost centre — its result should be zero, and any residue is waste or
 *     inefficiency;
 *   - at cost plus a markup, or at a fixed internal price per item, the
 *     kitchen earns a margin and is evaluated as a profit centre.
 *
 * The statement below prices the kitchen's real dispatched distribution
 * orders (the unit cost each carried from its production run) under the
 * policy, per receiving branch. A fixed policy with no price for an item
 * leaves that line unpriced and says so — falling back to cost would make
 * the kitchen look like a cost centre for exactly the items nobody priced.
 */

import { useMemo, useState } from "react";

import type { CentralKitchen, Currency, Id } from "@/lib/console/types";
import { extend, transferUnitPrice, evaluationFor, type TransferCharge, type TransferPricingMethod, type TransferPricingPolicy } from "@/lib/console/branch-network";
import { services } from "@/lib/console/services";
import { useAsync } from "@/lib/console/hooks";
import { useAction } from "@/lib/console/actions";
import { useI18n } from "@/lib/console/providers";
import { formatMoney, formatNumber, toMajorUnits } from "@/lib/console/format";
import type { ConsoleKey } from "@/locales";
import { DataTable, type Column } from "@/components/console/data-table";
import { ExportButton } from "@/components/console/export-button";
import { MoneyInput, PercentInput } from "@/components/console/fields";
import { Badge, Button, Callout, Field, Input, SegmentedControl, Skeleton } from "@/components/console/ui";

const METHODS: TransferPricingMethod[] = ["cost", "cost_plus", "fixed"];

export function TransferPricingPanel({ kitchen, canManage, onSaved }: { kitchen: CentralKitchen; canManage: boolean; onSaved: (message: string) => void }) {
  const { t, tx, fmt } = useI18n();
  const action = useAction();

  const data = useAsync(async () => {
    const [policy, distributions] = await Promise.all([
      services.branchNetwork.transferPricing.get(kitchen.id),
      services.centralKitchen.distributions.all(),
    ]);
    return { policy, distributions: distributions.filter((row) => row.kitchenId === kitchen.id) };
  }, [kitchen.id]);

  const [draft, setDraft] = useState<TransferPricingPolicy | null>(null);
  const saved = data.data?.policy ?? null;
  const currency: Currency = (data.data?.distributions[0]?.currency ?? saved?.currency ?? "EGP") as Currency;
  const policy: TransferPricingPolicy =
    draft ??
    saved ?? {
      id: kitchen.id,
      kitchenId: kitchen.id,
      method: "cost",
      markupPercent: 0,
      fixedPrices: {},
      currency,
      evaluatedAs: "cost_centre",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      updatedAt: "",
    };
  const edit = (patch: Partial<TransferPricingPolicy>) => setDraft({ ...policy, ...patch });

  // Items this kitchen has distributed, with the cost they carried.
  const items = useMemo(() => {
    const map = new Map<Id, { name: TransferCharge["itemName"]; unitCostMinor: number }>();
    for (const order of data.data?.distributions ?? []) map.set(order.itemId, { name: order.itemName, unitCostMinor: order.unitCostMinor });
    return [...map.entries()].map(([itemId, value]) => ({ itemId, ...value }));
  }, [data.data]);

  // FR-BRN-030 — the internal charge per dispatched line under the saved policy.
  const charges = useMemo<TransferCharge[]>(() => {
    const out: TransferCharge[] = [];
    for (const order of data.data?.distributions ?? []) {
      if (order.status === "draft") continue;
      const dispatchedDay = order.dispatchedAt?.slice(0, 10) ?? "";
      const inForce = saved && dispatchedDay >= saved.effectiveFrom ? saved : null;
      for (const line of order.lines) {
        if (!line.transferId || !(Number(line.allocated) > 0)) continue;
        const unitPriceMinor = transferUnitPrice(inForce, order.itemId, order.unitCostMinor);
        const costMinor = extend(line.allocated, order.unitCostMinor);
        const chargeMinor = unitPriceMinor === null ? null : extend(line.allocated, unitPriceMinor);
        out.push({
          distributionId: order.id,
          number: order.number,
          branchId: line.branchId,
          branchName: line.branchName,
          itemId: order.itemId,
          itemName: order.itemName,
          quantity: line.allocated,
          unitCostMinor: order.unitCostMinor,
          unitPriceMinor,
          costMinor,
          chargeMinor,
          marginMinor: chargeMinor === null ? null : chargeMinor - costMinor,
          dispatchedAt: order.dispatchedAt,
        });
      }
    }
    return out;
  }, [data.data, saved]);

  const byBranch = useMemo(() => {
    const map = new Map<Id, { name: TransferCharge["branchName"]; cost: number; charge: number; unpriced: number }>();
    for (const row of charges) {
      const entry = map.get(row.branchId) ?? { name: row.branchName, cost: 0, charge: 0, unpriced: 0 };
      entry.cost += row.costMinor;
      if (row.chargeMinor === null) entry.unpriced += 1;
      else entry.charge += row.chargeMinor;
      map.set(row.branchId, entry);
    }
    return [...map.entries()].map(([branchId, value]) => ({ branchId, ...value }));
  }, [charges]);

  const totals = charges.reduce(
    (sum, row) => ({ cost: sum.cost + row.costMinor, charge: sum.charge + (row.chargeMinor ?? 0), unpriced: sum.unpriced + (row.chargeMinor === null ? 1 : 0) }),
    { cost: 0, charge: 0, unpriced: 0 },
  );

  if (data.loading && !data.data) return <Skeleton className="h-40" />;
  if (data.error) return <Callout tone="bad">{data.error.message}</Callout>;

  const money = (minor: number) => formatMoney({ amount: minor, currency }, fmt);

  const columns: Column<TransferCharge>[] = [
    { key: "number", header: "#", render: (row) => <span className="font-mono text-xs">{row.number}</span> },
    { key: "branch", header: t("common.branch"), render: (row) => tx(row.branchName) },
    { key: "item", header: t("brn.tp.item"), render: (row) => tx(row.itemName) },
    { key: "qty", header: t("brn.tp.quantity"), numeric: true, render: (row) => <span dir="ltr">{row.quantity}</span> },
    { key: "cost", header: t("brn.tp.cost"), numeric: true, render: (row) => money(row.costMinor) },
    {
      key: "charge",
      header: t("brn.tp.charge"),
      numeric: true,
      render: (row) => (row.chargeMinor === null ? <Badge tone="warn">{t("brn.tp.unpriced")}</Badge> : money(row.chargeMinor)),
    },
  ];

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-fg text-sm font-semibold">{t("brn.tp.title")}</h3>
        <p className="text-fg-muted text-xs">{t("brn.tp.hint")}</p>
      </div>
      {action.error ? <Callout tone="bad">{action.error}</Callout> : null}

      <Field label={t("brn.tp.method")}>
        <SegmentedControl<TransferPricingMethod>
          value={policy.method}
          onChange={(method) => canManage && edit({ method })}
          options={METHODS.map((method) => ({ value: method, label: t(`brn.tp.method.${method}` as ConsoleKey) }))}
        />
      </Field>
      <Badge tone={evaluationFor(policy.method) === "cost_centre" ? "neutral" : "accent"}>
        {t(`brn.tp.eval.${evaluationFor(policy.method)}` as ConsoleKey)}
      </Badge>

      {policy.method === "cost_plus" ? (
        <Field label={t("brn.tp.markup")}>
          <PercentInput value={String(policy.markupPercent)} max={500} disabled={!canManage} onChange={(next) => edit({ markupPercent: Number(next) || 0 })} />
        </Field>
      ) : null}

      {policy.method === "fixed" ? (
        items.length === 0 ? (
          <Callout tone="muted">{t("brn.tp.noItems")}</Callout>
        ) : (
          <ul className="border-line divide-line divide-y rounded-lg border">
            {items.map((item) => (
              <li key={item.itemId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">
                  {tx(item.name)}
                  <span className="text-fg-subtle block text-xs">
                    {t("brn.tp.cost")}: {money(item.unitCostMinor)}
                  </span>
                </span>
                <div className="w-36">
                  <MoneyInput
                    value={policy.fixedPrices[item.itemId] ?? null}
                    currency={currency}
                    disabled={!canManage}
                    aria-label={tx(item.name)}
                    onChange={(minor) => {
                      const next = { ...policy.fixedPrices };
                      if (minor === null) delete next[item.itemId];
                      else next[item.itemId] = minor;
                      edit({ fixedPrices: next });
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <Field label={t("brn.tp.effectiveFrom")} hint={t("brn.tp.effectiveHint")}>
        <Input type="date" dir="ltr" value={policy.effectiveFrom} disabled={!canManage} onChange={(event) => edit({ effectiveFrom: event.target.value })} />
      </Field>

      {canManage ? (
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!draft}
            loading={action.pending}
            onClick={() =>
              action.run(() => services.branchNetwork.transferPricing.put({ ...policy, currency }), {
                onSuccess: () => {
                  setDraft(null);
                  data.reload();
                  onSaved(t("brn.tp.saved"));
                },
              })
            }
          >
            {t("common.save")}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="border-line rounded-lg border p-2">
          <p className="text-fg-muted text-xs">{t("brn.tp.cost")}</p>
          <p className="font-mono text-sm">{money(totals.cost)}</p>
        </div>
        <div className="border-line rounded-lg border p-2">
          <p className="text-fg-muted text-xs">{t("brn.tp.charge")}</p>
          <p className="font-mono text-sm">{money(totals.charge)}</p>
        </div>
        <div className="border-line rounded-lg border p-2">
          <p className="text-fg-muted text-xs">{t("brn.tp.result")}</p>
          <p className="font-mono text-sm">{money(totals.charge - totals.cost)}</p>
        </div>
      </div>
      {totals.unpriced > 0 ? <Callout tone="warn">{t("brn.tp.unpricedNote").replace("{n}", formatNumber(totals.unpriced, fmt))}</Callout> : null}
      {saved ? null : <Callout tone="muted">{t("brn.tp.noPolicy")}</Callout>}

      {byBranch.length > 0 ? (
        <ul className="divide-line divide-y text-sm">
          {byBranch.map((row) => (
            <li key={row.branchId} className="flex items-center justify-between gap-2 py-1.5">
              <span>{tx(row.name)}</span>
              <span className="font-mono text-xs tabular-nums">
                {money(row.charge)} <span className="text-fg-subtle">({t("brn.tp.cost")} {money(row.cost)})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Callout tone="muted">{t("brn.tp.noDispatches")}</Callout>
      )}

      {charges.length > 0 ? (
        <>
          <div className="flex justify-end">
            <ExportButton
              filename={`transfer-charges-${kitchen.code}`}
              title={t("brn.tp.title")}
              rows={charges}
              columns={[
                { key: "number", header: "#", value: (row) => row.number },
                { key: "branch", header: t("common.branch"), value: (row) => tx(row.branchName) },
                { key: "item", header: t("brn.tp.item"), value: (row) => tx(row.itemName) },
                { key: "qty", header: t("brn.tp.quantity"), value: (row) => row.quantity },
                { key: "cost", header: t("brn.tp.cost"), value: (row) => toMajorUnits({ amount: row.costMinor, currency }) },
                { key: "charge", header: t("brn.tp.charge"), value: (row) => (row.chargeMinor === null ? "" : toMajorUnits({ amount: row.chargeMinor, currency })) },
                { key: "margin", header: t("brn.tp.result"), value: (row) => (row.marginMinor === null ? "" : toMajorUnits({ amount: row.marginMinor, currency })) },
              ]}
            />
          </div>
          <DataTable columns={columns} rows={charges} rowKey={(row) => `${row.distributionId}:${row.branchId}`} caption={t("brn.tp.title")} dense />
        </>
      ) : null}
    </section>
  );
}
